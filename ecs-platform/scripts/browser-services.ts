import {db} from '../packages/db/client';
import {createServer} from '../apps/api/src/server';
import {createMockServer} from '../apps/mock-systems/src/server';
import {seedDemo} from '../prisma/seed';
import {provisionFixture} from '../tests/helpers/provision';
const url=new URL(process.env.DATABASE_URL??'');
if(process.env.ECS_E2E!=='true'||!['127.0.0.1','localhost'].includes(url.hostname)||!/^\/ecs_e2e_[a-f0-9]{32}$/.test(url.pathname)||process.env.MOCK_ORIGIN!=='http://127.0.0.1:4102')throw Error('Disposable browser environment required');
const mocks=createMockServer();await mocks.listen({host:'127.0.0.1',port:4102});
await seedDemo();
// Real local mock acknowledgements prepare the mapping dependency; publication
// of the new draft is performed by the browser, never marked successful here.
await provisionFixture('vnd_maz');
await provisionFixture('vnd_lum');
await provisionFixture('vnd_nrh');
const template=await db.product.findUniqueOrThrow({where:{id:'prd_maz_dress_1001'}});
await db.product.create({data:{id:'e2e_catalog_draft',companyId:template.companyId,partnerId:template.partnerId,sku:'E2E-DRESS-01',brand:template.brand,category:template.category,titleEn:'Browser acceptance draft',titleAr:template.titleAr,gtin:'4006381333931',price:template.price,floor:template.floor,status:'DRAFT',data:{...template.data as Record<string,never>,parentSku:'E2E-DRESS',demoOnly:true}}});
await db.product.create({data:{id:'e2e_dam_draft',companyId:template.companyId,partnerId:template.partnerId,sku:'E2E-DAM-01',brand:template.brand,category:template.category,titleEn:'DAM browser acceptance draft',titleAr:template.titleAr,gtin:null,price:template.price,floor:template.floor,status:'DRAFT',data:{...template.data as Record<string,never>,parentSku:'E2E-DAM',media:[],demoOnly:true}}});
const api=await createServer({verifyResponseContracts:true});await api.listen({host:'127.0.0.1',port:4002});
let closing=false;async function close(){if(closing)return;closing=true;await api.close();await mocks.close();await db.$disconnect();}
process.on('SIGTERM',()=>void close());process.on('SIGINT',()=>void close());
console.log('Disposable browser services ready: API 4002 / mocks 4102.');
