import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {db} from '../../packages/db/client';
import {seedDemo} from '../../prisma/seed';
import {createServer} from '../../apps/api/src/server';
import {createMockServer} from '../../apps/mock-systems/src/server';
import {processInbox} from '../../apps/worker/src/inbox';
import {processOutbox} from '../../apps/worker/src/outbox';
import {signWebhook,digest} from '../../packages/auth/security';
import {provisionFixture} from '../helpers/provision';
import * as orders from '../../packages/domain/orders';
const id=`event-${randomUUID()}`,partner=`v-${id}`,product=`p-${id}`,location=`l-${id}`;
let app:FastifyInstance,mocks:FastifyInstance,headers:Record<string,string>;
function envelope(){const orderId=`ORDER-${randomUUID()}`;return {eventId:randomUUID(),type:'order.created',version:1,occurredAt:'2026-09-25T10:00:00.000Z',producer:'SFCC',tenantId:'cmp_ati_uae',market:'AE',correlationId:`chain-${randomUUID()}`,subject:{entityType:'ORDER',entityId:orderId},data:{externalOrderId:orderId,channel:'BLM-AE',currency:'AED',deliveryCity:'Dubai',total:'150.00',lines:[{id:'line-1',sku:product,quantity:1,unitGross:'150.00'}]}};}
async function receive(body:unknown,source='SFCC',time=String(Math.floor(Date.now()/1000)),signature?:string){const raw=JSON.stringify(body);return app.inject({method:'POST',url:`/api/v1/webhooks/${source}`,headers:{'content-type':'application/json','x-webhook-timestamp':time,'x-webhook-signature':signature??signWebhook(raw,time,process.env.WEBHOOK_SECRET!)},payload:raw});}
beforeAll(async()=>{
 const url=new URL(process.env.DATABASE_URL??'');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/ecs_test')throw Error('Isolated local ecs_test required');
 if(!await db.partner.count())await seedDemo();app=await createServer({verifyResponseContracts:true});mocks=createMockServer();await mocks.listen({port:4101,host:'127.0.0.1'});
 const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:'admin@ati.demo',password:'Demo123!'}});expect(login.statusCode).toBe(200);headers={cookie:`${login.cookies[0].name}=${login.cookies[0].value}`,'x-csrf-token':login.json().csrfToken};
 await db.partner.create({data:{id:partner,code:partner,companyId:'cmp_ati_uae',displayName:'Event contract fixture',legalName:'Fictional Event Fixture LLC',status:'ACTIVE',markets:['AE'],erpVendorId:'fixture-erp-event'}});
 await db.brandRight.create({data:{partnerId:partner,brand:'br-event',market:'AE',categories:['Beauty'],validFrom:new Date('2026-01-01Z'),validUntil:new Date('2028-01-01Z'),status:'APPROVED',evidence:'Fictional event test rights',reason:'Isolated test fixture'}});
 await db.agreement.create({data:{partnerId:partner,version:1,rate:'0.28',currency:'AED',cadence:'WEEKLY',status:'APPROVED',validFrom:new Date('2026-01-01Z'),validUntil:new Date('2028-01-01Z'),rules:{market:'AE',returnDays:30}}});
 await db.location.create({data:{id:location,companyId:'cmp_ati_uae',partnerId:partner,name:'Event fixture warehouse',type:'VENDOR_WAREHOUSE',market:'AE',status:'ACTIVE',cutoffHour:24}});await provisionFixture(partner);
 await db.product.create({data:{id:product,sku:product,companyId:'cmp_ati_uae',partnerId:partner,brand:'br-event',titleEn:'Event fixture',titleAr:'منتج اختبار',category:'Beauty/Makeup/Lips',price:'150',floor:'130',status:'PUBLISHED',data:{demoOnly:true}}});
 for(const target of ['ERP','FYND','SFCC'])await db.publication.create({data:{productId:product,version:1,target,status:'SUCCEEDED',externalId:`fixture-${target}-${id}`}});
 await db.inventory.create({data:{productId:product,locationId:location,onHand:20,sequence:1}});
});
afterAll(async()=>{await app?.close();await mocks?.close();await db.$disconnect();});

it('retains signed v1 evidence, deduplicates concurrent intake and propagates the event chain into order/outbox',async()=>{
 const body=envelope(),raw=JSON.stringify(body),timestamp=String(Math.floor(Date.now()/1000));
 const results=await Promise.all([receive(body,'SFCC',timestamp),receive(body,'SFCC',timestamp)]);for(const r of results){expect(r.statusCode,r.body).toBe(202);expect(r.headers['x-event-correlation-id']).toBe(body.correlationId);}
 expect(results[0].json().receiptId).toBe(results[1].json().receiptId);
 const receipt=await db.inbox.findUniqueOrThrow({where:{id:results[0].json().receiptId}});
 expect(receipt).toMatchObject({envelopeVersion:1,rawEnvelope:raw,payloadHash:digest(raw),signatureTimestamp:timestamp,signature:signWebhook(raw,timestamp,process.env.WEBHOOK_SECRET!),correlationId:body.correlationId});
 expect(await processInbox(receipt.id)).toBe(true);expect(await processInbox(receipt.id)).toBe(false);
 const order=await db.order.findUniqueOrThrow({where:{channel_externalId:{channel:'BLM-AE',externalId:body.data.externalOrderId}}});expect(order.correlationId).toBe(body.correlationId);
 for(let i=0;i<5;i++)for(const job of await db.outbox.findMany({where:{correlationId:body.correlationId,status:'PENDING'}}))await processOutbox(job.id);
 const jobs=await db.outbox.findMany({where:{correlationId:body.correlationId}});expect(jobs.length).toBeGreaterThan(0);expect(jobs.every(j=>j.status==='SUCCEEDED')).toBe(true);
 expect(await db.order.count({where:{externalId:body.data.externalOrderId}})).toBe(1);
 expect((await receive({...body,data:{...body.data,total:'151.00'}})).statusCode).toBe(409);
});

it('rejects unauthenticated, expired, unsupported-version and forged scope/source envelopes before storing',async()=>{
 const before=await db.inbox.count();
 expect((await receive(envelope(),'SFCC',String(Math.floor(Date.now()/1000)),'0'.repeat(64))).statusCode).toBe(401);
 expect((await receive(envelope(),'SFCC','1')).statusCode).toBe(401);
 for(const [change,status] of [[{version:2},400],[{version:0},400],[{market:null},400],[{tenantId:'foreign'},403],[{market:'SA'},403],[{producer:'FYND'},403],[{idempotencyKey:'wrong-key'},400],[{extra:'undocumented'},400]] as const){const r=await receive({...envelope(),...change});expect(r.statusCode,r.body).toBe(status);}
 expect(await db.inbox.count()).toBe(before);
});

it('durably rejects mismatched subjects and replay cannot rewrite or falsely repair original evidence',async()=>{
 const body={...envelope(),subject:{entityType:'ORDER',entityId:'WRONG-ORDER'}},r=await receive(body);expect(r.statusCode).toBe(202);const receiptId=r.json().receiptId;
 expect(await processInbox(receiptId)).toBe(false);
 const before=await db.inbox.findUniqueOrThrow({where:{id:receiptId}});expect(before.status).toBe('DEAD_LETTER');expect(before.error).toContain('EVENT_SUBJECT_MISMATCH');
 expect(await db.order.count({where:{externalId:body.data.externalOrderId}})).toBe(0);
 const replay=await app.inject({method:'POST',url:`/api/v1/integrations/inbox/${receiptId}/replay`,headers,payload:{reason:'Review immutable subject mismatch through replay'}});expect(replay.statusCode,replay.body).toBe(200);
 for(const key of ['rawEnvelope','signature','signatureTimestamp'])expect(replay.json()).not.toHaveProperty(key);
 expect(await processInbox(receiptId)).toBe(false);
 const after=await db.inbox.findUniqueOrThrow({where:{id:receiptId}});expect(after).toMatchObject({rawEnvelope:before.rawEnvelope,payloadHash:before.payloadHash,signature:before.signature,correlationId:before.correlationId,status:'DEAD_LETTER'});
 const audit=await db.auditEvent.findFirstOrThrow({where:{entityId:receiptId,action:'inbox.replay'}});expect(JSON.stringify(audit)).not.toContain(before.signature!);
});

it('separates unsupported event sources/types and malformed business data from envelope acceptance',async()=>{
 for(const body of [{...envelope(),producer:'FYND'},{...envelope(),type:'shipment.unimplemented'},{...envelope(),data:{}}]){
  const r=await receive(body,body.producer);expect(r.statusCode,r.body).toBe(202);expect(r.json().status).toBe('PENDING');expect(await processInbox(r.json().receiptId)).toBe(false);
  const row=await db.inbox.findUniqueOrThrow({where:{id:r.json().receiptId}});expect(row.status).toBe('DEAD_LETTER');expect(row.error).toMatch(/UNSUPPORTED_EVENT|EVENT_SUBJECT_MISMATCH|INVALID_EVENT/);
 }
});

it('preserves both existing null-evidence legacy records and newly signed legacy bodies',async()=>{
 const data=envelope().data,old=await db.inbox.create({data:{source:'SFCC',eventId:randomUUID(),type:'order.created',companyId:'cmp_ati_uae',market:'AE',payload:data,payloadHash:'historical-unknown-raw',correlationId:randomUUID()}});
 expect(old.envelopeVersion).toBe(0);expect(old.rawEnvelope).toBeNull();expect(await processInbox(old.id)).toBe(true);
 const legacy={eventId:randomUUID(),type:'order.created',companyId:'cmp_ati_uae',market:'AE',data:envelope().data};const first=await receive(legacy),again=await receive(legacy);
 expect(first.statusCode).toBe(202);expect(again.headers['x-event-correlation-id']).toBe(first.headers['x-event-correlation-id']);expect(again.json().duplicate).toBe(true);
 const saved=await db.inbox.findUniqueOrThrow({where:{id:first.json().receiptId}});expect(saved.rawEnvelope).toBe(JSON.stringify(legacy));expect(saved.eventOccurredAt).toBeNull();expect(saved.envelopeVersion).toBe(0);expect(await processInbox(saved.id)).toBe(true);
});

it('enforces receipt immutability in PostgreSQL while leaving replay scheduling mutable',async()=>{
 const body=envelope(),r=await receive(body),receiptId=r.json().receiptId;
 for(const data of [{companyId:'foreign'},{payload:{}},{rawEnvelope:'{}'},{signature:'f'.repeat(64)},{correlationId:'rewrite'},{envelopeVersion:0,eventOccurredAt:null}])await expect(db.inbox.update({where:{id:receiptId},data})).rejects.toThrow();
 await expect(db.inbox.delete({where:{id:receiptId}})).rejects.toThrow();
 await expect(db.inbox.update({where:{id:receiptId},data:{status:'RETRY',attempts:1,availableAt:new Date(),error:'Transient test'}})).resolves.toMatchObject({rawEnvelope:JSON.stringify(body)});
 expect(await processInbox(receiptId)).toBe(true);
});

it('rolls back failed processing and retries the original signed receipt exactly once',async()=>{
 const body=envelope(),r=await receive(body),receiptId=r.json().receiptId;
 const spy=vi.spyOn(orders,'ingestOrder').mockRejectedValueOnce(Error('Transient test database failure'));
 try{expect(await processInbox(receiptId)).toBe(false);}finally{spy.mockRestore();}
 expect(await db.order.count({where:{externalId:body.data.externalOrderId}})).toBe(0);
 const failed=await db.inbox.findUniqueOrThrow({where:{id:receiptId}});expect(failed.status).toBe('RETRY');expect(failed.rawEnvelope).toBe(JSON.stringify(body));
 await db.inbox.update({where:{id:receiptId},data:{availableAt:new Date()}});expect(await processInbox(receiptId)).toBe(true);expect(await processInbox(receiptId)).toBe(false);
 expect(await db.order.count({where:{externalId:body.data.externalOrderId}})).toBe(1);
});
