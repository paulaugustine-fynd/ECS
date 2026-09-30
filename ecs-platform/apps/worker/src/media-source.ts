import {randomUUID} from 'node:crypto';
import {db} from '../../../packages/db/client';
import {transaction,audit} from '../../../packages/db/transaction';
import {permit,scope} from '../../../packages/auth/policy';
import {DomainError,requireCondition} from '../../../packages/domain/errors';
import {fetchDamAsset} from '../../../packages/media/dam';
import {uploadProductMedia} from '../../../packages/domain/catalog-media';
import {fetchImageSource} from '../../../packages/media/url';
import {importMediaZip} from '../../../packages/domain/catalog-media-zip';
import {bytesHash} from '../../../packages/media/image';
import {isDemoRuntime} from '../../../packages/config/hosted-demo';
const due=()=>({availableAt:{lte:new Date()},OR:[{status:{in:['PENDING','RETRY']}},{status:'PROCESSING',leaseUntil:{lt:new Date()}}]});
export async function processMediaJob(id:string){
 const leaseToken=randomUUID();
 const claimed=await db.mediaSourceJob.updateMany({where:{id,...due()},data:{status:'PROCESSING',leaseToken,leaseUntil:new Date(Date.now()+60000),attempts:{increment:1},cycleAttempts:{increment:1},version:{increment:1}}});if(!claimed.count)return;
 const job=await db.mediaSourceJob.findUniqueOrThrow({where:{id}});const actor=await db.user.findUniqueOrThrow({where:{id:job.actorId}}),owner={...actor,companyId:job.companyId,partnerId:job.partnerId,markets:[job.market]};
 try{
  await transaction(tx=>audit(tx,owner,job.correlationId,'media-job.attempt',id,null,{attempt:job.attempts,cycleAttempt:job.cycleAttempts},`${job.sourceType} worker acquired lease`,job.partnerId));
  const requestId=job.sourceType==='ZIP'?job.id:`${job.id}:${job.sourceType.toLowerCase()}`;
  const existing=await db.mediaIngestion.findMany({where:{companyId:job.companyId,requestId:job.sourceType==='ZIP'?{startsWith:`${requestId}:zip:`}:requestId},orderBy:{requestId:'asc'}});
  let receiptIds=existing.map(r=>r.id);
  if(existing.length)requireCondition(existing.length<=10&&existing.every(r=>r.productId===job.productId&&r.partnerId===job.partnerId&&r.market===job.market&&r.sourceType===job.sourceType&&r.requestHash===job.requestHash),'DAM_EVIDENCE_MISMATCH','Stored media evidence does not match the job');
  else{
   requireCondition(isDemoRuntime()&&(process.env.DOCUMENT_SCAN_MODE??'mock')==='mock','MEDIA_SCANNER_UNAVAILABLE','Source imports require explicit demo mode and the configured mock scanner',503);
   requireCondition(actor.active&&actor.companyId===job.companyId&&actor.markets.includes(job.market),'DAM_ACTOR_REVOKED','Original requester is no longer authorized',403);permit(actor,'catalog');
   const product=await db.product.findFirst({where:{id:job.productId,...scope(actor)}});requireCondition(product&&product.partnerId===job.partnerId&&product.market===job.market,'NOT_FOUND','Product is no longer in requester scope',404);
   requireCondition(product.version===job.expectedVersion,'STALE_VERSION','Product changed while the job was queued; create a new import for the reviewed version',409);
   requireCondition(['DRAFT','CHANGES_REQUESTED','REJECTED'].includes(product.status),'MEDIA_EDIT_LOCKED','Product is no longer editable',409);
   requireCondition(job.cycleAttempts<=3,'DAM_RETRY_EXHAUSTED','Attempt budget exhausted after an interrupted lease',400);
   if(job.attempts<=job.demoFailures)throw new DomainError('DAM_TRANSIENT','Explicit demo source failure simulation',503);
   if(job.sourceType==='ZIP'){
    requireCondition(job.destinationOrigin==='local://quarantined-archive','MEDIA_ZIP_BINDING','ZIP job must use the captured private archive',400);
    const archive=await db.mediaSourceArchive.findUnique({where:{jobId:job.id}});
    requireCondition(archive&&archive.byteSize===archive.bytes.length&&archive.checksum===bytesHash(Buffer.from(archive.bytes)),'MEDIA_ZIP_EVIDENCE','Private source archive is missing or its checksum does not match',400);
    const result=await importMediaZip(actor,job.productId,{requestId,expectedVersion:job.expectedVersion,fileName:job.sourceRef,base64:Buffer.from(archive.bytes).toString('base64')},job.correlationId,0,job.requestHash);
    receiptIds=result.receipts.map(r=>r.id);
   }else{
   let image:{fileName:string;base64:string;ref:string;kind:'DAM'|'URL'};
   if(job.sourceType==='URL'){
    const source=await fetchImageSource(job.sourceRef,job.destinationOrigin);
    image={fileName:source.fileName,base64:source.bytes.toString('base64'),ref:job.sourceRef,kind:'URL'};
   }else{
    requireCondition(job.sourceType==='DAM','MEDIA_SOURCE_TYPE','Unknown source job type',400);
    const source=await fetchDamAsset(job.sourceRef,job.destinationOrigin);
    image={fileName:source.fileName,base64:source.base64,ref:`demo-dam://${source.reference}@${source.revision}`,kind:'DAM'};
   }
   const result=await uploadProductMedia(actor,job.productId,{requestId,expectedVersion:job.expectedVersion,fileName:image.fileName,base64:image.base64},job.correlationId,0,{ref:image.ref,requestHash:job.requestHash,kind:image.kind});
   receiptIds=[result.receipt.id];
   }
  }
  const receiptId=receiptIds[0];
  await transaction(async tx=>{
   const changed=await tx.mediaSourceJob.updateMany({where:{id,status:'PROCESSING',leaseToken},data:{status:'SUCCEEDED',receiptId,receiptIds,lastError:null,leaseToken:null,leaseUntil:null,version:{increment:1}}});
   if(changed.count)await audit(tx,owner,job.correlationId,'media-job.succeeded',id,null,{receiptId,receiptIds,attempt:job.attempts},'Private imagery ingested; new attachments await human review',job.partnerId);
  });
 }catch(error){
  const code=error instanceof DomainError?error.code:'DAM_WORKER_FAILURE',retry=['DAM_TRANSIENT','DAM_WORKER_FAILURE','MEDIA_URL_TRANSIENT','MEDIA_URL_DNS','MEDIA_URL_NETWORK','MEDIA_URL_TIMEOUT','MEDIA_URL_TRUNCATED'].includes(code)&&job.cycleAttempts<3;
  await transaction(async tx=>{
   const changed=await tx.mediaSourceJob.updateMany({where:{id,status:'PROCESSING',leaseToken},data:{status:retry?'RETRY':'DLQ',lastError:code,availableAt:new Date(Date.now()+1000*2**(job.cycleAttempts-1)),leaseToken:null,leaseUntil:null,version:{increment:1}}});
   if(changed.count)await audit(tx,owner,job.correlationId,retry?'media-job.retry':'media-job.dead-letter',id,null,{attempt:job.attempts,error:code},'Import failure retained; no error response body is logged',job.partnerId);
  });
 }
}
export async function pollMediaJobs(){for(const job of await db.mediaSourceJob.findMany({where:due(),select:{id:true},orderBy:{createdAt:'asc'},take:10}))await processMediaJob(job.id);}
