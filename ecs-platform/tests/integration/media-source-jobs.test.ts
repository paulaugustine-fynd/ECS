import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {db} from '../../packages/db/client';
import {seedDemo} from '../../prisma/seed';
import {createServer} from '../../apps/api/src/server';
import {createMockServer} from '../../apps/mock-systems/src/server';
import {processMediaJob} from '../../apps/worker/src/media-source';
import {queueMediaJob} from '../../packages/domain/media-source-jobs';
import * as transactions from '../../packages/db/transaction';
import * as dam from '../../packages/media/dam';
import * as urlSource from '../../packages/media/url';
import {DomainError} from '../../packages/domain/errors';
import sharp from 'sharp';
import {zipParts} from '../helpers/xlsx';
import * as zipImport from '../../packages/domain/catalog-media-zip';
let app:FastifyInstance,mock:FastifyInstance,admin:Record<string,string>,vendor:Record<string,string>,foreign:Record<string,string>;
async function login(email:string){const r=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password:'Demo123!'}});expect(r.statusCode).toBe(200);return {cookie:`${r.cookies[0].name}=${r.cookies[0].value}`,'x-csrf-token':r.json().csrfToken};}
async function product(){const p=await db.product.findUniqueOrThrow({where:{id:'prd_maz_dress_1001'}});return db.product.create({data:{companyId:p.companyId,partnerId:p.partnerId,sku:`DAM-${randomUUID()}`,brand:p.brand,category:p.category,titleEn:'DAM test',titleAr:p.titleAr,price:p.price,floor:p.floor,data:{media:[]}}});}
const body=(demoFailures=0)=>({requestId:randomUUID(),expectedVersion:1,sourceRef:'studio-front' as const,demoFailures});
const queue=(id:string,payload:object,headers=vendor)=>app.inject({method:'POST',url:`/api/v1/catalog/items/${id}/media/jobs`,headers,payload});
const queueUrl=(id:string,payload:object,headers=vendor)=>app.inject({method:'POST',url:`/api/v1/catalog/items/${id}/media/url/jobs`,headers,payload});
const urlBody=()=>({requestId:randomUUID(),expectedVersion:1,url:'demo://supplier/front.png'});
const queueZip=(id:string,payload:object,headers=vendor)=>app.inject({method:'POST',url:`/api/v1/catalog/items/${id}/media/zip/jobs`,headers,payload});
async function zipBody(invalid=false){
 const front=await sharp({create:{width:200,height:200,channels:3,background:'#ffffff'}}).png().toBuffer();
 const back=invalid?Buffer.from('not an image'):await sharp({create:{width:200,height:200,channels:3,background:'#eeeeee'}}).png().toBuffer();
 const base64=zipParts(new Map<string,string|Buffer>([['front.png',front],['back.png',back],['manifest.json',JSON.stringify({version:1,images:[{file:'back.png'},{file:'front.png'}]})]]));
 return {requestId:randomUUID(),expectedVersion:1,fileName:'product-images.zip',base64};
}
async function due(id:string){await db.mediaSourceJob.update({where:{id},data:{availableAt:new Date(0)}});await processMediaJob(id);return db.mediaSourceJob.findUniqueOrThrow({where:{id}});}
beforeAll(async()=>{const url=new URL(process.env.DATABASE_URL??'');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/ecs_test')throw Error('Requires isolated ecs_test');if(!await db.partner.count())await seedDemo();app=await createServer({verifyResponseContracts:true});mock=createMockServer();await mock.listen({host:'127.0.0.1',port:4101});admin=await login('admin@ati.demo');vendor=await login('admin@maisonazure.demo');foreign=await login('catalog@lumera.demo');});
afterAll(async()=>{vi.unstubAllEnvs();await app?.close();await mock?.close();await db.$disconnect();});
it('quarantines ZIP bytes privately and imports ordered images once across competing workers',async()=>{
 const p=await product(),input=await zipBody(),q=await queueZip(p.id,input);expect(q.statusCode,q.body).toBe(200);const id=q.json().id;
 expect(q.json()).toMatchObject({sourceType:'ZIP',status:'PENDING',receiptIds:[]});
 for(const key of ['bytes','base64','checksum','destinationOrigin','requestHash'])expect(q.json()).not.toHaveProperty(key);
 expect(await db.mediaIngestion.count({where:{productId:p.id}})).toBe(0);
 expect(await db.mediaSourceArchive.findUniqueOrThrow({where:{jobId:id}})).toMatchObject({byteSize:Buffer.from(input.base64,'base64').length});
 expect((await queueZip(p.id,input)).json().id).toBe(id);expect((await queueZip(p.id,{...input,fileName:'other.zip'})).statusCode).toBe(409);
 await Promise.all([processMediaJob(id),processMediaJob(id)]);
 const done=await db.mediaSourceJob.findUniqueOrThrow({where:{id}});expect(done).toMatchObject({status:'SUCCEEDED',attempts:1,destinationOrigin:'local://quarantined-archive'});expect(done.receiptIds).toHaveLength(2);expect(done.receiptId).toBe(done.receiptIds[0]);
 const receipts=await db.mediaIngestion.findMany({where:{productId:p.id},orderBy:{requestId:'asc'}});
 expect(receipts.map(r=>r.id)).toEqual(done.receiptIds);expect(receipts.map(r=>r.sourceRef)).toEqual(['product-images.zip#back.png','product-images.zip#front.png']);
 expect(await db.product.findUniqueOrThrow({where:{id:p.id}})).toMatchObject({version:2,data:{media:[{assetId:receipts[0].assetId,status:'PENDING'},{assetId:receipts[1].assetId,status:'PENDING'}]}});
 await expect(db.mediaSourceArchive.update({where:{jobId:id},data:{checksum:'0'.repeat(64)}})).rejects.toThrow();
 await expect(db.mediaSourceArchive.delete({where:{jobId:id}})).rejects.toThrow();
 await expect(db.mediaSourceJob.update({where:{id},data:{sourceRef:'rebound.zip'}})).rejects.toThrow();
 expect((await app.inject({url:`/api/v1/catalog/items/${p.id}/media/jobs`,headers:vendor})).json().items[0].receiptIds).toEqual(done.receiptIds);
});
it('dead-letters corrupt archives and mixed invalid images without partial attachments',async()=>{
 for(const input of [await zipBody(true),{...await zipBody(),base64:Buffer.from('not a zip').toString('base64')}]){
  const p=await product(),assets=await db.mediaAsset.count(),q=await queueZip(p.id,input);expect(q.statusCode,q.body).toBe(200);await processMediaJob(q.json().id);
  expect(await db.mediaSourceJob.findUniqueOrThrow({where:{id:q.json().id}})).toMatchObject({status:'DLQ',attempts:1,receiptIds:[]});
  expect(await db.mediaSourceArchive.count({where:{jobId:q.json().id}})).toBe(1);expect(await db.mediaAsset.count()).toBe(assets);expect(await db.mediaIngestion.count({where:{productId:p.id}})).toBe(0);
  expect(await db.product.findUniqueOrThrow({where:{id:p.id}})).toMatchObject({version:1,data:{media:[]}});
 }
});
it('rolls back ZIP queue and import transactions when their audit cannot commit',async()=>{
 const p=await product(),input=await zipBody(),original=transactions.audit;
 let spy=vi.spyOn(transactions,'audit').mockImplementation((...args)=>{if(args[3]==='media-job.queued')throw Error('Injected queue audit failure');return original(...args);});
 const archives=await db.mediaSourceArchive.count();try{expect((await queueZip(p.id,input)).statusCode).toBe(500);}finally{spy.mockRestore();}
 expect(await db.mediaSourceJob.count({where:{productId:p.id}})).toBe(0);expect(await db.mediaSourceArchive.count()).toBe(archives);
 const q=await queueZip(p.id,input);expect(q.statusCode,q.body).toBe(200);const id=q.json().id,assets=await db.mediaAsset.count();
 spy=vi.spyOn(transactions,'audit').mockImplementation((...args)=>{if(args[3]==='catalog.media-zip')throw Error('Injected import audit failure');return original(...args);});
 try{await processMediaJob(id);}finally{spy.mockRestore();}
 expect(await db.mediaSourceJob.findUniqueOrThrow({where:{id}})).toMatchObject({status:'RETRY'});expect(await db.mediaAsset.count()).toBe(assets);expect(await db.mediaIngestion.count({where:{productId:p.id}})).toBe(0);expect((await db.product.findUniqueOrThrow({where:{id:p.id}})).version).toBe(1);
 expect((await due(id)).status).toBe('SUCCEEDED');expect(await db.mediaIngestion.count({where:{productId:p.id}})).toBe(2);
});
it('recovers all committed ZIP receipts after failed acknowledgement without reimporting',async()=>{
 const p=await product(),q=await queueZip(p.id,await zipBody());expect(q.statusCode,q.body).toBe(200);const id=q.json().id,original=transactions.audit;
 const spy=vi.spyOn(transactions,'audit').mockImplementation((...args)=>{if(args[3]==='media-job.succeeded')throw Error('Injected ZIP acknowledgement failure');return original(...args);});
 try{await processMediaJob(id);}finally{spy.mockRestore();}
 expect(await db.mediaSourceJob.findUniqueOrThrow({where:{id}})).toMatchObject({status:'RETRY'});expect(await db.mediaIngestion.count({where:{productId:p.id}})).toBe(2);
 const importer=vi.spyOn(zipImport,'importMediaZip');try{const done=await due(id);expect(done.status).toBe('SUCCEEDED');expect(done.receiptIds).toHaveLength(2);expect(importer).not.toHaveBeenCalled();}finally{importer.mockRestore();}
 expect((await db.product.findUniqueOrThrow({where:{id:p.id}})).version).toBe(2);expect(await db.mediaIngestion.count({where:{productId:p.id}})).toBe(2);
});
it('retains exhausted ZIP jobs and requires scoped, versioned ATI replay',async()=>{
 const p=await product(),q=await queueZip(p.id,{...await zipBody(),demoFailures:3});expect(q.statusCode,q.body).toBe(200);const id=q.json().id;
 expect((await due(id)).status).toBe('RETRY');expect((await due(id)).status).toBe('RETRY');const failed=await due(id);expect(failed.status).toBe('DLQ');
 const replay=(headers:Record<string,string>,version=failed.version)=>app.inject({method:'POST',url:`/api/v1/catalog/media/jobs/${id}/replay`,headers,payload:{expectedVersion:version,reason:'Verified retained ZIP source for retry'}});
 expect((await replay(vendor)).statusCode).toBe(403);expect((await replay(admin,1)).statusCode).toBe(409);expect((await replay(admin)).statusCode).toBe(200);
 const done=await due(id);expect(done).toMatchObject({status:'SUCCEEDED',attempts:4,replayCount:1});expect(done.receiptIds).toHaveLength(2);
});
it('rejects unauthorized ZIP storage and holds stale queued work without attachments',async()=>{
 const p=await product(),input=await zipBody(),archives=await db.mediaSourceArchive.count();
 expect((await queueZip(p.id,input,foreign)).statusCode).toBe(404);expect((await queueZip(p.id,input,{cookie:vendor.cookie})).statusCode).toBe(403);
 expect((await queueZip(p.id,{...input,expectedVersion:99})).statusCode).toBe(409);expect((await queueZip(p.id,{...input,base64:'not-base64'})).statusCode).toBe(400);
 expect(await db.mediaSourceArchive.count()).toBe(archives);expect(await db.mediaSourceJob.count({where:{productId:p.id}})).toBe(0);
 const q=await queueZip(p.id,input);expect(q.statusCode,q.body).toBe(200);await db.product.update({where:{id:p.id},data:{version:2}});await processMediaJob(q.json().id);
 expect(await db.mediaSourceJob.findUniqueOrThrow({where:{id:q.json().id}})).toMatchObject({status:'DLQ',lastError:'STALE_VERSION'});expect(await db.mediaIngestion.count({where:{productId:p.id}})).toBe(0);
});
it('queues URL imports without fetching, retains type/destination bindings and attaches once across worker races',async()=>{
 const p=await product(),input=urlBody(),transport=vi.spyOn(urlSource,'fetchImageSource');
 try{
  const q=await queueUrl(p.id,input);expect(q.statusCode,q.body).toBe(200);expect(q.json()).toMatchObject({sourceType:'URL',sourceRef:input.url,status:'PENDING'});expect(transport).not.toHaveBeenCalled();
  const id=q.json().id;expect((await queueUrl(p.id,input)).json().id).toBe(id);expect((await queueUrl(p.id,{...input,url:'demo://supplier/other.png'})).statusCode).toBe(409);
  expect((await queue(p.id,{...body(),requestId:input.requestId})).statusCode).toBe(409);
  vi.stubEnv('MOCK_ORIGIN','https://must-not-contact.invalid');await Promise.all([processMediaJob(id),processMediaJob(id)]);vi.unstubAllEnvs();
  const done=await db.mediaSourceJob.findUniqueOrThrow({where:{id}});expect(done).toMatchObject({sourceType:'URL',status:'SUCCEEDED',attempts:1,destinationOrigin:'http://127.0.0.1:4101'});
  expect(transport).toHaveBeenCalledTimes(1);expect(await db.mediaIngestion.findUniqueOrThrow({where:{id:done.receiptId!}})).toMatchObject({sourceType:'URL',sourceRef:input.url,productVersion:2});
  await expect(db.mediaSourceJob.update({where:{id},data:{sourceType:'DAM',sourceRef:'studio-front'}})).rejects.toThrow();
  await expect(db.mediaSourceJob.update({where:{id},data:{destinationOrigin:'http://127.0.0.1:9999'}})).rejects.toThrow();
  expect((await db.product.findUniqueOrThrow({where:{id:p.id}})).data).toMatchObject({media:[{status:'PENDING'}]});
 }finally{transport.mockRestore();vi.unstubAllEnvs();}
});
it('retries transient URL transport failures and retains exhausted work for reasoned ATI replay',async()=>{
 const p=await product(),id=(await queueUrl(p.id,urlBody())).json().id;
 const transport=vi.spyOn(urlSource,'fetchImageSource').mockRejectedValueOnce(new DomainError('MEDIA_URL_TIMEOUT','Simulated source timeout',400));
 try{expect((await due(id)).status).toBe('RETRY');expect((await due(id)).status).toBe('SUCCEEDED');expect(transport).toHaveBeenCalledTimes(2);}finally{transport.mockRestore();}
 const next=await product(),other=(await queueUrl(next.id,{...urlBody(),demoFailures:3})).json().id;
 expect((await due(other)).status).toBe('RETRY');expect((await due(other)).status).toBe('RETRY');const failed=await due(other);expect(failed.status).toBe('DLQ');
 const replay=(headers:Record<string,string>)=>app.inject({method:'POST',url:`/api/v1/catalog/media/jobs/${other}/replay`,headers,payload:{expectedVersion:failed.version,reason:'Reviewed simulated supplier recovery'}});
 expect((await replay(vendor)).statusCode).toBe(403);expect((await replay(admin)).statusCode).toBe(200);
 expect(await due(other)).toMatchObject({status:'SUCCEEDED',attempts:4,replayCount:1,sourceType:'URL'});
 expect(await db.mediaIngestion.count({where:{productId:next.id}})).toBe(1);
});
it('rechecks URL host approval before DNS or download and dead-letters revoked sources permanently',async()=>{
 const p=await product();vi.stubEnv('MEDIA_URL_ALLOWED_HOSTS','supplier.example');
 try{
  const q=await queueUrl(p.id,{...urlBody(),url:'https://supplier.example/front.png'});expect(q.statusCode,q.body).toBe(200);const id=q.json().id;
  vi.stubEnv('MEDIA_URL_ALLOWED_HOSTS','');await processMediaJob(id);
  expect(await db.mediaSourceJob.findUniqueOrThrow({where:{id}})).toMatchObject({status:'DLQ',lastError:'MEDIA_URL_HOST',attempts:1,destinationOrigin:'https://supplier.example'});
  expect(await db.mediaIngestion.count({where:{productId:p.id}})).toBe(0);
 }finally{vi.unstubAllEnvs();}
});
it('guards URL queue scope, CSRF, network policy and stale work without fetching',async()=>{
 const p=await product(),input=urlBody(),transport=vi.spyOn(urlSource,'fetchImageSource');
 try{
  expect((await queueUrl(p.id,input,foreign)).statusCode).toBe(404);expect((await queueUrl(p.id,input,{cookie:vendor.cookie})).statusCode).toBe(403);
  expect((await queueUrl(p.id,{...input,url:'http://169.254.169.254/latest'})).statusCode).toBe(400);
  expect((await queueUrl(p.id,{...input,url:'https://unapproved.example/front.png'})).statusCode).toBe(403);
  expect((await queueUrl(p.id,{...input,destinationOrigin:'https://evil.example'})).statusCode).toBe(400);
  const id=(await queueUrl(p.id,input)).json().id;await db.product.update({where:{id:p.id},data:{version:2}});await processMediaJob(id);
  expect(await db.mediaSourceJob.findUniqueOrThrow({where:{id}})).toMatchObject({status:'DLQ',lastError:'STALE_VERSION'});expect(transport).not.toHaveBeenCalled();
  expect(await db.mediaIngestion.count({where:{productId:p.id}})).toBe(0);
 }finally{transport.mockRestore();}
});
it('recovers committed URL evidence without another fetch after job acknowledgement fails',async()=>{
 const p=await product(),id=(await queueUrl(p.id,urlBody())).json().id,original=transactions.audit;
 const spy=vi.spyOn(transactions,'audit').mockImplementation((...args)=>{if(args[3]==='media-job.succeeded')throw Error('Injected URL acknowledgement failure');return original(...args);});
 try{await processMediaJob(id);}finally{spy.mockRestore();}
 expect((await db.mediaSourceJob.findUniqueOrThrow({where:{id}})).status).toBe('RETRY');
 const transport=vi.spyOn(urlSource,'fetchImageSource');try{expect((await due(id)).status).toBe('SUCCEEDED');expect(transport).not.toHaveBeenCalled();}finally{transport.mockRestore();}
 expect(await db.mediaIngestion.count({where:{productId:p.id}})).toBe(1);expect((await db.product.findUniqueOrThrow({where:{id:p.id}})).version).toBe(2);
});
it('queues idempotently, fences competing workers and pins the mock destination against environment changes',async()=>{
 const p=await product(),input=body(),q=await queue(p.id,input);expect(q.statusCode,q.body).toBe(200);const job=q.json();
 expect(q.body).not.toContain('leaseToken');expect(q.body).not.toContain('destinationOrigin');expect((await queue(p.id,input)).json().id).toBe(job.id);expect((await queue(p.id,{...input,sourceRef:'studio-back'})).statusCode).toBe(409);
 vi.stubEnv('MOCK_ORIGIN','https://must-not-contact.invalid');try{await Promise.all([processMediaJob(job.id),processMediaJob(job.id)]);}finally{vi.unstubAllEnvs();}
 const done=await db.mediaSourceJob.findUniqueOrThrow({where:{id:job.id}});expect(done).toMatchObject({status:'SUCCEEDED',attempts:1});
 const receipt=await db.mediaIngestion.findUniqueOrThrow({where:{id:done.receiptId!}});expect(receipt).toMatchObject({sourceType:'DAM',sourceRef:'demo-dam://studio-front@demo-v1',productVersion:2});
 expect((await db.product.findUniqueOrThrow({where:{id:p.id}})).data).toMatchObject({media:[{status:'PENDING'}]});
 await expect(db.mediaSourceJob.update({where:{id:job.id},data:{destinationOrigin:'http://127.0.0.1:9999'}})).rejects.toThrow();
 expect((await app.inject({url:`/api/v1/catalog/items/${p.id}/media/jobs`,headers:vendor})).json().items[0].status).toBe('SUCCEEDED');
});
it('retries three explicit transient failures, dead-letters and permits only scoped ATI replay with evidence',async()=>{
 const p=await product(),q=await queue(p.id,body(3)),id=q.json().id;
 expect((await due(id)).status).toBe('RETRY');expect((await due(id)).status).toBe('RETRY');const failed=await due(id);expect(failed).toMatchObject({status:'DLQ',attempts:3});
 expect(await db.mediaIngestion.count({where:{productId:p.id}})).toBe(0);
 const replay=(headers:Record<string,string>,version=failed.version)=>app.inject({method:'POST',url:`/api/v1/catalog/media/jobs/${id}/replay`,headers,payload:{expectedVersion:version,reason:'Verified mock source is healthy again'}});
 expect((await replay(vendor)).statusCode).toBe(403);expect((await replay(admin,1)).statusCode).toBe(409);expect((await replay(admin)).statusCode).toBe(200);
 expect(await due(id)).toMatchObject({status:'SUCCEEDED',attempts:4,replayCount:1});
 expect(await db.auditEvent.count({where:{entityId:id,action:'media-job.attempt'}})).toBe(4);expect(await db.auditEvent.count({where:{entityId:id,action:'media-job.replayed'}})).toBe(1);
});
it('recovers after a committed attachment but failed job acknowledgement without downloading or attaching twice',async()=>{
 const p=await product(),id=(await queue(p.id,body())).json().id,original=transactions.audit;
 const spy=vi.spyOn(transactions,'audit').mockImplementation((...args)=>{if(args[3]==='media-job.succeeded')throw Error('Injected acknowledgement failure');return original(...args);});
 try{await processMediaJob(id);}finally{spy.mockRestore();}
 expect((await db.mediaSourceJob.findUniqueOrThrow({where:{id}})).status).toBe('RETRY');expect(await db.mediaIngestion.count({where:{productId:p.id}})).toBe(1);
 const transport=vi.spyOn(dam,'fetchDamAsset');try{expect((await due(id)).status).toBe('SUCCEEDED');expect(transport).not.toHaveBeenCalled();}finally{transport.mockRestore();}
 expect((await db.product.findUniqueOrThrow({where:{id:p.id}})).version).toBe(2);
});
it('guards creation and reading by ownership and CSRF; stale work is held without changing the product',async()=>{
 const p=await product();expect((await queue(p.id,body(),foreign)).statusCode).toBe(404);expect((await queue(p.id,body(),{cookie:vendor.cookie})).statusCode).toBe(403);
 expect((await app.inject({url:`/api/v1/catalog/items/${p.id}/media/jobs`,headers:foreign})).statusCode).toBe(404);
 const id=(await queue(p.id,body())).json().id;await db.product.update({where:{id:p.id},data:{version:2}});await processMediaJob(id);
 expect(await db.mediaSourceJob.findUniqueOrThrow({where:{id}})).toMatchObject({status:'DLQ',lastError:'STALE_VERSION'});expect(await db.mediaIngestion.count({where:{productId:p.id}})).toBe(0);
});
it('reclaims expired leases and rechecks the original requester authorization',async()=>{
 const p=await product(),id=(await queue(p.id,body())).json().id;await db.mediaSourceJob.update({where:{id},data:{status:'PROCESSING',leaseToken:'expired',leaseUntil:new Date(0)}});expect((await due(id)).status).toBe('SUCCEEDED');
 const template=await db.user.findUniqueOrThrow({where:{email:'admin@maisonazure.demo'}}),actor=await db.user.create({data:{email:`dam-${randomUUID()}@demo.invalid`,name:'Temporary requester',passwordHash:template.passwordHash,role:template.role,companyId:template.companyId,partnerId:template.partnerId,markets:template.markets}}),next=await product();
 const job=await queueMediaJob(actor,next.id,body(),'test-revoked');await db.user.update({where:{id:actor.id},data:{active:false}});await processMediaJob(job.id);
 expect(await db.mediaSourceJob.findUniqueOrThrow({where:{id:job.id}})).toMatchObject({status:'DLQ',lastError:'DAM_ACTOR_REVOKED'});expect(await db.mediaIngestion.count({where:{productId:next.id}})).toBe(0);
});
