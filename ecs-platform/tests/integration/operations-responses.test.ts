import {beforeAll,afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {db} from '../../packages/db/client';
import {seedDemo} from '../../prisma/seed';
import {createServer} from '../../apps/api/src/server';
import {transaction,enqueue} from '../../packages/db/transaction';
import {prepareReconciliationScenario} from '../../scripts/reconciliation-scenario';
const company=`contracts-${randomUUID()}`,partner=`v-${company}`,other=`other-${company}`,product=`p-${company}`;
let app:FastifyInstance;
const auth=new Map<string,Record<string,string>>();
async function login(email:string){const res=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password:'Demo123!'}});expect(res.statusCode,res.body).toBe(200);return {cookie:`${res.cookies[0].name}=${res.cookies[0].value}`,'x-csrf-token':res.json().csrfToken};}
async function get(url:string,role='admin'){const res=await app.inject({url,headers:auth.get(role)});expect(res.statusCode,res.body).toBe(200);return res.json();}
beforeAll(async()=>{
 const url=new URL(process.env.DATABASE_URL??'');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/ecs_test')throw Error('Isolated local ecs_test required');
 if(!await db.partner.count())await seedDemo();app=await createServer({verifyResponseContracts:true});
 const seed=await db.user.findUniqueOrThrow({where:{email:'admin@ati.demo'}});
 for(const [name,role,partnerId,markets,companyId] of [['admin','ATI_SUPER_ADMIN',null,['AE'],company],['vendor','VENDOR_ADMIN',partner,['AE'],company],['other','VENDOR_ADMIN',other,['AE'],company],['market','ATI_SUPER_ADMIN',null,['SA'],company],['tenant','ATI_SUPER_ADMIN',null,['AE'],`foreign-${company}`]] as const){
  const user=await db.user.create({data:{name,role,partnerId,companyId,markets:[...markets],email:`${name}-${company}@test.invalid`,passwordHash:seed.passwordHash}});auth.set(name,await login(user.email));
 }
 for(const id of [partner,other])await db.partner.create({data:{id,code:id,companyId:company,displayName:'Contract fixture',legalName:'Fictional Contract LLC',status:'ACTIVE',markets:['AE'],erpVendorId:'fixture-erp'}});
 await db.product.create({data:{id:product,companyId:company,partnerId:partner,sku:product,titleEn:'Contract fixture item',titleAr:'منتج اختبار',brand:'fixture-brand',category:'Beauty/Skincare/Serums',price:'150.125',floor:'130',status:'DRAFT',data:{demoOnly:true}}});
 await db.location.create({data:{id:`l-${company}`,companyId:company,partnerId:partner,name:'Fixture warehouse',type:'VENDOR_WAREHOUSE',market:'AE',status:'ACTIVE'}});
 await db.inventory.create({data:{productId:product,locationId:`l-${company}`,onHand:10,safetyStock:1}});
});
afterAll(async()=>{await app?.close();await db.$disconnect();});

it('validates nonempty catalogue/inventory responses and preserves tenant, market and partner scoping',async()=>{
 const list=await get('/api/v1/catalog/items');expect(list.total).toBe(1);expect(list.items[0]).toMatchObject({id:product,price:'150.125',publications:[]});
 const detail=await get(`/api/v1/catalog/items/${product}`);expect(detail.issues.length).toBeGreaterThan(0);
 const stock=await get('/api/v1/inventory','vendor');expect(stock.items).toHaveLength(1);expect(stock.items[0].product.partner).toEqual({id:partner,status:'ACTIVE'});expect(stock.items[0].sellable).toBe(0);
 for(const role of ['other','market','tenant']){
  expect((await get('/api/v1/catalog/items',role)).items).toEqual([]);expect((await get('/api/v1/inventory',role)).items).toEqual([]);
  expect((await app.inject({url:`/api/v1/catalog/items/${product}`,headers:auth.get(role)})).statusCode).toBe(404);
 }
 expect((await get('/api/v1/catalog/imports/metadata','vendor')).partners.map((p:{id:string})=>p.id)).toEqual([partner]);
});

it('validates populated finance events, draft/calculated statements and vendor read-only evidence',async()=>{
 const adjustment=await app.inject({method:'POST',url:'/api/v1/finance/adjustments',headers:auth.get('admin'),payload:{partnerId:partner,amount:'12.34',reason:'Isolated contract verification adjustment',requestId:randomUUID()}});expect(adjustment.statusCode,adjustment.body).toBe(200);
 expect((await get('/api/v1/finance/events','vendor')).items).toHaveLength(1);expect((await get('/api/v1/finance/events','other')).items).toEqual([]);
 const now=(await db.demoClock.findUniqueOrThrow({where:{id:'main'}})).now.getTime();
 const created=await app.inject({method:'POST',url:'/api/v1/settlements',headers:auth.get('admin'),payload:{partnerId:partner,from:new Date(now-1000).toISOString(),to:new Date(now+1000).toISOString()}});expect(created.statusCode,created.body).toBe(200);
 const id=created.json().id;
 const calculated=await app.inject({method:'POST',url:`/api/v1/settlements/${id}/commands`,headers:auth.get('admin'),payload:{expectedVersion:1,action:'calculate',reason:'Verify serialized locked-evidence precursor'}});expect(calculated.statusCode,calculated.body).toBe(200);expect(calculated.json().payable).toBe('12.34');
 expect((await get(`/api/v1/settlements/${id}`,'vendor')).evidence.events).toHaveLength(1);expect((await get('/api/v1/settlements','vendor')).items).toHaveLength(1);
 for(const role of ['other','market','tenant'])expect((await app.inject({url:`/api/v1/settlements/${id}`,headers:auth.get(role)})).statusCode).toBe(404);
 expect((await app.inject({method:'POST',url:`/api/v1/settlements/${id}/commands`,headers:auth.get('vendor'),payload:{expectedVersion:2,action:'review',reason:'Unauthorized vendor attempt'}})).statusCode).toBe(403);
});

it('validates populated integration queues, replay responses and audit while denying vendor access',async()=>{
 const actor=await db.user.findUniqueOrThrow({where:{email:`admin-${company}@test.invalid`}});
 const job=await transaction(tx=>enqueue(tx,actor,company,'ERP','fixture-contract',partner,{fixture:true},randomUUID(),partner));
 await db.outbox.update({where:{id:job.id},data:{status:'DEAD_LETTER',error:'Isolated test failure'}});
 const receipt=await db.inbox.create({data:{source:'SFCC',eventId:randomUUID(),type:'fixture',companyId:company,market:'AE',payload:{fixture:true},payloadHash:'fixture-hash',correlationId:company,status:'DEAD_LETTER'}});
 for(const path of ['/api/v1/integrations/jobs','/api/v1/integrations/inbox']){
  expect((await get(path)).items).toHaveLength(1);expect((await get(path,'tenant')).items).toEqual([]);
  expect((await app.inject({url:path,headers:auth.get('vendor')})).statusCode).toBe(403);
 }
 for(const url of [`/api/v1/integrations/jobs/${job.id}/replay`,`/api/v1/integrations/inbox/${receipt.id}/replay`]){
  const response=await app.inject({method:'POST',url,headers:auth.get('admin'),payload:{reason:'Isolated response contract replay'}});expect(response.statusCode,response.body).toBe(200);expect(response.json().status).toBe('PENDING');
 }
 const history=await get('/api/v1/audit');expect(history.items.length).toBeGreaterThanOrEqual(2);expect(history.items.every((e:{companyId:string})=>e.companyId===company)).toBe(true);
 expect((await app.inject({url:'/api/v1/audit',headers:auth.get('vendor')})).statusCode).toBe(403);
});

it('accepts the explicit historical training statement DTO rather than an undocumented catch-all',async()=>{
 const scenario=await prepareReconciliationScenario(`dto-${randomUUID().slice(0,8)}`);auth.set('ati',await login('admin@ati.demo'));
 const statement=await get(`/api/v1/settlements/${scenario.statementId}`,'ati');expect(statement.evidence.fixture).toBe('reconciliation-held-export-v1');expect(statement.evidence.events).toHaveLength(4);expect(statement.status).toBe('EXPORT_PENDING');
 expect((await app.inject({url:`/api/v1/settlements/${scenario.statementId}`,headers:auth.get('admin')})).statusCode).toBe(404);
});
