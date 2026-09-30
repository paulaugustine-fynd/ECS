import {beforeAll,afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {db} from '../../packages/db/client';
import {seedDemo} from '../../prisma/seed';
import {createServer} from '../../apps/api/src/server';
import {createMockServer} from '../../apps/mock-systems/src/server';
import {processOutbox} from '../../apps/worker/src/outbox';
import {provisionFixture} from '../helpers/provision';
import {storefrontReadiness} from '../../packages/domain/storefront';
import {validGtin} from '../../packages/domain/calculations';
import {adapter} from '../../packages/integrations/adapter';
import {projectStorefront} from '../../packages/domain/storefront-contract';
const id=`storefront-${randomUUID()}`,productId=`product-${id}`;
let app:FastifyInstance,mocks:FastifyInstance,headers:Record<string,string>;
async function login(email:string){const r=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password:'Demo123!'}});expect(r.statusCode,r.body).toBe(200);return {cookie:`${r.cookies[0].name}=${r.cookies[0].value}`,'x-csrf-token':r.json().csrfToken};}
async function command(action:string){const p=await db.product.findUniqueOrThrow({where:{id:productId}});return app.inject({method:'POST',url:`/api/v1/catalog/items/${productId}/commands`,headers,payload:{action,expectedVersion:p.version}});}
async function drain(){for(let i=0;i<3;i++)for(const j of await db.outbox.findMany({where:{aggregateId:productId,status:'PENDING'}}))await processOutbox(j.id);}
beforeAll(async()=>{
 const url=new URL(process.env.DATABASE_URL??'');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/ecs_test')throw Error('Requires isolated local ecs_test');
 if(!(await db.partner.count()))await seedDemo();
 app=await createServer({verifyResponseContracts:true});mocks=createMockServer();await mocks.listen({port:4101,host:'127.0.0.1'});headers=await login('admin@ati.demo');
 const source=await db.product.findUniqueOrThrow({where:{id:'prd_lum_serum_3001'}});
 await db.partner.create({data:{id,code:id,companyId:source.companyId,legalName:'Private Vendor LLC',displayName:'Private Vendor',status:'APPROVED',markets:['AE'],erpVendorId:'mock-erp-fixture'}});
 await db.brandRight.create({data:{partnerId:id,brand:source.brand,market:'AE',categories:['Beauty'],validFrom:new Date('2026-01-01Z'),validUntil:new Date('2028-01-01Z'),status:'APPROVED',evidence:'Fictional rights',reason:'Storefront validation'}});
 await db.location.create({data:{id:`loc-${id}`,companyId:source.companyId,partnerId:id,name:'Storefront fixture warehouse',type:'VENDOR_WAREHOUSE',market:'AE',status:'ACTIVE'}});
 await provisionFixture(id);
 const gtin=Array.from({length:10},(_,i)=>`629993000001${i}`).find(validGtin)!;
 await db.product.create({data:{id:productId,companyId:source.companyId,partnerId:id,sku:`SKU-${id}`,market:'AE',titleEn:source.titleEn,titleAr:source.titleAr,brand:source.brand,category:source.category,currency:'AED',price:source.price,floor:source.floor,gtin,status:'APPROVED',data:source.data!}});
});
afterAll(async()=>{await app?.close();await mocks?.close();await db.$disconnect();});
it('publishes ERP-first and proves customer-visible content only after downstream processing',async()=>{
 expect((await storefrontReadiness(db,id)).passed).toBe(false);
 const res=await command('publish');expect(res.statusCode,res.body).toBe(200);
 expect(await db.mockStorefrontProduct.findUnique({where:{productId}})).toBeNull();
 await drain();expect((await storefrontReadiness(db,id)).passed).toBe(true);
 const response=await app.inject({url:`/api/v1/catalog/items/${productId}/storefront`,headers});expect(response.statusCode).toBe(200);
 expect(response.json()).toMatchObject({mode:'mock',passed:true,purchasable:false,content:{merchant:'Bloomingdale’s',merchantOfRecord:'Al Tayer Insignia'}});
 expect(response.body).not.toContain('Private Vendor');expect(response.body).not.toContain('erpVendorId');expect(response.body).not.toContain('floor');
});
it('does not accept successful publication flags when the storefront is hidden, missing or changed',async()=>{
 const original=await db.mockStorefrontProduct.findUniqueOrThrow({where:{productId}});
 await db.mockStorefrontProduct.update({where:{productId},data:{visible:false}});expect((await storefrontReadiness(db,id)).passed).toBe(false);
 expect((await command('refresh-storefront')).statusCode).toBe(200);await drain();expect((await storefrontReadiness(db,id)).passed).toBe(true);
 await db.mockStorefrontProduct.update({where:{productId},data:{content:{...original.content as object,titleAr:'Wrong translation'}}});expect((await storefrontReadiness(db,id)).passed).toBe(false);
 const preview=await app.inject({url:`/api/v1/catalog/items/${productId}/storefront`,headers});expect(preview.json().content).toBeNull();
 await db.mockStorefrontProduct.delete({where:{productId}});expect((await storefrontReadiness(db,id)).passed).toBe(false);
 expect((await command('refresh-storefront')).statusCode).toBe(200);await drain();expect((await storefrontReadiness(db,id)).passed).toBe(true);
});
it('protects preview ownership and refresh role/CSRF, and blocks stale content before transport',async()=>{
 const vendor=await login('admin@maisonazure.demo');
 expect((await app.inject({url:`/api/v1/catalog/items/${productId}/storefront`,headers:vendor})).statusCode).toBe(404);
 expect((await app.inject({method:'POST',url:`/api/v1/catalog/items/${productId}/commands`,headers:vendor,payload:{action:'refresh-storefront',expectedVersion:1}})).statusCode).toBe(403);
 expect((await app.inject({method:'POST',url:`/api/v1/catalog/items/${productId}/commands`,headers:{cookie:headers.cookie},payload:{action:'refresh-storefront',expectedVersion:1}})).statusCode).toBe(403);
 expect((await command('refresh-storefront')).statusCode).toBe(200);
 const job=await db.outbox.findFirstOrThrow({where:{aggregateId:productId,status:'PENDING'}});
 await db.product.update({where:{id:productId},data:{titleEn:'Changed without matching storefront'}});
 await processOutbox(job.id);expect((await db.outbox.findUniqueOrThrow({where:{id:job.id}})).status).toBe('DEAD_LETTER');
 expect(await db.mockRecord.count({where:{idempotencyKey:job.idempotencyKey}})).toBe(0);expect((await storefrontReadiness(db,id)).passed).toBe(false);
});
it('rejects an older storefront revision rather than overwriting a newer record',async()=>{
 const p=await db.product.findUniqueOrThrow({where:{id:productId}}),port=adapter('SFCC');
 const current=projectStorefront({...p,version:2},'revision-contract');
 await port.execute('publishStorefront',current,{idempotencyKey:`new-${id}`,correlationId:'revision-check'});
 await expect(port.execute('publishStorefront',projectStorefront(p,'revision-contract'),{idempotencyKey:`old-${id}`,correlationId:'revision-check'})).rejects.toThrow();
 expect((await db.mockStorefrontProduct.findUniqueOrThrow({where:{productId}})).version).toBe(2);
});
