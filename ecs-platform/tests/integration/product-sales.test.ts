import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {db} from '../../packages/db/client';
import {seedDemo} from '../../prisma/seed';
import {createServer} from '../../apps/api/src/server';
import {createMockServer} from '../../apps/mock-systems/src/server';
import {processOutbox} from '../../apps/worker/src/outbox';
import {transaction} from '../../packages/db/transaction';
import {commandCatalog} from '../../packages/domain/catalog';
import {commandSalesControl,readSalesControl} from '../../packages/domain/product-sales';
import {ingestOrder,commandLeg,type OrderInput} from '../../packages/domain/orders';
import * as stock from '../../packages/domain/inventory';
import {validGtin} from '../../packages/domain/calculations';
import {adapter} from '../../packages/integrations/adapter';
import {provisionFixture} from '../helpers/provision';
import type {Actor} from '../../packages/auth/policy';
const company=`sales-${randomUUID()}`,partner=`p-${company}`,productId=`sku-${company}`,siblingId=`sibling-${company}`;
let app:FastifyInstance,mocks:FastifyInstance,legId:string,oldPositive:{inventoryId:string;revision:number;sellable:number},orderId:string;
const actors=new Map<string,Actor>(),auth=new Map<string,Record<string,string>>();
const path=`/api/v1/catalog/items/${productId}/sales-control`,reason='ATI item-level review for the isolated test assortment';
async function drain(){for(let i=0;i<5;i++)for(const j of await db.outbox.findMany({where:{companyId:company,status:'PENDING'}})){await processOutbox(j.id);const result=await db.outbox.findUniqueOrThrow({where:{id:j.id}});expect(result.status,result.error??'').toBe('SUCCEEDED');}}
function order():OrderInput{return {externalOrderId:randomUUID(),channel:'BLM-AE',currency:'AED',deliveryCity:'Dubai',routingPolicy:'WAREHOUSE_FIRST',total:'1850.00',lines:[{id:'line-a',sku:productId,quantity:1,unitGross:'1850.00',vendorDiscount:'0',operatorDiscount:'0'}]};}
async function command(action:'pause'|'delist'|'restore'){const p=await db.product.findUniqueOrThrow({where:{id:productId}});const r=await app.inject({method:'POST',url:path,headers:auth.get('admin'),payload:{action,expectedVersion:p.saleVersion,reason}});expect(r.statusCode,r.body).toBe(200);return r.json();}
beforeAll(async()=>{
 const url=new URL(process.env.DATABASE_URL??'');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/ecs_test')throw Error('Isolated local ecs_test required');if(!await db.partner.count())await seedDemo();
 app=await createServer({verifyResponseContracts:true});mocks=createMockServer();await mocks.listen({port:4101,host:'127.0.0.1'});
 const seed=await db.user.findUniqueOrThrow({where:{email:'admin@ati.demo'}});
 for(const [name,role,partnerId,markets,companyId] of [['admin','ATI_SUPER_ADMIN',null,['AE'],company],['moderator','ATI_CATALOG_MODERATOR',null,['AE'],company],['ops','ATI_OPERATIONS_MANAGER',null,['AE'],company],['vendor','VENDOR_ADMIN',partner,['AE'],company],['foreign','VENDOR_ADMIN','foreign',['AE'],company],['sa','ATI_SUPER_ADMIN',null,['SA'],company],['tenant','ATI_SUPER_ADMIN',null,['AE'],'foreign-company']] as const){
  const u=await db.user.create({data:{name,role,partnerId,companyId,markets:[...markets],email:`${name}-${company}@test.invalid`,passwordHash:seed.passwordHash}});actors.set(name,u);
  const r=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:u.email,password:'Demo123!'}});expect(r.statusCode).toBe(200);auth.set(name,{cookie:`${r.cookies[0].name}=${r.cookies[0].value}`,'x-csrf-token':r.json().csrfToken});
 }
 await db.partner.create({data:{id:partner,code:partner,companyId:company,displayName:'Sales controls test',legalName:'Sales controls fixture LLC',status:'ACTIVE',markets:['AE'],erpVendorId:'mock-erp-fixture'}});
 await db.brandRight.create({data:{partnerId:partner,brand:'br-sales-test',market:'AE',categories:['Women'],validFrom:new Date('2026-01-01Z'),validUntil:new Date('2028-01-01Z'),status:'APPROVED',evidence:'Test brand rights',reason}});
 await db.agreement.create({data:{partnerId:partner,version:1,rate:'0.28',currency:'AED',cadence:'WEEKLY',status:'APPROVED',validFrom:new Date('2026-01-01Z'),validUntil:new Date('2028-01-01Z'),rules:{market:'AE',returnDays:30}}});
 for(const suffix of ['a','b'])await db.location.create({data:{id:`loc-${suffix}-${company}`,companyId:company,partnerId:partner,market:'AE',name:`Test warehouse ${suffix}`,type:'VENDOR_WAREHOUSE',status:'ACTIVE',cutoffHour:24}});
 await provisionFixture(partner);
 for(const id of [productId,siblingId]){
  const prefix=String(BigInt(`0x${randomUUID().replaceAll('-','').slice(0,10)}`)).padStart(12,'0');const gtin=Array.from({length:10},(_,i)=>prefix+i).find(validGtin)!;
  await db.product.create({data:{id,companyId:company,partnerId:partner,sku:id,gtin,brand:'br-sales-test',category:'Women/Dresses/Midi',titleEn:'Sales control test dress',titleAr:'فستان اختبار',price:'1850',floor:'1750',status:'APPROVED',data:{parentSku:id,attributes:{colour:'Black',size:'M',material:'Silk',countryOfOrigin:'Italy'},media:[{url:'/demo-assets/maz-dress-black.svg',status:'APPROVED'}]}}});
  for(const suffix of ['a','b'])await db.inventory.create({data:{productId:id,locationId:`loc-${suffix}-${company}`,onHand:10,safetyStock:1,sequence:1}});
  await commandCatalog(actors.get('admin')!,id,{action:'publish',expectedVersion:1},company);
 }
 await drain();await transaction(tx=>stock.reconcileAvailability(tx,partner,company));await drain();
 const o=await transaction(tx=>ingestOrder(tx,actors.get('admin')!,order(),company));orderId=o.id;await drain();legId=(await db.fulfilmentLeg.findFirstOrThrow({where:{orderId}})).id;
 const row=await db.inventory.findFirstOrThrow({where:{productId},orderBy:{id:'asc'}});oldPositive={inventoryId:row.id,revision:row.revision,sellable:row.onHand-row.reserved-row.safetyStock};
});
afterAll(async()=>{await app?.close();await mocks?.close();await db.$disconnect();});
it('enforces operator, tenant, market, partner, CSRF, reason and revision boundaries',async()=>{
 const payload={action:'pause',expectedVersion:1,reason},before=await db.product.findUniqueOrThrow({where:{id:productId}}),jobs=await db.outbox.count({where:{companyId:company}});
 expect((await app.inject({method:'POST',url:path,payload})).statusCode).toBe(401);
 expect((await app.inject({method:'POST',url:path,headers:{cookie:auth.get('admin')!.cookie},payload})).statusCode).toBe(403);
 for(const role of ['vendor','ops'])expect((await app.inject({method:'POST',url:path,headers:auth.get(role),payload})).statusCode).toBe(403);
 for(const role of ['foreign','sa','tenant'])expect((await app.inject({url:path,headers:auth.get(role)})).statusCode).toBe(404);
 for(const role of ['sa','tenant'])expect((await app.inject({method:'POST',url:path,headers:auth.get(role),payload})).statusCode).toBe(404);
 expect((await app.inject({url:path,headers:auth.get('vendor')})).statusCode).toBe(200);
 for(const invalid of [{reason:'no'},{expectedVersion:0},{action:'delete'},{partnerId:'foreign'}])expect((await app.inject({method:'POST',url:path,headers:auth.get('admin'),payload:{...payload,...invalid}})).statusCode).toBe(400);
 expect((await app.inject({method:'POST',url:path,headers:auth.get('admin'),payload:{...payload,expectedVersion:8}})).statusCode).toBe(409);
 expect(await db.product.findUniqueOrThrow({where:{id:productId}})).toEqual(before);expect(await db.outbox.count({where:{companyId:company}})).toBe(jobs);
});
it('pauses every item position atomically, preserving physical stock, approved content and open shipments',async()=>{
 const before=await db.inventory.findMany({where:{productId},orderBy:{id:'asc'}}),other=await db.inventory.findMany({where:{productId:siblingId}}),leg=await db.fulfilmentLeg.findUniqueOrThrow({where:{id:legId}}),pubs=await db.publication.findMany({where:{productId}});
 const result=await command('pause');expect(result).toMatchObject({status:'PAUSED',version:2,openShipments:1});expect(result.positions).toHaveLength(2);expect(result.positions.every((p:{sellable:number;targets:{verified:boolean}[]})=>p.sellable===0&&p.targets.every(t=>!t.verified))).toBe(true);
 const after=await db.inventory.findMany({where:{productId},orderBy:{id:'asc'}});for(let i=0;i<after.length;i++)expect(after[i]).toMatchObject({onHand:before[i].onHand,reserved:before[i].reserved,sequence:before[i].sequence,revision:before[i].revision+1});
 expect(await db.inventory.findMany({where:{productId:siblingId}})).toEqual(other);expect(await db.fulfilmentLeg.findUniqueOrThrow({where:{id:legId}})).toEqual(leg);expect(await db.publication.findMany({where:{productId}})).toEqual(pubs);
 expect(await db.product.findUniqueOrThrow({where:{id:productId}})).toMatchObject({status:'PUBLISHED',version:1,saleStatus:'PAUSED'});
 const count=await db.order.count({where:{companyId:company}});await expect(transaction(tx=>ingestOrder(tx,actors.get('admin')!,order(),company))).rejects.toMatchObject({code:'ITEM_NOT_SELLABLE'});expect(await db.order.count({where:{companyId:company}})).toBe(count);
 await drain();expect((await readSalesControl(actors.get('vendor')!,productId)).positions.every(p=>p.targets.every(t=>t.verified&&t.observedSellable===0))).toBe(true);
});
it('delists reversibly, rejects stale decisions and keeps late inventory messages and new counts at zero availability',async()=>{
 expect((await command('delist')).status).toBe('DELISTED');await drain();
 await adapter('SFCC').execute('syncInventory',oldPositive,{idempotencyKey:`late-${company}`,correlationId:company});expect((await db.mockInventory.findUniqueOrThrow({where:{system_inventoryId:{system:'SFCC',inventoryId:oldPositive.inventoryId}}})).sellable).toBe(0);
 const row=await db.inventory.findUniqueOrThrow({where:{id:oldPositive.inventoryId}});
 await stock.updateStock(actors.get('vendor')!,row.id,{expectedSequence:row.sequence,sourceSequence:row.sequence+1,onHand:15,damaged:0,unavailable:0,safetyStock:1,reason:'New physical count while delisted'},company);await drain();
 const view=await readSalesControl(actors.get('admin')!,productId);expect(view.positions.every(p=>p.sellable===0&&p.targets.every(t=>t.verified))).toBe(true);expect(view.history.map(h=>h.action).sort()).toEqual(['catalog.sales-delist','catalog.sales-pause']);
 await expect(commandSalesControl(actors.get('admin')!,productId,{action:'restore',expectedVersion:2,reason},company)).rejects.toMatchObject({code:'STALE_VERSION'});
});
it('finishes the already accepted order while delisted, consuming only its reservation and keeping published ATP zero',async()=>{
 for(const next of ['ACCEPTED','PICKING','PACKED','READY_TO_DISPATCH','DISPATCHED','DELIVERED'] as const){
  const leg=await db.fulfilmentLeg.findUniqueOrThrow({where:{id:legId}});
  await commandLeg(actors.get('admin')!,legId,{expectedVersion:leg.version,next,...(next==='PACKED'?{confirmedQuantities:{'line-a':1}}:{}),...(next==='DISPATCHED'?{tracking:'MOCK-SALES-CONTROL'}:{})},company);await drain();
 }
 expect(await db.fulfilmentLeg.findUniqueOrThrow({where:{id:legId}})).toMatchObject({status:'DELIVERED'});expect(await db.order.findUniqueOrThrow({where:{id:orderId}})).toMatchObject({status:'DELIVERED'});
 const view=await readSalesControl(actors.get('admin')!,productId);expect(view.openShipments).toBe(0);expect(view.positions.every(p=>p.reserved===0&&p.sellable===0&&p.targets.every(t=>t.verified))).toBe(true);expect(await db.financialEvent.count({where:{companyId:company}})).toBe(4);
});
it('restores only after independent partner, rights, quality and publication gates pass',async()=>{
 await db.partner.update({where:{id:partner},data:{status:'PAUSED'}});
 const p=await db.product.findUniqueOrThrow({where:{id:productId}});const restore=()=>commandSalesControl(actors.get('moderator')!,productId,{action:'restore',expectedVersion:p.saleVersion,reason},company);
 await expect(restore()).rejects.toMatchObject({code:'RESTORE_NOT_READY'});await db.partner.update({where:{id:partner},data:{status:'ACTIVE'}});
 const right=await db.brandRight.findFirstOrThrow({where:{partnerId:partner}});await db.brandRight.update({where:{id:right.id},data:{status:'PAUSED',version:{increment:1}}});await expect(restore()).rejects.toMatchObject({code:'RESTORE_NOT_READY'});await db.brandRight.update({where:{id:right.id},data:{status:'APPROVED',version:{increment:1}}});
 const pub=await db.publication.findFirstOrThrow({where:{productId,target:'FYND'}});await db.publication.update({where:{id:pub.id},data:{status:'FAILED'}});await expect(restore()).rejects.toMatchObject({code:'RESTORE_NOT_READY'});await db.publication.update({where:{id:pub.id},data:{status:'SUCCEEDED'}});
 await db.product.update({where:{id:productId},data:{titleAr:''}});await expect(restore()).rejects.toMatchObject({code:'RESTORE_NOT_READY'});await db.product.update({where:{id:productId},data:{titleAr:p.titleAr}});
 await expect(restore()).rejects.toMatchObject({code:'RESTORE_NOT_READY'});await provisionFixture(partner);
 expect((await restore()).status).toBe('ENABLED');await drain();expect((await readSalesControl(actors.get('admin')!,productId)).positions.every(p=>p.sellable>0&&p.targets.every(t=>t.verified))).toBe(true);
 const next=await transaction(tx=>ingestOrder(tx,actors.get('admin')!,order(),company));expect(next.id).not.toBe(orderId);await drain();
});
it('serializes competing decisions and rejects invalid sales-control revisions at the database boundary',async()=>{
 const p=await db.product.findUniqueOrThrow({where:{id:productId}});
 const results=await Promise.allSettled(['pause','delist'].map(action=>commandSalesControl(actors.get('admin')!,productId,{action:action as 'pause'|'delist',expectedVersion:p.saleVersion,reason},company)));
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);expect((await db.product.findUniqueOrThrow({where:{id:productId}})).saleVersion).toBe(p.saleVersion+1);
 await expect(db.product.update({where:{id:productId},data:{saleStatus:'ENABLED'}})).rejects.toThrow();await expect(db.product.update({where:{id:productId},data:{saleVersion:{increment:1}}})).rejects.toThrow();await drain();
});
it('rolls back the sales decision, inventory revisions, audit and outbox on a queue failure',async()=>{
 await command('restore');await drain();const p=await db.product.findUniqueOrThrow({where:{id:productId}}),rows=await db.inventory.findMany({where:{productId}}),counts=[await db.outbox.count(),await db.auditEvent.count()];
 const mock=vi.spyOn(stock,'queueStock').mockRejectedValueOnce(Error('Queue insert failed'));
 try{await expect(commandSalesControl(actors.get('admin')!,productId,{action:'delist',expectedVersion:p.saleVersion,reason},company)).rejects.toThrow('Queue insert failed');expect(await db.product.findUniqueOrThrow({where:{id:productId}})).toEqual(p);expect(await db.inventory.findMany({where:{productId}})).toEqual(rows);expect([await db.outbox.count(),await db.auditEvent.count()]).toEqual(counts);}finally{mock.mockRestore();}
});
it('orders racing with a pause either reserve beforehand or reject atomically; subsequent orders always reject',async()=>{
 const p=await db.product.findUniqueOrThrow({where:{id:productId}}),input=order();
 const [intake,pause]=await Promise.allSettled([transaction(tx=>ingestOrder(tx,actors.get('admin')!,input,company)),commandSalesControl(actors.get('admin')!,productId,{action:'pause',expectedVersion:p.saleVersion,reason},company)]);expect(pause.status).toBe('fulfilled');
 const created=await db.order.findUnique({where:{channel_externalId:{channel:input.channel,externalId:input.externalOrderId}}});expect(Boolean(created)).toBe(intake.status==='fulfilled');
 await expect(transaction(tx=>ingestOrder(tx,actors.get('admin')!,order(),company))).rejects.toMatchObject({code:'ITEM_NOT_SELLABLE'});await drain();expect((await readSalesControl(actors.get('admin')!,productId)).positions.every(p=>p.sellable===0&&p.targets.every(t=>t.verified))).toBe(true);
});
