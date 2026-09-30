import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {db} from '../../packages/db/client';
import {seedDemo} from '../../prisma/seed';
import {createServer} from '../../apps/api/src/server';
import {importFields} from '../../packages/domain/catalog-fields';
import * as transactions from '../../packages/db/transaction';
import {mutateWorkbook,replaceCell} from '../helpers/xlsx';
let app:FastifyInstance,vendor:Record<string,string>,foreign:Record<string,string>,fulfilment:Record<string,string>;
async function login(email:string){const r=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password:'Demo123!'}});expect(r.statusCode,r.body).toBe(200);return {cookie:`${r.cookies[0].name}=${r.cookies[0].value}`,'x-csrf-token':r.json().csrfToken};}
function fixture(){const token=randomUUID().slice(0,8),row={partner_code:'VND-LUM',brand:'Lumera',vendor_sku:`MAPPED-${token}`,gtin:'06299920000014',parent_sku:`PARENT-${token}`,title_en:`Coral silk tint ${token}`,title_ar:'صبغة شفاه مرجانية',category:'Lips',colour:'Midnight',size:'One Size',list_price:'160',selling_price:'145',currency:'AED',image_url:'/demo-assets/lum-lip-ruby.svg',location_code:'LUM-DXB-WH01',quantity:'3',finish:'Satin',country_of_origin:'France'} as Record<string,string>;
 const source=importFields.map(f=>f==='colour'?'shade':f==='category'?'department':f),headers=[...source,'supplier_notes'];
 const content=headers.join(',')+'\n'+[...importFields.map(f=>row[f]??''),'private original note'].map(v=>JSON.stringify(v)).join(',');
 return {source:'CSV' as const,fileName:'vendor-fields.csv',content,requestKey:randomUUID(),mapping:{fields:Object.fromEntries(importFields.map((f,i)=>[f,source[i]])),ignoredHeaders:['supplier_notes'],values:[{field:'category' as const,from:'Lips',to:'Beauty/Makeup/Lips'},{field:'colour' as const,from:'Midnight',to:'Black'}]}};
}
const post=(path:string,payload:object,headers=vendor)=>app.inject({method:'POST',url:'/api/v1/catalog/imports'+path,headers,payload});
beforeAll(async()=>{const u=new URL(process.env.DATABASE_URL??'');if(!['localhost','127.0.0.1'].includes(u.hostname)||u.pathname!=='/ecs_test')throw Error('Isolated ecs_test required');if(!await db.partner.count())await seedDemo();app=await createServer({verifyResponseContracts:true});vendor=await login('catalog@lumera.demo');foreign=await login('admin@maisonazure.demo');fulfilment=await login('fulfilment@maisonazure.demo');});
afterAll(async()=>{await app?.close();await db.$disconnect();});
it('previews mapped raw/canonical values without persistence and stages immutable source evidence',async()=>{
 const input=fixture(),count=await db.catalogImport.count(),products=await db.product.count(),jobs=await db.outbox.count();
 const preview=await post('/preview',input);expect(preview.statusCode,preview.body).toBe(200);expect(preview.json()).toMatchObject({ready:true,rowCount:1,sampleRows:[{raw:{shade:'Midnight',department:'Lips',supplier_notes:'private original note'},canonical:{colour:'Black',category:'Beauty/Makeup/Lips',gtin:'06299920000014'}}]});expect(await db.catalogImport.count()).toBe(count);
 const staged=await post('',input);expect(staged.statusCode,staged.body).toBe(200);const batch=staged.json();expect(batch.mapping).toMatchObject({version:1,fields:{colour:'shade'}});expect(batch.rows[0].input).toMatchObject({colour:'Black',category:'Beauty/Makeup/Lips'});expect(batch).not.toHaveProperty('originalRows');
 const stored=await db.catalogImport.findUniqueOrThrow({where:{id:batch.id}});expect(stored.originalRows).toMatchObject([{shade:'Midnight',department:'Lips',supplier_notes:'private original note'}]);
 expect(await db.product.count()).toBe(products);expect(await db.outbox.count()).toBe(jobs);expect((await post('',input)).json().id).toBe(batch.id);
 const reordered={...input,mapping:{...input.mapping,fields:Object.fromEntries(Object.entries(input.mapping.fields).reverse()),values:[...input.mapping.values].reverse()}};expect((await post('',reordered)).json().id).toBe(batch.id);
 expect((await post('',{...input,mapping:{...input.mapping,values:[]}})).statusCode).toBe(409);
 await expect(db.catalogImport.update({where:{id:batch.id},data:{mapping:{version:1,fields:{},ignoredHeaders:[],values:[]}}})).rejects.toThrow();
 expect((await app.inject({url:`/api/v1/catalog/imports/${batch.id}`,headers:foreign})).statusCode).toBe(404);
});
it('does not bypass ownership, permissions, CSRF or moderation with custom mappings',async()=>{
 const input=fixture();expect((await post('/preview',input,{cookie:vendor.cookie})).statusCode).toBe(403);expect((await post('/preview',input,fulfilment)).statusCode).toBe(403);expect((await post('',input,foreign)).statusCode).toBe(403);
 const noMap={...input,mapping:undefined};const preview=await post('/preview',noMap);expect(preview.statusCode).toBe(200);expect(preview.json()).toMatchObject({ready:false,missingFields:['category','colour']});expect((await post('',noMap)).statusCode).toBe(400);
 const bad={...input,mapping:{...input.mapping,values:[{field:'category',from:'Lips',to:'Unapproved/Category'}]}};const staged=await post('',bad);expect(staged.statusCode,staged.body).toBe(200);expect(staged.json().rows[0].issues.map((i:{code:string})=>i.code)).toContain('PRICE_POLICY_MISSING');expect((await post(`/${staged.json().id}/submit`,{expectedVersion:1})).statusCode).toBe(422);
});
it('rolls back mapped source and audit together when staging fails',async()=>{
 const input=fixture(),before=await db.catalogImport.count(),original=transactions.audit;
 const spy=vi.spyOn(transactions,'audit').mockImplementation((...args)=>{if(args[3]==='catalog.import-staged')throw Error('Injected mapping audit failure');return original(...args);});
 try{expect((await post('',input)).statusCode).toBe(500);}finally{spy.mockRestore();}
 expect(await db.catalogImport.count()).toBe(before);expect((await post('',input)).statusCode).toBe(200);
});
it('maps XLSX source headers while preserving the numeric-identifier and formula guards',async()=>{
 const base64=await mutateWorkbook(p=>replaceCell(p,'I1','<c r="I1" t="inlineStr"><is><t>shade</t></is></c>'));
 const input={source:'XLSX',fileName:'vendor-fields.xlsx',base64,requestKey:randomUUID()};const preview=await post('/preview',input);expect(preview.statusCode,preview.body).toBe(200);const mapping={...preview.json().mapping,fields:{...preview.json().mapping.fields,colour:'shade'}};
 const staged=await post('',{...input,mapping});expect(staged.statusCode,staged.body).toBe(200);expect(staged.json().rows[0].input.gtin).toBe('06299920000014');
 const numeric=await mutateWorkbook(p=>replaceCell(p,'D2','<c r="D2"><v>6299920000014</v></c>'));const check=await post('/preview',{...input,base64:numeric,requestKey:randomUUID()});expect(check.json()).toMatchObject({ready:false,numericIssues:['gtin']});expect((await post('',{...input,base64:numeric,requestKey:randomUUID()})).statusCode).toBe(400);
});
