import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {db} from '../../packages/db/client';
import {seedDemo} from '../../prisma/seed';
import {createServer} from '../../apps/api/src/server';
import {createMockServer} from '../../apps/mock-systems/src/server';
import {processOutbox} from '../../apps/worker/src/outbox';
import {digest} from '../../packages/auth/security';
import {transaction,enqueue,json} from '../../packages/db/transaction';
import {createStatement,commandStatement,ledger} from '../../packages/domain/finance';
import {reconciliationDetail,scanReconciliation,resolveReconciliation} from '../../packages/domain/reconciliation';
import type {Actor} from '../../packages/auth/policy';
const company=`recon-${randomUUID()}`,partner=`p-${company}`,legId=`leg-${company}`,actors=new Map<string,Actor>(),auth=new Map<string,Record<string,string>>();
const target={entityType:'SHIPMENT' as const,id:legId},reason='Review missing delivery evidence in isolated reconciliation fixture';
const line={id:'line-a',sku:'RECON-SKU',productId:'test-product',inventoryId:'test-stock',quantity:2,unitGross:'100.00',vendorDiscount:'10.00',operatorDiscount:'5.00',net:'185.00',commissionRate:'0.20',agreementId:'fixture',agreementVersion:1};
let app:FastifyInstance,mock:FastifyInstance,issueId:string,fyndId:string;
async function ack(target:'FYND'|'SFCC',operation:string,payload:unknown){
 const actor=actors.get('admin')!,job=await transaction(tx=>enqueue(tx,actor,company,target,operation,legId,payload,randomUUID(),partner));
 // Execute the actual deterministic mock route, not a forged response.
 const response=await mock.inject({method:'POST',url:`/systems/${target}/${operation}`,headers:{'content-type':'application/json','x-mock-secret':process.env.MOCK_SECRET!,'x-idempotency-key':job.idempotencyKey},payload:JSON.stringify(job.payload)});expect(response.statusCode,response.body).toBe(200);
 await db.outbox.update({where:{id:job.id},data:{status:'SUCCEEDED',response:json(response.json())}});return response.json().externalId as string;
}
beforeAll(async()=>{
 const u=new URL(process.env.DATABASE_URL??'');if(!['localhost','127.0.0.1'].includes(u.hostname)||u.pathname!=='/ecs_test')throw Error('Isolated ecs_test required');if(!await db.partner.count())await seedDemo();
 const seed=await db.user.findUniqueOrThrow({where:{email:'admin@ati.demo'}});app=await createServer({verifyResponseContracts:true});mock=createMockServer();await mock.listen({host:'127.0.0.1',port:4101});
 await db.partner.create({data:{id:partner,companyId:company,code:company,displayName:'Reconciliation fixture',legalName:'Fictional company',markets:['AE'],erpVendorId:'mock-erp-fixture'}});
 for(const [name,role,companyId,partnerId,markets] of [['admin','ATI_SUPER_ADMIN',company,null,['AE']],['finance','ATI_FINANCE_ANALYST',company,null,['AE']],['auditor','ATI_AUDITOR',company,null,['AE']],['vendor','VENDOR_ADMIN',company,partner,['AE']],['ops','ATI_OPERATIONS_MANAGER',company,null,['AE']],['foreign','ATI_SUPER_ADMIN','foreign-'+company,null,['AE']],['sa','ATI_SUPER_ADMIN',company,null,['SA']]] as const){const actor=await db.user.create({data:{name,companyId,role,partnerId,markets:[...markets],email:`${name}-${company}@test.invalid`,passwordHash:seed.passwordHash}});actors.set(name,actor);const r=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:actor.email,password:'Demo123!'}});expect(r.statusCode,r.body).toBe(200);auth.set(name,{cookie:`${r.cookies[0].name}=${r.cookies[0].value}`,'x-csrf-token':r.json().csrfToken});}
 const payload={externalOrderId:company,channel:'BLM-AE',currency:'AED',deliveryCity:'Dubai',routingPolicy:'HYBRID_WATERFALL',total:'185.00',lines:[{id:line.id,sku:line.sku,quantity:line.quantity,unitGross:line.unitGross,vendorDiscount:line.vendorDiscount,operatorDiscount:line.operatorDiscount}]};
 const order=await db.order.create({data:{companyId:company,market:'AE',channel:'BLM-AE',externalId:company,currency:'AED',total:185,correlationId:company,payloadHash:digest(JSON.stringify(payload)),lines:payload.lines,deliveryCity:'Dubai',routingPolicy:'HYBRID_WATERFALL'}});
 await db.inbox.create({data:{source:'SFCC',eventId:randomUUID(),type:'order.created',companyId:company,market:'AE',payload,payloadHash:digest(JSON.stringify(payload)),correlationId:company,status:'PROCESSED'}});
 await db.fulfilmentLeg.create({data:{id:legId,companyId:company,partnerId:partner,market:'AE',orderId:order.id,locationId:'test-location',status:'DELIVERED',deliveredAt:new Date(),deadline:new Date(),lines:[line],routingTrace:[]}});
 fyndId=await ack('FYND','createShipment',{leg:{id:legId,orderId:order.id,lines:[line]}});await db.fulfilmentLeg.update({where:{id:legId},data:{fyndId}});
 await ack('FYND','transitionShipment',{next:'DELIVERED',from:'DISPATCHED',fyndShipmentId:fyndId});
 await ack('SFCC','shipmentStatus',{status:'DELIVERED',shipmentId:legId,externalOrderId:company,currency:'AED'});
});
afterAll(async()=>{await app?.close();await mock?.close();await db.user.deleteMany({where:{companyId:{in:[company,'foreign-'+company]}}});await db.$disconnect();});
it('detects a missing transaction ledger, records one durable case on repeated scans, and leaves business values untouched',async()=>{
 const url='/api/v1/reconciliation/evidence?'+new URLSearchParams(target),before=[await db.financialEvent.count(),await db.outbox.count(),await db.order.count()];
 const r=await app.inject({url,headers:auth.get('admin')});expect(r.statusCode,r.body).toBe(200);expect(r.json().checks.filter((c:{status:string})=>c.status!=='MATCH')).toMatchObject([{key:'LEDGER:line-a',status:'MISSING'}]);expect(await db.reconciliationIssue.count({where:{companyId:company}})).toBe(0);
 const results=await Promise.all([1,2].map(()=>scanReconciliation(actors.get('finance')!,{...target,reason},company)));expect(results.map(r=>r.failedChecks)).toEqual([1,1]);
 const issues=await db.reconciliationIssue.findMany({where:{companyId:company}});expect(issues).toHaveLength(1);issueId=issues[0].id;expect(issues[0]).toMatchObject({status:'OPEN',version:1,firstActual:'No eligible evidence recorded'});
 expect(await db.auditEvent.count({where:{companyId:company,action:'reconciliation.detected'}})).toBe(1);expect([await db.financialEvent.count(),await db.outbox.count(),await db.order.count()]).toEqual(before);
});
it('refuses blind closure, then resolves only after an idempotent source repair and preserves first evidence',async()=>{
 const input={expectedVersion:1,reason:'Delivery acknowledgement replay repaired the missing immutable ledger'};
 await expect(resolveReconciliation(actors.get('finance')!,issueId,input,company)).rejects.toMatchObject({code:'MISMATCH_UNRESOLVED'});
 const repairUrl=`/api/v1/reconciliation/shipments/${legId}/repair-ledger`,repairInput={expectedShipmentVersion:1,reason:input.reason};
 for(const name of ['auditor','vendor','ops'])expect((await app.inject({method:'POST',url:repairUrl,headers:auth.get(name),payload:repairInput})).statusCode).toBe(403);
 expect((await app.inject({method:'POST',url:repairUrl,headers:{cookie:auth.get('finance')!.cookie},payload:repairInput})).statusCode).toBe(403);
 expect((await app.inject({method:'POST',url:repairUrl,headers:auth.get('finance'),payload:{...repairInput,expectedShipmentVersion:2}})).statusCode).toBe(409);
 for(const expected of [4,0]){const repair=await app.inject({method:'POST',url:repairUrl,headers:auth.get('finance'),payload:repairInput});expect(repair.statusCode,repair.body).toBe(200);expect(repair.json()).toEqual({shipmentId:legId,createdEntries:expected,actualMoneyMoved:false});}expect(await db.financialEvent.count({where:{companyId:company}})).toBe(4);
 const report=await reconciliationDetail(actors.get('admin')!,target);expect(report.checks.every(c=>c.status==='MATCH')).toBe(true);expect(report.issues[0].status).toBe('OPEN');
 const response=await app.inject({method:'POST',url:`/api/v1/reconciliation/issues/${issueId}/resolve`,headers:auth.get('finance'),payload:input});expect(response.statusCode,response.body).toBe(200);expect(response.json()).toMatchObject({status:'RESOLVED',version:2,firstActual:'No eligible evidence recorded'});expect(response.json().actual).toContain('200.000');
 await expect(resolveReconciliation(actors.get('admin')!,issueId,input,company)).rejects.toMatchObject({code:'STALE_RECONCILIATION'});
 const saved=await db.reconciliationIssue.findUniqueOrThrow({where:{id:issueId}});await expect(db.reconciliationIssue.update({where:{id:issueId},data:{firstActual:'erase original'}})).rejects.toThrow();await expect(db.reconciliationIssue.delete({where:{id:issueId}})).rejects.toThrow();await expect(db.reconciliationIssue.create({data:{...saved,id:randomUUID(),checkKey:'FOREIGN',partnerId:'not-owner'}})).rejects.toThrow();
 expect((await reconciliationDetail(actors.get('auditor')!,target)).history.some(h=>h.action==='reconciliation.resolved'&&h.reason===input.reason)).toBe(true);
});
it('compares immutable settlement evidence with an actual Finance mock dispatch and never treats export as payment',async()=>{
 const actor=actors.get('finance')!,clock=await db.demoClock.findUniqueOrThrow({where:{id:'main'}}),from=new Date(clock.now.getTime()-86400000),to=new Date(clock.now.getTime()+86400000);
 let statement=await createStatement(actor,{partnerId:partner,from:from.toISOString(),to:to.toISOString()},company);
 for(const action of ['calculate','review','lock','export'] as const)statement=await commandStatement(actor,statement.id,{action,expectedVersion:statement.version,reason:'Isolated transaction reconciliation verification'},company);
 const t={entityType:'SETTLEMENT' as const,id:statement.id};expect(statement.payable.toFixed(2)).toBe('152.00');
 const before=await reconciliationDetail(actor,t);expect(before.checks.map(c=>c.status)).toEqual(['MATCH','MATCH','MISSING']);await scanReconciliation(actor,{...t,reason},company);
 const job=await db.outbox.findFirstOrThrow({where:{aggregateId:statement.id,operation:'exportStatement'}});expect(await processOutbox(job.id)).toBe(true);
 const after=await reconciliationDetail(actor,t);expect(after.checks.every(c=>c.status==='MATCH')).toBe(true);expect((await db.settlement.findUniqueOrThrow({where:{id:statement.id}})).status).toBe('EXPORTED');
 await resolveReconciliation(actor,after.issues[0].id,{expectedVersion:1,reason:'Finance mock acknowledgement now matches the locked statement and ledger'},company);
 expect(await db.financialEvent.count({where:{companyId:company,kind:'PAYOUT_CONFIRMED'}})).toBe(0);
});
it('reopens a recurrent discrepancy without erasing original values or changing immutable financial events',async()=>{
 await transaction(tx=>ledger(tx,actors.get('admin')!,partner,'SALE_RECOGNISED','1.00',`${legId}:line-a`,randomUUID(),{fixture:'Intentional duplicate sale for recurrence test'}));
 await scanReconciliation(actors.get('finance')!,{...target,reason:'A new duplicate source entry requires a fresh investigation'},company);
 const issue=await db.reconciliationIssue.findUniqueOrThrow({where:{id:issueId}});expect(issue).toMatchObject({status:'OPEN',version:3,firstActual:'No eligible evidence recorded',resolvedAt:null});expect(issue.actual).toContain('1.000');
 expect(await db.auditEvent.count({where:{entityId:issueId,action:'reconciliation.reopened'}})).toBe(1);
 const repair=await app.inject({method:'POST',url:`/api/v1/reconciliation/shipments/${legId}/repair-ledger`,headers:auth.get('finance'),payload:{expectedShipmentVersion:1,reason}});expect(repair.statusCode).toBe(409);expect(repair.json().error.code).toBe('LEDGER_REPAIR_UNSAFE');
 await expect(resolveReconciliation(actors.get('finance')!,issueId,{expectedVersion:3,reason},company)).rejects.toMatchObject({code:'MISMATCH_UNRESOLVED'});
});
it('restricts scans/resolution by role, CSRF, company and market and serializes only declared response fields',async()=>{
 const get='/api/v1/reconciliation/evidence?'+new URLSearchParams(target),post='/api/v1/reconciliation/scan',payload={...target,reason};
 expect((await app.inject({url:get})).statusCode).toBe(401);
 for(const name of ['vendor','ops']){expect((await app.inject({url:get,headers:auth.get(name)})).statusCode).toBe(403);expect((await app.inject({method:'POST',url:post,headers:auth.get(name),payload})).statusCode).toBe(403);}
 for(const name of ['foreign','sa']){expect((await app.inject({url:get,headers:auth.get(name)})).statusCode).toBe(404);expect((await app.inject({method:'POST',url:post,headers:auth.get(name),payload})).statusCode).toBe(404);expect((await app.inject({method:'POST',url:`/api/v1/reconciliation/issues/${issueId}/resolve`,headers:auth.get(name),payload:{reason,expectedVersion:3}})).statusCode).toBe(404);}
 expect((await app.inject({url:get,headers:auth.get('auditor')})).statusCode).toBe(200);expect((await app.inject({method:'POST',url:post,headers:auth.get('auditor'),payload})).statusCode).toBe(403);
 expect((await app.inject({method:'POST',url:post,headers:{cookie:auth.get('admin')!.cookie},payload})).statusCode).toBe(403);
 for(const bad of [{reason:'short'},{entityType:'ORDER'},{companyId:'foreign'}])expect((await app.inject({method:'POST',url:post,headers:auth.get('admin'),payload:{...payload,...bad}})).statusCode).toBe(400);
 const list=await app.inject({url:'/api/v1/reconciliation?market=AE&status=ALL',headers:auth.get('finance')});expect(list.statusCode,list.body).toBe(200);expect(list.json().total).toBe(2);expect(list.body).not.toMatch(/passwordHash|x-mock-secret|payloadHash/);
});
it('detects mismatched identity, premature ledger and inconsistent captured net, with transactional rollback on audit failure',async()=>{
 await db.fulfilmentLeg.update({where:{id:legId},data:{fyndId:'wrong-identity',status:'ASSIGNED',lines:[{...line,net:'999'}]}});
 const report=await reconciliationDetail(actors.get('admin')!,target);expect(report.checks.find(c=>c.key==='FYND_REFERENCE')?.status).toBe('MISMATCH');expect(report.checks.find(c=>c.key==='LINE_NET:line-a')?.status).toBe('MISMATCH');expect(report.checks.find(c=>c.key==='LEDGER:line-a')?.status).toBe('MISMATCH');
 const dbFns=await import('../../packages/db/transaction'),spy=vi.spyOn(dbFns,'audit').mockRejectedValueOnce(Error('Audit write failed'));
 const before=await db.reconciliationIssue.count({where:{companyId:company}});
 try{await expect(scanReconciliation(actors.get('admin')!,{...target,reason},company)).rejects.toThrow('Audit write failed');expect(await db.reconciliationIssue.count({where:{companyId:company}})).toBe(before);}finally{spy.mockRestore();await db.fulfilmentLeg.update({where:{id:legId},data:{fyndId,status:'DELIVERED',lines:[line]}});}
});
