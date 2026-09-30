import {z} from 'zod';
import {Prisma} from '@prisma/client';
import {type Actor,permit,scope} from '../auth/policy';
import {db} from '../db/client';
import {transaction,audit} from '../db/transaction';
import {digest} from '../auth/security';
import {validateDestination} from '../integrations/destination';
import {damReference} from '../media/dam';
import {requireCondition} from './errors';
import {urlMediaInput,validateImageSource} from '../media/url';
import {archiveBytes,zipMediaInput} from '../media/archive';
import {bytesHash} from '../media/image';
import {isDemoRuntime,inlineMockOrigin} from '../config/hosted-demo';
export const mediaJobInput=z.object({requestId:z.string().uuid(),expectedVersion:z.number().int().positive(),sourceRef:damReference,demoFailures:z.number().int().min(0).max(3).default(0)}).strict();
export const urlMediaJobInput=urlMediaInput.extend({demoFailures:z.number().int().min(0).max(3).default(0)}).strict();
export const zipMediaJobInput=zipMediaInput.extend({demoFailures:z.number().int().min(0).max(3).default(0)}).strict();
export const mediaJobReplay=z.object({expectedVersion:z.number().int().positive(),reason:z.string().trim().min(5).max(1000)}).strict();
export const mediaJobSelect={id:true,productId:true,sourceType:true,sourceRef:true,expectedVersion:true,demoFailures:true,status:true,version:true,attempts:true,cycleAttempts:true,replayCount:true,availableAt:true,receiptId:true,receiptIds:true,lastError:true,createdAt:true,updatedAt:true} as const;
async function owned(actor:Actor,id:string){permit(actor,'catalog');const p=await db.product.findFirst({where:{id,...scope(actor)}});requireCondition(p,'NOT_FOUND','Product not found',404);return p;}
export async function listMediaJobs(actor:Actor,id:string){await owned(actor,id);return {items:await db.mediaSourceJob.findMany({where:{productId:id,...scope(actor)},select:mediaJobSelect,orderBy:{createdAt:'desc'},take:50})};}
export async function queueMediaJob(actor:Actor,id:string,input:z.infer<typeof mediaJobInput>,correlationId:string){
 return queueSourceJob(actor,id,input,correlationId,'DAM',digest(JSON.stringify(input)),()=>validateDestination({destinationMode:'mock',destinationOrigin:process.env.MOCK_ORIGIN??'http://127.0.0.1:4100'}).destinationOrigin);
}
export async function queueUrlMediaJob(actor:Actor,id:string,input:z.infer<typeof urlMediaJobInput>,correlationId:string){
 return queueSourceJob(actor,id,{...input,sourceRef:input.url},correlationId,'URL',digest(JSON.stringify({operation:'queue-url',...input})),()=>{const source=validateImageSource(input.url);return source.url.protocol==='mock:'?inlineMockOrigin:source.url.origin;});
}
export async function queueZipMediaJob(actor:Actor,id:string,input:z.infer<typeof zipMediaJobInput>,correlationId:string){
 return queueSourceJob(actor,id,{...input,sourceRef:input.fileName},correlationId,'ZIP',digest(JSON.stringify({operation:'queue-zip',...input})),()=> 'local://quarantined-archive',()=>{
  const bytes=archiveBytes(input.base64);return {bytes,byteSize:bytes.length,checksum:bytesHash(bytes)};
 });
}
async function queueSourceJob(actor:Actor,id:string,input:{requestId:string;expectedVersion:number;sourceRef:string;demoFailures:number},correlationId:string,sourceType:'DAM'|'URL'|'ZIP',hash:string,destination:()=>string,archive?:()=>{bytes:Buffer;byteSize:number;checksum:string}){
 await owned(actor,id);requireCondition(isDemoRuntime(),'DAM_DISABLED','Source jobs require explicit demo mode',503);
 const run=()=>transaction(async tx=>{
  const p=await tx.product.findFirst({where:{id,...scope(actor)}});requireCondition(p,'NOT_FOUND','Product not found',404);
  const previous=await tx.mediaSourceJob.findUnique({where:{companyId_requestId:{companyId:actor.companyId,requestId:input.requestId}}});
  if(previous){requireCondition(previous.productId===id&&previous.partnerId===p.partnerId&&previous.requestHash===hash,'MEDIA_REQUEST_CONFLICT','Job request ID is already bound to different input',409);return tx.mediaSourceJob.findUniqueOrThrow({where:{id:previous.id},select:mediaJobSelect});}
  requireCondition(p.version===input.expectedVersion,'STALE_VERSION','Refresh the product before queuing imagery',409);requireCondition(['DRAFT','CHANGES_REQUESTED','REJECTED'].includes(p.status),'MEDIA_EDIT_LOCKED','Only draft or returned products accept new imagery',409);
  const job=await tx.mediaSourceJob.create({data:{companyId:p.companyId,partnerId:p.partnerId,market:p.market,productId:id,actorId:actor.id,requestId:input.requestId,requestHash:hash,expectedVersion:input.expectedVersion,sourceType,sourceRef:input.sourceRef,destinationOrigin:destination(),correlationId,demoFailures:input.demoFailures},select:mediaJobSelect});
  if(archive){const source=archive();await tx.mediaSourceArchive.create({data:{jobId:job.id,...source,bytes:new Uint8Array(source.bytes)}});}
  await audit(tx,{...actor,markets:[p.market]},correlationId,'media-job.queued',job.id,null,job,`${sourceType} import queued; new imagery requires human review`,p.partnerId);return job;
 });
 try{return await run();}catch(e){if(e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2002')return run();throw e;}
}
export async function replayMediaJob(actor:Actor,id:string,input:z.infer<typeof mediaJobReplay>,correlationId:string){
 permit(actor,'catalog',true);
 return transaction(async tx=>{
  const job=await tx.mediaSourceJob.findFirst({where:{id,...scope(actor)}});requireCondition(job,'NOT_FOUND','Media job not found',404);
  requireCondition(job.status==='DLQ'&&job.version===input.expectedVersion,'MEDIA_JOB_STATE','Refresh the job; only the current dead-letter version can be replayed',409);
  const next=await tx.mediaSourceJob.update({where:{id},data:{status:'PENDING',version:{increment:1},cycleAttempts:0,replayCount:{increment:1},availableAt:new Date(),leaseUntil:null,leaseToken:null,lastError:null},select:mediaJobSelect});
  await audit(tx,{...actor,markets:[job.market]},correlationId,'media-job.replayed',id,{status:job.status,attempts:job.attempts},next,input.reason,job.partnerId);return next;
 });
}
