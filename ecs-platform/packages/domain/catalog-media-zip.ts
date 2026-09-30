import type {z} from 'zod';
import {Prisma} from '@prisma/client';
import {type Actor,permit,scope} from '../auth/policy';
import {digest} from '../auth/security';
import {db} from '../db/client';
import {audit,json,transaction} from '../db/transaction';
import {requireCondition} from './errors';
import type {CatalogData} from './catalog';
import {assetSelect,receiptSelect} from './catalog-media';
import {zipMediaInput,parseMediaArchive} from '../media/archive';
import {sanitizeImage,bytesHash} from '../media/image';
export {zipMediaInput};
export async function importMediaZip(actor:Actor,id:string,input:z.infer<typeof zipMediaInput>,correlationId:string,retry=0,jobRequestHash?:string):Promise<{receipts:Prisma.MediaIngestionGetPayload<{select:typeof selection}>[];replayed:boolean;archiveChecksum:string}>{
 permit(actor,'catalog');const p=await db.product.findFirst({where:{id,...scope(actor)}});requireCondition(p,'NOT_FOUND','Product not found',404);
 const prefix=`${input.requestId}:zip:`,requestHash=jobRequestHash??digest(JSON.stringify(input));
 const previous=await db.mediaIngestion.findMany({where:{companyId:actor.companyId,requestId:{startsWith:prefix}},orderBy:{requestId:'asc'}});
 if(previous.length){requireCondition(previous.every(r=>r.productId===id&&r.partnerId===p.partnerId&&r.requestHash===requestHash),'MEDIA_REQUEST_CONFLICT','Request ID is already bound to different ZIP content',409);return {receipts:await db.mediaIngestion.findMany({where:{id:{in:previous.map(r=>r.id)}},select:selection,orderBy:{requestId:'asc'}}),replayed:true,archiveChecksum:bytesHash(Buffer.from(input.base64,'base64'))};}
 requireCondition(p.version===input.expectedVersion,'STALE_VERSION','Refresh the product before importing',409);
 requireCondition(['DRAFT','CHANGES_REQUESTED','REJECTED'].includes(p.status),'MEDIA_EDIT_LOCKED','Only draft or returned products accept ZIP imports',409);
 const archive=await parseMediaArchive(input.base64),images:{fileName:string;image:Awaited<ReturnType<typeof sanitizeImage>>}[]=[];
 for(const source of archive.images)images.push({fileName:source.fileName,image:await sanitizeImage(source.bytes,source.fileName)});
 try{return await transaction(async tx=>{
  const product=await tx.product.findFirst({where:{id,...scope(actor)}});requireCondition(product,'NOT_FOUND','Product not found',404);
  requireCondition(product.version===input.expectedVersion,'STALE_VERSION','Refresh the product before importing',409);
  requireCondition(['DRAFT','CHANGES_REQUESTED','REJECTED'].includes(product.status),'MEDIA_EDIT_LOCKED','Only draft or returned products accept ZIP imports',409);
  const data=product.data as CatalogData,media=[...(data.media??[])],pending=[];
  for(const [index,{fileName,image}] of images.entries()){
   const {originalChecksum,...assetData}=image;
   const asset=await tx.mediaAsset.findUnique({where:{companyId_partnerId_market_checksum:{companyId:product.companyId,partnerId:product.partnerId,market:product.market,checksum:image.checksum}}})??await tx.mediaAsset.create({data:{...assetData,quality:json(image.quality),companyId:product.companyId,partnerId:product.partnerId,market:product.market}});
   const duplicate=media.some(m=>m.assetId===asset.id);if(!duplicate)media.push({url:`/api/v1/catalog/media/${asset.id}/content`,assetId:asset.id,checksum:asset.checksum,width:asset.width,height:asset.height,status:'PENDING'});
   pending.push({assetId:asset.id,originalChecksum,duplicate,requestId:`${prefix}${index}`,sourceRef:`${input.fileName}#${fileName}`});
  }
  requireCondition(media.length<=10,'MEDIA_LIMIT','The ZIP would exceed ten attached images; remove unwanted draft images first',400);
  const version=product.version+(pending.some(r=>!r.duplicate)?1:0),receipts=[];
  if(version!==product.version)await tx.product.update({where:{id},data:{version,status:'DRAFT',data:json({...data,media})}});
  for(const row of pending)receipts.push(await tx.mediaIngestion.create({data:{...row,companyId:product.companyId,partnerId:product.partnerId,market:product.market,productId:id,requestHash,sourceType:'ZIP',actorId:actor.id,correlationId,productVersion:version},select:selection}));
  await audit(tx,{...actor,markets:[product.market]},correlationId,'catalog.media-zip',id,{version:product.version},{version,archiveChecksum:archive.checksum,manifest:archive.manifest,receiptIds:receipts.map(r=>r.id)},'ZIP imagery validated atomically; new attachments await ATI review',product.partnerId);
  return {receipts,replayed:false,archiveChecksum:archive.checksum};
 });}catch(e){
  // Another copy may commit between our initial replay check and transaction.
  if(retry<2&&e instanceof Prisma.PrismaClientKnownRequestError&&e.code==='P2002')return importMediaZip(actor,id,input,correlationId,retry+1,jobRequestHash);
  if(retry<2&&e instanceof Error&&'code' in e&&e.code==='STALE_VERSION'){const found=await db.mediaIngestion.count({where:{companyId:actor.companyId,requestId:{startsWith:prefix}}});if(found)return importMediaZip(actor,id,input,correlationId,retry+1,jobRequestHash);}
  throw e;
 }
}
const selection={...receiptSelect,asset:{select:assetSelect}} as const;
