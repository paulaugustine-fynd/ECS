import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {db} from '../../packages/db/client';
import {json,transaction} from '../../packages/db/transaction';
import * as transactions from '../../packages/db/transaction';
import {seedDemo} from '../../prisma/seed';
import {createServer} from '../../apps/api/src/server';
import {createMockServer} from '../../apps/mock-systems/src/server';
import {processOutbox} from '../../apps/worker/src/outbox';
import {provisionFixture} from '../helpers/provision';
import {commandCatalog} from '../../packages/domain/catalog';
import {commandSalesControl} from '../../packages/domain/product-sales';
import {ingestOrder,orderInput,commandLeg} from '../../packages/domain/orders';
import {validGtin} from '../../packages/domain/calculations';
import type {Actor} from '../../packages/auth/policy';
import {expireExchangePaymentHolds} from '../../packages/domain/exchange-cancellation';
import {exchangePaymentPayload,exchangeCancellationResult} from '../../packages/contracts/exchange-payment';

const company=`exchange-${randomUUID()}`,partner=`p-${company}`,medium=`m-${company}`,large=`l-${company}`,location=`loc-${company}`;
const auth=new Map<string,Record<string,string>>();
let app:FastifyInstance,mocks:FastifyInstance,actor:Actor,returnId:string,inventoryId:string,orderId:string,legId:string;
const preview=(payload:object={},role='ops',id=returnId)=>app.inject({method:'POST',url:`/api/v1/returns/${id}/exchange-preview`,headers:auth.get(role),payload:{expectedReturnVersion:1,replacementProductId:large,...payload}});
async function drain(){for(let i=0;i<5;i++)for(const j of await db.outbox.findMany({where:{companyId:company,status:'PENDING'}})){await processOutbox(j.id);const done=await db.outbox.findUniqueOrThrow({where:{id:j.id}});expect(done.status,done.error??'').toBe('SUCCEEDED');}}
beforeAll(async()=>{
 const u=new URL(process.env.DATABASE_URL??'');if(u.pathname!=='/ecs_test'||!['localhost','127.0.0.1'].includes(u.hostname))throw Error('Requires isolated ecs_test');if(!await db.partner.count())await seedDemo();
 app=await createServer({verifyResponseContracts:true});mocks=createMockServer();await mocks.listen({host:'127.0.0.1',port:4101});
 const template=await db.user.findUniqueOrThrow({where:{email:'admin@ati.demo'}});
 for(const [name,role,partnerId,markets,companyId] of [['ops','ATI_SUPER_ADMIN',null,['AE'],company],['vendor','VENDOR_ADMIN',partner,['AE'],company],['foreign','VENDOR_ADMIN','foreign',['AE'],company],['catalog','ATI_CATALOG_MODERATOR',null,['AE'],company],['sa','ATI_SUPER_ADMIN',null,['SA'],company],['tenant','ATI_SUPER_ADMIN',null,['AE'],'another-company']] as const){
  const user=await db.user.create({data:{name,role,partnerId,companyId,markets:[...markets],email:`${name}-${company}@test.invalid`,passwordHash:template.passwordHash}});if(name==='ops')actor=user;
  const r=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:user.email,password:'Demo123!'}});expect(r.statusCode,r.body).toBe(200);auth.set(name,{cookie:`${r.cookies[0].name}=${r.cookies[0].value}`,'x-csrf-token':r.json().csrfToken});
 }
 const now=(await db.demoClock.findUniqueOrThrow({where:{id:'main'}})).now;
 await db.partner.create({data:{id:partner,code:partner,companyId:company,legalName:'Exchange test LLC',displayName:'Exchange fixtures',status:'ACTIVE',markets:['AE'],erpVendorId:'mock-erp-exchange'}});
 await db.brandRight.create({data:{partnerId:partner,brand:partner,market:'AE',categories:['Women'],validFrom:new Date(now.getTime()-86400000),validUntil:new Date(now.getTime()+365*86400000),status:'APPROVED',evidence:'Fictional exchange rights',reason:'Isolated test fixture'}});
 const agreement=await db.agreement.create({data:{partnerId:partner,version:1,rate:'0.28',status:'APPROVED',currency:'AED',validFrom:new Date(now.getTime()-86400000),validUntil:new Date(now.getTime()+365*86400000),rules:{returnDays:30,handlingCharge:'20'}}});
 await db.location.create({data:{id:location,companyId:company,partnerId:partner,market:'AE',name:'Exchange test store',type:'BRAND_STORE',status:'ACTIVE',cutoffHour:24}});
 await provisionFixture(partner);
 for(const [id,size] of [[medium,'M'],[large,'L']]){
  const prefix=String(BigInt(`0x${randomUUID().replaceAll('-','').slice(0,10)}`)).padStart(12,'0'),gtin=Array.from({length:10},(_,i)=>prefix+i).find(validGtin)!;
  await db.product.create({data:{id,sku:id,companyId:company,partnerId:partner,market:'AE',gtin,brand:partner,category:'Women/Dresses/Midi',titleEn:`Exchange dress ${size}`,titleAr:'فستان اختبار',price:'1850',floor:'1750',status:'APPROVED',data:{parentSku:`style-${company}`,attributes:{size,colour:'Black',material:'Silk',countryOfOrigin:'Italy'},media:[{url:'/demo-assets/maz-dress-black.svg',status:'APPROVED'}]}}});
  await db.inventory.create({data:{productId:id,locationId:location,onHand:8,safetyStock:1,sequence:1}});
  await commandCatalog(actor,id,{action:'publish',expectedVersion:1},company);
 }
 await drain();inventoryId=(await db.inventory.findFirstOrThrow({where:{productId:large}})).id;
 // Historical returned/refunded delivery precondition; not proof of a new carrier or refund journey.
 // Publication/provisioning use real local mock jobs; every preview is via authenticated API.
 const originalInventory=await db.inventory.findFirstOrThrow({where:{productId:medium}});
 const line={id:'original-line',sku:medium,productId:medium,inventoryId:originalInventory.id,quantity:1,unitGross:'1850',vendorDiscount:'100',operatorDiscount:'50',net:'1700',commissionRate:'0.28',agreementId:agreement.id,agreementVersion:1,returnPolicy:{version:1,days:30,handlingCharge:'20'}};
 const order=await db.order.create({data:{companyId:company,market:'AE',channel:'BLM-AE',externalId:randomUUID(),currency:'AED',total:'1700',status:'DELIVERED',fyndId:'historical-order',correlationId:company,payloadHash:'historical',lines:json([line]),deliveryCity:'Dubai',routingPolicy:'HISTORICAL_FIXTURE'}});orderId=order.id;
 const leg=await db.fulfilmentLeg.create({data:{orderId,companyId:company,partnerId:partner,market:'AE',locationId:location,status:'DELIVERED',fyndId:'historical-leg',deliveredAt:now,deadline:now,lines:json([line]),routingTrace:{fixture:true,explanation:'Historical exchange preview precondition'}}});legId=leg.id;
 const requested=await app.inject({method:'POST',url:'/api/v1/returns',headers:auth.get('ops'),payload:{legId,lineId:line.id,quantity:1,reason:'Customer requires a larger size',requestId:randomUUID()}});expect(requested.statusCode,requested.body).toBe(200);returnId=requested.json().id;
 await db.returnCase.update({where:{id:returnId},data:{status:'CLOSED',qc:'GOOD',refundStatus:'ACKNOWLEDGED',refundId:'historical-refund'}});
});
afterAll(async()=>{await app?.close();await mocks?.close();await db.$disconnect();});
async function snapshot(){return {order:await db.order.findUnique({where:{id:orderId}}),leg:await db.fulfilmentLeg.findUnique({where:{id:legId}}),r:await db.returnCase.findUnique({where:{id:returnId}}),stock:await db.inventory.findMany({where:{product:{companyId:company}},orderBy:{id:'asc'}}),jobs:await db.outbox.count({where:{companyId:company}}),ledger:await db.financialEvent.count({where:{companyId:company}}),audit:await db.auditEvent.count({where:{companyId:company}}),orders:await db.order.count({where:{companyId:company}})};}
it('previews M → L with original net refund, full replacement charge and no state changes',async()=>{
 const before=await snapshot(),result=await preview();expect(result.statusCode,result.body).toBe(200);
 expect(result.json()).toMatchObject({eligibility:'ELIGIBLE_AT_PREVIEW',reserved:false,replacementCreated:false,original:{size:'M'},replacement:{size:'L'},pricing:{originalRefund:'1700.00',replacementCharge:'1850.00',difference:'150.00',direction:'ADDITIONAL_COST',discountsCarriedForward:false},route:{locationId:location,available:7},blockers:[]});
 expect(await snapshot()).toEqual(before);
 const options=await app.inject({url:`/api/v1/returns/${returnId}/exchange-options`,headers:auth.get('vendor')});expect(options.statusCode,options.body).toBe(200);expect(options.json().items.map((p:{id:string})=>p.id)).toEqual([large]);expect(options.json().hasMore).toBe(false);
});
it('enforces session, CSRF, role, company, market, partner, version and strict inputs',async()=>{
 expect((await preview({},'missing')).statusCode).toBe(401);
 auth.set('no-csrf',{cookie:auth.get('ops')!.cookie});expect((await preview({},'no-csrf')).statusCode).toBe(403);
 expect((await preview({},'catalog')).statusCode).toBe(403);
 for(const role of ['foreign','tenant','sa']){expect((await preview({},role)).statusCode).toBe(404);expect((await app.inject({url:`/api/v1/returns/${returnId}/exchange-options`,headers:auth.get(role)})).statusCode).toBe(404);}
 expect((await preview({},'vendor')).statusCode).toBe(200);
 expect((await preview({replacementProductId:'prd_lum_serum_3001'})).statusCode).toBe(404);
 expect((await preview({expectedReturnVersion:99})).statusCode).toBe(409);
 for(const input of [{quantity:2},{replacementProductId:''},{expectedReturnVersion:0},{routingPolicy:'MANUAL_OVERRIDE'},{charge:'0'}])expect((await preview(input)).statusCode).toBe(400);
 expect((await preview({replacementProductId:medium})).json()).toMatchObject({error:{code:'NOT_SIBLING_VARIANT'}});
});
it('blocks unrefunded, rejected and already-linked returns without pretending to reserve',async()=>{
 const before=await db.returnCase.findUniqueOrThrow({where:{id:returnId}});
 try{
  for(const status of ['REQUESTED','RECEIVED','QC_FAILED','REFUND_PENDING']){await db.returnCase.update({where:{id:returnId},data:{status}});expect((await preview()).json()).toMatchObject({eligibility:'BLOCKED',blockers:[{code:'RETURN_REFUND_PENDING'}],reserved:false});}
  await db.returnCase.update({where:{id:returnId},data:{status:'REJECTED'}});expect((await preview()).json().blockers[0].code).toBe('RETURN_REJECTED');
  await db.returnCase.update({where:{id:returnId},data:{status:'CLOSED',refundId:null}});expect((await preview()).json().eligibility).toBe('BLOCKED');
  await db.returnCase.update({where:{id:returnId},data:{refundId:before.refundId,replacementOrderId:'existing-replacement'}});expect((await preview()).json().blockers[0].code).toBe('REPLACEMENT_ALREADY_LINKED');
 }finally{await db.returnCase.update({where:{id:returnId},data:{status:before.status,refundId:before.refundId,replacementOrderId:before.replacementOrderId}});}
});
it('handles equal and lower prices without floating-point or double-refund semantics',async()=>{
 try{for(const [price,difference,direction] of [['1700','0.00','EVEN'],['1650.25','-49.75','LOWER_COST']]){await db.product.update({where:{id:large},data:{price}});const r=await preview();expect(r.statusCode,r.body).toBe(200);expect(r.json().pricing).toMatchObject({originalRefund:'1700.00',replacementCharge:Number(price).toFixed(2),difference,direction});}}
 finally{await db.product.update({where:{id:large},data:{price:'1850'}});}
});
it('rechecks stock instead of reusing an earlier preview; intake rejects the same exhausted route',async()=>{
 const before=await db.inventory.findUniqueOrThrow({where:{id:inventoryId}});
 try{
  expect((await preview()).json().eligibility).toBe('ELIGIBLE_AT_PREVIEW');
  await db.inventory.update({where:{id:inventoryId},data:{reserved:7}});
  const blocked=await preview();expect(blocked.json()).toMatchObject({eligibility:'BLOCKED',route:null,blockers:[{code:'NO_ROUTE'}]});
  await expect(transaction(tx=>ingestOrder(tx,actor,orderInput.parse({externalOrderId:randomUUID(),channel:'BLM-AE',currency:'AED',deliveryCity:'Dubai',total:'1850',lines:[{id:'l',sku:large,quantity:1,unitGross:'1850'}]}),company))).rejects.toMatchObject({code:'NO_ROUTE'});
 }finally{await db.inventory.update({where:{id:inventoryId},data:{reserved:before.reserved}});}
});
it('retains catalogue and mapping gates instead of treating a published flag as sufficient',async()=>{
 await commandSalesControl(actor,large,{action:'pause',expectedVersion:1,reason:'Pause replacement for a local eligibility test'},company);
 expect((await preview()).json().blockers[0].code).toBe('ITEM_NOT_SELLABLE');
 await commandSalesControl(actor,large,{action:'restore',expectedVersion:2,reason:'Restore replacement after eligibility test'},company);
 try{
  await db.product.update({where:{id:large},data:{version:2}});expect((await preview()).json().blockers[0].code).toBe('MAPPING_MISSING');
 }finally{await db.product.update({where:{id:large},data:{version:1}});}
 const mapping=await db.mockMapping.findFirstOrThrow({where:{snapshot:{path:['companyId'],equals:company}}});
 try{await db.mockMapping.update({where:{key:mapping.key},data:{fingerprint:'0'.repeat(64)}});expect((await preview()).json().blockers[0].code).toBe('MAPPING_MISSING');}
 finally{await db.mockMapping.update({where:{key:mapping.key},data:{fingerprint:mapping.fingerprint}});}
});
it('rejects unrelated styles and does not infer a family from a SKU prefix',async()=>{
 const p=await db.product.findUniqueOrThrow({where:{id:large}});
 try{
  for(const parentSku of ['',`different-${company}`]){
   await db.product.update({where:{id:large},data:{data:json({...p.data as object,parentSku})}});
   expect((await preview()).json()).toMatchObject({error:{code:'NOT_SIBLING_VARIANT'}});
   expect((await app.inject({url:`/api/v1/returns/${returnId}/exchange-options`,headers:auth.get('ops')})).json().items).toHaveLength(0);
  }
 }finally{await db.product.update({where:{id:large},data:{data:json(p.data)}});}
});
it('keeps concurrent preview retries entirely read-only',async()=>{
 const before=await snapshot(),results=await Promise.all([preview(),preview(),preview()]);
 results.forEach(r=>{expect(r.statusCode,r.body).toBe(200);expect(r.json()).toMatchObject({reserved:false,replacementCreated:false});});
 expect(results[0].json()).toEqual(results[1].json());expect(await snapshot()).toEqual(before);
});

async function requestBody(){const quote=(await preview()).json();expect(quote.eligibility).toBe('ELIGIBLE_AT_PREVIEW');return {expectedReturnVersion:quote.returnVersion,replacementProductId:large,routingPolicy:quote.routingPolicy,requestId:randomUUID(),reason:'Customer accepts a size L replacement review',expectedProductVersion:quote.replacement.version,expectedSaleVersion:quote.replacement.saleVersion,acceptedReplacementTotal:quote.pricing.replacementCharge,acceptedPolicy:quote.policy};}
const submit=(payload:object,role='vendor')=>app.inject({method:'POST',url:`/api/v1/returns/${returnId}/exchanges`,headers:auth.get(role),payload});
const cancel=(id:string,role='vendor',payload:object={expectedVersion:1,reason:'Customer withdrew the pending exchange review'})=>app.inject({method:'POST',url:`/api/v1/exchanges/${id}/cancel`,headers:auth.get(role),payload});
const review=(id:string,payload:object={},role='ops')=>app.inject({method:'POST',url:`/api/v1/exchanges/${id}/review`,headers:auth.get(role),payload:{action:'approve',expectedVersion:1,reason:'ATI reviewed the accepted replacement terms',...payload}});
async function cancelActive(){for(const r of await db.exchangeRequest.findMany({where:{returnId,status:{in:['REQUESTED','APPROVED']}}})){const result=await cancel(r.id,'ops',{expectedVersion:r.version,reason:'Clean up the isolated test request'});expect(result.statusCode,result.body).toBe(200);}}
it('persists one owned request and pricing snapshot without stock, payment, return or delivery mutation',async()=>{
 const body=await requestBody(),before=await snapshot();
 try{
  const result=await submit(body);expect(result.statusCode,result.body).toBe(200);const r=result.json().request;
  expect(r).toMatchObject({status:'REQUESTED',version:1,quantity:1,returnId,replacementProductId:large,replacementTotal:'1850.00',snapshot:{eligibility:'ELIGIBLE_AT_PREVIEW',reserved:false,replacementCreated:false,pricing:{difference:'150.00'}},cancelledAt:null});expect(r).not.toHaveProperty('requestHash');
  const after=await snapshot();expect({...after,audit:before.audit}).toEqual(before);expect(after.audit).toBe(before.audit+1);
  expect(await db.auditEvent.count({where:{entityId:r.id,action:'exchange.request'}})).toBe(1);
  for(const role of ['ops','vendor']){const list=await app.inject({url:`/api/v1/returns/${returnId}/exchanges`,headers:auth.get(role)});expect(list.statusCode,list.body).toBe(200);expect(list.json().items).toContainEqual(r);}
  expect((await preview()).json().blockers).toContainEqual(expect.objectContaining({code:'EXCHANGE_ALREADY_REQUESTED'}));
 }finally{await cancelActive();}
});
it('deduplicates simultaneous exact requests and rejects changed-content reuse even after cancellation',async()=>{
 const body=await requestBody();
 try{
  const results=await Promise.all([submit(body),submit(body)]);results.forEach(r=>expect(r.statusCode,r.body).toBe(200));const id=results[0].json().request.id;
  expect(results[1].json().request.id).toBe(id);expect(results.map(r=>r.json().replayed).sort()).toEqual([false,true]);
  expect(await db.auditEvent.count({where:{entityId:id,action:'exchange.request'}})).toBe(1);
  expect((await submit({...body,reason:'Different request content must not replace evidence'})).statusCode).toBe(409);
  expect((await cancel(id)).statusCode).toBe(200);const replay=await submit(body);expect(replay.statusCode,replay.body).toBe(200);expect(replay.json()).toMatchObject({replayed:true,request:{id,status:'CANCELLED'}});
  expect((await submit({...body,acceptedReplacementTotal:'1.00'})).statusCode).toBe(409);
 }finally{await cancelActive();}
});
it('allows one winner for competing requests and retains cancelled history when choosing again',async()=>{
 const a=await requestBody(),b={...a,requestId:randomUUID()};
 try{
  const results=await Promise.all([submit(a),submit(b,'ops')]);expect(results.map(r=>r.statusCode).sort()).toEqual([200,409]);
  const id=results.find(r=>r.statusCode===200)!.json().request.id;expect((await cancel(id,'ops')).statusCode).toBe(200);
  const next=await submit(await requestBody());expect(next.statusCode,next.body).toBe(200);expect(next.json().request.id).not.toBe(id);
  const list=(await app.inject({url:`/api/v1/returns/${returnId}/exchanges`,headers:auth.get('vendor')})).json();expect(list.items.find((r:{id:string})=>r.id===id).status).toBe('CANCELLED');expect(list.items.filter((r:{status:string})=>r.status==='REQUESTED')).toHaveLength(1);
 }finally{await cancelActive();}
});
it('recomputes quote and availability instead of trusting an accepted amount or earlier route',async()=>{
 const body=await requestBody(),stock=await db.inventory.findUniqueOrThrow({where:{id:inventoryId}}),count=await db.exchangeRequest.count({where:{returnId}});
 for(const payload of [{...body,acceptedReplacementTotal:'0.00'},{...body,expectedProductVersion:999},{...body,expectedSaleVersion:999}])expect((await submit(payload)).json()).toMatchObject({error:{code:'EXCHANGE_QUOTE_CHANGED'}});
 try{
  await db.product.update({where:{id:large},data:{price:'1900'}});expect((await submit(body)).json()).toMatchObject({error:{code:'EXCHANGE_QUOTE_CHANGED'}});
  await db.product.update({where:{id:large},data:{price:'1850'}});await db.inventory.update({where:{id:inventoryId},data:{reserved:7}});expect((await submit(body)).json()).toMatchObject({error:{code:'EXCHANGE_BLOCKED'}});
 }finally{await db.product.update({where:{id:large},data:{price:'1850'}});await db.inventory.update({where:{id:inventoryId},data:{reserved:stock.reserved}});}
 expect(await db.exchangeRequest.count({where:{returnId}})).toBe(count);
 expect((await submit({...body,expectedReturnVersion:99})).statusCode).toBe(409);
 expect((await submit({...body,quantity:2})).statusCode).toBe(400);expect((await submit({...body,acceptedPolicy:'ATI_PRODUCTION_POLICY'})).statusCode).toBe(400);
});
it('rolls back a request if its audit cannot be retained',async()=>{
 const body=await requestBody(),count=await db.exchangeRequest.count({where:{returnId}}),before=await snapshot(),spy=vi.spyOn(transactions,'audit').mockRejectedValueOnce(Error('Injected request audit failure'));
 try{expect((await submit(body)).statusCode).toBe(500);}finally{spy.mockRestore();}
 expect(await db.exchangeRequest.count({where:{returnId}})).toBe(count);expect(await snapshot()).toEqual(before);
});
it('enforces write/read/cancel boundaries and never exposes another company or partner request',async()=>{
 const body=await requestBody();for(const [role,status] of [['missing',401],['no-csrf',403],['catalog',403],['foreign',404],['sa',404],['tenant',404]] as const){expect((await submit(body,role)).statusCode).toBe(status);if(!['missing','no-csrf'].includes(role))expect((await app.inject({url:`/api/v1/returns/${returnId}/exchanges`,headers:auth.get(role)})).statusCode).toBe(status);}
 try{
  const created=await submit(body),id=created.json().request.id;expect(created.statusCode,created.body).toBe(200);
  for(const [role,status] of [['missing',401],['no-csrf',403],['catalog',403],['foreign',404],['sa',404],['tenant',404]] as const)expect((await cancel(id,role)).statusCode).toBe(status);
  expect((await cancel(id,'vendor',{expectedVersion:99,reason:'Stale cancellation request'})).statusCode).toBe(409);
 }finally{await cancelActive();}
});
it('guards immutable evidence and one-active-request ownership at the SQL boundary',async()=>{
 const body=await requestBody();
 try{
  const created=await submit(body);expect(created.statusCode,created.body).toBe(200);const r=await db.exchangeRequest.findUniqueOrThrow({where:{id:created.json().request.id}});
  await expect(db.exchangeRequest.update({where:{id:r.id},data:{replacementTotal:'1'}})).rejects.toThrow();
  await expect(db.exchangeRequest.update({where:{id:r.id},data:{snapshot:{forged:true}}})).rejects.toThrow();
  await expect(db.exchangeRequest.delete({where:{id:r.id}})).rejects.toThrow();
  const clone={...r,id:randomUUID(),requestId:randomUUID(),snapshot:json(r.snapshot),reviewSnapshot:undefined};
  await expect(db.exchangeRequest.create({data:clone})).rejects.toMatchObject({code:'P2002'});
  await expect(db.exchangeRequest.create({data:{...clone,id:randomUUID(),companyId:'foreign'}})).rejects.toThrow();
  await expect(db.exchangeRequest.create({data:{...clone,id:randomUUID(),quantity:2}})).rejects.toThrow();
 }finally{await cancelActive();}
});
it('deduplicates cancellation and preserves the request across API restarts without ledger or stock entries',async()=>{
 const body=await requestBody();
 try{
  const created=await submit(body);expect(created.statusCode,created.body).toBe(200);const r=created.json().request;
  await app.close();app=await createServer({verifyResponseContracts:true});
  expect((await app.inject({url:`/api/v1/returns/${returnId}/exchanges`,headers:auth.get('vendor')})).json().items).toContainEqual(r);
  const before=await snapshot(),cancelled=await Promise.all([cancel(r.id),cancel(r.id)]);cancelled.forEach(c=>expect(c.statusCode,c.body).toBe(200));expect(cancelled.map(c=>c.json().replayed).sort()).toEqual([false,true]);
  const after=await snapshot();expect({...after,audit:before.audit}).toEqual(before);expect(after.audit).toBe(before.audit+1);expect(await db.auditEvent.count({where:{entityId:r.id,action:'exchange.cancel'}})).toBe(1);
  expect((await cancel(r.id,'ops')).statusCode).toBe(409);expect((await preview()).json().eligibility).toBe('ELIGIBLE_AT_PREVIEW');
 }finally{await cancelActive();}
});
it('retains an ATI approval and refreshed quote without claiming a replacement or payment',async()=>{
 try{
  const created=await submit(await requestBody()),r=created.json().request,before=await snapshot();
  const decided=await review(r.id);expect(decided.statusCode,decided.body).toBe(200);
  expect(decided.json()).toMatchObject({replayed:false,request:{status:'APPROVED',version:2,reviewAction:'APPROVED',reviewedBy:actor.id,reviewSnapshot:{eligibility:'ELIGIBLE_AT_PREVIEW',reserved:false,replacementCreated:false,pricing:{replacementCharge:'1850.00'}}}});
  expect(decided.json().request.snapshot).toEqual(r.snapshot);
  const after=await snapshot();expect({...after,audit:before.audit}).toEqual(before);expect(after.audit).toBe(before.audit+1);
  expect((await preview()).json().blockers).toContainEqual(expect.objectContaining({code:'EXCHANGE_ALREADY_REQUESTED'}));
  expect((await app.inject({url:`/api/v1/returns/${returnId}/exchanges`,headers:auth.get('vendor')})).json().items).toContainEqual(decided.json().request);
 }finally{await cancelActive();}
});
it('restricts review to ATI fulfilment roles with tenant, market, CSRF and strict-body checks',async()=>{
 try{
  const r=(await submit(await requestBody())).json().request;
  for(const [role,status] of [['missing',401],['no-csrf',403],['vendor',403],['foreign',403],['catalog',403],['sa',404],['tenant',404]] as const)expect((await review(r.id,{},role)).statusCode).toBe(status);
  for(const payload of [{action:'pay'},{reason:'bad'},{expectedVersion:0},{amount:'1'},{reviewedBy:'fake'}])expect((await review(r.id,payload)).statusCode).toBe(400);
  expect((await review(r.id,{expectedVersion:99})).statusCode).toBe(409);
  expect((await db.exchangeRequest.findUniqueOrThrow({where:{id:r.id}})).status).toBe('REQUESTED');
 }finally{await cancelActive();}
});
it('rejects stale approved terms, exhausted stock and changed refund facts; rejection still releases the slot',async()=>{
 const stock=await db.inventory.findUniqueOrThrow({where:{id:inventoryId}});
 try{
  const body=await requestBody(),r=(await submit(body)).json().request;
  await db.product.update({where:{id:large},data:{price:'1900'}});expect((await review(r.id)).json()).toMatchObject({error:{code:'EXCHANGE_QUOTE_CHANGED'}});
  await db.product.update({where:{id:large},data:{price:'1850'}});
  await db.inventory.update({where:{id:inventoryId},data:{reserved:7}});expect((await review(r.id)).json()).toMatchObject({error:{code:'EXCHANGE_BLOCKED'}});
  await db.inventory.update({where:{id:inventoryId},data:{reserved:stock.reserved}});
  await commandSalesControl(actor,large,{action:'pause',expectedVersion:body.expectedSaleVersion,reason:'Pause replacement after accepted quote'},company);
  expect((await review(r.id)).json()).toMatchObject({error:{code:'EXCHANGE_BLOCKED'}});
  await commandSalesControl(actor,large,{action:'restore',expectedVersion:body.expectedSaleVersion+1,reason:'Restore replacement with a new sales revision'},company);
  expect((await review(r.id)).json()).toMatchObject({error:{code:'EXCHANGE_QUOTE_CHANGED'}});
  const original=await db.returnCase.findUniqueOrThrow({where:{id:returnId}});
  try{await db.returnCase.update({where:{id:returnId},data:{version:2}});expect((await review(r.id)).json()).toMatchObject({error:{code:'STALE_RETURN'}});
   const rejected=await review(r.id,{action:'reject',reason:'Accepted terms need renewed partner consent'});expect(rejected.statusCode,rejected.body).toBe(200);expect(rejected.json().request).toMatchObject({status:'REJECTED',reviewSnapshot:null,reviewAction:'REJECTED'});
  }finally{await db.returnCase.update({where:{id:returnId},data:{version:original.version}});}
  expect((await submit(body)).json()).toMatchObject({replayed:true,request:{id:r.id,status:'REJECTED'}});
  expect((await preview()).json().eligibility).toBe('ELIGIBLE_AT_PREVIEW');expect((await submit(await requestBody())).statusCode).toBe(200);
 }finally{await db.product.update({where:{id:large},data:{price:'1850'}});await db.inventory.update({where:{id:inventoryId},data:{reserved:stock.reserved}});await cancelActive();}
});
it('deduplicates exact review retries, rejects conflicting decisions and preserves review through cancellation',async()=>{
 try{
  const id=(await submit(await requestBody())).json().request.id;
  const results=await Promise.all([review(id),review(id)]);results.forEach(r=>expect(r.statusCode,r.body).toBe(200));expect(results.map(r=>r.json().replayed).sort()).toEqual([false,true]);
  expect(await db.auditEvent.count({where:{entityId:id,action:'exchange.approve'}})).toBe(1);
  expect((await review(id,{reason:'Different approval evidence'})).statusCode).toBe(409);expect((await review(id,{action:'reject'})).statusCode).toBe(409);
  const before=results[0].json().request,command={expectedVersion:2,reason:'Customer withdrew before replacement checkout'};
  const cancelled=await Promise.all([cancel(id,'vendor',command),cancel(id,'vendor',command)]);cancelled.forEach(r=>expect(r.statusCode,r.body).toBe(200));expect(cancelled.map(r=>r.json().replayed).sort()).toEqual([false,true]);
  expect(cancelled[0].json().request).toMatchObject({status:'CANCELLED',version:3,reviewAction:'APPROVED',reviewSnapshot:before.reviewSnapshot,reviewReason:before.reviewReason});
  expect((await review(id)).json()).toMatchObject({replayed:true,request:{status:'CANCELLED',version:3}});
 }finally{await cancelActive();}
});
it('serializes competing review/cancellation and conflicting reviewer decisions',async()=>{
 try{
  let id=(await submit(await requestBody())).json().request.id;
  const competing=await Promise.all([review(id),cancel(id)]);expect(competing.map(r=>r.statusCode).sort()).toEqual([200,409]);await cancelActive();
  id=(await submit(await requestBody())).json().request.id;
  const decisions=await Promise.all([review(id),review(id,{action:'reject'})]);expect(decisions.map(r=>r.statusCode).sort()).toEqual([200,409]);
  expect(await db.auditEvent.count({where:{entityId:id,action:{in:['exchange.approve','exchange.reject']}}})).toBe(1);
 }finally{await cancelActive();}
});
it('rolls back failed review audit and guards immutable review evidence in SQL',async()=>{
 try{
  const id=(await submit(await requestBody())).json().request.id,before=await snapshot(),spy=vi.spyOn(transactions,'audit').mockRejectedValueOnce(Error('Injected review audit failure'));
  try{expect((await review(id)).statusCode).toBe(500);}finally{spy.mockRestore();}
  expect(await snapshot()).toEqual(before);expect((await db.exchangeRequest.findUniqueOrThrow({where:{id}})).status).toBe('REQUESTED');
  await expect(db.exchangeRequest.update({where:{id},data:{status:'APPROVED',version:2}})).rejects.toThrow();
  await expect(db.exchangeRequest.update({where:{id},data:{reviewReason:'Forged partial decision'}})).rejects.toThrow();
  expect((await review(id)).statusCode).toBe(200);
  await expect(db.exchangeRequest.update({where:{id},data:{reviewReason:'Rewritten accepted history'}})).rejects.toThrow();
  await expect(db.exchangeRequest.update({where:{id},data:{status:'CANCELLED',version:3,cancelledAt:new Date(),cancelledBy:actor.id,cancellationReason:'Cancellation with a forged review',reviewSnapshot:{forged:true}}})).rejects.toThrow();
  await expect(db.exchangeRequest.delete({where:{id}})).rejects.toThrow();
 }finally{await cancelActive();}
});
it('retains a rejection across API restart and refuses reversal or cancellation of rejected history',async()=>{
 const id=(await submit(await requestBody())).json().request.id;
 const rejected=await review(id,{action:'reject',reason:'ATI declined this replacement request'});expect(rejected.statusCode,rejected.body).toBe(200);
 await app.close();app=await createServer({verifyResponseContracts:true});
 expect((await app.inject({url:`/api/v1/returns/${returnId}/exchanges`,headers:auth.get('vendor')})).json().items).toContainEqual(rejected.json().request);
 expect((await review(id,{action:'reject',reason:'ATI declined this replacement request'})).json().replayed).toBe(true);
 expect((await review(id,{expectedVersion:2})).statusCode).toBe(409);
 expect((await cancel(id,'vendor',{expectedVersion:2,reason:'Trying to cancel rejected history'})).statusCode).toBe(409);
});

// Independent historical refunded deliveries allow separate checkout outcomes.
// New replacement orders, payments, reservations and fulfilment use the real domain/worker.
async function checkoutCase(){
 const baseOrder=await db.order.findUniqueOrThrow({where:{id:orderId}}),baseLeg=await db.fulfilmentLeg.findUniqueOrThrow({where:{id:legId}});
 const originalOrder=await db.order.create({data:{...baseOrder,id:randomUUID(),externalId:randomUUID(),lines:json(baseOrder.lines)}});
 const originalLeg=await db.fulfilmentLeg.create({data:{...baseLeg,id:randomUUID(),orderId:originalOrder.id,lines:json(baseLeg.lines),routingTrace:json(baseLeg.routingTrace)}});
 const created=await app.inject({method:'POST',url:'/api/v1/returns',headers:auth.get('ops'),payload:{legId:originalLeg.id,lineId:'original-line',quantity:1,reason:'Independent fictional refunded exchange case',requestId:randomUUID()}});expect(created.statusCode,created.body).toBe(200);
 const r=await db.returnCase.update({where:{id:created.json().id},data:{status:'CLOSED',qc:'GOOD',refundStatus:'ACKNOWLEDGED',refundId:`historical-${randomUUID()}`}});
 const quote=(await preview({},'ops',r.id)).json();expect(quote.eligibility).toBe('ELIGIBLE_AT_PREVIEW');
 const saved=await app.inject({method:'POST',url:`/api/v1/returns/${r.id}/exchanges`,headers:auth.get('vendor'),payload:{requestId:randomUUID(),reason:'Accepted separate replacement purchase',replacementProductId:large,expectedReturnVersion:1,expectedProductVersion:quote.replacement.version,expectedSaleVersion:quote.replacement.saleVersion,acceptedReplacementTotal:quote.pricing.replacementCharge,acceptedPolicy:quote.policy}});expect(saved.statusCode,saved.body).toBe(200);
 const id=saved.json().request.id;expect((await review(id)).statusCode).toBe(200);return {id,r,originalOrder,originalLeg};
}
const checkout=(id:string,payload:object={},role='ops')=>app.inject({method:'POST',url:`/api/v1/exchanges/${id}/checkout`,headers:auth.get(role),payload:{expectedVersion:2,reason:'Simulate customer accepting the separate SFCC replacement purchase',simulatedCustomerAcceptance:true,...payload}});
const execution=(id:string,role='ops')=>app.inject({url:`/api/v1/exchanges/${id}/checkout`,headers:auth.get(role)});
async function due(id:string){await db.outbox.update({where:{id},data:{availableAt:new Date(0)}});await processOutbox(id);return db.outbox.findUniqueOrThrow({where:{id}});}
async function paymentJob(executionId:string,operation='purchaseExchange'){return db.outbox.findFirstOrThrow({where:{aggregateId:executionId,operation}});}
async function advance(leg:string,next:'ACCEPTED'|'PICKING'|'PACKED'|'READY_TO_DISPATCH'|'DISPATCHED'|'DELIVERED'|'CANCELLED'){
 const l=await db.fulfilmentLeg.findUniqueOrThrow({where:{id:leg}});
 await commandLeg(actor,leg,{expectedVersion:l.version,next,reason:'Fictional exchange lifecycle verification',tracking:'EXCHANGE-DEMO-TRACK',confirmedQuantities:{replacement:1}},company);await drain();
}
it('creates one linked replacement reservation and waits for typed SFCC evidence before sending to Fynd',async()=>{
 const c=await checkoutCase(),before=await db.inventory.findUniqueOrThrow({where:{id:inventoryId}});
 const results=await Promise.all([checkout(c.id),checkout(c.id)]);results.forEach(r=>expect(r.statusCode,r.body).toBe(200));expect(results.map(r=>r.json().replayed).sort()).toEqual([false,true]);
 const e=results[0].json().execution;expect(e).toMatchObject({paymentStatus:'PENDING',orderStatus:'AWAITING_PAYMENT',purchaseReceipt:null,amount:'1850.00',actualMoneyMoved:false});expect(results[1].json().execution.id).toBe(e.id);
 expect((await db.auditEvent.findFirstOrThrow({where:{entityId:e.orderId,action:'order.routed'}})).reason).toBe('Approved exchange checkout; simulated payment acknowledgement required');
 expect((await db.returnCase.findUniqueOrThrow({where:{id:c.r.id}}))).toMatchObject({...c.r,replacementOrderId:e.orderId,version:2});
 expect(await db.order.findUnique({where:{id:c.originalOrder.id}})).toEqual(c.originalOrder);expect(await db.fulfilmentLeg.findUnique({where:{id:c.originalLeg.id}})).toEqual(c.originalLeg);
 expect((await db.inventory.findUniqueOrThrow({where:{id:inventoryId}})).reserved).toBe(before.reserved+1);
 expect(await db.outbox.count({where:{aggregateId:e.orderId,target:'FYND',operation:'createOrder'}})).toBe(0);
 expect((await checkout(c.id,{reason:'Different checkout request'})).statusCode).toBe(409);expect((await cancel(c.id,'vendor',{expectedVersion:2,reason:'Cannot cancel a linked order using request-only command'})).statusCode).toBe(409);
 await expect(commandLeg(actor,e.shipments[0].id,{expectedVersion:1,next:'ACCEPTED'},company)).rejects.toMatchObject({code:'FYND_ACK_REQUIRED'});
 await drain();const after=(await execution(c.id,'vendor')).json();expect(after).toMatchObject({paymentStatus:'CAPTURED',orderStatus:'ALLOCATED',purchaseReceipt:{status:'CAPTURED',amount:'1850.00',actualMoneyMoved:false},shipments:[{status:'ASSIGNED'}]});
 expect(await db.outbox.count({where:{aggregateId:e.orderId,operation:'createOrder'}})).toBe(1);
 for(const next of ['ACCEPTED','PICKING','PACKED','READY_TO_DISPATCH','DISPATCHED','DELIVERED'] as const)await advance(e.shipments[0].id,next);
 expect((await execution(c.id)).json()).toMatchObject({paymentStatus:'CAPTURED',orderStatus:'DELIVERED'});
 const stock=await db.inventory.findUniqueOrThrow({where:{id:inventoryId}});expect(stock.reserved).toBe(before.reserved);expect(stock.onHand).toBe(before.onHand-1);
 const events=await db.financialEvent.findMany({where:{sourceId:`${e.shipments[0].id}:replacement`}});expect(events).toHaveLength(4);expect(events.find(x=>x.kind==='SALE_RECOGNISED')?.amount.toFixed(2)).toBe('1850.00');expect(events.find(x=>x.kind==='COMMISSION_ACCRUED')?.amount.toFixed(2)).toBe('-518.00');
 expect(await db.fulfilmentLeg.findUnique({where:{id:c.originalLeg.id}})).toEqual(c.originalLeg);
});
it('enforces checkout role, ownership, demo-only consent and fresh price/stock gates',async()=>{
 const c=await checkoutCase();for(const [role,status] of [['missing',401],['no-csrf',403],['vendor',403],['foreign',403],['catalog',403],['sa',404],['tenant',404]] as const)expect((await checkout(c.id,{},role)).statusCode).toBe(status);
 expect((await checkout(c.id,{simulatedCustomerAcceptance:false})).statusCode).toBe(400);expect((await checkout(c.id,{expectedVersion:1})).statusCode).toBe(409);expect((await checkout(c.id,{amount:'1'})).statusCode).toBe(400);
 const stock=await db.inventory.findUniqueOrThrow({where:{id:inventoryId}}),mode=process.env.DEMO_MODE;
 try{
  process.env.DEMO_MODE='false';expect((await checkout(c.id)).statusCode).toBe(403);process.env.DEMO_MODE=mode;
  await db.product.update({where:{id:large},data:{price:'1900'}});expect((await checkout(c.id)).json()).toMatchObject({error:{code:'EXCHANGE_QUOTE_CHANGED'}});await db.product.update({where:{id:large},data:{price:'1850'}});
  await db.inventory.update({where:{id:inventoryId},data:{reserved:stock.onHand}});expect((await checkout(c.id)).json()).toMatchObject({error:{code:'EXCHANGE_BLOCKED'}});
 }finally{process.env.DEMO_MODE=mode;await db.product.update({where:{id:large},data:{price:'1850'}});await db.inventory.update({where:{id:inventoryId},data:{reserved:stock.reserved}});}
 expect(await db.exchangeExecution.count({where:{exchangeId:c.id}})).toBe(0);expect(await db.returnCase.findUnique({where:{id:c.r.id}})).toEqual(c.r);
});
it('rolls back order, link, reservation, execution, audit and jobs if checkout cannot commit',async()=>{
 const c=await checkoutCase(),before=await snapshot(),enqueue=transactions.enqueue,spy=vi.spyOn(transactions,'enqueue').mockImplementation(async(...args)=>{if(args[4]==='purchaseExchange')throw Error('Injected checkout outbox failure');return enqueue(...args);});
 try{expect((await checkout(c.id)).statusCode).toBe(500);}finally{spy.mockRestore();}
 expect(await snapshot()).toEqual(before);expect(await db.exchangeExecution.count({where:{exchangeId:c.id}})).toBe(0);expect(await db.returnCase.findUnique({where:{id:c.r.id}})).toEqual(c.r);
});
it('retains payment failure and reservation, then replays a dead letter without a second purchase or order',async()=>{
 const c=await checkoutCase(),created=await checkout(c.id);expect(created.statusCode,created.body).toBe(200);const e=created.json().execution,job=await paymentJob(e.id);
 await db.adapterFault.upsert({where:{system:'SFCC'},create:{system:'SFCC',remaining:1,statusCode:422},update:{remaining:1,statusCode:422}});
 expect((await due(job.id)).status).toBe('DEAD_LETTER');expect((await execution(c.id)).json()).toMatchObject({paymentStatus:'PENDING',orderStatus:'AWAITING_PAYMENT',purchaseReceipt:null});expect(await db.outbox.count({where:{aggregateId:e.orderId,operation:'createOrder'}})).toBe(0);
 const replay=await app.inject({method:'POST',url:`/api/v1/integrations/jobs/${job.id}/replay`,headers:auth.get('ops'),payload:{reason:'Retry simulated payment after resolved rejection'}});expect(replay.statusCode,replay.body).toBe(200);
 expect((await due(job.id)).status).toBe('SUCCEEDED');await drain();expect((await execution(c.id)).json().paymentStatus).toBe('CAPTURED');expect(await db.mockRecord.count({where:{system:'SFCC',idempotencyKey:job.idempotencyKey}})).toBe(1);
 for(const role of ['foreign','sa','tenant'])expect((await execution(c.id,role)).statusCode).toBe(404);expect((await execution(c.id,'catalog')).statusCode).toBe(403);
});
it('recovers from remote purchase success followed by local acknowledgement rollback exactly once',async()=>{
 const c=await checkoutCase(),e=(await checkout(c.id)).json().execution,job=await paymentJob(e.id),enqueue=transactions.enqueue;
 const spy=vi.spyOn(transactions,'enqueue').mockImplementation(async(...args)=>{if(args[4]==='createOrder')throw Error('Injected post-payment Fynd queue failure');return enqueue(...args);});
 try{expect((await due(job.id)).status).toBe('RETRY');}finally{spy.mockRestore();}
 expect(await db.mockRecord.count({where:{system:'SFCC',idempotencyKey:job.idempotencyKey}})).toBe(1);expect((await execution(c.id)).json().paymentStatus).toBe('PENDING');expect(await db.outbox.count({where:{aggregateId:e.orderId,operation:'createOrder'}})).toBe(0);
 expect((await due(job.id)).status).toBe('SUCCEEDED');await drain();expect(await db.outbox.count({where:{aggregateId:e.orderId,operation:'createOrder'}})).toBe(1);expect(await db.auditEvent.count({where:{entityId:c.id,action:'exchange.purchase-acknowledged'}})).toBe(1);
});
it('quarantines an incorrect payment amount instead of releasing a shipment',async()=>{
 const c=await checkoutCase(),e=(await checkout(c.id)).json().execution,job=await paymentJob(e.id),fetch=globalThis.fetch;
 const spy=vi.spyOn(globalThis,'fetch').mockImplementation(async(...args)=>{const response=await fetch(...args);if(String(args[0]).endsWith('/purchaseExchange')){const body=await response.json();body.payment.amount='1.00';return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});}return response;});
 try{expect((await due(job.id)).status).toBe('DEAD_LETTER');}finally{spy.mockRestore();}
 expect((await execution(c.id)).json()).toMatchObject({paymentStatus:'PENDING',purchaseReceipt:null,orderStatus:'AWAITING_PAYMENT'});expect(await db.outbox.count({where:{aggregateId:e.orderId,operation:'createOrder'}})).toBe(0);
 const replay=await app.inject({method:'POST',url:`/api/v1/integrations/jobs/${job.id}/replay`,headers:auth.get('ops'),payload:{reason:'Restore correctly typed payment receipt'}});expect(replay.statusCode,replay.body).toBe(200);expect((await due(job.id)).status).toBe('SUCCEEDED');await drain();
});
it('cancels an assigned replacement through Fynd, releases stock and separately acknowledges the SFCC refund',async()=>{
 const c=await checkoutCase(),before=await db.inventory.findUniqueOrThrow({where:{id:inventoryId}}),e=(await checkout(c.id)).json().execution;await drain();
 const leg=await db.fulfilmentLeg.findUniqueOrThrow({where:{id:e.shipments[0].id}});await commandLeg(actor,leg.id,{expectedVersion:leg.version,next:'CANCELLED',reason:'Customer cancels before replacement picking'},company);
 const transition=await db.outbox.findFirstOrThrow({where:{aggregateId:leg.id,operation:'transitionShipment',status:'PENDING'}});await processOutbox(transition.id);
 expect((await execution(c.id)).json()).toMatchObject({orderStatus:'CANCELLED',paymentStatus:'REFUND_PENDING',refundReceipt:null});expect((await db.inventory.findUniqueOrThrow({where:{id:inventoryId}})).reserved).toBe(before.reserved);
 const refund=await paymentJob(e.id,'refundExchangePurchase');await db.adapterFault.upsert({where:{system:'SFCC'},create:{system:'SFCC',remaining:1,statusCode:422},update:{remaining:1,statusCode:422}});expect((await due(refund.id)).status).toBe('DEAD_LETTER');expect((await execution(c.id)).json().paymentStatus).toBe('REFUND_PENDING');
 expect((await app.inject({method:'POST',url:`/api/v1/integrations/jobs/${refund.id}/replay`,headers:auth.get('ops'),payload:{reason:'Retry separate replacement refund'}})).statusCode).toBe(200);expect((await due(refund.id)).status).toBe('SUCCEEDED');await drain();
 expect((await execution(c.id)).json()).toMatchObject({paymentStatus:'REFUNDED',refundReceipt:{status:'REFUNDED',amount:'1850.00',actualMoneyMoved:false},purchaseReceipt:{status:'CAPTURED'}});expect(await processOutbox(refund.id)).toBe(false);
 expect(await db.financialEvent.count({where:{sourceId:`${leg.id}:replacement`}})).toBe(0);expect(await db.fulfilmentLeg.findUnique({where:{id:c.originalLeg.id}})).toEqual(c.originalLeg);
 const stored=await db.exchangeExecution.findUniqueOrThrow({where:{id:e.id}});await expect(db.exchangeExecution.update({where:{id:e.id},data:{amount:'1'}})).rejects.toThrow();await expect(db.exchangeExecution.update({where:{id:e.id},data:{purchaseReceipt:{forged:true}}})).rejects.toThrow();await expect(db.exchangeExecution.delete({where:{id:e.id}})).rejects.toThrow();expect(await db.exchangeExecution.findUnique({where:{id:e.id}})).toEqual(stored);
});

const cancelCheckout=(id:string,payload:object={},role='ops')=>app.inject({method:'POST',url:`/api/v1/exchanges/${id}/checkout/cancel`,headers:auth.get(role),payload:{expectedVersion:1,reason:'Customer cancels the separate replacement purchase',...payload}});
async function cancelJobs(eid:string){return {sfcc:await paymentJob(eid,'cancelExchangePurchase'),fynd:await paymentJob(eid,'cancelExchangeOrder')};}
it('cancels before payment, waits for both fences, and releases the reservation exactly once',async()=>{
 const c=await checkoutCase(),before=await db.inventory.findUniqueOrThrow({where:{id:inventoryId}}),e=(await checkout(c.id)).json().execution,purchase=await paymentJob(e.id);
 const results=await Promise.all([cancelCheckout(c.id),cancelCheckout(c.id)]);results.forEach(r=>expect(r.statusCode,r.body).toBe(200));expect(results.map(r=>r.json().replayed).sort()).toEqual([false,true]);
 expect((await db.outbox.findUniqueOrThrow({where:{id:purchase.id}})).status).toBe('CANCELLED');expect(await processOutbox(purchase.id)).toBe(false);
 const jobs=await cancelJobs(e.id);expect((await due(jobs.sfcc.id)).status).toBe('SUCCEEDED');
 expect((await execution(c.id)).json()).toMatchObject({paymentStatus:'VOIDED',orderStatus:'AWAITING_PAYMENT',cancellation:{status:'REQUESTED',sfccReceipt:{outcome:{resolution:'VOIDED'}},fyndReceipt:null}});
 expect((await db.inventory.findUniqueOrThrow({where:{id:inventoryId}})).reserved).toBe(before.reserved+1);
 expect((await due(jobs.fynd.id)).status).toBe('SUCCEEDED');await drain();
 expect((await execution(c.id,'vendor')).json()).toMatchObject({paymentStatus:'VOIDED',orderStatus:'CANCELLED',cancellation:{status:'COMPLETED'},shipments:[{status:'CANCELLED'}]});
 expect((await db.inventory.findUniqueOrThrow({where:{id:inventoryId}}))).toMatchObject({reserved:before.reserved,onHand:before.onHand});
 expect(await processOutbox(jobs.fynd.id)).toBe(false);expect((await cancelCheckout(c.id)).json().replayed).toBe(true);
 expect(await db.outbox.count({where:{aggregateId:e.id,operation:'refundExchangePurchase'}})).toBe(0);
 expect((await app.inject({method:'POST',url:`/api/v1/integrations/jobs/${purchase.id}/replay`,headers:auth.get('ops'),payload:{reason:'Attempt to reopen cancelled payment'}})).statusCode).toBe(409);
 const late=await mocks.inject({method:'POST',url:'/systems/SFCC/purchaseExchange',headers:{'x-mock-secret':process.env.MOCK_SECRET!,'x-idempotency-key':purchase.idempotencyKey},payload:purchase.payload as object});expect(late.statusCode,late.body).toBe(409);
 expect(await db.order.findUnique({where:{id:c.originalOrder.id}})).toEqual(c.originalOrder);expect(await db.fulfilmentLeg.findUnique({where:{id:c.originalLeg.id}})).toEqual(c.originalLeg);
});
it('guards cancellation scope, CSRF, strict input, versions and immutable cancellation history',async()=>{
 const c=await checkoutCase(),e=(await checkout(c.id)).json().execution;
 for(const [role,status] of [['missing',401],['no-csrf',403],['vendor',403],['foreign',403],['catalog',403],['tenant',404],['sa',404]] as const)expect((await cancelCheckout(c.id,{},role)).statusCode).toBe(status);
 expect((await cancelCheckout(c.id,{expectedVersion:99})).statusCode).toBe(409);expect((await cancelCheckout(c.id,{amount:'0'})).statusCode).toBe(400);
 const saved=await cancelCheckout(c.id);expect(saved.statusCode,saved.body).toBe(200);
 expect((await cancelCheckout(c.id,{reason:'Different cancellation intent'})).statusCode).toBe(409);
 const cancellation=await db.exchangeCancellation.findUniqueOrThrow({where:{executionId:e.id}});
 await expect(db.exchangeCancellation.update({where:{id:cancellation.id},data:{reason:'Rewrite old evidence',version:{increment:1}}})).rejects.toThrow();
 await expect(db.exchangeCancellation.delete({where:{id:cancellation.id}})).rejects.toThrow();
 await expect(db.exchangeExecution.update({where:{id:e.id},data:{holdExpiresAt:new Date()}})).rejects.toThrow();
 await drain();const final=await db.exchangeCancellation.findUniqueOrThrow({where:{executionId:e.id}});
 await expect(db.exchangeCancellation.update({where:{id:final.id},data:{sfccReceipt:{forged:true},version:{increment:1}}})).rejects.toThrow();
 await expect(db.mockExchangeState.update({where:{system_exchangeId:{system:'SFCC',exchangeId:c.id}},data:{closed:false,revision:{increment:1}}})).rejects.toThrow();
});
it('rolls back cancellation intent, lease invalidation and shipment commands if enqueue fails',async()=>{
 const c=await checkoutCase(),e=(await checkout(c.id)).json().execution,job=await paymentJob(e.id),before=await snapshot(),enqueue=transactions.enqueue;
 const spy=vi.spyOn(transactions,'enqueue').mockImplementation(async(...args)=>{if(args[4]==='cancelExchangeOrder')throw Error('Injected cancellation enqueue rollback');return enqueue(...args);});
 try{expect((await cancelCheckout(c.id)).statusCode).toBe(500);}finally{spy.mockRestore();}
 expect(await snapshot()).toEqual(before);expect(await db.exchangeCancellation.findUnique({where:{executionId:e.id}})).toBeNull();expect(await db.outbox.findUnique({where:{id:job.id}})).toEqual(job);expect((await execution(c.id)).json()).toEqual(e);
 expect((await cancelCheckout(c.id)).statusCode).toBe(200);await drain();
});
it('recovers a remotely captured payment with a lost local acknowledgement, then refunds independently',async()=>{
 const c=await checkoutCase(),before=await db.inventory.findUniqueOrThrow({where:{id:inventoryId}}),e=(await checkout(c.id)).json().execution,purchase=await paymentJob(e.id),enqueue=transactions.enqueue;
 const spy=vi.spyOn(transactions,'enqueue').mockImplementation(async(...args)=>{if(args[4]==='createOrder')throw Error('Local payment acknowledgement rollback');return enqueue(...args);});
 try{expect((await due(purchase.id)).status).toBe('RETRY');}finally{spy.mockRestore();}
 expect((await execution(c.id)).json().paymentStatus).toBe('PENDING');expect((await cancelCheckout(c.id)).statusCode).toBe(200);
 const jobs=await cancelJobs(e.id);expect((await due(jobs.fynd.id)).status).toBe('SUCCEEDED');expect((await db.inventory.findUniqueOrThrow({where:{id:inventoryId}})).reserved).toBe(before.reserved+1);
 expect((await due(jobs.sfcc.id)).status).toBe('SUCCEEDED');expect((await execution(c.id)).json()).toMatchObject({paymentStatus:'REFUND_PENDING',orderStatus:'CANCELLED',purchaseReceipt:{status:'CAPTURED'},refundReceipt:null,cancellation:{status:'REFUND_PENDING'}});
 const refund=await paymentJob(e.id,'refundExchangePurchase');await db.adapterFault.upsert({where:{system:'SFCC'},create:{system:'SFCC',remaining:1,statusCode:422},update:{remaining:1,statusCode:422}});expect((await due(refund.id)).status).toBe('DEAD_LETTER');
 expect((await execution(c.id)).json().cancellation.status).toBe('REFUND_PENDING');expect((await db.inventory.findUniqueOrThrow({where:{id:inventoryId}})).reserved).toBe(before.reserved);
 expect((await app.inject({method:'POST',url:`/api/v1/integrations/jobs/${refund.id}/replay`,headers:auth.get('ops'),payload:{reason:'Retry independently acknowledged replacement refund'}})).statusCode).toBe(200);
 expect((await due(refund.id)).status).toBe('SUCCEEDED');await drain();expect((await execution(c.id)).json()).toMatchObject({paymentStatus:'REFUNDED',cancellation:{status:'COMPLETED'}});
 expect(await db.mockRecord.count({where:{system:'SFCC',idempotencyKey:purchase.idempotencyKey}})).toBe(1);expect(await db.mockRecord.count({where:{system:'SFCC',idempotencyKey:refund.idempotencyKey}})).toBe(1);
});
it('keeps stock reserved while a cancellation acknowledgement is in the dead-letter queue',async()=>{
 const c=await checkoutCase(),e=(await checkout(c.id)).json().execution;expect((await cancelCheckout(c.id)).statusCode).toBe(200);const jobs=await cancelJobs(e.id),reserved=(await db.inventory.findUniqueOrThrow({where:{id:inventoryId}})).reserved;
 await db.adapterFault.upsert({where:{system:'FYND'},create:{system:'FYND',remaining:1,statusCode:422},update:{remaining:1,statusCode:422}});
 expect((await due(jobs.fynd.id)).status).toBe('DEAD_LETTER');expect((await due(jobs.sfcc.id)).status).toBe('SUCCEEDED');expect((await db.inventory.findUniqueOrThrow({where:{id:inventoryId}})).reserved).toBe(reserved);
 expect((await execution(c.id)).json().cancellation.status).toBe('REQUESTED');expect((await app.inject({method:'POST',url:`/api/v1/integrations/jobs/${jobs.fynd.id}/replay`,headers:auth.get('ops'),payload:{reason:'Restore Fynd cancellation acknowledgement'}})).statusCode).toBe(200);
 expect((await due(jobs.fynd.id)).status).toBe('SUCCEEDED');await drain();expect((await db.inventory.findUniqueOrThrow({where:{id:inventoryId}})).reserved).toBe(reserved-1);
});
it('fences a remotely created Fynd order after its local acknowledgement was lost',async()=>{
 const c=await checkoutCase(),e=(await checkout(c.id)).json().execution;expect((await due((await paymentJob(e.id)).id)).status).toBe('SUCCEEDED');
 const create=await db.outbox.findFirstOrThrow({where:{aggregateId:e.orderId,operation:'createOrder'}}),enqueue=transactions.enqueue;
 const spy=vi.spyOn(transactions,'enqueue').mockImplementation(async(...args)=>{if(args[4]==='createShipment')throw Error('Fynd local acknowledgement rollback');return enqueue(...args);});
 try{expect((await due(create.id)).status).toBe('RETRY');}finally{spy.mockRestore();}
 expect((await cancelCheckout(c.id,{expectedVersion:2})).statusCode).toBe(200);await drain();
 expect((await execution(c.id)).json()).toMatchObject({paymentStatus:'REFUNDED',orderStatus:'CANCELLED',cancellation:{status:'COMPLETED',fyndReceipt:{outcome:{resolution:'FENCED',orderExisted:true}}}});
 const late=await mocks.inject({method:'POST',url:'/systems/FYND/createShipment',headers:{'x-mock-secret':process.env.MOCK_SECRET!,'x-idempotency-key':`shipment:${e.shipments[0].id}:create`},payload:{fyndOrderId:'late-order',leg:{id:e.shipments[0].id,orderId:e.orderId}}});expect(late.statusCode,late.body).toBe(409);
 expect(await processOutbox(create.id)).toBe(false);expect(await db.outbox.count({where:{aggregateId:e.shipments[0].id,operation:'createShipment'}})).toBe(0);
});
it('discards an in-flight purchase acknowledgement after cancellation takes its lease',async()=>{
 const c=await checkoutCase(),e=(await checkout(c.id)).json().execution,purchase=await paymentJob(e.id),originalFetch=globalThis.fetch;let triggered=false;
 const spy=vi.spyOn(globalThis,'fetch').mockImplementation(async(...args)=>{const response=await originalFetch(...args);if(String(args[0]).endsWith('/purchaseExchange')&&!triggered){triggered=true;const result=await cancelCheckout(c.id);expect(result.statusCode,result.body).toBe(200);}return response;});
 try{expect((await due(purchase.id)).status).toBe('CANCELLED');}finally{spy.mockRestore();}
 expect(triggered).toBe(true);expect((await execution(c.id)).json().paymentStatus).toBe('PENDING');expect(await db.outbox.count({where:{aggregateId:e.orderId,operation:'createOrder'}})).toBe(0);
 await drain();expect((await execution(c.id)).json()).toMatchObject({paymentStatus:'REFUNDED',orderStatus:'CANCELLED',cancellation:{status:'COMPLETED'}});
});
it('expires only pending holds at the demo deadline and deduplicates concurrent sweeps',async()=>{
 const c=await checkoutCase(),e=(await checkout(c.id)).json().execution,clock=await db.demoClock.findUniqueOrThrow({where:{id:'main'}});
 try{
  await db.demoClock.update({where:{id:'main'},data:{now:new Date(new Date(e.holdExpiresAt).getTime()-1)}});expect(await expireExchangePaymentHolds(company)).toBe(0);
  await db.demoClock.update({where:{id:'main'},data:{now:new Date(e.holdExpiresAt)}});const results=await Promise.all([expireExchangePaymentHolds(company),expireExchangePaymentHolds(company)]);expect(results.reduce((a,b)=>a+b,0)).toBe(1);
  expect((await execution(c.id)).json()).toMatchObject({cancellation:{cause:'PAYMENT_HOLD_EXPIRED',status:'REQUESTED'}});expect(await expireExchangePaymentHolds(company)).toBe(0);
  await drain();expect((await execution(c.id)).json()).toMatchObject({paymentStatus:'VOIDED',cancellation:{status:'COMPLETED'}});
  expect(await db.exchangeCancellation.count({where:{execution:{companyId:company,paymentStatus:'CAPTURED'}}})).toBe(0);
 }finally{await db.demoClock.update({where:{id:'main'},data:{now:clock.now}});}
});
it('rejects checkout-level cancellation after acceptance and preserves the ordinary shipment cancellation path',async()=>{
 const c=await checkoutCase(),e=(await checkout(c.id)).json().execution;await drain();await advance(e.shipments[0].id,'ACCEPTED');
 expect((await cancelCheckout(c.id,{expectedVersion:2})).json()).toMatchObject({error:{code:'CANCELLATION_TOO_LATE'}});expect(await db.exchangeCancellation.count({where:{executionId:e.id}})).toBe(0);await advance(e.shipments[0].id,'CANCELLED');expect((await execution(c.id)).json().paymentStatus).toBe('REFUNDED');
});
it('serializes independent remote payment/cancellation races without a post-void capture',async()=>{
 for(let i=0;i<4;i++){
  const id=randomUUID(),payload={schemaVersion:'1.0',exchangeId:id,orderId:`order-${id}`,externalOrderId:`external-${id}`,companyId:company,partnerId:partner,market:'AE',currency:'AED',amount:'1850.00',policy:'REFUND_AND_REPURCHASE_DEMO_V1',simulatedCustomerAcceptance:true,actualMoneyMoved:false};
  const call=(operation:string,key:string,body:object)=>mocks.inject({method:'POST',url:`/systems/SFCC/${operation}`,headers:{'x-mock-secret':process.env.MOCK_SECRET!,'x-idempotency-key':key},payload:body});
  const purchase=()=>call('purchaseExchange',`exchange:${id}:purchase:v1`,payload),cancel=()=>call('cancelExchangePurchase',`exchange:${id}:cancel:SFCC:v1`,{...payload,shipmentIds:['s']});
  const [a,b]=await Promise.all(i%2?[purchase(),cancel()]:[cancel(),purchase()]);const cancelled=i%2?b:a,bought=i%2?a:b;
  expect(cancelled.statusCode,cancelled.body).toBe(200);const evidence=exchangeCancellationResult.parse(cancelled.json());expect(evidence.system).toBe('SFCC');
  if(evidence.outcome.resolution==='VOIDED')expect(bought.statusCode,bought.body).toBe(409);else expect(bought.statusCode,bought.body).toBe(200);
  const late=await purchase();expect(late.statusCode).toBe(bought.statusCode);const row=await db.mockExchangeState.findUniqueOrThrow({where:{system_exchangeId:{system:'SFCC',exchangeId:id}}});expect(row.closed).toBe(true);expect(!!row.purchaseReceipt).toBe(evidence.outcome.resolution==='CAPTURED');
 }
});
it('quarantines a forged cancellation outcome without releasing stock and permits corrected replay',async()=>{
 const c=await checkoutCase(),e=(await checkout(c.id)).json().execution;expect((await cancelCheckout(c.id)).statusCode).toBe(200);const jobs=await cancelJobs(e.id),before=(await db.inventory.findUniqueOrThrow({where:{id:inventoryId}})).reserved,originalFetch=globalThis.fetch;
 const spy=vi.spyOn(globalThis,'fetch').mockImplementation(async(...args)=>{const response=await originalFetch(...args);if(String(args[0]).endsWith('/cancelExchangePurchase')){const value=await response.json();value.intent.amount='1.00';return new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});}return response;});
 try{expect((await due(jobs.sfcc.id)).status).toBe('DEAD_LETTER');}finally{spy.mockRestore();}
 expect((await due(jobs.fynd.id)).status).toBe('SUCCEEDED');expect((await db.inventory.findUniqueOrThrow({where:{id:inventoryId}})).reserved).toBe(before);expect((await execution(c.id)).json()).toMatchObject({paymentStatus:'PENDING',cancellation:{sfccReceipt:null}});
 expect((await app.inject({method:'POST',url:`/api/v1/integrations/jobs/${jobs.sfcc.id}/replay`,headers:auth.get('ops'),payload:{reason:'Restore the exact cancellation identity receipt'}})).statusCode).toBe(200);expect((await due(jobs.sfcc.id)).status).toBe('SUCCEEDED');await drain();
 expect((await db.inventory.findUniqueOrThrow({where:{id:inventoryId}})).reserved).toBe(before-1);
});
it('discards an in-flight Fynd shipment acknowledgement and fences future creation',async()=>{
 const c=await checkoutCase(),e=(await checkout(c.id)).json().execution;expect((await due((await paymentJob(e.id)).id)).status).toBe('SUCCEEDED');const order=await db.outbox.findFirstOrThrow({where:{aggregateId:e.orderId,operation:'createOrder'}});expect((await due(order.id)).status).toBe('SUCCEEDED');
 const shipment=await db.outbox.findFirstOrThrow({where:{aggregateId:e.shipments[0].id,operation:'createShipment'}}),originalFetch=globalThis.fetch;let cancelled=false;
 const spy=vi.spyOn(globalThis,'fetch').mockImplementation(async(...args)=>{const response=await originalFetch(...args);if(String(args[0]).endsWith('/createShipment')&&!cancelled){cancelled=true;const result=await cancelCheckout(c.id,{expectedVersion:2});expect(result.statusCode,result.body).toBe(200);}return response;});
 try{expect((await due(shipment.id)).status).toBe('CANCELLED');}finally{spy.mockRestore();}
 expect(cancelled).toBe(true);await drain();expect((await execution(c.id)).json()).toMatchObject({paymentStatus:'REFUNDED',orderStatus:'CANCELLED',shipments:[{fyndId:null,status:'CANCELLED'}]});
 const row=await db.mockExchangeState.findUniqueOrThrow({where:{system_exchangeId:{system:'FYND',exchangeId:c.id}}});expect(row).toMatchObject({closed:true,orderCreated:true});expect(exchangePaymentPayload.parse(row.identity).orderId).toBe(e.orderId);
});
