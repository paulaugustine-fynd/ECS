import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {db} from '../../packages/db/client';
import {seedDemo} from '../../prisma/seed';
import {sampleDocument} from '../../prisma/document-fixtures';
import {createServer} from '../../apps/api/src/server';
import {createMockServer} from '../../apps/mock-systems/src/server';
import {processOutbox} from '../../apps/worker/src/outbox';
import {commandPartner,readiness} from '../../packages/domain/partners';
import {launchTestReadiness} from '../../packages/domain/launch-tests';
import {adapter} from '../../packages/integrations/adapter';
import {provisionFixture} from '../helpers/provision';
import {storefrontFixture} from '../helpers/storefront';
const id=`isolated-${randomUUID()}`,productId=`product-${id}`,locationId=`location-${id}`;
const actor={id:'test-operator',companyId:'cmp_ati_uae',partnerId:null,markets:['AE'],role:'ATI_SUPER_ADMIN'};
let app:FastifyInstance,mocks:FastifyInstance,headers:Record<string,string>,inventoryId:string,completedRun:string,mappedLocationId:string;
async function login(email:string){const r=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password:'Demo123!'}});expect(r.statusCode,r.body).toBe(200);return {cookie:`${r.cookies[0].name}=${r.cookies[0].value}`,'x-csrf-token':r.json().csrfToken};}
async function start(requestId=randomUUID()){
 const p=await db.partner.findUniqueOrThrow({where:{id}});
 const payload={expectedVersion:p.version,requestId,reason:'Verify isolated pre-activation order'};
 const res=await app.inject({method:'POST',url:`/api/v1/partners/${id}/launch-tests`,headers,payload});
 expect(res.statusCode,res.body).toBe(200);return {run:res.json(),payload};
}
async function next(runId:string){const job=await db.outbox.findFirstOrThrow({where:{aggregateId:runId,status:'PENDING'}});await processOutbox(job.id);return db.outbox.findUniqueOrThrow({where:{id:job.id}});}
beforeAll(async()=>{
 const url=new URL(process.env.DATABASE_URL??'');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/ecs_test')throw Error('Requires isolated local ecs_test');
 if(!(await db.partner.count()))await seedDemo();
 app=await createServer({verifyResponseContracts:true});mocks=createMockServer();await mocks.listen({port:4101,host:'127.0.0.1'});headers=await login('admin@ati.demo');
 await db.partner.create({data:{id,code:id,companyId:actor.companyId,legalName:'Isolated Launch Fixture LLC',displayName:'Isolated Launch Fixture',status:'APPROVED',markets:['AE'],fyndMapped:true,erpVendorId:'mock-erp-launch'}});
 for(const type of ['TRADE_LICENSE','VAT_CERTIFICATE','BANK_LETTER'])await db.document.create({data:{partnerId:id,type,...await sampleDocument(id,type),status:'APPROVED',expiresAt:new Date('2028-01-01Z')}});
 await db.agreement.create({data:{partnerId:id,version:1,rate:'0.30',currency:'AED',cadence:'MONTHLY',validFrom:new Date('2026-01-01Z'),validUntil:new Date('2028-01-01Z'),status:'APPROVED',rules:{market:'AE',returnDays:30}}});
 await db.brandRight.create({data:{partnerId:id,brand:'launch-fixture',market:'AE',categories:['Beauty'],validFrom:new Date('2026-01-01Z'),validUntil:new Date('2028-01-01Z'),status:'APPROVED',evidence:'Fictional test authorization',reason:'Isolated test fixture'}});
 await db.product.create({data:{id:productId,companyId:actor.companyId,partnerId:id,sku:`SKU-${id}`,titleEn:'Launch fixture',titleAr:'اختبار إطلاق',brand:'launch-fixture',category:'Beauty/Lips',price:'150',floor:'130',status:'PUBLISHED',data:{demoOnly:true}}});
 for(const target of ['ERP','FYND','SFCC'])await db.publication.create({data:{productId,version:1,target,status:'SUCCEEDED',externalId:`fixture-${target}`}});
 await db.location.create({data:{id:locationId,companyId:actor.companyId,partnerId:id,name:'Isolated launch location',type:'VENDOR_WAREHOUSE',market:'AE',status:'ACTIVE',fyndId:'mock-location-launch'}});
 inventoryId=(await db.inventory.create({data:{productId,locationId,onHand:12,reserved:2,safetyStock:1,sequence:1}})).id;
 await provisionFixture(id);mappedLocationId=(await db.location.findUniqueOrThrow({where:{id:locationId}})).fyndId!;
 expect((await storefrontFixture(productId)).status).toBe('SUCCEEDED');
 await commandPartner(actor,id,{action:'sync-inventory',expectedVersion:(await db.partner.findUniqueOrThrow({where:{id}})).version},'test-prepare');
 for(const job of await db.outbox.findMany({where:{aggregateId:inventoryId,status:'PENDING'}}))await processOutbox(job.id);
});
afterAll(async()=>{await app?.close();await mocks?.close();await db.$disconnect();});
describe('isolated pre-activation order evidence',()=>{
 it('passes eight real mock acknowledgements without operational side effects and enables activation',async()=>{
  const beforeStock=await db.inventory.findUniqueOrThrow({where:{id:inventoryId}}),orders=await db.order.count(),legs=await db.fulfilmentLeg.count(),finance=await db.financialEvent.count();
  const {run,payload}=await start();completedRun=run.id;
  const duplicate=await app.inject({method:'POST',url:`/api/v1/partners/${id}/launch-tests`,headers,payload});expect(duplicate.json().id).toBe(run.id);
  expect((await launchTestReadiness(db,id)).passed).toBe(false);
  for(let step=0;step<8;step++){const job=await next(run.id);expect(job.status,job.error??'').toBe('SUCCEEDED');expect(await processOutbox(job.id)).toBe(false);expect((await db.launchTest.findUniqueOrThrow({where:{id:run.id}})).step).toBe(step+1);}
  expect((await launchTestReadiness(db,id)).passed).toBe(true);
  expect(await db.inventory.findUniqueOrThrow({where:{id:inventoryId}})).toEqual(beforeStock);
  expect(await db.order.count()).toBe(orders);expect(await db.fulfilmentLeg.count()).toBe(legs);expect(await db.financialEvent.count()).toBe(finance);
  expect(await db.mockLaunchOrder.findUniqueOrThrow({where:{runId:run.id}})).toMatchObject({state:'CONFIRMED',virtualOnHand:0,virtualReserved:0});
  expect(await db.outbox.count({where:{aggregateId:run.id,target:{notIn:['FYND','SFCC']}}})).toBe(0);
  expect((await readiness(db,id)).every(g=>g.passed)).toBe(true);
  const p=await db.partner.findUniqueOrThrow({where:{id}});await commandPartner(actor,id,{action:'activate',expectedVersion:p.version},'verified-activation');
  expect((await db.partner.findUniqueOrThrow({where:{id}})).status).toBe('ACTIVE');
  expect((await launchTestReadiness(db,id)).passed).toBe(true);
  for(const job of await db.outbox.findMany({where:{aggregateId:inventoryId,status:'PENDING'}}))await processOutbox(job.id);
 });
 it('binds evidence to current configuration and prevents mutation of completed records',async()=>{
  await db.mockStorefrontProduct.update({where:{productId},data:{visible:false}});
  expect((await readiness(db,id)).find(g=>g.key==='storefront')?.passed).toBe(false);
  expect((await launchTestReadiness(db,id)).passed).toBe(false);
  const blocked=await app.inject({method:'POST',url:`/api/v1/partners/${id}/launch-tests`,headers,payload:{expectedVersion:(await db.partner.findUniqueOrThrow({where:{id}})).version,requestId:randomUUID(),reason:'Hidden storefront must block launch'}});
  expect(blocked.statusCode,blocked.body).toBe(422);
  await db.mockStorefrontProduct.update({where:{productId},data:{visible:true}});
  await expect(db.launchTest.update({where:{id:completedRun},data:{status:'RUNNING',step:0,completedAt:null}})).rejects.toThrow();
  await expect(db.launchTest.delete({where:{id:completedRun}})).rejects.toThrow();
  await db.location.update({where:{id:locationId},data:{cutoffHour:17}});expect((await launchTestReadiness(db,id)).passed).toBe(false);
  await db.location.update({where:{id:locationId},data:{cutoffHour:18}});expect((await launchTestReadiness(db,id)).passed).toBe(true);
 });
 it('persists a failed step and recovers through the audited replay API exactly once',async()=>{
  const {run}=await start();for(let i=0;i<3;i++)expect((await next(run.id)).status).toBe('SUCCEEDED');
  await db.adapterFault.upsert({where:{system:'FYND'},update:{remaining:1,statusCode:422},create:{system:'FYND',remaining:1,statusCode:422}});
  const failed=await next(run.id);expect(failed.status).toBe('DEAD_LETTER');expect((await db.launchTest.findUniqueOrThrow({where:{id:run.id}})).status).toBe('FAILED');
  expect((await launchTestReadiness(db,id)).passed).toBe(false);
  const replay=await app.inject({method:'POST',url:`/api/v1/integrations/jobs/${failed.id}/replay`,headers,payload:{reason:'Corrected mock failure; resume isolated test'}});expect(replay.statusCode,replay.body).toBe(200);
  await processOutbox(failed.id);for(let i=4;i<8;i++)expect((await next(run.id)).status).toBe('SUCCEEDED');
  expect((await launchTestReadiness(db,id)).passed).toBe(true);
  expect(await db.mockRecord.count({where:{idempotencyKey:`launch:${run.id}:3`}})).toBe(1);
 });
 it('checks ownership, roles, CSRF, request identity and scopes the returned history',async()=>{
  const vendor=await login('admin@maisonazure.demo');
  expect((await app.inject({url:`/api/v1/partners/${id}/launch-tests`,headers:vendor})).statusCode).toBe(404);
  expect((await app.inject({method:'POST',url:`/api/v1/partners/${id}/launch-tests`,headers:vendor,payload:{expectedVersion:1,requestId:randomUUID(),reason:'Denied vendor launch'}})).statusCode).toBe(403);
  expect((await app.inject({method:'POST',url:`/api/v1/partners/${id}/launch-tests`,headers:{cookie:headers.cookie},payload:{}})).statusCode).toBe(403);
  const ops=await login('ops@ati.demo');const history=await app.inject({url:`/api/v1/partners/${id}/launch-tests`,headers:ops});expect(history.statusCode).toBe(200);expect(history.body).not.toContain('agreement');expect(history.body).not.toContain('configuration');
  const {run,payload}=await start();
  const conflict=await app.inject({method:'POST',url:`/api/v1/partners/${id}/launch-tests`,headers,payload:{...payload,reason:'Different content with same request'}});expect(conflict.statusCode).toBe(409);
  await expect(db.launchTest.update({where:{id:run.id},data:{fingerprint:'0'.repeat(64)}})).rejects.toThrow();
  const pending=await db.outbox.findFirstOrThrow({where:{aggregateId:run.id,status:'PENDING'}});
  await db.location.update({where:{id:locationId},data:{fyndId:'changed-mapping'}});
  await processOutbox(pending.id);expect((await db.outbox.findUniqueOrThrow({where:{id:pending.id}})).status).toBe('DEAD_LETTER');
  expect(await db.mockRecord.count({where:{idempotencyKey:pending.idempotencyKey}})).toBe(0);
  expect((await launchTestReadiness(db,id)).passed).toBe(false);
 });
 it('mock order state machine rejects skipped transitions and preserves virtual reservations',async()=>{
  const job=await db.outbox.findFirstOrThrow({where:{aggregateId:completedRun,operation:'launchOrderStep'},orderBy:{createdAt:'asc'}});
  const original=job.payload as Record<string,unknown>,runId=`contract-${randomUUID()}`;
  const port=adapter('FYND'),payload={...original,runId,step:0};
  const first=await port.execute('launchOrderStep',payload,{idempotencyKey:`${runId}:0`,correlationId:'contract'});
  expect(await port.execute('launchOrderStep',payload,{idempotencyKey:`${runId}:0`,correlationId:'contract'})).toEqual(first);
  await expect(port.execute('launchOrderStep',{...payload,step:3},{idempotencyKey:`${runId}:3`,correlationId:'contract'})).rejects.toThrow('409');
  expect(await db.mockLaunchOrder.findUniqueOrThrow({where:{runId}})).toMatchObject({state:'ASSIGNED',virtualOnHand:1,virtualReserved:1});
 });
 it('serializes competing launch requests without producing two active test runs',async()=>{
  await db.location.update({where:{id:locationId},data:{fyndId:mappedLocationId}});
  const p=await db.partner.findUniqueOrThrow({where:{id}});
  const responses=await Promise.all([1,2].map(()=>app.inject({method:'POST',url:`/api/v1/partners/${id}/launch-tests`,headers,payload:{expectedVersion:p.version,requestId:randomUUID(),reason:'Concurrent operator launch request'}})));
  expect(responses.map(r=>r.statusCode).sort(),responses.map(r=>r.body).join('\n')).toEqual([200,409]);
  expect(await db.launchTest.count({where:{partnerId:id,status:'RUNNING'}})).toBe(1);
 });
});
