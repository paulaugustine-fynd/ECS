import {z} from 'zod';
import {Prisma} from '@prisma/client';
import type {Actor} from '../auth/policy';
import {permit,scope} from '../auth/policy';
import {digest} from '../auth/security';
import {db} from '../db/client';
import {audit,transaction} from '../db/transaction';
import {uploadMediaInput,imageBytes,sanitizeImage} from '../media/image';
import {requireCondition} from './errors';

export const returnEvidenceInput=uploadMediaInput.extend({notes:z.string().trim().min(5).max(1000)}).strict();
export const returnEvidenceSelect={id:true,returnId:true,returnVersion:true,fileName:true,notes:true,checksum:true,originalChecksum:true,contentType:true,byteSize:true,width:true,height:true,scanStatus:true,actorId:true,createdAt:true} as const;
async function allowedReturn(actor:Actor,id:string){permit(actor,'fulfilment');const r=await db.returnCase.findFirst({where:{id,...scope(actor)}});requireCondition(r,'NOT_FOUND','Return not found',404);return r;}
export async function listReturnEvidence(actor:Actor,id:string){await allowedReturn(actor,id);return {items:await db.returnEvidence.findMany({where:{returnId:id,...scope(actor)},select:returnEvidenceSelect,orderBy:[{createdAt:'asc'},{id:'asc'}]})};}
export async function readReturnEvidence(actor:Actor,id:string){permit(actor,'fulfilment');const e=await db.returnEvidence.findFirst({where:{id,...scope(actor)}});requireCondition(e,'NOT_FOUND','Inspection photo not found',404);await allowedReturn(actor,e.returnId);return Buffer.from(e.bytes);}
export async function uploadReturnEvidence(actor:Actor,id:string,input:z.infer<typeof returnEvidenceInput>,correlationId:string,retry=0):Promise<{evidence:Prisma.ReturnEvidenceGetPayload<{select:typeof returnEvidenceSelect}>;replayed:boolean}>{
 permit(actor,'fulfilment',true);await allowedReturn(actor,id);
 const requestHash=digest(JSON.stringify({returnId:id,...input})),key={companyId:actor.companyId,actorId:actor.id,requestId:input.requestId};
 const previous=await db.returnEvidence.findUnique({where:{companyId_actorId_requestId:key}});
 if(previous){requireCondition(previous.returnId===id&&previous.requestHash===requestHash,'EVIDENCE_REQUEST_CONFLICT','Upload reference already belongs to different evidence',409);return {evidence:await db.returnEvidence.findUniqueOrThrow({where:{id:previous.id},select:returnEvidenceSelect}),replayed:true};}
 const image=await sanitizeImage(imageBytes(input.base64),input.fileName);
 try{return await transaction(async tx=>{
  const r=await tx.returnCase.findFirst({where:{id,...scope(actor)}});requireCondition(r,'NOT_FOUND','Return not found',404);
  const prior=await tx.returnEvidence.findUnique({where:{companyId_actorId_requestId:key},select:{...returnEvidenceSelect,requestHash:true}});
  if(prior){requireCondition(prior.returnId===id&&prior.requestHash===requestHash,'EVIDENCE_REQUEST_CONFLICT','Upload reference already belongs to different evidence',409);const {requestHash:discard,...evidence}=prior;void discard;return {evidence,replayed:true};}
  requireCondition(r.status==='RECEIVED','EVIDENCE_LOCKED','Record receipt before uploading; evidence is locked after QC',409);
  requireCondition(r.version===input.expectedVersion,'STALE_RETURN','Refresh the return before attaching inspection evidence',409);
  const existing=await tx.returnEvidence.findMany({where:{returnId:id},select:{checksum:true}});
  requireCondition(existing.length<6,'EVIDENCE_LIMIT','At most six inspection photos per return',400);
  requireCondition(!existing.some(e=>e.checksum===image.checksum),'EVIDENCE_DUPLICATE','These pixels are already retained for this return',409);
  const {quality:discard,...pixels}=image;void discard;
  const evidence=await tx.returnEvidence.create({data:{...pixels,...key,returnId:id,partnerId:r.partnerId,market:r.market,correlationId,requestHash,returnVersion:r.version+1,fileName:input.fileName,notes:input.notes},select:returnEvidenceSelect});
  await tx.returnCase.update({where:{id},data:{version:{increment:1}}});
  await audit(tx,{...actor,markets:[r.market]},correlationId,'return.evidence-upload',id,{version:r.version},{version:r.version+1,evidenceId:evidence.id,checksum:evidence.checksum,notes:evidence.notes},input.notes,r.partnerId);
  return {evidence,replayed:false};
 });}catch(error){if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002'&&retry<2)return uploadReturnEvidence(actor,id,input,correlationId,retry+1);throw error;}
}
