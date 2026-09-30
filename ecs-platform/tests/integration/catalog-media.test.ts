import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import * as transactions from '../../packages/db/transaction';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import type {FastifyInstance} from 'fastify';
import {db} from '../../packages/db/client';
import {seedDemo} from '../../prisma/seed';
import {createServer} from '../../apps/api/src/server';
import {createMockServer} from '../../apps/mock-systems/src/server';
import {provisionFixture} from '../helpers/provision';
import {processOutbox} from '../../apps/worker/src/outbox';
import {zipParts} from '../helpers/xlsx';
import * as sourceTransport from '../../packages/media/url';
let app:FastifyInstance,mock:FastifyInstance,admin:Record<string,string>,vendor:Record<string,string>,foreign:Record<string,string>,base64:string;
const id=`media-${randomUUID()}`;
async function login(email:string){const r=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password:'Demo123!'}});expect(r.statusCode).toBe(200);return {cookie:`${r.cookies[0].name}=${r.cookies[0].value}`,'x-csrf-token':r.json().csrfToken};}
async function product(){const p=await db.product.findUniqueOrThrow({where:{id:'prd_maz_dress_1001'}});return db.product.create({data:{id:`${id}-${randomUUID()}`,companyId:p.companyId,partnerId:p.partnerId,sku:`SKU-${randomUUID()}`,brand:p.brand,category:p.category,titleEn:'Private media test',titleAr:p.titleAr,gtin:'4006381333931',price:p.price,floor:p.floor,status:'DRAFT',data:{...p.data as Record<string,never>,media:[]}}});}
const input=(version=1)=>({requestId:randomUUID(),expectedVersion:version,fileName:'private-image.png',base64});
const upload=(productId:string,payload:object,headers=vendor)=>app.inject({method:'POST',url:`/api/v1/catalog/items/${productId}/media`,headers,payload});
const replace=(productId:string,payload:object,headers=vendor)=>app.inject({method:'POST',url:`/api/v1/catalog/items/${productId}/media/replace`,headers,payload});
async function replacementFixture(){
 const p=await product(),old=await upload(p.id,input()),oldUrl=`/api/v1/catalog/media/${old.json().receipt.assetId}/content`;
 const pixels=(await sharp({create:{width:256,height:256,channels:3,background:'#eeaacc'}}).png().toBuffer()).toString('base64');
 return {p,old:old.json().receipt,oldUrl,body:{...input(2),base64:pixels,replaceUrl:oldUrl,reason:'Correct background and preserve primary position'}};
}
const zipUpload=(productId:string,payload:object,headers=vendor)=>app.inject({method:'POST',url:`/api/v1/catalog/items/${productId}/media/zip`,headers,payload});
const urlUpload=(productId:string,payload:object,headers=vendor)=>app.inject({method:'POST',url:`/api/v1/catalog/items/${productId}/media/url`,headers,payload});
const zipInput=(images:Map<string,Buffer>,version=1)=>({requestId:randomUUID(),expectedVersion:version,fileName:'images.zip',base64:zipParts(new Map<string,string|Buffer>([...images,['manifest.json',JSON.stringify({version:1,images:[...images.keys()].map(file=>({file}))})]]))});
beforeAll(async()=>{const url=new URL(process.env.DATABASE_URL??'');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/ecs_test')throw Error('Requires isolated ecs_test');if(!await db.partner.count())await seedDemo();app=await createServer({verifyResponseContracts:true});mock=createMockServer();await mock.listen({port:4101,host:'127.0.0.1'});admin=await login('admin@ati.demo');vendor=await login('admin@maisonazure.demo');foreign=await login('catalog@lumera.demo');base64=(await sharp({create:{width:256,height:256,channels:3,background:'#ddeeff'}}).png().toBuffer()).toString('base64');});
afterAll(async()=>{await app?.close();await mock?.close();await db.$disconnect();});
it('atomically replaces at capacity, preserves image position/history and replays without another revision',async()=>{
 const {p,old,oldUrl,body}=await replacementFixture(),current=await db.product.findUniqueOrThrow({where:{id:p.id}});
 const media=(current.data as {media:object[]}).media;
 await db.product.update({where:{id:p.id},data:{status:'CHANGES_REQUESTED',data:{...current.data as object,media:[...media,...Array.from({length:9},(_,i)=>({url:`/assets/sample-${i}.svg`,status:'APPROVED'}))]}}});
 const r=await replace(p.id,body);expect(r.statusCode,r.body).toBe(200);const receipt=r.json().receipt;
 expect(receipt).toMatchObject({productVersion:3,duplicate:false,sourceType:'UPLOAD'});expect(receipt.assetId).not.toBe(old.assetId);
 const saved=await db.product.findUniqueOrThrow({where:{id:p.id}});expect(saved.status).toBe('DRAFT');expect((saved.data as {media:object[]}).media).toHaveLength(10);
 expect(saved.data).toMatchObject({media:[{assetId:receipt.assetId,status:'PENDING'},...Array.from({length:9},(_,i)=>({url:`/assets/sample-${i}.svg`,status:'APPROVED'}))]});
 expect((await app.inject({url:oldUrl,headers:vendor})).statusCode).toBe(200);expect(await db.mediaIngestion.count({where:{productId:p.id}})).toBe(2);
 const event=await db.auditEvent.findFirstOrThrow({where:{entityId:p.id,action:'catalog.media-replace'}});expect(event.before).toMatchObject({image:{url:oldUrl},position:0,version:2});expect(event.after).toMatchObject({receiptId:receipt.id,image:{status:'PENDING'},position:0,version:3});expect(event.reason).toBe(body.reason);
 expect((await replace(p.id,body)).json()).toMatchObject({replayed:true,receipt:{id:receipt.id}});
 expect((await replace(p.id,{...body,reason:'Changed reason for the same request'})).statusCode).toBe(409);
 const plainUpload={requestId:body.requestId,expectedVersion:body.expectedVersion,fileName:body.fileName,base64:body.base64};expect((await upload(p.id,plainUpload)).statusCode).toBe(409);
 expect((await db.product.findUniqueOrThrow({where:{id:p.id}})).version).toBe(3);
});
it('does not allow replacement to bypass scope, roles, CSRF, review states or fresh version checks',async()=>{
 const {p,body}=await replacementFixture(),before=await db.product.findUniqueOrThrow({where:{id:p.id}}),assets=await db.mediaAsset.count();
 expect((await replace(p.id,body,foreign)).statusCode).toBe(404);expect((await replace(p.id,body,{cookie:vendor.cookie})).statusCode).toBe(403);
 expect((await replace(p.id,body,await login('fulfilment@maisonazure.demo'))).statusCode).toBe(403);
 expect((await replace(p.id,{...body,expectedVersion:1})).statusCode).toBe(409);expect((await replace(p.id,{...body,replaceUrl:'/not-attached.png'})).statusCode).toBe(404);
 expect((await replace(p.id,{...body,reason:''})).statusCode).toBe(400);
 expect(await db.product.findUniqueOrThrow({where:{id:p.id}})).toEqual(before);
 for(const status of ['IN_REVIEW','APPROVED','PUBLISHING','PUBLISHED']){await db.product.update({where:{id:p.id},data:{status}});expect((await replace(p.id,body)).statusCode).toBe(409);}
 expect(await db.mediaAsset.count()).toBe(assets);expect(await db.mediaIngestion.count({where:{productId:p.id}})).toBe(1);
});
it('retains the old image on invalid pixels, attached duplicates and audit rollback',async()=>{
 const {p,body}=await replacementFixture(),before=await db.product.findUniqueOrThrow({where:{id:p.id}}),assets=await db.mediaAsset.count();
 expect((await replace(p.id,{...body,base64:Buffer.from('not an image').toString('base64')})).statusCode).toBe(400);
 expect((await replace(p.id,{...body,base64})).json()).toMatchObject({error:{code:'MEDIA_REPLACEMENT_DUPLICATE'}});
 const spy=vi.spyOn(transactions,'audit').mockRejectedValueOnce(Error('Injected replacement audit failure'));
 try{expect((await replace(p.id,body)).statusCode).toBe(500);}finally{spy.mockRestore();}
 expect(await db.product.findUniqueOrThrow({where:{id:p.id}})).toEqual(before);expect(await db.mediaAsset.count()).toBe(assets);expect(await db.mediaIngestion.count({where:{productId:p.id}})).toBe(1);
});
it('serializes concurrent replacements: exact retries agree and competing edits cannot overwrite',async()=>{
 const {p,body}=await replacementFixture();const exact=await Promise.all([replace(p.id,body),replace(p.id,body)]);
 for(const r of exact)expect(r.statusCode,r.body).toBe(200);expect(exact[0].json().receipt.id).toBe(exact[1].json().receipt.id);
 expect(await db.mediaIngestion.count({where:{productId:p.id}})).toBe(2);expect(await db.auditEvent.count({where:{entityId:p.id,action:'catalog.media-replace'}})).toBe(1);
 const fresh=await replacementFixture(),competing=await Promise.all([replace(fresh.p.id,fresh.body),replace(fresh.p.id,{...fresh.body,requestId:randomUUID()})]);
 expect(competing.map(r=>r.statusCode).sort()).toEqual([200,409]);expect((await db.product.findUniqueOrThrow({where:{id:fresh.p.id}})).version).toBe(3);
});
it('fetches a real loopback supplier image once, retains URL lineage and replays without refetching',async()=>{
 const p=await product(),body={requestId:randomUUID(),expectedVersion:1,url:'demo://supplier/front.png'},spy=vi.spyOn(sourceTransport,'fetchImageSource');
 try{
  const r=await urlUpload(p.id,body);expect(r.statusCode,r.body).toBe(200);expect(r.json().receipt).toMatchObject({sourceType:'URL',sourceRef:body.url,productVersion:2,asset:{width:256,height:256}});
  const retry=await urlUpload(p.id,body);expect(retry.statusCode,retry.body).toBe(200);expect(retry.json()).toMatchObject({replayed:true,receipt:{id:r.json().receipt.id}});expect(spy).toHaveBeenCalledTimes(1);
  expect((await urlUpload(p.id,{...body,url:'https://changed.example/front.png'})).statusCode).toBe(409);
  expect((await urlUpload(p.id,body,foreign)).statusCode).toBe(404);expect(spy).toHaveBeenCalledTimes(1);
 }finally{spy.mockRestore();}
});
it('denies unapproved sources and stale, unauthorized or locked imports without changing product data',async()=>{
 const p=await product(),body={requestId:randomUUID(),expectedVersion:1,url:'demo://supplier/front.png'},before=await db.mediaAsset.count();
 expect((await urlUpload(p.id,{...body,url:'http://169.254.169.254/latest/meta-data'})).statusCode).toBe(400);
 expect((await urlUpload(p.id,{...body,url:'https://unapproved.example/front.png'})).statusCode).toBe(403);
 expect((await urlUpload(p.id,body,{cookie:vendor.cookie})).statusCode).toBe(403);expect((await urlUpload(p.id,{...body,expectedVersion:99})).statusCode).toBe(409);
 await db.product.update({where:{id:p.id},data:{status:'PUBLISHED'}});expect((await urlUpload(p.id,body)).statusCode).toBe(409);
 expect(await db.mediaAsset.count()).toBe(before);expect(await db.mediaIngestion.count({where:{productId:p.id}})).toBe(0);
});
it('imports a ZIP atomically in manifest order with replay, dedup and immutable archive evidence',async()=>{
 const p=await product(),body=zipInput(new Map([['first.png',Buffer.from(base64,'base64')],['same.png',Buffer.from(base64,'base64')]]));
 const results=await Promise.all([zipUpload(p.id,body),zipUpload(p.id,body)]);for(const r of results)expect(r.statusCode,r.body).toBe(200);
 expect(results[0].json().receipts.map((r:{id:string})=>r.id)).toEqual(results[1].json().receipts.map((r:{id:string})=>r.id));
 expect(results[0].json().receipts).toMatchObject([{sourceType:'ZIP',sourceRef:'images.zip#first.png',duplicate:false,productVersion:2},{sourceType:'ZIP',duplicate:true,productVersion:2}]);
 expect((await db.product.findUniqueOrThrow({where:{id:p.id}})).data).toMatchObject({media:[{status:'PENDING'}]});expect(await db.mediaIngestion.count({where:{productId:p.id}})).toBe(2);
 const event=await db.auditEvent.findFirstOrThrow({where:{entityId:p.id,action:'catalog.media-zip'}});expect(event.after).toMatchObject({archiveChecksum:results[0].json().archiveChecksum,manifest:{version:1}});
 expect((await zipUpload(p.id,{...body,fileName:'changed.zip'})).statusCode).toBe(409);
 expect((await zipUpload(p.id,body,foreign)).statusCode).toBe(404);expect((await zipUpload(p.id,body,{cookie:vendor.cookie})).statusCode).toBe(403);
 const dedup=await zipUpload(p.id,{...body,requestId:randomUUID(),expectedVersion:2});expect(dedup.statusCode,dedup.body).toBe(200);expect(dedup.json().receipts.every((r:{duplicate:boolean;productVersion:number})=>r.duplicate&&r.productVersion===2)).toBe(true);
});
it('rejects invalid ZIP images and rolls back every attachment, receipt and asset when audit fails',async()=>{
 const p=await product(),before=await db.mediaAsset.count();
 const valid=await sharp({create:{width:192,height:192,channels:3,background:'#ff1299'}}).png().toBuffer();
 const invalid=zipInput(new Map([['good.png',valid],['broken.png',Buffer.from('not pixels')]]));expect((await zipUpload(p.id,invalid)).statusCode).toBe(400);
 const body=zipInput(new Map([['good.png',valid]])),spy=vi.spyOn(transactions,'audit').mockRejectedValueOnce(Error('Injected ZIP audit failure'));
 try{expect((await zipUpload(p.id,body)).statusCode).toBe(500);}finally{spy.mockRestore();}
 expect(await db.mediaAsset.count()).toBe(before);expect(await db.mediaIngestion.count({where:{productId:p.id}})).toBe(0);expect((await db.product.findUniqueOrThrow({where:{id:p.id}})).version).toBe(1);
 expect((await zipUpload(p.id,{...body,expectedVersion:22})).statusCode).toBe(409);
 await db.product.update({where:{id:p.id},data:{status:'PUBLISHED'}});expect((await zipUpload(p.id,body)).statusCode).toBe(409);
});
const decide=(productId:string,payload:object,headers=admin)=>app.inject({method:'POST',url:`/api/v1/catalog/items/${productId}/media/commands`,headers,payload});
it('rejects one image with feedback, lets its vendor correct and reorder, and retains immutable evidence',async()=>{
 const p=await product(),r=await upload(p.id,input()),assetId=r.json().receipt.assetId,url=`/api/v1/catalog/media/${assetId}/content`;
 await db.product.update({where:{id:p.id},data:{status:'IN_REVIEW'}});
 const rejected=await decide(p.id,{expectedVersion:2,action:'reject',url,reason:'Background needs correction'});expect(rejected.statusCode,rejected.body).toBe(200);expect(rejected.json()).toMatchObject({version:3,status:'CHANGES_REQUESTED'});
 const saved=await db.product.findUniqueOrThrow({where:{id:p.id}});expect(saved.data).toMatchObject({media:[{status:'REJECTED',reason:'Background needs correction'}]});
 expect(await db.exception.count({where:{entityId:p.id,kind:'CATALOG_REVIEW',status:'OPEN'}})).toBe(1);
 expect((await decide(p.id,{expectedVersion:3,action:'remove',url,reason:'Replace the rejected picture'},vendor)).statusCode).toBe(200);
 expect(await db.mediaAsset.count({where:{id:assetId}})).toBe(1);expect(await db.mediaIngestion.count({where:{productId:p.id}})).toBe(1);
 const replacement=await upload(p.id,input(4));expect(replacement.json().receipt).toMatchObject({assetId,duplicate:false,productVersion:5});
 expect((await db.product.findUniqueOrThrow({where:{id:p.id}})).data).toMatchObject({media:[{status:'PENDING'}]});
 const second=await upload(p.id,{...input(5),base64:(await sharp({create:{width:128,height:128,channels:3,background:'#119955'}}).png().toBuffer()).toString('base64')});const nextUrl=`/api/v1/catalog/media/${second.json().receipt.assetId}/content`;
 expect((await decide(p.id,{expectedVersion:6,action:'move',url:nextUrl,position:0,reason:'Use corrected primary image'},vendor)).statusCode).toBe(200);
 expect((await db.product.findUniqueOrThrow({where:{id:p.id}})).data).toMatchObject({media:[{url:nextUrl},{url}]});
 const approval=await decide(p.id,{expectedVersion:7,action:'approve',url:nextUrl,reason:'Reviewed primary image pixels'});expect(approval.statusCode,approval.body).toBe(200);
 expect((await db.product.findUniqueOrThrow({where:{id:p.id}})).data).toMatchObject({media:[{status:'APPROVED'},{status:'PENDING'}]});
});
it('guards individual image decisions by scope, role, CSRF, attachment, state and version',async()=>{
 const p=await product(),r=await upload(p.id,input()),url=`/api/v1/catalog/media/${r.json().receipt.assetId}/content`,body={expectedVersion:2,action:'approve',url,reason:'Review the image pixels'};
 expect((await decide(p.id,body,vendor)).statusCode).toBe(403);expect((await decide(p.id,{...body,action:'remove'},foreign)).statusCode).toBe(404);
 expect((await decide(p.id,body,{cookie:admin.cookie})).statusCode).toBe(403);expect((await decide(p.id,{...body,expectedVersion:1})).statusCode).toBe(409);
 expect((await decide(p.id,{...body,url:'/unattached.png'})).statusCode).toBe(404);expect((await decide(p.id,{...body,reason:''})).statusCode).toBe(400);
 expect((await decide(p.id,{...body,action:'move',position:5},vendor)).statusCode).toBe(400);
 for(const status of ['APPROVED','PUBLISHING','PUBLISHED']){await db.product.update({where:{id:p.id},data:{status}});expect((await decide(p.id,body)).statusCode).toBe(409);expect((await decide(p.id,{...body,action:'remove'},vendor)).statusCode).toBe(409);}
 expect(await db.auditEvent.count({where:{entityId:p.id,action:'catalog.media-approve'}})).toBe(0);
});
it('serializes competing review decisions and rolls back changes when audit fails',async()=>{
 const p=await product(),r=await upload(p.id,input()),url=`/api/v1/catalog/media/${r.json().receipt.assetId}/content`,body={expectedVersion:2,action:'approve',url,reason:'Reviewed image for publication'};
 const results=await Promise.all([decide(p.id,body),decide(p.id,{...body,action:'reject'})]);expect(results.map(r=>r.statusCode).sort()).toEqual([200,409]);
 expect((await db.product.findUniqueOrThrow({where:{id:p.id}})).version).toBe(3);
 const before=await db.product.findUniqueOrThrow({where:{id:p.id}}),spy=vi.spyOn(transactions,'audit').mockRejectedValueOnce(Error('Injected decision audit failure'));
 try{expect((await decide(p.id,{...body,expectedVersion:3})).statusCode).toBe(500);}finally{spy.mockRestore();}
 expect(await db.product.findUniqueOrThrow({where:{id:p.id}})).toEqual(before);
});
it('uploads private pixels with lineage; exact request replay and owned checksum dedup do not revise twice',async()=>{
 const p=await product(),body=input(),r=await upload(p.id,body);expect(r.statusCode,r.body).toBe(200);const receipt=r.json().receipt;
 expect(receipt).toMatchObject({productVersion:2,duplicate:false,asset:{width:256,height:256,scanStatus:'MOCK_CLEAN'}});expect(r.body).not.toContain('base64');expect(r.json().receipt.asset).not.toHaveProperty('bytes');
 expect((await upload(p.id,body)).json()).toMatchObject({replayed:true,receipt:{id:receipt.id}});
 const dedup=await upload(p.id,input(2));expect(dedup.statusCode,dedup.body).toBe(200);expect(dedup.json().receipt).toMatchObject({duplicate:true,assetId:receipt.assetId,productVersion:2});
 expect((await db.product.findUniqueOrThrow({where:{id:p.id}})).version).toBe(2);
 const download=await app.inject({url:`/api/v1/catalog/media/${receipt.assetId}/content`,headers:vendor});expect(download.statusCode).toBe(200);expect(download.headers['content-type']).toContain('image/png');expect(download.headers['cache-control']).toBe('no-store');expect((await sharp(download.rawPayload).metadata()).width).toBe(256);
 expect((await upload(p.id,{...body,fileName:'changed.png'})).statusCode).toBe(409);
 for(const headers of [foreign,{}])expect((await app.inject({url:`/api/v1/catalog/media/${receipt.assetId}/content`,headers})).statusCode).toBe(headers===foreign?404:401);
 await expect(db.mediaAsset.update({where:{id:receipt.assetId},data:{market:'SA'}})).rejects.toThrow();await expect(db.mediaIngestion.delete({where:{id:receipt.id}})).rejects.toThrow();
});
it('enforces role, ownership, CSRF, versions and published locks without partial assets',async()=>{
 const p=await product(),before=await db.mediaAsset.count();
 expect((await upload(p.id,input(),foreign)).statusCode).toBe(404);expect((await upload(p.id,input(),{cookie:vendor.cookie})).statusCode).toBe(403);expect((await upload(p.id,input(),await login('fulfilment@maisonazure.demo'))).statusCode).toBe(403);
 expect((await upload(p.id,input(20))).statusCode).toBe(409);expect((await upload('prd_maz_dress_1001',input())).statusCode).toBe(409);
 expect((await upload(p.id,{...input(),base64:Buffer.from('<script>bad</script>').toString('base64')})).statusCode).toBe(400);
 expect(await db.mediaAsset.count()).toBe(before);expect(await db.mediaIngestion.count({where:{productId:p.id}})).toBe(0);expect((await db.product.findUniqueOrThrow({where:{id:p.id}})).version).toBe(1);
});
it('deduplicates concurrent identical submissions and rolls back an audit failure',async()=>{
 const p=await product(),body=input();const results=await Promise.all([upload(p.id,body),upload(p.id,body)]);
 for(const r of results)expect(r.statusCode,r.body).toBe(200);expect(results[0].json().receipt.id).toBe(results[1].json().receipt.id);expect(await db.mediaIngestion.count({where:{productId:p.id}})).toBe(1);
 const fresh=await product(),different=(await sharp({create:{width:256,height:256,channels:3,background:'#ff2244'}}).png().toBuffer()).toString('base64'),before=await db.mediaAsset.count();
 const spy=vi.spyOn(transactions,'audit').mockRejectedValueOnce(Error('Injected audit failure'));
 try{expect((await upload(fresh.id,{...input(),base64:different})).statusCode).toBe(500);}finally{spy.mockRestore();}
 expect(await db.mediaAsset.count()).toBe(before);expect(await db.mediaIngestion.count({where:{productId:fresh.id}})).toBe(0);expect((await db.product.findUniqueOrThrow({where:{id:fresh.id}})).version).toBe(1);
});
it('shares only same-owner pixels across competing products while retaining separate ingestion evidence',async()=>{
 const [a,b]=await Promise.all([product(),product()]);const shared=(await sharp({create:{width:192,height:192,channels:3,background:'#5a8c3f'}}).png().toBuffer()).toString('base64');
 const results=await Promise.all([upload(a.id,{...input(),base64:shared}),upload(b.id,{...input(),base64:shared})]);
 for(const r of results)expect(r.statusCode,r.body).toBe(200);expect(results[0].json().receipt.assetId).toBe(results[1].json().receipt.assetId);expect(results[0].json().receipt.id).not.toBe(results[1].json().receipt.id);
});
it('requires human review, publishes approved asset lineage through ERP/Fynd/SFCC and retains private bytes',async()=>{
 await provisionFixture('vnd_maz');const p=await product();await db.product.updateMany({where:{gtin:p.gtin,id:{not:p.id}},data:{gtin:null}});
 const uploaded=await upload(p.id,input());expect(uploaded.statusCode,uploaded.body).toBe(200);const assetId=uploaded.json().receipt.assetId;
 const command=(action:string,headers=admin)=>app.inject({method:'POST',url:`/api/v1/catalog/items/${p.id}/commands`,headers,payload:{expectedVersion:2,action,reason:'Reviewed safe pixels and ownership'}});
 expect((await command('submit',vendor)).statusCode).toBe(200);expect((await command('approve')).statusCode).toBe(422);expect((await command('approve-media',vendor)).statusCode).toBe(403);expect((await command('approve-media')).statusCode).toBe(200);expect((await command('approve')).statusCode).toBe(200);expect((await command('publish')).statusCode).toBe(200);
 for(let n=0;n<4;n++)for(const j of await db.outbox.findMany({where:{aggregateId:p.id,status:'PENDING'}}))await processOutbox(j.id);
 expect((await db.product.findUniqueOrThrow({where:{id:p.id}})).status).toBe('PUBLISHED');
 const job=await db.outbox.findFirstOrThrow({where:{aggregateId:p.id,target:'FYND',operation:'upsertProduct'}});expect(job.status).toBe('SUCCEEDED');expect(JSON.stringify(job.payload)).toContain(assetId);expect(JSON.stringify(job.payload)).not.toContain(base64);
 expect(await db.auditEvent.count({where:{entityId:p.id,action:'catalog.media-upload'}})).toBe(1);
});
