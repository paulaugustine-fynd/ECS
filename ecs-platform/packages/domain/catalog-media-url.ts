import type {z} from 'zod';
import {type Actor,permit,scope} from '../auth/policy';
import {digest} from '../auth/security';
import {db} from '../db/client';
import {requireCondition} from './errors';
import {assetSelect,receiptSelect,uploadProductMedia} from './catalog-media';
import {fetchImageSource,urlMediaInput} from '../media/url';
export {urlMediaInput};
export async function importMediaUrl(actor:Actor,id:string,input:z.infer<typeof urlMediaInput>,correlationId:string){
 permit(actor,'catalog');const p=await db.product.findFirst({where:{id,...scope(actor)}});requireCondition(p,'NOT_FOUND','Product not found',404);
 const requestId=`${input.requestId}:url`,requestHash=digest(JSON.stringify(input));
 const previous=await db.mediaIngestion.findUnique({where:{companyId_requestId:{companyId:actor.companyId,requestId}}});
 if(previous){requireCondition(previous.productId===id&&previous.partnerId===p.partnerId&&previous.requestHash===requestHash,'MEDIA_REQUEST_CONFLICT','Request ID is bound to another image source',409);return {receipt:await db.mediaIngestion.findUniqueOrThrow({where:{id:previous.id},select:{...receiptSelect,asset:{select:assetSelect}}}),replayed:true};}
 requireCondition(p.version===input.expectedVersion,'STALE_VERSION','Refresh the product before importing imagery',409);
 requireCondition(['DRAFT','CHANGES_REQUESTED','REJECTED'].includes(p.status),'MEDIA_EDIT_LOCKED','Only draft or returned products accept source imagery',409);
 // No vendor-supplied network target is contacted before ownership/state checks.
 requireCondition(process.env.DEMO_MODE==='true'&&(process.env.DOCUMENT_SCAN_MODE??'mock')==='mock','MEDIA_SCANNER_UNAVAILABLE','Only explicit local mock scanning is implemented',503);
 const source=await fetchImageSource(input.url);
 return uploadProductMedia(actor,id,{requestId,expectedVersion:input.expectedVersion,fileName:source.fileName,base64:source.bytes.toString('base64')},correlationId,0,{ref:input.url,requestHash});
}
