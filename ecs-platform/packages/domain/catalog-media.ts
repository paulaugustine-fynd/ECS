import {z} from 'zod';
import type {Actor} from '../auth/policy';
import {permit,scope} from '../auth/policy';
import {db} from '../db/client';
import {transaction,audit,json} from '../db/transaction';
import {requireCondition} from './errors';
import {uploadMediaInput,imageBytes,sanitizeImage,mediaRequestHash} from '../media/image';
import type {CatalogData} from './catalog';
import {Prisma} from '@prisma/client';
import {openException} from './exception-lifecycle';
import {notifyOperations} from './notifications';
import {digest} from '../auth/security';
export {uploadMediaInput};
export const replaceMediaInput=uploadMediaInput.extend({replaceUrl:z.string().min(1).max(2048),reason:z.string().trim().min(5).max(1000)}).strict();
type Replacement={replaceUrl:string;reason:string};
export async function replaceProductMedia(actor:Actor,id:string,input:z.infer<typeof replaceMediaInput>,correlationId:string){
 const {replaceUrl,reason,...upload}=input;
 return uploadProductMedia(actor,id,upload,correlationId,0,undefined,{replaceUrl,reason});
}
const mediaDecisionBase={expectedVersion:z.number().int().positive(),url:z.string().min(1).max(2048),reason:z.string().trim().min(5).max(1000)};
export const mediaDecisionInput=z.discriminatedUnion('action',[
 z.object({...mediaDecisionBase,action:z.literal('approve')}).strict(),
 z.object({...mediaDecisionBase,action:z.literal('reject')}).strict(),
 z.object({...mediaDecisionBase,action:z.literal('remove')}).strict(),
 z.object({...mediaDecisionBase,action:z.literal('move'),position:z.number().int().min(0).max(9)}).strict(),
]);
export async function decideProductMedia(actor:Actor,id:string,input:z.infer<typeof mediaDecisionInput>,correlationId:string){
 permit(actor,'catalog',input.action==='approve'||input.action==='reject');
 return transaction(async tx=>{
  const p=await tx.product.findFirst({where:{id,...scope(actor)}});requireCondition(p,'NOT_FOUND','Product not found',404);
  requireCondition(p.version===input.expectedVersion,'STALE_VERSION','Refresh the product before changing image decisions',409);
  const moderation=input.action==='approve'||input.action==='reject';
  requireCondition((moderation?['DRAFT','CHANGES_REQUESTED','IN_REVIEW']:['DRAFT','CHANGES_REQUESTED','REJECTED']).includes(p.status),'MEDIA_EDIT_LOCKED','This product must be returned for changes before its images can change',409);
  const data=p.data as CatalogData,media=[...(data.media??[])],index=media.findIndex(m=>m.url===input.url);
  requireCondition(index>=0,'NOT_FOUND','Attached image not found',404);
  if(input.action==='move'){
   requireCondition(input.position<media.length&&input.position!==index,'MEDIA_POSITION','Choose a different position within the attached image set',400);
   const [selected]=media.splice(index,1);media.splice(input.position,0,selected);
  }else if(input.action==='remove')media.splice(index,1);
  else media[index]={...media[index],status:input.action==='approve'?'APPROVED':'REJECTED',reason:input.reason};
  const status=input.action==='reject'?'CHANGES_REQUESTED':moderation?p.status:'DRAFT';
  const updated=await tx.product.update({where:{id},data:{version:{increment:1},status,data:json({...data,media,...(input.action==='reject'?{reviewReason:input.reason}:{})})}});
  const event=await audit(tx,{...actor,markets:[p.market]},correlationId,`catalog.media-${input.action}`,id,{version:p.version,media:data.media??[]},{version:updated.version,media},input.reason,p.partnerId);
  if(input.action==='reject'){
   await openException(tx,{companyId:p.companyId,partnerId:p.partnerId,market:p.market,kind:'CATALOG_REVIEW',entityId:id,message:'An image was rejected. Review image feedback, remove or replace it and resubmit.'});
   await notifyOperations(tx,{companyId:p.companyId,partnerId:p.partnerId,market:p.market,category:'CATALOG',severity:'WARNING',entityType:'PRODUCT',entityId:id,eventKey:`media-review:${event.id}`,title:'Product image changes requested',message:`${p.sku}: review the image feedback before resubmitting.`,eventAt:(await tx.demoClock.findUniqueOrThrow({where:{id:'main'}})).now});
  }
  return {id:updated.id,version:updated.version,status:updated.status};
 });
}
export const assetSelect={id:true,companyId:true,partnerId:true,market:true,checksum:true,contentType:true,byteSize:true,width:true,height:true,scanStatus:true,quality:true,createdAt:true} as const;
export const receiptSelect={id:true,assetId:true,productId:true,sourceType:true,sourceRef:true,originalChecksum:true,productVersion:true,duplicate:true,createdAt:true} as const;
const contentUrl=(id:string)=>`/api/v1/catalog/media/${id}/content`;
async function allowedProduct(actor:Actor,id:string){permit(actor,'catalog');const p=await db.product.findFirst({where:{id,...scope(actor)}});requireCondition(p,'NOT_FOUND','Product not found',404);return p;}
export async function listProductMedia(actor:Actor,id:string){await allowedProduct(actor,id);return {items:await db.mediaIngestion.findMany({where:{productId:id,...scope(actor)},select:{...receiptSelect,asset:{select:assetSelect}},orderBy:{createdAt:'desc'},take:100})};}
export async function readMediaContent(actor:Actor,id:string){permit(actor,'catalog');const asset=await db.mediaAsset.findFirst({where:{id,...scope(actor)}});requireCondition(asset,'NOT_FOUND','Image not found',404);return Buffer.from(asset.bytes);}
export async function uploadProductMedia(actor:Actor,id:string,input:z.infer<typeof uploadMediaInput>,correlationId:string,retry=0,source?:{ref:string;requestHash:string;kind?:'URL'|'DAM'},replacement?:Replacement):Promise<{receipt:Awaited<ReturnType<typeof listProductMedia>>['items'][number];replayed:boolean}>{
 await allowedProduct(actor,id);const requestHash=replacement?digest(JSON.stringify({operation:'replace',...input,...replacement})):source?.requestHash??mediaRequestHash(input);
 const existing=await db.mediaIngestion.findUnique({where:{companyId_requestId:{companyId:actor.companyId,requestId:input.requestId}}});
 if(existing){requireCondition(existing.productId===id&&existing.partnerId===(await allowedProduct(actor,id)).partnerId&&existing.requestHash===requestHash,'MEDIA_REQUEST_CONFLICT','Request ID already belongs to different upload content',409);return {receipt:await db.mediaIngestion.findUniqueOrThrow({where:{id:existing.id},select:{...receiptSelect,asset:{select:assetSelect}}}),replayed:true};}
 const image=await sanitizeImage(imageBytes(input.base64),input.fileName);
 try{return await transaction(async tx=>{
  const product=await tx.product.findFirst({where:{id,...scope(actor)}});requireCondition(product,'NOT_FOUND','Product not found',404);
  const prior=await tx.mediaIngestion.findUnique({where:{companyId_requestId:{companyId:actor.companyId,requestId:input.requestId}}});
  if(prior){requireCondition(prior.productId===id&&prior.requestHash===requestHash,'MEDIA_REQUEST_CONFLICT','Request ID already belongs to different upload content',409);return {receipt:await tx.mediaIngestion.findUniqueOrThrow({where:{id:prior.id},select:{...receiptSelect,asset:{select:assetSelect}}}),replayed:true};}
  requireCondition(product.version===input.expectedVersion,'STALE_VERSION','Refresh the product before uploading',409);
  requireCondition(['DRAFT','CHANGES_REQUESTED','REJECTED'].includes(product.status),'MEDIA_EDIT_LOCKED','Return the item to a draft before changing media; published content is never overwritten',409);
  const data=product.data as CatalogData,media=data.media??[],replaceIndex=replacement?media.findIndex(m=>m.url===replacement.replaceUrl):-1;
  if(replacement)requireCondition(replaceIndex>=0,'NOT_FOUND','Image to replace is no longer attached',404);
  const {originalChecksum,...assetData}=image;
  const asset=await tx.mediaAsset.findUnique({where:{companyId_partnerId_market_checksum:{companyId:product.companyId,partnerId:product.partnerId,market:product.market,checksum:image.checksum}}})??await tx.mediaAsset.create({data:{...assetData,quality:json(image.quality),companyId:product.companyId,partnerId:product.partnerId,market:product.market}});
  const duplicate=media.some(m=>m.assetId===asset.id||m.url===contentUrl(asset.id));
  if(replacement)requireCondition(!duplicate,'MEDIA_REPLACEMENT_DUPLICATE','Choose different pixels that are not already attached to this product',409);
  requireCondition(replacement||duplicate||media.length<10,'MEDIA_LIMIT','At most 10 images can be attached to a product',400);
  const productVersion=product.version+(duplicate?0:1);
  const attachment={url:contentUrl(asset.id),assetId:asset.id,checksum:asset.checksum,width:asset.width,height:asset.height,status:'PENDING'};
  const nextMedia=replacement?media.map((m,index)=>index===replaceIndex?attachment:m):[...media,attachment];
  if(!duplicate)await tx.product.update({where:{id},data:{version:productVersion,status:'DRAFT',data:json({...data,media:nextMedia})}});
  const receipt=await tx.mediaIngestion.create({data:{companyId:product.companyId,partnerId:product.partnerId,market:product.market,productId:id,assetId:asset.id,requestId:input.requestId,requestHash,originalChecksum,sourceType:source?(source.kind??'URL'):'UPLOAD',sourceRef:source?.ref??input.fileName,actorId:actor.id,correlationId,productVersion,duplicate},select:{...receiptSelect,asset:{select:assetSelect}}});
  await audit(tx,{...actor,markets:[product.market]},correlationId,replacement?'catalog.media-replace':'catalog.media-upload',id,{version:product.version,...(replacement?{image:media[replaceIndex],position:replaceIndex}:{})},{receiptId:receipt.id,assetId:asset.id,checksum:asset.checksum,version:productVersion,duplicate,...(replacement?{image:attachment,position:replaceIndex}:{})},replacement?.reason??'Private raster image attached pending human moderation',product.partnerId);
  return {receipt,replayed:false};
 });}catch(error){
  // Concurrent uploads can race on the owned checksum or request key. Re-read
  // committed evidence with a new transaction; never retry arbitrary failures.
  if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002'&&retry<2)return uploadProductMedia(actor,id,input,correlationId,retry+1,source,replacement);
  throw error;
 }
}
