import { beforeAll,afterAll,describe,it,expect } from 'vitest';
import { db } from '../../packages/db/client';
import { seedDemo } from '../../prisma/seed';
import { createServer } from '../../apps/api/src/server';
import { createMockServer } from '../../apps/mock-systems/src/server';
import { processOutbox } from '../../apps/worker/src/outbox';
import { signWebhook } from '../../packages/auth/security';
import { adapter } from '../../packages/integrations/adapter';
import {captureDestination} from '../../packages/integrations/destination';
import { processInbox } from '../../apps/worker/src/inbox';
import { demoOrder } from '../../seed/demo-order';
import { ingestOrder,orderInput,type ReservedLine } from '../../packages/domain/orders';
import { transaction,enqueue } from '../../packages/db/transaction';
import { sampleApplication } from '../../prisma/document-fixtures';
import {selectAgreement,commercialRate} from '../../packages/domain/commercials';
import {reconcileAvailability} from '../../packages/domain/inventory';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {mutateWorkbook,replaceCell} from '../helpers/xlsx';
import {importFields} from '../../packages/domain/catalog-import';
import {inventoryReadiness} from '../../packages/domain/launch-inventory';
import {readiness,commandPartner} from '../../packages/domain/partners';
import {provisionFixture} from '../helpers/provision';
import {validGtin} from '../../packages/domain/calculations';
import type { FastifyInstance } from 'fastify';
let app:FastifyInstance,mocks:FastifyInstance;
type Login={cookie:string;csrf:string};
const sessions=new Map<string,Login>();
async function login(email:string):Promise<Login>{const cached=sessions.get(email);if(cached)return cached;const res=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password:'Demo123!'}});expect(res.statusCode,res.body).toBe(200);const auth={cookie:res.cookies[0].name+'='+res.cookies[0].value,csrf:res.json().csrfToken};sessions.set(email,auth);return auth;}
const headers=(auth:Login)=>({cookie:auth.cookie,'x-csrf-token':auth.csrf});
beforeAll(async()=>{
  const url=new URL(process.env.DATABASE_URL??'');
  if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/ecs_test')throw new Error('Integration tests require the isolated local ecs_test database. They never reset ecs_demo.');
  await db.catalogImport.deleteMany();
  await db.mockStorefrontProduct.deleteMany();
  await db.mockInventory.deleteMany();
  await db.invitation.deleteMany();
  await db.slaMilestone.deleteMany();await db.slaPolicy.deleteMany();
  await db.notificationPolicy.deleteMany();
  await db.$executeRawUnsafe('TRUNCATE TABLE "ReconciliationIssue", "MockMapping", "LaunchTest", "MockLaunchOrder", "Session", "User", "Document", "Agreement", "Publication", "Inventory", "Location", "Product", "Partner", "FulfilmentLeg", "Order", "ReturnCase", "FinancialEvent", "Settlement", "Outbox", "Inbox", "IntegrationAttempt", "AuditEvent", "Exception", "MockRecord", "AdapterFault", "DemoClock" CASCADE');
  await seedDemo();app=await createServer({verifyResponseContracts:true});mocks=createMockServer();await mocks.listen({port:4101,host:'127.0.0.1'});
  for(const partnerId of ['vnd_maz','vnd_lum','vnd_nrh'])await provisionFixture(partnerId);
});
afterAll(async()=>{await app?.close();await mocks?.close();await db.$disconnect();});
describe('real PostgreSQL API boundary',()=>{
  it('seeds replacement size L as a distinct unpublished draft with no borrowed size-M identities',async()=>{
    const m=await db.product.findUniqueOrThrow({where:{id:'prd_maz_dress_1001'}}),l=await db.product.findUniqueOrThrow({where:{id:'prd_maz_dress_1001_l'},include:{publications:true}});
    expect(l.status).toBe('DRAFT');expect(l.publications).toHaveLength(0);expect(l.gtin).not.toBe(m.gtin);expect(validGtin(l.gtin!)).toBe(true);
    expect(l.data).toMatchObject({id:l.id,variantSku:l.sku,gtin:l.gtin,title:{en:l.titleEn,ar:l.titleAr},status:'DRAFT',attributes:{size:'L'},externalIds:{}});
    expect((l.data as {parentSku:string}).parentSku).toBe((m.data as {parentSku:string}).parentSku);
  });
  it('logs in every seeded persona without exposing password hashes',async()=>{
    const users=await db.user.findMany();expect(users).toHaveLength(11);
    for(const user of users){const auth=await login(user.email);const me=await app.inject({url:'/api/v1/auth/me',headers:headers(auth)});expect(me.json().user.email).toBe(user.email);expect(me.body).not.toContain('passwordHash');}
  });
  it('enforces unauthenticated, CSRF, role and partner boundaries',async()=>{
    expect((await app.inject('/api/v1/partners')).statusCode).toBe(401);
    const vendor=await login('admin@maisonazure.demo');
    const list=await app.inject({url:'/api/v1/partners',headers:headers(vendor)});expect(list.json().items.map((p:{id:string})=>p.id)).toEqual(['vnd_maz']);
    expect((await app.inject({url:'/api/v1/partners/vnd_lum',headers:headers(vendor)})).statusCode).toBe(404);
    expect((await app.inject({url:'/api/v1/integrations/jobs',headers:headers(vendor)})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:'/api/v1/partners/vnd_maz/commands',headers:{cookie:vendor.cookie},payload:{action:'pause',expectedVersion:1,reason:'Test reason'}})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:'/api/v1/partners/vnd_maz/commands',headers:headers(vendor),payload:{action:'pause',expectedVersion:1,reason:'Test reason'}})).statusCode).toBe(403);
  });
  it('uses field-level role permissions on partner lists and details for every persona',async()=>{
    let address=1;
    for(const user of await db.user.findMany()){
      const auth=headers(await login(user.email)),id=user.partnerId??'vnd_onboard';
      // Separate simulated clients keep this role matrix out of the long workflow's IP quota.
      const remoteAddress=`127.0.1.${address++}`;
      const list=await app.inject({url:'/api/v1/partners',headers:auth,remoteAddress});expect(list.statusCode,list.body).toBe(200);
      for(const p of list.json().items){expect(p).not.toHaveProperty('application');expect(p).not.toHaveProperty('reviewReason');expect(p).not.toHaveProperty('agreements');}
      const response=await app.inject({url:`/api/v1/partners/${id}`,headers:auth,remoteAddress});expect(response.statusCode,response.body).toBe(200);
      const body=response.json(),application=['ATI_SUPER_ADMIN','ATI_PARTNER_MANAGER','ATI_AUDITOR','VENDOR_ADMIN'].includes(user.role),commercials=['ATI_SUPER_ADMIN','ATI_PARTNER_MANAGER','ATI_AUDITOR','ATI_FINANCE_ANALYST','VENDOR_ADMIN','VENDOR_FINANCE_VIEWER'].includes(user.role);
      expect(body.access.application).toBe(application);expect(body.access.commercials).toBe(commercials);
      if(application){expect(body).toHaveProperty('application');expect(body).toHaveProperty('applicationIssues');}
      else{expect(body).not.toHaveProperty('application');expect(body).not.toHaveProperty('applicationIssues');expect(body).not.toHaveProperty('reviewReason');}
      if(commercials)expect(body.agreements.length).toBeGreaterThan(0);else expect(body).not.toHaveProperty('agreements');
      if(user.role==='ATI_FINANCE_ANALYST'){expect(body.access.documentTypes).toEqual(['BANK_LETTER']);expect(body.documents.map((d:{type:string})=>d.type)).toEqual(['BANK_LETTER']);}
      else if(!application){expect(body.access.documentTypes).toEqual([]);expect(body.documents).toEqual([]);}
      for(const d of body.documents)expect(d).not.toHaveProperty('objectKey');
    }
  });
  it('does not expose another market agreement through the partner detail shortcut',async()=>{
    const id=`contract_${randomUUID()}`;await db.partner.create({data:{id,code:id,companyId:'cmp_ati_uae',legalName:'Contract scope test',displayName:'Contract scope test',markets:['AE','SA']}});
    try{
      await db.agreement.createMany({data:['AE','SA'].map((market,index)=>({partnerId:id,version:index+1,rate:'0.2',currency:market==='AE'?'AED':'SAR',validFrom:new Date('2026-01-01Z'),validUntil:new Date('2027-01-01Z'),rules:{market}}))});
      const res=await app.inject({url:`/api/v1/partners/${id}`,headers:headers(await login('finance@ati.demo')),remoteAddress:'127.0.1.30'});expect(res.statusCode,res.body).toBe(200);
      expect(res.json().agreements.map((a:{currency:string})=>a.currency)).toEqual(['AED']);
      expect(res.json()).not.toHaveProperty('application');
    }finally{await db.agreement.deleteMany({where:{partnerId:id}});await db.partner.delete({where:{id}});}
  });
  it('rejects stale edits and rolls back invalid activation without audit side effects',async()=>{
    const auth=await login('admin@ati.demo');const before=await db.auditEvent.count();
    const res=await app.inject({method:'POST',url:'/api/v1/partners/vnd_onboard/commands',headers:headers(auth),payload:{action:'activate',expectedVersion:1}});
    expect(res.statusCode).toBe(409);expect(await db.auditEvent.count()).toBe(before);
    const stale=await app.inject({method:'POST',url:'/api/v1/partners/vnd_onboard/commands',headers:headers(auth),payload:{action:'review',expectedVersion:99}});expect(stale.statusCode).toBe(409);
  });
  it('reviews documents, approves a partner and atomically creates audit + ERP outbox',async()=>{
    const auth=await login('partner.manager@ati.demo');
    const command=async(action:string)=>{const p=await db.partner.findUniqueOrThrow({where:{id:'vnd_onboard'}});return app.inject({method:'POST',url:'/api/v1/partners/vnd_onboard/commands',headers:headers(auth),payload:{action,expectedVersion:p.version}});};
    expect((await command('review')).statusCode).toBe(200);
    expect((await command('approve')).statusCode).toBe(422);
    for(const doc of await db.document.findMany({where:{partnerId:'vnd_onboard'}})){
      expect((await app.inject({method:'POST',url:`/api/v1/documents/${doc.id}/review`,headers:headers(auth),payload:{status:'APPROVED',reason:'Verified fictional sample'}})).statusCode).toBe(200);
    }
    expect((await command('approve')).statusCode).toBe(200);expect((await command('sync-erp')).statusCode).toBe(200);
    const job=await db.outbox.findUniqueOrThrow({where:{idempotencyKey:'partner:vnd_onboard:erp'}});
    expect(job.status).toBe('PENDING');expect(await db.auditEvent.count({where:{action:'partner.sync-erp'}})).toBe(1);
    await processOutbox(job.id);const persisted=await db.partner.findUniqueOrThrow({where:{id:'vnd_onboard'}});expect(persisted.erpVendorId).toMatch(/^mock-erp-/);
    expect((await db.outbox.findUniqueOrThrow({where:{id:job.id}})).status).toBe('SUCCEEDED');
    expect(await processOutbox(job.id)).toBe(false);
  });
  it('all six mock ports return stable idempotent results',async()=>{
    for(const system of ['FYND','SFCC','ERP','WMS','FINANCE','LOGISTICS'] as const){
      const port=adapter(system),context={idempotencyKey:`test-${system}`,correlationId:'contract-test'};
      const first=await port.execute('contractProbe',{sample:true},context);const second=await port.execute('contractProbe',{sample:true},context);
      expect(second).toEqual(first);expect(first.mode).toBe('mock');
      await expect(port.execute('contractProbe',{sample:false},context)).rejects.toThrow('409');
    }
  });
  it('persists permanent failures in DLQ and permits audited replay',async()=>{
    const auth=await login('admin@ati.demo');
    await db.adapterFault.upsert({where:{system:'ERP'},update:{remaining:1,statusCode:422},create:{system:'ERP',remaining:1,statusCode:422}});
    const job=await db.outbox.create({data:{...captureDestination('ERP'),companyId:'cmp_ati_uae',target:'ERP',operation:'contractProbe',aggregateId:'probe',payload:{sample:true},correlationId:'failure-test',idempotencyKey:'failure-probe'}});
    await processOutbox(job.id);expect((await db.outbox.findUniqueOrThrow({where:{id:job.id}})).status).toBe('DEAD_LETTER');
    const alerts=await db.notification.findMany({where:{entityId:job.id},include:{user:true}});expect(alerts.map(n=>n.user.email).sort()).toEqual(['admin@ati.demo','ops@ati.demo']);expect(alerts.every(n=>n.category==='INTEGRATION'&&!n.message.includes('sample'))).toBe(true);
    const replay=await app.inject({method:'POST',url:`/api/v1/integrations/jobs/${job.id}/replay`,headers:headers(auth),payload:{reason:'Transient fixture corrected'}});expect(replay.statusCode).toBe(200);
    expect((await db.exception.findUniqueOrThrow({where:{kind_entityId:{kind:'INTEGRATION_DLQ',entityId:job.id}}})).status).toBe('REPLAY_REQUESTED');
    await db.adapterFault.update({where:{system:'ERP'},data:{remaining:1,statusCode:422}});await processOutbox(job.id);expect(await db.notification.count({where:{entityId:job.id}})).toBe(4);
    expect((await db.exception.findUniqueOrThrow({where:{kind_entityId:{kind:'INTEGRATION_DLQ',entityId:job.id}}})).status).toBe('OPEN');
    expect((await app.inject({method:'POST',url:`/api/v1/integrations/jobs/${job.id}/replay`,headers:headers(auth),payload:{reason:'Second controlled retry after failure cleared'}})).statusCode).toBe(200);
    await processOutbox(job.id);expect((await db.outbox.findUniqueOrThrow({where:{id:job.id}})).status).toBe('SUCCEEDED');
    expect(await db.integrationAttempt.count({where:{jobId:job.id}})).toBe(3);
    expect((await db.exception.findUniqueOrThrow({where:{kind_entityId:{kind:'INTEGRATION_DLQ',entityId:job.id}}})).resolvedAt).not.toBeNull();
  });
  it('pins queued destinations across config changes and prevents retargeting even during replay',async()=>{
    const actor={id:'integration-test',companyId:'cmp_ati_uae',partnerId:null,markets:['AE'],role:'ATI_SUPER_ADMIN'};
    const make=()=>transaction(tx=>enqueue(tx,actor,'pinned-test','FYND','contractProbe','pinned-probe',{sample:true},'pinned-probe'));
    const job=await make();expect(job.destinationOrigin).toBe('http://127.0.0.1:4101');
    for(const data of [{destinationOrigin:'http://127.0.0.1:4199'},{companyId:'another-company'},{payload:{sample:false}},{destinationMode:'live'}]){
      await expect(db.outbox.update({where:{id:job.id},data})).rejects.toThrow();
    }
    const originalMode=process.env.FYND_MODE,originalOrigin=process.env.MOCK_ORIGIN;
    try{
      process.env.FYND_MODE='live';process.env.MOCK_ORIGIN='https://api.fynd.com';
      await processOutbox(job.id);
      const done=await db.outbox.findUniqueOrThrow({where:{id:job.id}});
      expect(done.status).toBe('SUCCEEDED');expect(done.response).toMatchObject({mode:'mock',system:'FYND'});
      await expect(make()).rejects.toThrow('not tenant-validated');
      process.env.FYND_MODE='mock';process.env.MOCK_ORIGIN='http://127.0.0.1:4199';
      await expect(make()).rejects.toThrow('already bound');
    }finally{
      if(originalMode===undefined)delete process.env.FYND_MODE;else process.env.FYND_MODE=originalMode;
      process.env.MOCK_ORIGIN=originalOrigin;
    }
    // The existing replay test exercises lease/status updates under the same trigger.
    expect((await db.outbox.findUniqueOrThrow({where:{id:job.id}})).destinationOrigin).toBe('http://127.0.0.1:4101');
  });
  it('verifies signed webhook ingress and deduplicates concurrent receipts',async()=>{
    const raw=JSON.stringify({eventId:'evt-1',type:'order.created',companyId:'cmp_ati_uae',market:'AE',data:{sample:true}});const ts=String(Math.floor(Date.now()/1000));
    const hs={'content-type':'application/json','x-webhook-timestamp':ts,'x-webhook-signature':signWebhook(raw,ts,process.env.WEBHOOK_SECRET!)};
    const responses=await Promise.all([1,2].map(()=>app.inject({method:'POST',url:'/api/v1/webhooks/SFCC',headers:hs,payload:raw})));
    responses.forEach(r=>expect(r.statusCode,r.body).toBe(202));expect(await db.inbox.count()).toBe(1);
    expect((await app.inject({method:'POST',url:'/api/v1/webhooks/SFCC',headers:hs,payload:raw+' '})).statusCode).toBe(401);
  });
  it('blocks mutation of database audit history',async()=>{
    await expect(db.auditEvent.update({where:{id:'seed-audit'},data:{action:'tampered'}})).rejects.toThrow();
  });
  it('validates catalogue edits, preserves ownership and requires independent operator moderation',async()=>{
    const admin=await login('admin@ati.demo'),vendor=await login('catalog@lumera.demo');const id='prd_nrh_duvet_4002';
    expect((await app.inject({url:`/api/v1/catalog/items/${id}`,headers:headers(vendor)})).statusCode).toBe(404);
    const detail=await app.inject({url:`/api/v1/catalog/items/${id}`,headers:headers(admin)});
    expect(detail.json().issues.map((i:{code:string})=>i.code)).toEqual(expect.arrayContaining(['ARABIC_TITLE_MISSING','MEDIA_REVIEW_REQUIRED']));
    const p=detail.json();const draft={expectedVersion:p.version,titleEn:p.titleEn,titleAr:'غطاء لحاف من القطن - كوين',gtin:p.gtin,price:'10.00',attributes:p.data.attributes};
    const edit=await app.inject({method:'POST',url:`/api/v1/catalog/items/${id}/draft`,headers:headers(admin),payload:draft});expect(edit.statusCode,edit.body).toBe(200);
    let version=edit.json().version;
    const command=(action:string)=>app.inject({method:'POST',url:`/api/v1/catalog/items/${id}/commands`,headers:headers(admin),payload:{action,expectedVersion:version,reason:'Reviewed fictional sample content'}});
    expect((await command('submit')).statusCode).toBe(422);
    const correction=await app.inject({method:'POST',url:`/api/v1/catalog/items/${id}/draft`,headers:headers(admin),payload:{...draft,expectedVersion:version,price:'795.00'}});expect(correction.statusCode).toBe(200);version=correction.json().version;
    expect((await command('submit')).statusCode).toBe(200);
    expect((await command('request-changes')).statusCode).toBe(200);
    expect((await db.exception.findUniqueOrThrow({where:{kind_entityId:{kind:'CATALOG_REVIEW',entityId:id}}})).status).toBe('OPEN');
    expect((await command('submit')).statusCode).toBe(200);
    expect((await db.exception.findUniqueOrThrow({where:{kind_entityId:{kind:'CATALOG_REVIEW',entityId:id}}})).status).toBe('RESOLVED');
    expect((await command('approve')).statusCode).toBe(422);
    expect((await command('approve-media')).statusCode).toBe(200);
    expect((await command('approve')).statusCode).toBe(200);
    expect((await app.inject({method:'POST',url:'/api/v1/catalog/items/prd_lum_lip_3002/commands',headers:headers(vendor),payload:{action:'publish',expectedVersion:1}})).statusCode).toBe(403);
    expect(await db.outbox.count({where:{aggregateId:id}})).toBe(0);
  });
  it('publishes ERP first, preserves failed target status, and marks live only after all acknowledgements',async()=>{
    const auth=await login('admin@ati.demo');const id='prd_lum_lip_3002';
    const publish=await app.inject({method:'POST',url:`/api/v1/catalog/items/${id}/commands`,headers:headers(auth),payload:{action:'publish',expectedVersion:1}});expect(publish.statusCode,publish.body).toBe(200);
    let jobs=await db.outbox.findMany({where:{aggregateId:id}});expect(jobs.map(j=>j.target)).toEqual(['ERP']);
    expect((await db.publication.findMany({where:{productId:id,target:'SFCC'}}))[0].status).toBe('BLOCKED');
    await db.adapterFault.upsert({where:{system:'ERP'},update:{remaining:1,statusCode:422},create:{system:'ERP',remaining:1,statusCode:422}});
    await processOutbox(jobs[0].id);expect(await db.outbox.count({where:{aggregateId:id}})).toBe(1);
    const replay=async(jobId:string)=>{const res=await app.inject({method:'POST',url:`/api/v1/integrations/jobs/${jobId}/replay`,headers:headers(auth),payload:{reason:'Corrected fixture and retried'}});expect(res.statusCode,res.body).toBe(200);await processOutbox(jobId);};
    await replay(jobs[0].id);jobs=await db.outbox.findMany({where:{aggregateId:id}});expect(jobs).toHaveLength(3);
    const fynd=jobs.find(j=>j.target==='FYND')!,sfcc=jobs.find(j=>j.target==='SFCC')!;
    expect(sfcc.payload).toHaveProperty('erpItemId');await processOutbox(fynd.id);
    await db.adapterFault.upsert({where:{system:'SFCC'},update:{remaining:1,statusCode:422},create:{system:'SFCC',remaining:1,statusCode:422}});
    await processOutbox(sfcc.id);expect((await db.product.findUniqueOrThrow({where:{id}})).status).toBe('PUBLISHING');
    expect((await db.publication.findMany({where:{productId:id,target:'SFCC'}}))[0].status).toBe('FAILED');
    await replay(sfcc.id);expect((await db.product.findUniqueOrThrow({where:{id}})).status).toBe('PUBLISHED');
    expect((await db.exception.findUniqueOrThrow({where:{kind_entityId:{kind:'INTEGRATION_DLQ',entityId:sfcc.id}}})).status).toBe('RESOLVED');
    expect(await db.mockRecord.count({where:{idempotencyKey:`product:${id}:1:SFCC`}})).toBe(1);
  });
  it('updates stock with monotonic source sequence, protects reservations, and ignores late downstream revisions',async()=>{
    const auth=await login('admin@ati.demo');const row=await db.inventory.findFirstOrThrow({where:{productId:'prd_lum_serum_3001'}});
    const payload={expectedSequence:row.sequence,sourceSequence:row.sequence+1,onHand:125,damaged:1,unavailable:1,safetyStock:5,reason:'Cycle count confirmed stock'};
    const adjust=()=>app.inject({method:'POST',url:`/api/v1/inventory/${row.id}/adjust`,headers:headers(auth),payload});
    expect((await adjust()).statusCode).toBe(200);expect((await adjust()).statusCode).toBe(409);
    const bad=await app.inject({method:'POST',url:`/api/v1/inventory/${row.id}/adjust`,headers:headers(auth),payload:{...payload,expectedSequence:2,sourceSequence:3,onHand:1}});expect(bad.statusCode).toBe(422);
    const port=adapter('SFCC');
    for(const revision of [9,8])await port.execute('syncInventory',{inventoryId:row.id,revision,sellable:revision},{idempotencyKey:`sequence-test-${revision}`,correlationId:'stock-test'});
    expect((await db.mockInventory.findUniqueOrThrow({where:{system_inventoryId:{system:'SFCC',inventoryId:row.id}}})).revision).toBe(9);
  });
  it('routes signed SFCC intake into three isolated legs, reserves once and deduplicates distinct receipt IDs',async()=>{
    const before=await db.inventory.findMany();
    async function receive(eventId:string,data:unknown){const raw=JSON.stringify({eventId,type:'order.created',companyId:'cmp_ati_uae',market:'AE',data});const ts=String(Math.floor(Date.now()/1000));const r=await app.inject({method:'POST',url:'/api/v1/webhooks/SFCC',headers:{'content-type':'application/json','x-webhook-timestamp':ts,'x-webhook-signature':signWebhook(raw,ts,process.env.WEBHOOK_SECRET!)},payload:raw});expect(r.statusCode).toBe(202);return r.json().receiptId as string;}
    const receipt=await receive('three-leg-order',demoOrder);expect(await processInbox(receipt)).toBe(true);
    const order=await db.order.findUniqueOrThrow({where:{channel_externalId:{channel:'BLM-AE',externalId:demoOrder.externalOrderId}},include:{legs:true}});expect(order.legs).toHaveLength(3);expect(order.total.toFixed(2)).toBe('2666.00');
    expect(new Set(order.legs.map(l=>l.partnerId)).size).toBe(3);
    for(const leg of order.legs)for(const line of leg.lines as ReservedLine[]){const current=await db.inventory.findUniqueOrThrow({where:{id:line.inventoryId}});expect(current.reserved-before.find(r=>r.id===line.inventoryId)!.reserved).toBe(line.quantity);}
    expect(await processInbox(await receive('same-order-new-event',demoOrder))).toBe(true);
    expect(await db.order.count()).toBe(1);expect(await db.outbox.count({where:{operation:'createOrder'}})).toBe(1);
    const createJob=await db.outbox.findFirstOrThrow({where:{operation:'createOrder'}});await processOutbox(createJob.id);
    for(const job of await db.outbox.findMany({where:{operation:'createShipment'}}))await processOutbox(job.id);
    const vendor=await login('admin@maisonazure.demo');const list=await app.inject({url:'/api/v1/orders',headers:headers(vendor)});expect(list.json().items).toHaveLength(1);expect(list.body).not.toContain('vnd_lum');expect(list.body).not.toContain('2666');
    const other=order.legs.find(l=>l.partnerId==='vnd_lum')!;expect((await app.inject({url:`/api/v1/shipments/${other.id}`,headers:headers(vendor)})).statusCode).toBe(404);
    const corrupt=await receive('conflicting-total',{...demoOrder,total:'1.00'});expect(await processInbox(corrupt)).toBe(false);expect((await db.inbox.findUniqueOrThrow({where:{id:corrupt}})).status).toBe('DEAD_LETTER');
    const alerts=await db.notification.findMany({where:{entityId:corrupt},include:{user:true}});expect(alerts.map(n=>n.user.email).sort()).toEqual(['admin@ati.demo','ops@ati.demo']);expect(alerts.every(n=>n.entityType==='INBOX_RECEIPT'&&!n.message.includes('1.00'))).toBe(true);
    const operator=await login('admin@ati.demo');expect((await app.inject({method:'POST',url:`/api/v1/integrations/inbox/${corrupt}/replay`,headers:headers(operator),payload:{reason:'Verify repeated permanent failure remains actionable'}})).statusCode).toBe(200);
    expect((await db.exception.findUniqueOrThrow({where:{kind_entityId:{kind:'INBOX_DLQ',entityId:corrupt}}})).status).toBe('REPLAY_REQUESTED');
    await processInbox(corrupt);expect((await db.exception.findUniqueOrThrow({where:{kind_entityId:{kind:'INBOX_DLQ',entityId:corrupt}}})).status).toBe('OPEN');expect(await db.notification.count({where:{entityId:corrupt}})).toBe(4);
    expect(await db.order.count()).toBe(1);
  });
  it('returns distinct operator and vendor order contracts with scoped shipment details',async()=>{
    const operator=await login('ops@ati.demo'),vendor=await login('fulfilment@maisonazure.demo');
    const get=(url:string,auth:Login)=>app.inject({url,headers:headers(auth),remoteAddress:'127.0.2.1'});
    const all=await get('/api/v1/orders',operator);expect(all.statusCode,all.body).toBe(200);expect(all.json().view).toBe('orders');
    expect(all.json().items[0].legs).toHaveLength(3);expect(all.json().items[0].total).toBe('2666');
    const own=await get('/api/v1/orders',vendor);expect(own.statusCode,own.body).toBe(200);expect(own.json().view).toBe('shipments');expect(own.json().items).toHaveLength(1);
    const leg=own.json().items[0];expect(leg.partnerId).toBe('vnd_maz');expect(Object.keys(leg.order).sort()).toEqual(['currency','externalId']);
    const list=await get('/api/v1/shipments',vendor);expect(list.statusCode,list.body).toBe(200);expect(list.json().items).toEqual([leg]);
    const detail=await get(`/api/v1/shipments/${leg.id}`,vendor);expect(detail.statusCode,detail.body).toBe(200);expect(detail.json()).toEqual(leg);
    expect(own.body).not.toContain('vnd_lum');expect(own.body).not.toContain('vnd_nrh');
    expect((await get('/api/v1/orders?market=SA',vendor)).statusCode).toBe(403);
    expect((await get('/api/v1/orders',await login('catalog@lumera.demo'))).statusCode).toBe(403);
  });
  it('returns pending then duplicate simulator receipts without claiming order processing',async()=>{
    const auth=await login('admin@ati.demo'),before=await db.order.count();
    const submit=()=>app.inject({method:'POST',url:'/api/v1/demo/orders',headers:headers(auth),remoteAddress:'127.0.2.2',payload:{externalOrderId:'CONTRACT-SIMULATOR-ONLY'}});
    const first=await submit();expect(first.statusCode,first.body).toBe(200);expect(first.json()).toMatchObject({status:'PENDING',sourceMode:'signed-sfcc-simulator'});
    const second=await submit();expect(second.statusCode,second.body).toBe(200);expect(second.json()).toEqual({receiptId:first.json().receiptId,duplicate:true,sourceMode:'signed-sfcc-simulator'});
    const saved=await db.inbox.findUniqueOrThrow({where:{id:first.json().receiptId}});expect(saved.envelopeVersion).toBe(1);expect(JSON.parse(saved.rawEnvelope!)).toMatchObject({producer:'SFCC',version:1,metadata:{demoOnly:true}});
    expect(await db.order.count()).toBe(before);
    expect((await db.inbox.findUniqueOrThrow({where:{id:first.json().receiptId}})).status).toBe('PENDING');
  });
  it('fulfils one leg with Fynd acknowledgements, quantity guards, packing slip and exact stock movement',async()=>{
    const auth=await login('admin@maisonazure.demo');let leg=await db.fulfilmentLeg.findFirstOrThrow({where:{partnerId:'vnd_maz'}});const line=(leg.lines as ReservedLine[])[0];const stock=await db.inventory.findUniqueOrThrow({where:{id:line.inventoryId}});
    const operator=await login('ops@ati.demo');
    const command=(next:string,extra:Record<string,unknown>={})=>app.inject({method:'POST',url:`/api/v1/shipments/${leg.id}/commands`,headers:headers(next==='DELIVERED'?operator:auth),payload:{expectedVersion:leg.version,next,...extra}});
    expect((await command('DISPATCHED')).statusCode).toBe(409);
    for(const next of ['ACCEPTED','PICKING','PACKED','READY_TO_DISPATCH','DISPATCHED','DELIVERED']){
      if(next==='PACKED')expect((await command(next)).statusCode).toBe(422);
      if(next==='DISPATCHED')expect((await command(next)).statusCode).toBe(422);
      const response=await command(next,{...(next==='PACKED'?{confirmedQuantities:{[line.id]:line.quantity}}:{}),...(next==='DISPATCHED'?{tracking:'ATI-MOCK-123456'}:{})});expect(response.statusCode,response.body).toBe(200);
      expect(response.json().status).toBe(leg.status);expect(response.json().requestedStatus).toBe(next);
      const job=await db.outbox.findFirstOrThrow({where:{aggregateId:leg.id,operation:'transitionShipment',status:'PENDING'}});await processOutbox(job.id);leg=await db.fulfilmentLeg.findUniqueOrThrow({where:{id:leg.id}});expect(leg.status).toBe(next);expect(leg.requestedStatus).toBe(null);
    }
    const after=await db.inventory.findUniqueOrThrow({where:{id:line.inventoryId}});expect(after.onHand).toBe(stock.onHand-line.quantity);expect(after.reserved).toBe(stock.reserved-line.quantity);
    const facts=(await db.outbox.findFirstOrThrow({where:{aggregateId:leg.id,target:'SFCC',operation:'shipmentStatus'},orderBy:{createdAt:'desc'}})).payload;
    expect(facts).toMatchObject({externalOrderId:demoOrder.externalOrderId,channel:'BLM-AE',currency:'AED',shipmentId:leg.id,fyndShipmentId:leg.fyndId,status:'DELIVERED',tracking:'ATI-MOCK-123456',lines:[{id:line.id,sku:line.sku,quantity:line.quantity}],merchantOfRecord:'ATI',invoiceOwner:'SFCC'});
    expect(facts).not.toHaveProperty('taxInvoice');expect(facts).not.toHaveProperty('commissionRate');
    const slip=await app.inject({url:`/api/v1/shipments/${leg.id}/packing-slip`,headers:headers(auth)});expect(slip.statusCode).toBe(200);expect(slip.body).toContain('This is not a VAT invoice');expect(slip.body).not.toContain('LUM-SRM');
  });
  it('recognizes delivery, processes good-QC returns once and separates refund from vendor reversal',async()=>{
    const auth=await login('ops@ati.demo'),finance=await login('finance@ati.demo');let leg=await db.fulfilmentLeg.findFirstOrThrow({where:{partnerId:'vnd_lum'}});const line=(leg.lines as ReservedLine[])[0];
    for(const next of ['ACCEPTED','PICKING','PACKED','READY_TO_DISPATCH','DISPATCHED','DELIVERED']){
      const res=await app.inject({method:'POST',url:`/api/v1/shipments/${leg.id}/commands`,headers:headers(auth),payload:{expectedVersion:leg.version,next,...(next==='PACKED'?{confirmedQuantities:{[line.id]:2}}:{}),...(next==='DISPATCHED'?{tracking:'LUM-MOCK-12345'}:{})}});expect(res.statusCode,res.body).toBe(200);
      await processOutbox((await db.outbox.findFirstOrThrow({where:{aggregateId:leg.id,operation:'transitionShipment',status:'PENDING'}})).id);leg=await db.fulfilmentLeg.findUniqueOrThrow({where:{id:leg.id}});
    }
    const sales=await db.financialEvent.findMany({where:{partnerId:'vnd_lum'}});expect(sales.reduce((s,e)=>s+Number(e.amount),0)).toBeCloseTo(391.68);
    const payload={legId:leg.id,lineId:line.id,quantity:1,reason:'Customer requested a return',requestId:'lum-good-qc'};
    const request=()=>app.inject({method:'POST',url:'/api/v1/returns',headers:headers(auth),payload});const res=await request();expect(res.statusCode,res.body).toBe(200);const id=res.json().id;expect((await request()).json().id).toBe(id);
    expect(res.json().refund).toBe('288');expect(res.json().payableReversal).toBe('195.84');expect(res.json().chargeback).toBe('20');
    const before=await db.inventory.findUniqueOrThrow({where:{id:line.inventoryId}});
    for(const action of ['approve','book-pickup','receive','qc-good']){
      const r=await db.returnCase.findUniqueOrThrow({where:{id}});const response=await app.inject({method:'POST',url:`/api/v1/returns/${id}/commands`,headers:headers(auth),payload:{expectedVersion:r.version,action,reason:'Verified fictional return evidence'}});expect(response.statusCode,response.body).toBe(200);
      for(const job of await db.outbox.findMany({where:{aggregateId:id,status:'PENDING'}}))await processOutbox(job.id);
    }
    const r=await db.returnCase.findUniqueOrThrow({where:{id}});expect(r.status).toBe('CLOSED');expect(r.refundStatus).toBe('ACKNOWLEDGED');expect((await db.inventory.findUniqueOrThrow({where:{id:line.inventoryId}})).onHand).toBe(before.onHand+1);
    const duplicate=await app.inject({method:'POST',url:`/api/v1/returns/${id}/commands`,headers:headers(auth),payload:{expectedVersion:r.version,action:'qc-good',reason:'Repeated acknowledgement'}});expect(duplicate.statusCode).toBe(409);
    expect(await db.financialEvent.count({where:{sourceId:id}})).toBe(2);
    expect((await app.inject({url:'/api/v1/finance/events',headers:headers(auth)})).statusCode).toBe(403);
    expect((await app.inject({url:'/api/v1/finance/events',headers:headers(finance)})).statusCode).toBe(200);
    expect((await app.inject({url:`/api/v1/returns/${id}`,headers:headers(await login('admin@maisonazure.demo'))})).statusCode).toBe(404);
    const over=await app.inject({method:'POST',url:'/api/v1/returns',headers:headers(auth),payload:{...payload,quantity:2,requestId:'lum-too-many'}});expect(over.statusCode).toBe(422);
  });
  it('locks reconciled statements, exports through Finance and carries later adjustments separately',async()=>{
    const auth=await login('finance@ati.demo');const create=()=>app.inject({method:'POST',url:'/api/v1/settlements',headers:headers(auth),payload:{partnerId:'vnd_lum',from:'2026-09-01T00:00:00Z',to:'2026-10-01T00:00:00Z'}});
    const res=await create();expect(res.statusCode,res.body).toBe(200);const id=res.json().id;
    const command=async(action:string)=>{const s=await db.settlement.findUniqueOrThrow({where:{id}});return app.inject({method:'POST',url:`/api/v1/settlements/${id}/commands`,headers:headers(auth),payload:{action,expectedVersion:s.version,reason:'Matched sales and return ledger'}});};
    for(const action of ['calculate','review','lock']){const result=await command(action);expect(result.statusCode,result.body).toBe(200);expect(result.json().payable).toBe('175.84');}
    await expect(db.settlement.update({where:{id},data:{payable:'999'}})).rejects.toThrow();
    const event=await db.financialEvent.findFirstOrThrow({where:{settlementId:id}});await expect(db.financialEvent.update({where:{id:event.id},data:{amount:'999'}})).rejects.toThrow();
    expect((await command('calculate')).statusCode).toBe(409);
    expect((await app.inject({url:`/api/v1/settlements/${id}`,headers:headers(await login('finance@maisonazure.demo'))})).statusCode).toBe(404);
    for(const action of ['export','confirm-payment']){expect((await command(action)).statusCode).toBe(200);const job=await db.outbox.findFirstOrThrow({where:{aggregateId:id,status:'PENDING'}});await processOutbox(job.id);}
    expect((await db.settlement.findUniqueOrThrow({where:{id}})).status).toBe('PAID');
    const csv=await app.inject({url:`/api/v1/settlements/${id}/export`,headers:headers(auth)});expect(csv.statusCode,csv.body).toBe(200);expect(csv.body).toContain('RETURN_REVERSAL');
    const payload={partnerId:'vnd_lum',amount:'15.00',reason:'Approved commercial correction',requestId:'late-correction-1'};
    for(let i=0;i<2;i++)expect((await app.inject({method:'POST',url:'/api/v1/finance/adjustments',headers:headers(auth),payload})).statusCode).toBe(200);
    expect((await db.settlement.findUniqueOrThrow({where:{id}})).payable.toFixed(2)).toBe('175.84');
    const later=(await create()).json();const calc=await app.inject({method:'POST',url:`/api/v1/settlements/${later.id}/commands`,headers:headers(auth),payload:{action:'calculate',expectedVersion:later.version,reason:'Include only unassigned adjustments'}});expect(calc.statusCode,calc.body).toBe(200);expect(calc.json().payable).toBe('15');expect(calc.json().evidence.events).toHaveLength(1);
  });
  it('holds bad-QC refunds, restocks as damaged, and requires an audited operator override',async()=>{
    const auth=await login('ops@ati.demo');const leg=await db.fulfilmentLeg.findFirstOrThrow({where:{partnerId:'vnd_lum'}}),line=(leg.lines as ReservedLine[])[0];
    const res=await app.inject({method:'POST',url:'/api/v1/returns',headers:headers(auth),payload:{legId:leg.id,lineId:line.id,quantity:1,reason:'Product seal is damaged',requestId:'lum-bad-qc'}});expect(res.statusCode,res.body).toBe(200);const id=res.json().id;
    const before=await db.inventory.findUniqueOrThrow({where:{id:line.inventoryId}});
    const command=async(action:string)=>{const r=await db.returnCase.findUniqueOrThrow({where:{id}});return app.inject({method:'POST',url:`/api/v1/returns/${id}/commands`,headers:headers(auth),payload:{expectedVersion:r.version,action,reason:'Inspected broken seal; goodwill exception'}});};
    for(const action of ['approve','book-pickup','receive','qc-bad']){const result=await command(action);expect(result.statusCode,result.body).toBe(200);for(const job of await db.outbox.findMany({where:{aggregateId:id,status:'PENDING'}}))await processOutbox(job.id);}
    const stock=await db.inventory.findUniqueOrThrow({where:{id:line.inventoryId}});expect(stock.onHand).toBe(before.onHand+1);expect(stock.damaged).toBe(before.damaged+1);expect(await db.financialEvent.count({where:{sourceId:id}})).toBe(0);expect((await db.returnCase.findUniqueOrThrow({where:{id}})).refundStatus).toBe('HELD');
    expect((await command('approve-refund')).statusCode).toBe(200);expect(await db.financialEvent.count({where:{sourceId:id}})).toBe(2);expect((await db.inventory.findUniqueOrThrow({where:{id:line.inventoryId}})).onHand).toBe(stock.onHand);
  });
  it('serializes closed and override-pending return evidence while isolating vendor access',async()=>{
    const get=async(url:string,email:string)=>app.inject({url,headers:headers(await login(email)),remoteAddress:'127.0.2.3'});
    const response=await get('/api/v1/returns','ops@ati.demo');expect(response.statusCode,response.body).toBe(200);
    const items=response.json().items;expect(items).toHaveLength(2);
    expect(items.map((r:{status:string})=>r.status).sort()).toEqual(['CLOSED','REFUND_PENDING']);
    const overridden=items.find((r:{qc:string})=>r.qc==='BAD');expect(overridden.policy.refundOverride.reason).toBe('Inspected broken seal; goodwill exception');
    const detail=await get(`/api/v1/returns/${overridden.id}`,'ops@ati.demo');expect(detail.statusCode,detail.body).toBe(200);expect(detail.json()).toEqual(overridden);
    const fixture=await db.user.findUniqueOrThrow({where:{email:'fulfilment@maisonazure.demo'}});
    const email=`return-contract-${randomUUID()}@lumera.demo`;
    const user=await db.user.create({data:{...fixture,id:randomUUID(),email,partnerId:'vnd_lum'}});
    try{
      const own=await get('/api/v1/returns',email);expect(own.statusCode,own.body).toBe(200);expect(own.json().items).toEqual(items);
    }finally{await db.session.deleteMany({where:{userId:user.id}});await db.user.delete({where:{id:user.id}});sessions.delete(email);}
    const other=await get('/api/v1/returns','admin@maisonazure.demo');expect(other.statusCode,other.body).toBe(200);expect(other.json().items).toEqual([]);
    expect((await get(`/api/v1/returns/${overridden.id}`,'admin@maisonazure.demo')).statusCode).toBe(404);
  });
  it('rejects expired returns and serializes competing claims for the final returnable unit',async()=>{
    const auth=await login('ops@ati.demo');const leg=await db.fulfilmentLeg.findFirstOrThrow({where:{partnerId:'vnd_maz',status:'DELIVERED'}}),line=(leg.lines as ReservedLine[])[0];const clock=await db.demoClock.findUniqueOrThrow({where:{id:'main'}});
    const request=(requestId:string)=>app.inject({method:'POST',url:'/api/v1/returns',headers:headers(auth),payload:{legId:leg.id,lineId:line.id,quantity:1,reason:'Return requested by customer',requestId}});
    try{await db.demoClock.update({where:{id:'main'},data:{now:new Date(clock.now.getTime()+31*86400000)}});const expired=await request('expired-return');expect(expired.statusCode).toBe(422);expect(expired.json().error.code).toBe('RETURN_WINDOW_EXPIRED');}finally{await db.demoClock.update({where:{id:'main'},data:{now:clock.now}});}
    const results=await Promise.all([request('competing-return-1'),request('competing-return-2')]);expect(results.map(r=>r.statusCode).sort()).toEqual([200,422]);expect(await db.returnCase.count({where:{legId:leg.id}})).toBe(1);
  });
  it('requires fresh reconciliation after ledger changes and blocks reopening locked statements',async()=>{
    const auth=await login('finance@ati.demo');const s=await db.settlement.findFirstOrThrow({where:{partnerId:'vnd_lum',status:'CALCULATED'}});
    expect((await app.inject({method:'POST',url:'/api/v1/finance/adjustments',headers:headers(auth),payload:{partnerId:'vnd_lum',amount:'1.00',reason:'New unassigned reconciliation correction',requestId:'reconciliation-new-entry'}})).statusCode).toBe(200);
    const review=await app.inject({method:'POST',url:`/api/v1/settlements/${s.id}/commands`,headers:headers(auth),payload:{action:'review',expectedVersion:s.version,reason:'Attempt to review old snapshot'}});expect(review.statusCode).toBe(409);expect(review.json().error.code).toBe('RECONCILIATION_CHANGED');
    const locked=await db.settlement.findFirstOrThrow({where:{status:'PAID'}});await expect(db.settlement.update({where:{id:locked.id},data:{status:'DRAFT'}})).rejects.toThrow();await expect(db.settlement.update({where:{id:locked.id},data:{companyId:'foreign-company'}})).rejects.toThrow();
  });
  it('concurrent orders cannot oversell the same final stock',async()=>{
    const receipts=[];
    for(let i=0;i<2;i++)receipts.push(await db.inbox.create({data:{source:'SFCC',eventId:`concurrent-${i}`,type:'order.created',companyId:'cmp_ati_uae',market:'AE',payload:{externalOrderId:`LAST-STOCK-${i}`,channel:'BLM-AE',currency:'AED',deliveryCity:'Dubai',total:'6400.00',lines:[{id:'bag',sku:'MAZ-BAG-2001-TAN-OS',quantity:2,unitGross:'3200.00'}]},payloadHash:`concurrent-${i}`,correlationId:`concurrent-${i}`}}));
    await Promise.all(receipts.map(r=>processInbox(r.id)));
    expect(await db.order.count({where:{externalId:{startsWith:'LAST-STOCK-'}}})).toBe(1);
    const position=await db.inventory.findFirstOrThrow({where:{productId:'prd_maz_bag_2001'}});expect(position.reserved).toBe(2);expect(position.onHand-position.reserved-position.safetyStock).toBe(0);
  });
  it('uses distinct routing priorities and refuses manual overrides of hard gates',async()=>{
    const actor=await db.user.findUniqueOrThrow({where:{email:'admin@ati.demo'}});
    const make=(policy:string,reference:string,extra:Record<string,unknown>={})=>orderInput.parse({externalOrderId:reference,channel:'BLM-AE',currency:'AED',deliveryCity:'Dubai',routingPolicy:policy,total:'1850.00',lines:[{id:'dress',sku:'MAZ-DRS-1001-BLK-M',quantity:1,unitGross:'1850.00'}],...extra});
    const store=await transaction(tx=>ingestOrder(tx,actor,make('STORE_FIRST','STORE-POLICY'),'policy-test'));
    expect((await db.fulfilmentLeg.findFirstOrThrow({where:{orderId:store.id}})).locationId).toBe('loc_maz_store1');
    const warehouse=await transaction(tx=>ingestOrder(tx,actor,make('WAREHOUSE_FIRST','WAREHOUSE-POLICY'),'policy-test'));
    expect((await db.fulfilmentLeg.findFirstOrThrow({where:{orderId:warehouse.id}})).locationId).toBe('loc_maz_wh1');
    await expect(transaction(tx=>ingestOrder(tx,actor,make('MANUAL_OVERRIDE','INVALID-MANUAL',{overrideReason:'Attempt foreign location',manualLocations:{dress:'loc_orb_store1'}}),'policy-test'))).rejects.toThrow('cannot bypass eligibility');
    await expect(transaction(tx=>ingestOrder(tx,actor,make('STORE_FIRST','OUT-OF-AREA',{deliveryCity:'London'}),'policy-test'))).rejects.toThrow('Destination outside service area');
    const before=await db.order.count();await db.location.updateMany({where:{partnerId:'vnd_maz'},data:{cutoffHour:0}});
    await provisionFixture('vnd_maz');
    await expect(transaction(tx=>ingestOrder(tx,actor,make('HYBRID_WATERFALL','AFTER-CUTOFF'),'policy-test'))).rejects.toThrow('cut-off');expect(await db.order.count()).toBe(before);
    await db.location.updateMany({where:{partnerId:'vnd_maz'},data:{cutoffHour:18}});
    await provisionFixture('vnd_maz');
  });
  it('invites a scoped partner and accepts the one-use invitation without trusting client role or tenant',async()=>{
    const admin=await login('partner.manager@ati.demo');const payload={email:'invited@sample.demo',legalName:'Sample Concessions LLC',displayName:'Sample Concessions'};
    expect((await app.inject({method:'POST',url:'/api/v1/partners/invite',headers:headers(await login('admin@maisonazure.demo')),payload})).statusCode).toBe(403);
    const r=await app.inject({method:'POST',url:'/api/v1/partners/invite',headers:headers(admin),payload});expect(r.statusCode,r.body).toBe(200);expect(r.json().delivery).toBe('LOCAL_PREVIEW_NOT_SENT');
    const input={token:r.json().invitationUrl.split('#')[1],email:payload.email,name:'Fictional Vendor',password:'DemoInvitation123!'};
    expect((await app.inject({method:'POST',url:'/api/v1/invitations/accept',payload:{...input,role:'ATI_SUPER_ADMIN'}})).statusCode).toBe(400);
    expect((await app.inject({method:'POST',url:'/api/v1/invitations/accept',payload:{...input,email:'different@sample.demo'}})).statusCode).toBe(400);
    expect((await app.inject({method:'POST',url:'/api/v1/invitations/accept',payload:input})).statusCode).toBe(200);
    expect((await app.inject({method:'POST',url:'/api/v1/invitations/accept',payload:input})).statusCode).toBe(400);
    const u=await db.user.findUniqueOrThrow({where:{email:payload.email}});expect(u.role).toBe('VENDOR_ADMIN');expect(u.companyId).toBe('cmp_ati_uae');expect(u.partnerId).toBe(r.json().partner.id);
    const auth=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:payload.email,password:input.password}});expect(auth.statusCode).toBe(200);sessions.set(payload.email,{cookie:auth.cookies[0].name+'='+auth.cookies[0].value,csrf:auth.json().csrfToken});
  });
  it('saves an editable application, rejects cross-partner paths, and validates private uploads',async()=>{
    const user=await db.user.findUniqueOrThrow({where:{email:'invited@sample.demo'}}),id=user.partnerId!,auth=await login(user.email);
    const p=await db.partner.findUniqueOrThrow({where:{id}}),input={expectedVersion:p.version,legalName:'Sample Concessions LLC',displayName:'Sample Concessions',application:{...sampleApplication,contactEmail:user.email,brands:'Sample Brand'}};
    const foreign=await app.inject({method:'POST',url:'/api/v1/partners/vnd_lum/application',headers:headers(auth),payload:input});expect(foreign.statusCode).toBe(404);
    const saved=await app.inject({method:'POST',url:`/api/v1/partners/${id}/application`,headers:headers(auth),payload:input});expect(saved.statusCode,saved.body).toBe(200);
    expect((await app.inject({method:'POST',url:`/api/v1/partners/${id}/application`,headers:headers(auth),payload:input})).statusCode).toBe(409);
    const submit=await app.inject({method:'POST',url:`/api/v1/partners/${id}/commands`,headers:headers(auth),payload:{action:'submit',expectedVersion:saved.json().version}});expect(submit.statusCode).toBe(422);
    const base={expectedVersion:saved.json().version,type:'TRADE_LICENSE',fileName:'sample.txt',contentType:'text/plain',base64:Buffer.from('Fictional valid sample compliance evidence').toString('base64'),expiresAt:'2027-09-23T00:00:00Z'};
    expect((await app.inject({method:'POST',url:'/api/v1/partners/vnd_lum/documents',headers:headers(auth),payload:base})).statusCode).toBe(404);
    for(const invalid of [{contentType:'image/png'},{fileName:'../escape.txt'},{expiresAt:'2020-01-01T00:00:00Z'},{expiresAt:null}])expect((await app.inject({method:'POST',url:`/api/v1/partners/${id}/documents`,headers:headers(auth),payload:{...base,...invalid}})).statusCode).toBeGreaterThanOrEqual(400);
    const blocked=await app.inject({method:'POST',url:`/api/v1/partners/${id}/documents`,headers:headers(auth),payload:{...base,base64:Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE').toString('base64')}});expect(blocked.statusCode,blocked.body).toBe(200);expect(blocked.json().scanStatus).toBe('BLOCKED');expect(blocked.json().storageMode).toBe('quarantine');
    expect((await app.inject({method:'POST',url:`/api/v1/documents/${blocked.json().id}/download-link`,headers:headers(auth),payload:{}})).statusCode).toBe(409);
    for(const type of ['TRADE_LICENSE','VAT_CERTIFICATE','BANK_LETTER']){const current=await db.partner.findUniqueOrThrow({where:{id}});const uploaded=await app.inject({method:'POST',url:`/api/v1/partners/${id}/documents`,headers:headers(auth),payload:{...base,type,expectedVersion:current.version}});expect(uploaded.statusCode,uploaded.body).toBe(200);expect(uploaded.json().scanStatus).toBe('MOCK_CLEAN');expect(uploaded.json().byteSize).toBeGreaterThan(0);}
  });
  it('uses session-bound expiring document links, preserves versions and supports RFI resubmission',async()=>{
    const user=await db.user.findUniqueOrThrow({where:{email:'invited@sample.demo'}}),id=user.partnerId!,auth=await login(user.email),admin=await login('partner.manager@ati.demo');
    const doc=await db.document.findFirstOrThrow({where:{partnerId:id,type:'TRADE_LICENSE',status:'PENDING'},orderBy:{version:'desc'}});
    const link=await app.inject({method:'POST',url:`/api/v1/documents/${doc.id}/download-link`,headers:headers(auth),payload:{}});expect(link.statusCode,link.body).toBe(200);
    const download=await app.inject({url:link.json().url,headers:headers(auth)});expect(download.statusCode).toBe(200);expect(download.body).toBe('Fictional valid sample compliance evidence');expect(download.headers['content-disposition']).toContain('attachment');
    expect((await app.inject({url:link.json().url,headers:headers(admin)})).statusCode).toBe(403);
    expect((await app.inject({url:link.json().url.replace(/expires=\d+/,'expires=1'),headers:headers(auth)})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:`/api/v1/documents/${doc.id}/download-link`,headers:headers(await login('admin@maisonazure.demo')),payload:{}})).statusCode).toBe(404);
    const lum=await db.document.findFirstOrThrow({where:{partnerId:'vnd_lum'}});expect((await app.inject({method:'POST',url:`/api/v1/documents/${lum.id}/download-link`,headers:headers(await login('catalog@lumera.demo')),payload:{}})).statusCode).toBe(403);
    const command=async(action:string,session=admin)=>{const current=await db.partner.findUniqueOrThrow({where:{id}});return app.inject({method:'POST',url:`/api/v1/partners/${id}/commands`,headers:headers(session),payload:{action,expectedVersion:current.version,reason:'Please confirm the brand authorization evidence'}});};
    expect((await command('submit',auth)).statusCode).toBe(200);expect((await command('review')).statusCode).toBe(200);expect((await command('request-info')).statusCode).toBe(200);
    const p=await db.partner.findUniqueOrThrow({where:{id}});expect(p.reviewReason).toContain('brand authorization');
    const revised=await app.inject({method:'POST',url:`/api/v1/partners/${id}/documents`,headers:headers(auth),payload:{expectedVersion:p.version,type:'TRADE_LICENSE',fileName:'revised.txt',contentType:'text/plain',base64:Buffer.from('Revised fictional evidence with authorization reference').toString('base64'),expiresAt:'2027-10-01T00:00:00Z'}});expect(revised.statusCode).toBe(200);expect(revised.json().version).toBe(doc.version+1);
    expect((await command('submit',auth)).statusCode).toBe(200);expect((await command('review')).statusCode).toBe(200);
    const review=(docId:string)=>app.inject({method:'POST',url:`/api/v1/documents/${docId}/review`,headers:headers(admin),payload:{status:'APPROVED',reason:'Downloaded current fictional evidence and verified validity'}});
    expect((await review(doc.id)).statusCode).toBe(409);
    for(const type of ['TRADE_LICENSE','VAT_CERTIFICATE','BANK_LETTER']){const current=await db.document.findFirstOrThrow({where:{partnerId:id,type},orderBy:{version:'desc'}});expect((await review(current.id)).statusCode).toBe(200);}
    expect((await command('approve')).statusCode).toBe(200);expect((await command('activate')).statusCode).toBe(422);
    expect(await db.document.count({where:{partnerId:id,type:'TRADE_LICENSE'}})).toBe(3);
    expect(await db.auditEvent.count({where:{entityId:doc.id,action:'document.download'}})).toBe(1);
  });
  it('scopes commercial configuration and calculates exact category-specific payable previews',async()=>{
    const admin=await login('admin@ati.demo'),vendor=await login('admin@maisonazure.demo'),other=await login('catalog@lumera.demo');
    expect((await app.inject({url:'/api/v1/partners/vnd_lum/agreements',headers:headers(vendor)})).statusCode).toBe(404);
    expect((await app.inject({url:'/api/v1/partners/vnd_lum/agreements',headers:headers(other)})).statusCode).toBe(403);
    const now=(await db.demoClock.findUniqueOrThrow({where:{id:'main'}})).now.toISOString();
    const terms={rate:'0.28',currency:'AED',cadence:'WEEKLY',market:'AE',brand:null,validFrom:now,validUntil:'2027-12-31T00:00:00Z',returnDays:30,handlingCharge:'20.00',categoryRates:[{category:'Handbags',rate:'0.30'}]};
    const preview=await app.inject({method:'POST',url:'/api/v1/partners/vnd_maz/agreements/preview',headers:headers(admin),payload:{...terms,productBrand:'br_maz',category:'Women/Bags/Handbags',gross:'1000.00',vendorDiscount:'100.00',operatorDiscount:'50.00'}});
    expect(preview.statusCode,preview.body).toBe(200);expect(preview.json()).toMatchObject({basis:'900.00',customerNet:'850.00',proposed:{rate:'0.30',commission:'270.00',payable:'630.00'}});
    const payload={...terms,expectedVersion:1,reason:'Fictional commercial configuration'};
    expect((await app.inject({method:'POST',url:'/api/v1/partners/vnd_maz/agreements',headers:headers(vendor),payload})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:'/api/v1/partners/vnd_maz/agreements',headers:headers(admin),payload:{...payload,currency:'SAR'}})).statusCode).toBe(422);
    expect((await app.inject({method:'POST',url:'/api/v1/partners/vnd_maz/agreements',headers:headers(admin),payload:{...payload,validFrom:'2020-01-01T00:00:00Z'}})).statusCode).toBe(422);
    expect((await app.inject({method:'POST',url:'/api/v1/partners/vnd_maz/agreements',headers:headers(admin),payload:{...payload,categoryRates:[{category:'Handbags',rate:'0.2'},{category:'handbags',rate:'0.3'}]}})).statusCode).toBe(422);
    expect(await db.agreement.count({where:{partnerId:'vnd_maz'}})).toBe(1);
  });
  it('approves immutable effective-dated terms without repricing historical orders',async()=>{
    const auth=await login('finance@ati.demo'),actor=await db.user.findUniqueOrThrow({where:{email:'admin@ati.demo'}}),now=(await db.demoClock.findUniqueOrThrow({where:{id:'main'}})).now;
    const previous=await db.fulfilmentLeg.findFirstOrThrow({where:{partnerId:'vnd_maz'}});const snapshot=JSON.stringify(previous.lines);
    const payload={expectedVersion:1,rate:'0.25',currency:'AED',cadence:'BIWEEKLY',market:'AE',brand:'br_maz',validFrom:now.toISOString(),validUntil:'2027-12-31T00:00:00Z',returnDays:21,handlingCharge:'12.00',categoryRates:[{category:'Dresses',rate:'0.31'}],reason:'New fictional brand-specific terms'};
    const saved=await app.inject({method:'POST',url:'/api/v1/partners/vnd_maz/agreements',headers:headers(auth),payload});expect(saved.statusCode,saved.body).toBe(200);expect(saved.json().status).toBe('DRAFT');const id=saved.json().id;
    expect((await app.inject({method:'POST',url:'/api/v1/partners/vnd_maz/agreements',headers:headers(auth),payload})).statusCode).toBe(409);
    let agreements=await db.agreement.findMany({where:{partnerId:'vnd_maz'}});expect(selectAgreement(agreements,now,'AE','AED','br_maz')?.version).toBe(1);
    const approved=await app.inject({method:'POST',url:`/api/v1/agreements/${id}/approve`,headers:headers(auth),payload:{reason:'Reviewed configuration for the fictional demo'}});expect(approved.statusCode,approved.body).toBe(200);
    expect((await app.inject({method:'POST',url:`/api/v1/agreements/${id}/approve`,headers:headers(auth),payload:{reason:'Duplicate approval attempt'}})).statusCode).toBe(409);
    await expect(db.agreement.update({where:{id},data:{rate:'0.99'}})).rejects.toThrow();await expect(db.agreement.delete({where:{id}})).rejects.toThrow();
    agreements=await db.agreement.findMany({where:{partnerId:'vnd_maz'}});const selected=selectAgreement(agreements,now,'AE','AED','br_maz')!;expect(selected.version).toBe(2);expect(commercialRate(selected,'Women/Clothing/Dresses')).toBe('0.31');expect(selectAgreement(agreements,now,'AE','AED','Another Brand')?.version).toBe(1);expect(selectAgreement(agreements,now,'SA','SAR','br_maz')).toBeUndefined();
    const order=await transaction(tx=>ingestOrder(tx,actor,orderInput.parse({...demoOrder,externalOrderId:'COMMERCIAL-SNAPSHOT-1',total:'1850.00',lines:[demoOrder.lines[0]]}),'commercial-snapshot'));
    const leg=await db.fulfilmentLeg.findFirstOrThrow({where:{orderId:order.id}}),line=(leg.lines as ReservedLine[])[0];expect(line.agreementVersion).toBe(2);expect(line.commissionRate).toBe('0.31');expect(line.returnPolicy).toEqual({version:2,days:21,handlingCharge:'12.00'});
    expect(JSON.stringify((await db.fulfilmentLeg.findUniqueOrThrow({where:{id:previous.id}})).lines)).toBe(snapshot);
    expect(await db.auditEvent.count({where:{entityId:id,action:'agreement.approve'}})).toBe(1);
  });
  it('keeps future agreement versions inactive and serializes competing version creation',async()=>{
    const auth=await login('partner.manager@ati.demo'),now=(await db.demoClock.findUniqueOrThrow({where:{id:'main'}})).now;
    const from=new Date(now.getTime()+86400000);const payload={expectedVersion:2,rate:'0.20',currency:'AED',cadence:'MONTHLY',market:'AE',brand:'br_maz',validFrom:from.toISOString(),validUntil:'2027-12-31T00:00:00Z',returnDays:14,handlingCharge:'10.00',categoryRates:[],reason:'Scheduled fictional next-day terms'};
    const responses=await Promise.all([1,2].map(()=>app.inject({method:'POST',url:'/api/v1/partners/vnd_maz/agreements',headers:headers(auth),payload})));expect(responses.map(r=>r.statusCode).sort()).toEqual([200,409]);const id=responses.find(r=>r.statusCode===200)!.json().id;
    expect((await app.inject({method:'POST',url:`/api/v1/agreements/${id}/approve`,headers:headers(auth),payload:{reason:'Approve scheduled demo terms'}})).statusCode).toBe(200);
    const agreements=await db.agreement.findMany({where:{partnerId:'vnd_maz'}});expect(selectAgreement(agreements,now,'AE','AED','br_maz')?.version).toBe(2);expect(selectAgreement(agreements,from,'AE','AED','br_maz')?.version).toBe(3);
    expect((await app.inject({method:'POST',url:`/api/v1/agreements/${id}/reject`,headers:headers(auth),payload:{reason:'Cannot reject approved terms'}})).statusCode).toBe(409);
    const draft=await app.inject({method:'POST',url:'/api/v1/partners/vnd_maz/agreements',headers:headers(auth),payload:{...payload,expectedVersion:3}});expect(draft.statusCode).toBe(200);
    const rejected=await app.inject({method:'POST',url:`/api/v1/agreements/${draft.json().id}/reject`,headers:headers(auth),payload:{reason:'Withdraw fictional proposal before activation'}});expect(rejected.statusCode).toBe(200);expect(rejected.json().status).toBe('REJECTED');
    expect((await app.inject({method:'POST',url:`/api/v1/agreements/${draft.json().id}/approve`,headers:headers(auth),payload:{reason:'Cannot approve a rejected proposal'}})).statusCode).toBe(409);
    expect(commercialRate(agreements[0],'constructor')).toBe(agreements[0].rate.toString());
  });
  it('isolates brand rights, rejects legacy Boolean authorization and prevents overlapping reviewed grants',async()=>{
    const admin=await login('partner.manager@ati.demo'),vendor=await login('admin@maisonazure.demo');
    expect((await app.inject({url:'/api/v1/partners/vnd_lum/brand-rights',headers:headers(vendor)})).statusCode).toBe(404);
    const own=await app.inject({url:'/api/v1/partners/vnd_maz/brand-rights',headers:headers(vendor)});expect(own.statusCode).toBe(200);expect(own.json().products.every((p:{authorized:boolean})=>p.authorized)).toBe(true);
    const payload={brand:'br_maz',market:'AE',categories:['Women'],validFrom:'2026-09-23T08:00:00Z',validUntil:'2027-12-31T00:00:00Z',evidence:'Fictional distributor reference',reason:'Test scope review'};
    expect((await app.inject({method:'POST',url:'/api/v1/partners/vnd_maz/brand-rights',headers:headers(vendor),payload})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:'/api/v1/partners/vnd_maz/brand-rights',headers:headers(admin),payload:{...payload,market:'SA'}})).statusCode).toBe(403);
    const saved=await app.inject({method:'POST',url:'/api/v1/partners/vnd_maz/brand-rights',headers:headers(admin),payload});expect(saved.statusCode,saved.body).toBe(200);
    const approve=await app.inject({method:'POST',url:`/api/v1/brand-rights/${saved.json().id}/commands`,headers:headers(admin),payload:{action:'approve',expectedVersion:1,reason:'Attempt an overlapping approval'}});expect(approve.statusCode).toBe(409);expect(approve.json().error.code).toBe('OVERLAPPING_AUTHORIZATION');
    await expect(db.brandRight.update({where:{id:'fixture-right-br_maz'},data:{categories:['Beauty']}})).rejects.toThrow();
    const p=await db.partner.findUniqueOrThrow({where:{id:'vnd_maz'}});const legacy=await app.inject({method:'POST',url:'/api/v1/partners/vnd_maz/commands',headers:headers(admin),payload:{action:'authorize-brand',expectedVersion:p.version,reason:'Attempt to bypass registry'}});expect(legacy.statusCode).toBe(409);
  });
  it('pauses brand availability atomically, preserves physical stock and lets existing orders continue',async()=>{
    const auth=await login('admin@ati.demo'),actor=await db.user.findUniqueOrThrow({where:{email:'admin@ati.demo'}});
    const order=await db.order.findUniqueOrThrow({where:{channel_externalId:{channel:'BLM-AE',externalId:'COMMERCIAL-SNAPSHOT-1'}}});
    const orderJob=await db.outbox.findUniqueOrThrow({where:{idempotencyKey:`order:${order.id}:FYND`}});await processOutbox(orderJob.id);
    let leg=await db.fulfilmentLeg.findFirstOrThrow({where:{orderId:order.id}});await processOutbox((await db.outbox.findUniqueOrThrow({where:{idempotencyKey:`shipment:${leg.id}:create`}})).id);
    leg=await db.fulfilmentLeg.findUniqueOrThrow({where:{id:leg.id}});const original=JSON.stringify(leg.lines);
    const before=await db.inventory.findMany({where:{product:{partnerId:'vnd_maz'}},orderBy:{id:'asc'}});
    const command=(action:string,expectedVersion:number)=>app.inject({method:'POST',url:'/api/v1/brand-rights/fixture-right-br_maz/commands',headers:headers(auth),payload:{action,expectedVersion,reason:'Fictional territorial authorization review'}});
    const paused=await command('pause',1);expect(paused.statusCode,paused.body).toBe(200);
    expect((await command('resume',1)).statusCode).toBe(409);
    const after=await db.inventory.findMany({where:{product:{partnerId:'vnd_maz'}},orderBy:{id:'asc'}});expect(after.map(r=>[r.onHand,r.reserved])).toEqual(before.map(r=>[r.onHand,r.reserved]));expect(after.every(r=>r.lastEligible===false)).toBe(true);
    const view=await app.inject({url:'/api/v1/inventory?limit=100',headers:headers(await login('admin@maisonazure.demo'))});expect(view.json().items.every((i:{sellable:number})=>i.sellable===0)).toBe(true);
    for(const row of after)for(const target of ['FYND','SFCC']){const job=await db.outbox.findUniqueOrThrow({where:{idempotencyKey:`stock:${row.id}:r${row.revision}:${target}`}});expect((job.payload as {sellable:number}).sellable).toBe(0);await processOutbox(job.id);expect((await db.mockInventory.findUniqueOrThrow({where:{system_inventoryId:{system:target,inventoryId:row.id}}})).sellable).toBe(0);}
    await expect(transaction(tx=>ingestOrder(tx,actor,orderInput.parse({...demoOrder,externalOrderId:'BRAND-BLOCKED',total:'1850.00',lines:[demoOrder.lines[0]]}),'brand-blocked'))).rejects.toThrow('lacks effective');
    const transition=await app.inject({method:'POST',url:`/api/v1/shipments/${leg.id}/commands`,headers:headers(auth),payload:{expectedVersion:leg.version,next:'ACCEPTED'}});expect(transition.statusCode,transition.body).toBe(200);
    await processOutbox((await db.outbox.findUniqueOrThrow({where:{idempotencyKey:`shipment:${leg.id}:${transition.json().version}:ACCEPTED`}})).id);
    const accepted=await db.fulfilmentLeg.findUniqueOrThrow({where:{id:leg.id}});expect(accepted.status).toBe('ACCEPTED');expect(JSON.stringify(accepted.lines)).toBe(original);
    expect((await command('resume',2)).statusCode).toBe(200);expect(await transaction(tx=>reconcileAvailability(tx,'vnd_maz'))).toBe(0);
    expect((await db.inventory.findMany({where:{product:{partnerId:'vnd_maz'}}})).every(r=>r.lastEligible===false)).toBe(true);
    await provisionFixture('vnd_maz');
    const restored=await db.inventory.findMany({where:{product:{partnerId:'vnd_maz'}}});
    expect(restored.filter(r=>r.productId!=='prd_maz_dress_1001_l').every(r=>r.lastEligible===true)).toBe(true);
    // The legacy size-L fixture lacks publication evidence: resuming a brand
    // must not turn that incomplete SKU into sellable stock.
    expect(restored.find(r=>r.productId==='prd_maz_dress_1001_l')?.lastEligible).toBe(false);
  });
  it('serializes overlapping approvals and makes revocation terminal',async()=>{
    const auth=await login('partner.manager@ati.demo');
    const payload={brand:'br_review_race',market:'AE',categories:['Women/Dresses'],validFrom:'2026-09-23T08:00:00Z',validUntil:'2027-12-31T00:00:00Z',evidence:'Fictional concurrent approval test',reason:'Duplicate proposal comparison'};
    const drafts=await Promise.all([1,2].map(()=>app.inject({method:'POST',url:'/api/v1/partners/vnd_onboard/brand-rights',headers:headers(auth),payload})));drafts.forEach(r=>expect(r.statusCode,r.body).toBe(200));
    const results=await Promise.all(drafts.map(d=>app.inject({method:'POST',url:`/api/v1/brand-rights/${d.json().id}/commands`,headers:headers(auth),payload:{action:'approve',expectedVersion:1,reason:'Concurrent scope review'}})));expect(results.map(r=>r.statusCode).sort()).toEqual([200,409]);
    const approved=results.find(r=>r.statusCode===200)!.json();
    const revoke=await app.inject({method:'POST',url:`/api/v1/brand-rights/${approved.id}/commands`,headers:headers(auth),payload:{action:'revoke',expectedVersion:approved.version,reason:'Withdraw the fictional grant permanently'}});expect(revoke.statusCode).toBe(200);
    expect((await app.inject({method:'POST',url:`/api/v1/brand-rights/${approved.id}/commands`,headers:headers(auth),payload:{action:'resume',expectedVersion:revoke.json().version,reason:'Cannot revive revoked rights'}})).statusCode).toBe(409);
    await expect(db.brandRight.delete({where:{id:approved.id}})).rejects.toThrow();
  });
  it('reconciles expiry without editing grants, and blocks queued publication after authorization is withdrawn',async()=>{
    const clock=await db.demoClock.findUniqueOrThrow({where:{id:'main'}}),grant=await db.brandRight.findUniqueOrThrow({where:{id:'fixture-right-br_maz'}});
    try{await db.demoClock.update({where:{id:'main'},data:{now:grant.validUntil}});expect(await transaction(tx=>reconcileAvailability(tx,'vnd_maz'))).toBeGreaterThan(0);expect((await db.inventory.findMany({where:{product:{partnerId:'vnd_maz'}}})).every(r=>r.lastEligible===false)).toBe(true);expect((await db.brandRight.findUniqueOrThrow({where:{id:grant.id}})).status).toBe('APPROVED');}
    finally{await db.demoClock.update({where:{id:'main'},data:{now:clock.now}});await transaction(tx=>reconcileAvailability(tx,'vnd_maz'));}
    const auth=await login('admin@ati.demo');const r=await db.brandRight.findUniqueOrThrow({where:{id:grant.id}});
    expect((await app.inject({method:'POST',url:`/api/v1/brand-rights/${r.id}/commands`,headers:headers(auth),payload:{action:'suspend',expectedVersion:r.version,reason:'Testing queued publication guard'}})).statusCode).toBe(200);
    const product=await db.product.findFirstOrThrow({where:{partnerId:'vnd_maz'}});
    const job=await db.outbox.create({data:{...captureDestination('FYND'),companyId:product.companyId,partnerId:product.partnerId,market:product.market,target:'FYND',operation:'upsertProduct',aggregateId:product.id,payload:{version:999,product:{id:product.id}},correlationId:'rights-publish',idempotencyKey:'rights-publish-blocked'}});
    await processOutbox(job.id);expect((await db.outbox.findUniqueOrThrow({where:{id:job.id}})).status).toBe('DEAD_LETTER');expect(await db.mockRecord.count({where:{idempotencyKey:job.idempotencyKey}})).toBe(0);
    const updated=await db.brandRight.findUniqueOrThrow({where:{id:r.id}});expect((await app.inject({method:'POST',url:`/api/v1/brand-rights/${r.id}/commands`,headers:headers(auth),payload:{action:'resume',expectedVersion:updated.version,reason:'Restore fixture after negative test'}})).statusCode).toBe(200);
  });
});

function importFixture(n:number){
 const prefix=`629991${String(n).padStart(6,'0')}`,check=(10-[...prefix].reverse().reduce((s,c,i)=>s+Number(c)*(i%2?1:3),0)%10)%10;
 return {partner_code:'VND-LUM',brand:'Lumera',vendor_sku:`LUM-IMPORT-${n}`,gtin:prefix+check,parent_sku:`LUM-IMP-PARENT-${n}`,title_en:`Coral satin tint ${n}`,title_ar:'صبغة شفاه ساتان مرجانية',category:'Beauty/Makeup/Lips',colour:'Coral',size:'One Size',list_price:'160.00',selling_price:'145.00',currency:'AED',image_url:'/demo-assets/lum-lip-ruby.svg',location_code:'LUM-DXB-WH01',quantity:'3',finish:'Satin',country_of_origin:'France'};
}
function csvFor(rows:Record<string,string>[]){const quote=(s:string)=>`"${s.replaceAll('"','""')}"`;return importFields.join(',')+'\r\n'+rows.map(r=>importFields.map(f=>quote(r[f]??'')).join(',')).join('\r\n');}
describe('staged catalogue imports',()=>{
 it('stages Excel with source provenance, correction and moderation-only submission',async()=>{
  const auth=await login('catalog@lumera.demo'),other=await login('admin@maisonazure.demo');
  const base64=await mutateWorkbook(p=>replaceCell(p,'L2','<c r="L2"><v>10</v></c>'));
  const payload={source:'XLSX',fileName:'coral-assortment.xlsx',base64,requestKey:randomUUID()};
  const post=(url:string,body:Record<string,unknown>,session=auth)=>app.inject({remoteAddress:'127.0.3.1',method:'POST',url,headers:headers(session),payload:body});
  const productsBefore=await db.product.count(),jobsBefore=await db.outbox.count();
  const stage=await post('/api/v1/catalog/imports',payload);expect(stage.statusCode,stage.body).toBe(200);
  const batch=stage.json(),path=`/api/v1/catalog/imports/${batch.id}`;
  expect(batch.source).toBe('XLSX');expect(batch.rows[0].number).toBe(2);expect(batch.rows[0].input.gtin).toBe('06299920000014');
  expect(batch.rows[0].issues.map((i:{code:string})=>i.code)).toContain('BELOW_PRICE_FLOOR');
  expect(await db.product.count()).toBe(productsBefore);expect(await db.outbox.count()).toBe(jobsBefore);
  expect((await post(path+'/submit',{expectedVersion:1})).statusCode).toBe(422);
  expect((await post('/api/v1/catalog/imports',payload)).json().id).toBe(batch.id);
  expect((await post('/api/v1/catalog/imports',payload,other)).statusCode).toBe(403);
  const changed=(await readFile(new URL('../fixtures/catalogue.xlsx',import.meta.url))).toString('base64');
  expect((await post('/api/v1/catalog/imports',{...payload,base64:changed})).statusCode).toBe(409);
  const correction=await post(path+'/rows',{expectedVersion:1,rowNumber:2,input:{...batch.rows[0].input,selling_price:'145.00'},reason:'Corrected Excel price after validation'});
  expect(correction.statusCode,correction.body).toBe(200);expect(correction.json().rows[0].issues).toEqual([]);
  const submit=await post(path+'/submit',{expectedVersion:2});expect(submit.statusCode,submit.body).toBe(200);
  expect((await post(path+'/submit',{expectedVersion:2})).json().id).toBe(batch.id);
  const product=await db.product.findUniqueOrThrow({where:{sku:'LUM-XLSX-CORAL-001'},include:{inventory:true,publications:true}});
  expect(product.status).toBe('IN_REVIEW');expect(product.inventory[0].onHand).toBe(12);expect(product.inventory[0].lastEligible).toBe(false);expect(product.publications).toEqual([]);
  expect(await db.product.count()).toBe(productsBefore+1);expect(await db.outbox.count()).toBe(jobsBefore);
  const saved=await db.catalogImport.findUniqueOrThrow({where:{id:batch.id}});expect(saved.checksum).toBe(batch.checksum);
  expect((saved.originalRows as {selling_price:string}[])[0].selling_price).toBe('10');
 });
 it('rejects unsafe Excel before staging and advertises supported import sources',async()=>{
  const auth=await login('catalog@lumera.demo');
  const before=await db.catalogImport.count(),audits=await db.auditEvent.count();
  const response=await app.inject({remoteAddress:'127.0.3.2',method:'POST',url:'/api/v1/catalog/imports',headers:headers(auth),payload:{source:'XLSX',fileName:'formula.xlsx',requestKey:randomUUID(),base64:await mutateWorkbook(p=>replaceCell(p,'L2','<c r="L2"><f>100+45</f><v>145</v></c>'))}});
  expect(response.statusCode,response.body).toBe(400);expect(response.json().error.code).toBe('XLSX_FORMULA');
  expect(await db.catalogImport.count()).toBe(before);expect(await db.auditEvent.count()).toBe(audits);
  const meta=await app.inject({remoteAddress:'127.0.3.2',url:'/api/v1/catalog/imports/metadata',headers:headers(auth)});
  expect(meta.json().sources).toEqual(['CSV','XLSX','API']);expect(meta.json().xlsx.worksheet).toBe('Catalogue');
 });
 it('stages defective CSV without creating products and enforces partner/role/source boundaries',async()=>{
  const auth=await login('admin@ati.demo'),vendor=await login('catalog@lumera.demo'),other=await login('admin@maisonazure.demo'),finance=await login('finance@maisonazure.demo');
  const original={...importFixture(1),title_ar:'',gtin:'not-valid',selling_price:'10.00'},payload={source:'CSV',fileName:'defective.csv',content:csvFor([original]),requestKey:randomUUID()};
  const before=await db.product.count();const staged=await app.inject({method:'POST',url:'/api/v1/catalog/imports',headers:headers(auth),payload});expect(staged.statusCode,staged.body).toBe(200);
  const batch=staged.json();expect(batch.rows[0].issues.map((i:{code:string})=>i.code)).toEqual(expect.arrayContaining(['ARABIC_TITLE_MISSING','GTIN_INVALID','BELOW_PRICE_FLOOR']));expect(await db.product.count()).toBe(before);
  expect((await app.inject({method:'POST',url:`/api/v1/catalog/imports/${batch.id}/submit`,headers:headers(auth),payload:{expectedVersion:1}})).statusCode).toBe(422);
  expect((await app.inject({url:`/api/v1/catalog/imports/${batch.id}`,headers:headers(vendor)})).statusCode).toBe(404);
  expect((await app.inject({url:'/api/v1/catalog/imports',headers:headers(finance)})).statusCode).toBe(403);
  expect((await app.inject({method:'POST',url:'/api/v1/catalog/imports',headers:headers(other),payload})).statusCode).toBe(403);
  const repeat=await app.inject({method:'POST',url:'/api/v1/catalog/imports',headers:headers(auth),payload});expect(repeat.json().id).toBe(batch.id);
  expect((await app.inject({method:'POST',url:'/api/v1/catalog/imports',headers:headers(auth),payload:{...payload,content:csvFor([importFixture(2)])}})).statusCode).toBe(409);
  await expect(db.catalogImport.update({where:{id:batch.id},data:{originalRows:[]}})).rejects.toThrow();
 });
 it('corrects a row with audit, revalidates at commit and creates review-only products exactly once',async()=>{
  const auth=await login('catalog@lumera.demo'),other=await login('admin@maisonazure.demo');const row=importFixture(3);
  const stage=await app.inject({method:'POST',url:'/api/v1/catalog/imports',headers:headers(auth),payload:{source:'API',fileName:'API batch',rows:[{...row,title_ar:''}],requestKey:randomUUID()}});expect(stage.statusCode,stage.body).toBe(200);const batch=stage.json();
  const path=`/api/v1/catalog/imports/${batch.id}`;
  expect((await app.inject({url:path,headers:headers(other)})).statusCode).toBe(404);
  expect((await app.inject({method:'POST',url:path+'/rows',headers:headers(auth),payload:{expectedVersion:1,rowNumber:2,input:{...row,partner_code:'VND-MAZ'},reason:'Cannot reassign ownership'}})).statusCode).toBe(403);
  const fix=await app.inject({method:'POST',url:path+'/rows',headers:headers(auth),payload:{expectedVersion:1,rowNumber:2,input:row,reason:'Added reviewed Arabic product title'}});expect(fix.statusCode,fix.body).toBe(200);expect(fix.json().rows[0].issues).toHaveLength(0);
  expect((await app.inject({method:'POST',url:path+'/rows',headers:headers(auth),payload:{expectedVersion:1,rowNumber:2,input:row,reason:'Stale correction attempt'}})).statusCode).toBe(409);
  // Changing an entitlement after preview must invalidate submission.
  const grant=await db.brandRight.findUniqueOrThrow({where:{id:'fixture-right-br_lum'}});await db.brandRight.update({where:{id:grant.id},data:{status:'PAUSED'}});
  expect((await app.inject({method:'POST',url:path+'/submit',headers:headers(auth),payload:{expectedVersion:2}})).statusCode).toBe(422);
  expect(await db.product.count({where:{sku:row.vendor_sku}})).toBe(0);await db.brandRight.update({where:{id:grant.id},data:{status:grant.status}});
  const productsBefore=await db.product.count(),jobsBefore=await db.outbox.count();
  const results=await Promise.all([1,2].map(()=>app.inject({method:'POST',url:path+'/submit',headers:headers(auth),payload:{expectedVersion:2}})));results.forEach(r=>expect(r.statusCode,r.body).toBe(200));
  expect(await db.product.count()).toBe(productsBefore+1);expect(await db.outbox.count()).toBe(jobsBefore);
  const product=await db.product.findUniqueOrThrow({where:{sku:row.vendor_sku},include:{inventory:true,publications:true}});expect(product.status).toBe('IN_REVIEW');expect(product.floor.toFixed(2)).toBe('130.00');expect(product.inventory[0].onHand).toBe(3);expect(product.publications).toHaveLength(0);
  const inventory=await app.inject({url:'/api/v1/inventory?limit=100',headers:headers(auth)});expect(inventory.json().items.find((r:{productId:string})=>r.productId===product.id).sellable).toBe(0);
  await expect(db.catalogImport.update({where:{id:batch.id},data:{rows:[]}})).rejects.toThrow();expect(await db.auditEvent.count({where:{action:'catalog.import-row-corrected',entityId:batch.id}})).toBe(1);
  expect((await app.inject({method:'POST',url:`/api/v1/catalog/items/${product.id}/commands`,headers:headers(auth),payload:{action:'approve',expectedVersion:1,reason:'Vendor may not moderate'}})).statusCode).toBe(403);
 });
 it('flags duplicates inside batches and restricts probable-duplicate decisions to ATI with reason',async()=>{
  const vendor=await login('catalog@lumera.demo'),admin=await login('admin@ati.demo');
  // This separate simulated client keeps the full workflow suite from consuming
  // the production 200/minute per-IP quota before this independent import story.
  const remoteAddress='127.0.3.4';
  const existing=await db.product.findUniqueOrThrow({where:{sku:'LUM-IMPORT-3'}}),row={...importFixture(4),title_en:existing.titleEn};
  const stage=await app.inject({remoteAddress,method:'POST',url:'/api/v1/catalog/imports',headers:headers(vendor),payload:{source:'API',fileName:'API batch',rows:[row],requestKey:randomUUID()}});expect(stage.statusCode,stage.body).toBe(200);const batch=stage.json(),path=`/api/v1/catalog/imports/${batch.id}`;
  expect(batch.rows[0].issues.map((i:{code:string})=>i.code)).toContain('PROBABLE_DUPLICATE');expect(batch.rows[0].duplicateCandidates[0].sku).toBe('LUM-IMPORT-3');
  const decision={rowNumber:2,expectedVersion:1,reason:'Verified separate formulation in fictional catalogue'};
  expect((await app.inject({remoteAddress,method:'POST',url:path+'/duplicate-decision',headers:headers(vendor),payload:decision})).statusCode).toBe(403);
  const reviewed=await app.inject({remoteAddress,method:'POST',url:path+'/duplicate-decision',headers:headers(admin),payload:decision});expect(reviewed.statusCode,reviewed.body).toBe(200);expect(reviewed.json().rows[0].issues).toHaveLength(0);
  const edited=await app.inject({remoteAddress,method:'POST',url:path+'/rows',headers:headers(vendor),payload:{rowNumber:2,expectedVersion:2,input:row,reason:'Saving invalidates earlier duplicate approval'}});expect(edited.statusCode,edited.body).toBe(200);expect(edited.json().rows[0].issues.map((i:{code:string})=>i.code)).toContain('PROBABLE_DUPLICATE');
  const dup=await app.inject({remoteAddress,method:'POST',url:'/api/v1/catalog/imports',headers:headers(vendor),payload:{source:'CSV',fileName:'duplicates.csv',content:csvFor([importFixture(5),importFixture(5)]),requestKey:randomUUID()}});expect(dup.statusCode,dup.body).toBe(200);expect(dup.json().rows.every((r:{issues:{code:string}[]})=>r.issues.some(i=>i.code==='BATCH_DUPLICATE'))).toBe(true);
  const excluded=await app.inject({remoteAddress,method:'POST',url:`/api/v1/catalog/imports/${dup.json().id}/rows`,headers:headers(vendor),payload:{rowNumber:3,expectedVersion:1,input:importFixture(5),excluded:true,reason:'Exclude the repeated source row'}});expect(excluded.statusCode,excluded.body).toBe(200);expect(excluded.json().rows[0].issues.some((i:{code:string})=>i.code==='BATCH_DUPLICATE')).toBe(false);
 });
 it('serializes competing batches so one GTIN cannot create two products',async()=>{
  const auth=await login('catalog@lumera.demo'),base=importFixture(60);
  // A separate simulated client avoids exhausting the unchanged 200/min API limit
  // after the preceding suite's full business journeys.
  const batches=await Promise.all([0,1].map(n=>app.inject({remoteAddress:'127.0.0.2',method:'POST',url:'/api/v1/catalog/imports',headers:headers(auth),payload:{source:'API',fileName:'API batch',rows:[{...base,vendor_sku:`RACE-SKU-${n}`,parent_sku:`RACE-PARENT-${n}`}],requestKey:randomUUID()}})));
  batches.forEach(b=>expect(b.json().rows[0].issues).toHaveLength(0));
  const responses=await Promise.all(batches.map(b=>app.inject({remoteAddress:'127.0.0.2',method:'POST',url:`/api/v1/catalog/imports/${b.json().id}/submit`,headers:headers(auth),payload:{expectedVersion:1}})));
  expect(responses.map(r=>r.statusCode).sort()).toEqual([200,422]);expect(await db.product.count({where:{gtin:base.gtin}})).toBe(1);
 });
 it('reconciles pre-activation stock from current acknowledgements and read-back, never Boolean flags',async()=>{
  const actor={id:'launch-test',companyId:'cmp_ati_uae',partnerId:null,markets:['AE'],role:'ATI_SUPER_ADMIN'};
  const partner=await db.partner.create({data:{id:'launch-test-partner',code:'LAUNCH-TEST',companyId:actor.companyId,legalName:'Launch Test LLC',displayName:'Launch Test',status:'APPROVED',markets:['AE'],inventorySynced:true,testOrderPassed:true}});
  const product=await db.product.create({data:{id:'launch-test-product',companyId:actor.companyId,partnerId:partner.id,sku:'LAUNCH-TEST-SKU',titleEn:'Test product',titleAr:'منتج اختبار',category:'Beauty/Lips',brand:'launch-brand',price:145,floor:130,status:'PUBLISHED',data:{demoOnly:true}}});
  for(const target of ['ERP','FYND','SFCC'])await db.publication.create({data:{productId:product.id,version:1,target,status:'SUCCEEDED',externalId:`fixture-${target}`}});
  const location=await db.location.create({data:{id:'launch-test-location',companyId:actor.companyId,partnerId:partner.id,name:'Test warehouse',type:'VENDOR_WAREHOUSE',market:'AE',status:'ACTIVE',fyndId:'mock-test-location'}});
  const row=await db.inventory.create({data:{productId:product.id,locationId:location.id,onHand:10,reserved:2,safetyStock:1,sequence:1}});
  expect((await inventoryReadiness(db,partner.id)).passed).toBe(false);
  expect((await readiness(db,partner.id)).find(g=>g.key==='test')?.passed).toBe(false);
  const sync=()=>commandPartner(actor,partner.id,{action:'sync-inventory',expectedVersion:2},'launch-stock-test');
  await commandPartner(actor,partner.id,{action:'sync-inventory',expectedVersion:1},'launch-stock-test');
  let jobs=await db.outbox.findMany({where:{aggregateId:row.id}});expect(jobs).toHaveLength(2);
  jobs.forEach(j=>expect(j.payload).toMatchObject({revision:2,sellable:0}));
  await processOutbox(jobs.find(j=>j.target==='FYND')!.id);
  expect((await inventoryReadiness(db,partner.id)).passed).toBe(false);
  await db.adapterFault.upsert({where:{system:'SFCC'},update:{remaining:1,statusCode:422},create:{system:'SFCC',remaining:1,statusCode:422}});
  const sfcc=jobs.find(j=>j.target==='SFCC')!;await processOutbox(sfcc.id);
  expect((await inventoryReadiness(db,partner.id)).passed).toBe(false);
  await db.outbox.update({where:{id:sfcc.id},data:{status:'PENDING',availableAt:new Date()}});await processOutbox(sfcc.id);
  expect((await inventoryReadiness(db,partner.id)).passed).toBe(true);
  const unstocked=await db.product.create({data:{companyId:actor.companyId,partnerId:partner.id,sku:'LAUNCH-NO-STOCK',titleEn:'Missing position fixture',titleAr:'اختبار',category:'Beauty/Lips',brand:'launch-brand',price:145,floor:130,status:'PUBLISHED',data:{demoOnly:true}}});
  expect((await inventoryReadiness(db,partner.id)).passed).toBe(false);
  expect((await inventoryReadiness(db,partner.id)).detail).toContain('1 published products have no stock position');
  await db.product.update({where:{id:unstocked.id},data:{status:'DRAFT'}});
  expect(await db.inventory.findUniqueOrThrow({where:{id:row.id}})).toMatchObject({onHand:10,reserved:2,sequence:1,revision:2});
  await db.mockInventory.update({where:{system_inventoryId:{system:'SFCC',inventoryId:row.id}},data:{sellable:999}});
  expect((await inventoryReadiness(db,partner.id)).passed).toBe(false);
  // A new revision, not editing an old command, corrects downstream drift.
  await sync();expect((await inventoryReadiness(db,partner.id)).passed).toBe(false);
  jobs=await db.outbox.findMany({where:{aggregateId:row.id,status:'PENDING'}});
  for(const job of jobs)await processOutbox(job.id);
  expect((await inventoryReadiness(db,partner.id)).passed).toBe(true);
  await db.inventory.update({where:{id:row.id},data:{revision:{increment:1},syncedAt:null}});
  expect((await inventoryReadiness(db,partner.id)).passed).toBe(false);
  expect(await db.order.count({where:{externalId:{startsWith:'LAUNCH-TEST'}}})).toBe(0);
  expect(await db.financialEvent.count({where:{partnerId:partner.id}})).toBe(0);
 });
 it('guards launch stock commands by role, version, location ownership and empty assortment',async()=>{
  const actor={id:'launch-test',companyId:'cmp_ati_uae',partnerId:null,markets:['AE'],role:'ATI_SUPER_ADMIN'};
  const id='launch-test-partner',p=await db.partner.findUniqueOrThrow({where:{id}});
  const cmd={action:'sync-inventory' as const,expectedVersion:p.version};
  await expect(commandPartner({...actor,role:'VENDOR_ADMIN',partnerId:id},id,cmd,'launch-denied')).rejects.toMatchObject({statusCode:403});
  await expect(commandPartner(actor,id,{...cmd,expectedVersion:1},'launch-stale')).rejects.toThrow('record changed');
  const before=await db.outbox.count();
  await db.location.update({where:{id:'launch-test-location'},data:{partnerId:'vnd_maz'}});
  await expect(commandPartner(actor,id,cmd,'launch-owner')).rejects.toThrow('location mappings');
  expect(await db.outbox.count()).toBe(before);
  expect((await db.partner.findUniqueOrThrow({where:{id}})).version).toBe(p.version);
  expect((await inventoryReadiness(db,id)).positions[0].issues).toContain('Active company/market/owner location mapping is missing');
  const empty=await db.partner.create({data:{code:'EMPTY-LAUNCH',companyId:actor.companyId,legalName:'Empty Launch LLC',displayName:'Empty Launch',status:'APPROVED',markets:['AE']}});
  await expect(commandPartner(actor,empty.id,{action:'sync-inventory',expectedVersion:empty.version},'empty-launch')).rejects.toThrow('stock position');
 });
 it('requires every current publication before order allocation and exposes zero ATP when acknowledgement is missing',async()=>{
  const product=await db.product.findUniqueOrThrow({where:{id:'prd_lum_serum_3001'}});
  const pub=await db.publication.findUniqueOrThrow({where:{productId_version_target:{productId:product.id,version:product.version,target:'SFCC'}}});
  const before=await db.inventory.findMany({where:{productId:product.id}});
  try{
   await db.publication.update({where:{id:pub.id},data:{status:'FAILED'}});
   const actor={id:'launch-test',companyId:product.companyId,partnerId:null,markets:['AE'],role:'ATI_SUPER_ADMIN'};
   const input=orderInput.parse({...demoOrder,externalOrderId:'missing-current-publication',total:product.price.toFixed(2),lines:[{id:'test',sku:product.sku,quantity:1,unitGross:product.price.toFixed(2)}]});
   await expect(transaction(tx=>ingestOrder(tx,actor,input,'missing-pub'))).rejects.toThrow('publication acknowledgements');
   const auth=await login('admin@ati.demo');
   const view=await app.inject({remoteAddress:'127.0.0.3',url:'/api/v1/inventory?limit=100',headers:headers(auth)});
   expect(view.statusCode,view.body).toBe(200);
   const rows=view.json().items.filter((r:{productId:string})=>r.productId===product.id);expect(rows.length).toBeGreaterThan(0);rows.forEach((r:{sellable:number})=>expect(r.sellable).toBe(0));
   expect(await db.inventory.findMany({where:{productId:product.id}})).toEqual(before);
  }finally{await db.publication.update({where:{id:pub.id},data:{status:pub.status}});}
 });
 it('downloads the defined template and scoped validation report',async()=>{
  const auth=await login('admin@ati.demo'),vendor=await login('admin@maisonazure.demo');
  const batch=await db.catalogImport.findFirstOrThrow({where:{fileName:'defective.csv'}});
  const template=await app.inject({remoteAddress:'127.0.0.2',url:'/api/v1/catalog/imports/template',headers:headers(auth)});expect(template.statusCode).toBe(200);expect(template.body.trim()).toBe(importFields.join(','));
  const report=await app.inject({remoteAddress:'127.0.0.2',url:`/api/v1/catalog/imports/${batch.id}/errors.csv`,headers:headers(auth)});expect(report.statusCode).toBe(200);expect(report.body).toContain('ARABIC_TITLE_MISSING');
  expect((await app.inject({remoteAddress:'127.0.0.2',url:`/api/v1/catalog/imports/${batch.id}/errors.csv`,headers:headers(vendor)})).statusCode).toBe(404);
 });
});
