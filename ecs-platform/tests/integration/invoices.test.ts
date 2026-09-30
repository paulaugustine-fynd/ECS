import {beforeAll,afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {db} from '../../packages/db/client';
import {seedDemo} from '../../prisma/seed';
import {createServer} from '../../apps/api/src/server';
import {processInbox} from '../../apps/worker/src/inbox';
import {signWebhook} from '../../packages/auth/security';
import {listShipmentInvoices} from '../../packages/domain/invoices';
import seedUsers from '../../seed/users.json';
const id=`invoice-${randomUUID()}`,legId=`leg-${id}`,otherLegId=`other-${id}`;
let app:FastifyInstance,admin:Record<string,string>;
const data={externalOrderId:id,channel:'BLM-AE',invoiceNumber:`INV-${id}`,version:1,status:'ISSUED',url:'https://sfcc.demo.invalid/invoices/example',issuedAt:'2026-09-23T12:00:00.000Z',shipmentIds:[legId]};
async function login(email:string){const r=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password:'Demo123!'}});expect(r.statusCode,r.body).toBe(200);return {cookie:`${r.cookies[0].name}=${r.cookies[0].value}`,'x-csrf-token':r.json().csrfToken};}
async function receive(payload:object,eventId=randomUUID(),companyId='cmp_ati_uae',market='AE',source='SFCC'){
 const raw=JSON.stringify({eventId,type:'invoice.updated',companyId,market,data:payload}),timestamp=String(Math.floor(Date.now()/1000));
 return app.inject({method:'POST',url:`/api/v1/webhooks/${source}`,headers:{'content-type':'application/json','x-webhook-timestamp':timestamp,'x-webhook-signature':signWebhook(raw,timestamp,process.env.WEBHOOK_SECRET!)},payload:raw});
}
beforeAll(async()=>{
 const url=new URL(process.env.DATABASE_URL??'');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/ecs_test')throw Error('Requires isolated local ecs_test');
 if(!(await db.partner.count()))await seedDemo();
 app=await createServer({verifyResponseContracts:true});admin=await login('admin@ati.demo');
 for(const orderId of [id,`other-${id}`])await db.order.create({data:{id:orderId,companyId:'cmp_ati_uae',market:'AE',channel:'BLM-AE',externalId:orderId,currency:'AED',total:'100',correlationId:id,payloadHash:id,lines:[],deliveryCity:'Dubai',routingPolicy:'HISTORICAL',createdAt:new Date('2026-09-22T12:00:00Z')}});
 for(const [shipment,orderId] of [[legId,id],[otherLegId,`other-${id}`]])await db.fulfilmentLeg.create({data:{id:shipment,orderId,companyId:'cmp_ati_uae',market:'AE',partnerId:'vnd_maz',locationId:'fixture',status:'DELIVERED',deliveredAt:new Date('2026-09-23T12:00:00Z'),deadline:new Date('2026-09-24T12:00:00Z'),lines:[],routingTrace:{fixture:true,explanation:'Invoice test only'}}});
});
afterAll(async()=>{await app?.close();await db.$disconnect();});
it('processes a signed invoice reference once, preserves fulfilment and finance, and exposes operator evidence',async()=>{
 const counts={ledger:await db.financialEvent.count(),jobs:await db.outbox.count(),orders:await db.order.count()};
 const eventId=randomUUID(),r=await receive(data,eventId);expect(r.statusCode,r.body).toBe(202);
 expect(await db.invoiceReference.count({where:{orderId:id}})).toBe(0);
 expect(await processInbox(r.json().receiptId)).toBe(true);
 expect((await receive(data,eventId)).json().duplicate).toBe(true);
 const duplicate=await receive(data);expect(await processInbox(duplicate.json().receiptId)).toBe(true);
 expect(await db.invoiceReference.count({where:{orderId:id}})).toBe(1);
 const result=await app.inject({url:`/api/v1/shipments/${legId}/invoices`,headers:admin});expect(result.statusCode,result.body).toBe(200);
 expect(result.json()).toMatchObject({owner:'SFCC',merchantOfRecord:'ATI',items:[{invoiceNumber:data.invoiceNumber,status:'ISSUED',version:1,receiptId:r.json().receiptId}]});
 expect(result.body).not.toContain('payloadHash');
 expect(await db.auditEvent.count({where:{action:'invoice.sfcc-reference',entityId:result.json().items[0].id}})).toBe(1);
 expect({ledger:await db.financialEvent.count(),jobs:await db.outbox.count(),orders:await db.order.count()}).toEqual(counts);
 expect((await db.fulfilmentLeg.findUniqueOrThrow({where:{id:legId}})).status).toBe('DELIVERED');
});
it('limits references to authorized ATI roles, company and market without vendor leakage',async()=>{
 for(const u of await db.user.findMany({where:{email:{in:[...seedUsers.map(u=>u.email),'auditor@ati.demo','finance@maisonazure.demo']}}})){
  const h=await login(u.email),allowed=['ATI_SUPER_ADMIN','ATI_OPERATIONS_MANAGER','ATI_FINANCE_ANALYST','ATI_AUDITOR'].includes(u.role);
  const r=await app.inject({url:`/api/v1/shipments/${legId}/invoices`,headers:h});expect(r.statusCode,r.body).toBe(allowed?200:403);
  if(u.role.startsWith('VENDOR_'))expect(r.body).not.toContain(data.invoiceNumber);
 }
 const actor={id:'test',role:'ATI_SUPER_ADMIN',partnerId:null,companyId:'cmp_ati_uae',markets:['SA']};
 await expect(listShipmentInvoices(actor,legId)).rejects.toMatchObject({code:'NOT_FOUND'});
 await expect(listShipmentInvoices({...actor,markets:['AE'],companyId:'other-company'},legId)).rejects.toMatchObject({code:'NOT_FOUND'});
 const vendor=await login('admin@maisonazure.demo');
 for(const path of ['/orders','/shipments',`/shipments/${legId}`]){
  const r=await app.inject({url:`/api/v1${path}`,headers:vendor});expect(r.statusCode,r.body).toBe(200);expect(r.body).not.toContain(data.invoiceNumber);expect(r.body).not.toContain('invoiceReferences');
 }
});
it('rejects unsafe or foreign references and sends permanent failures to the replayable inbox DLQ',async()=>{
 const badPayloads=[{...data,url:'javascript:alert(1)'},{...data,url:'https://untrusted.example/invoice'},{...data,url:'https://sfcc.demo.invalid/invoice?secret=token'},{...data,shipmentIds:[otherLegId]},{...data,shipmentIds:[legId,legId]},{...data,issuedAt:'2026-09-01T00:00:00.000Z'},{...data,url:'https://user:password@sfcc.demo.invalid/invoice'},{...data,url:'https://sfcc.demo.invalid:444/invoice'}];
 for(const payload of badPayloads){const r=await receive(payload);expect(await processInbox(r.json().receiptId)).toBe(false);expect((await db.inbox.findUniqueOrThrow({where:{id:r.json().receiptId}})).status).toBe('DEAD_LETTER');}
 for(const [company,market] of [['other-company','AE'],['cmp_ati_uae','SA']]){const r=await receive(data,randomUUID(),company,market);expect(r.statusCode,r.body).toBe(400);}
 const wrongSource=await receive(data,randomUUID(),'cmp_ati_uae','AE','FYND');expect(wrongSource.statusCode).toBe(202);expect(await processInbox(wrongSource.json().receiptId)).toBe(false);
 expect((await db.invoiceReference.findFirstOrThrow({where:{orderId:id}})).version).toBe(1);
 const unsigned=await app.inject({method:'POST',url:'/api/v1/webhooks/SFCC',payload:{eventId:randomUUID(),type:'invoice.updated',companyId:'cmp_ati_uae',market:'AE',data}});expect(unsigned.statusCode).toBe(401);
});
it('records sequential revisions and voids without allowing stale, conflicting or reassigned invoices',async()=>{
 for(const payload of [{...data,url:'https://sfcc.demo.invalid/invoices/changed'},{...data,version:3},{...data,version:2,externalOrderId:`other-${id}`,shipmentIds:[otherLegId]}]){const r=await receive(payload);expect(await processInbox(r.json().receiptId)).toBe(false);}
 const revised={...data,version:2,url:'https://sfcc.demo.invalid/invoices/revised'};
 expect(await processInbox((await receive(revised)).json().receiptId)).toBe(true);
 expect(await processInbox((await receive(data)).json().receiptId)).toBe(false);
 const voided={...revised,version:3,status:'VOIDED'};expect(await processInbox((await receive(voided)).json().receiptId)).toBe(true);
 expect(await processInbox((await receive({...voided,version:4,status:'ISSUED'})).json().receiptId)).toBe(false);
 const invoice=await db.invoiceReference.findFirstOrThrow({where:{orderId:id}});expect(invoice).toMatchObject({version:3,status:'VOIDED'});
 const history=await db.auditEvent.findMany({where:{entityId:invoice.id,action:'invoice.sfcc-reference'},orderBy:{createdAt:'asc'}});expect(history).toHaveLength(3);expect(history[1].before).toMatchObject({version:1});expect(history[2].after).toMatchObject({status:'VOIDED'});
});
it('supports delayed fulfilment repair/replay and guards the presenter simulator',async()=>{
 await db.fulfilmentLeg.update({where:{id:otherLegId},data:{status:'PACKED'}});
 const payload={...data,externalOrderId:`other-${id}`,invoiceNumber:`INV-OTHER-${id}`,shipmentIds:[otherLegId]};
 const r=await receive(payload),receiptId=r.json().receiptId;expect(await processInbox(receiptId)).toBe(false);
 expect((await db.inbox.findUniqueOrThrow({where:{id:receiptId}})).error).toContain('INVOICE_BEFORE_FULFILMENT');
 const body={shipmentId:otherLegId,invoiceNumber:`DEMO-${id}`};
 expect((await app.inject({method:'POST',url:'/api/v1/demo/invoices',headers:admin,payload:body})).statusCode).toBe(409);
 await db.fulfilmentLeg.update({where:{id:otherLegId},data:{status:'DISPATCHED'}});
 const replay=await app.inject({method:'POST',url:`/api/v1/integrations/inbox/${receiptId}/replay`,headers:admin,payload:{reason:'Fulfilment has now been acknowledged'}});expect(replay.statusCode,replay.body).toBe(200);
 expect(await processInbox(receiptId)).toBe(true);
 expect((await db.exception.findFirstOrThrow({where:{kind:'INBOX_DLQ',entityId:receiptId}})).status).toBe('RESOLVED');
 const vendor=await login('admin@maisonazure.demo');expect((await app.inject({method:'POST',url:'/api/v1/demo/invoices',headers:vendor,payload:body})).statusCode).toBe(403);
 expect((await app.inject({method:'POST',url:'/api/v1/demo/invoices',headers:{cookie:admin.cookie},payload:body})).statusCode).toBe(403);
 const simulated=await app.inject({method:'POST',url:'/api/v1/demo/invoices',headers:admin,payload:body});expect(simulated.statusCode,simulated.body).toBe(200);
 const accepted=await db.inbox.findUniqueOrThrow({where:{id:simulated.json().receiptId}});
 expect(accepted.envelopeVersion).toBe(1);
 expect(JSON.parse(accepted.rawEnvelope!)).toMatchObject({version:1,producer:'SFCC',type:'invoice.updated',subject:{entityType:'INVOICE',entityId:body.invoiceNumber},metadata:{demoOnly:true}});
 expect(await processInbox(accepted.id)).toBe(true);
 expect(await db.invoiceReference.findFirstOrThrow({where:{receiptId:accepted.id}})).toMatchObject({invoiceNumber:body.invoiceNumber,orderId:`other-${id}`});
 const duplicate=await app.inject({method:'POST',url:'/api/v1/demo/invoices',headers:admin,payload:body});expect(duplicate.json().duplicate).toBe(true);
 const retained=await db.inbox.findUniqueOrThrow({where:{id:accepted.id}});
 expect(retained.rawEnvelope).toBe(accepted.rawEnvelope);expect(retained.correlationId).toBe(accepted.correlationId);
});
