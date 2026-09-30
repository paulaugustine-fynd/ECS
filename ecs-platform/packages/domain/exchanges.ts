import {z} from 'zod';
import Decimal from 'decimal.js';
import {Prisma,type ExchangeRequest} from '@prisma/client';
import {type Actor,permit,scope} from '../auth/policy';
import {audit,json,transaction} from '../db/transaction';
import {digest} from '../auth/security';
import {DomainError,requireCondition} from './errors';
import {orderInput,planOrder,type ReservedLine} from './orders';

export const exchangePreviewInput=z.object({
 replacementProductId:z.string().min(1).max(100),
 expectedReturnVersion:z.number().int().positive(),
 routingPolicy:z.enum(['HYBRID_WATERFALL','WAREHOUSE_FIRST','STORE_FIRST','BRAND_FIRST']).default('HYBRID_WATERFALL'),
}).strict();
type VariantData={parentSku?:string;attributes?:Record<string,unknown>};
const variant=(data:unknown)=>{
 const d=data as VariantData;
 return {parentSku:typeof d?.parentSku==='string'?d.parentSku.trim():'',size:typeof d?.attributes?.size==='string'?d.attributes.size:null};
};

export async function exchangeOptions(actor:Actor,id:string){
 permit(actor,'fulfilment');
 return transaction(async tx=>{
  const r=await tx.returnCase.findFirst({where:{id,...scope(actor)}});requireCondition(r,'NOT_FOUND','Return not found',404);
  const original=await tx.product.findFirst({where:{id:r.productId,...scope(actor)}});requireCondition(original,'NOT_FOUND','Original product not found',404);
  const parent=variant(original.data).parentSku;
  const products=parent?await tx.product.findMany({where:{companyId:r.companyId,partnerId:r.partnerId,market:r.market,currency:r.currency,brand:original.brand,category:original.category,id:{not:original.id},data:{path:['parentSku'],equals:parent}},orderBy:{sku:'asc'},take:51}):[];
  return {returnId:r.id,returnVersion:r.version,hasMore:products.length>50,items:products.slice(0,50).map(p=>({id:p.id,sku:p.sku,title:p.titleEn,size:variant(p.data).size,unitPrice:p.price.toFixed(2),currency:p.currency,status:p.status,saleStatus:p.saleStatus})),notice:'Same-partner sibling variants only. Inclusion is not approval or availability; preview each selection before requesting an exchange.'};
 });
}

/** A read-only prerequisite to linked replacement orchestration. No stock, money,
 * delivered line, return, outbox or audit record is changed by a preview. */
export async function previewExchange(actor:Actor,id:string,input:z.infer<typeof exchangePreviewInput>){
 permit(actor,'fulfilment');
 return transaction(tx=>previewExchangeTx(tx,actor,id,input));
}
export async function previewExchangeTx(tx:Prisma.TransactionClient,actor:Actor,id:string,input:z.infer<typeof exchangePreviewInput>,reviewingRequestId?:string){
  const r=await tx.returnCase.findFirst({where:{id,...scope(actor)}});
  requireCondition(r,'NOT_FOUND','Return not found',404);
  requireCondition(r.version===input.expectedReturnVersion,'STALE_RETURN','Refresh the return before previewing a replacement',409);
  const leg=await tx.fulfilmentLeg.findFirst({where:{id:r.legId,...scope(actor)},include:{order:true}});
  requireCondition(leg,'NOT_FOUND','Original shipment not found',404);
  const line=(leg.lines as ReservedLine[]).find(l=>l.id===r.lineId&&l.productId===r.productId);
  requireCondition(line&&leg.status==='DELIVERED'&&leg.deliveredAt,'NOT_DELIVERED','Exchange requires the original delivered line',409);
  const original=await tx.product.findFirst({where:{id:r.productId,...scope(actor)}});
  // Always constrain replacement to the return owner, including for ATI users.
  // A foreign SKU must not leak its price, inventory or existence.
  const replacement=await tx.product.findFirst({where:{id:input.replacementProductId,companyId:r.companyId,partnerId:r.partnerId,market:r.market}});
  requireCondition(original&&replacement,'NOT_FOUND','Replacement variant not found',404);
  const from=variant(original.data),to=variant(replacement.data);
  requireCondition(original.id!==replacement.id&&from.parentSku&&from.parentSku===to.parentSku&&original.brand===replacement.brand&&original.category===replacement.category,'NOT_SIBLING_VARIANT','Choose another variant of the same partner, brand and parent style',422);
  requireCondition(r.market==='AE'&&r.currency==='AED'&&replacement.currency==='AED','UNSUPPORTED_EXCHANGE_MARKET','This demo preview supports UAE/AED only',422);
  requireCondition(r.quantity>0&&r.quantity<=line.quantity,'INVALID_RETURN_QUANTITY','Return quantity is inconsistent with the delivered line',409);
  const total=replacement.price.mul(r.quantity),difference=new Decimal(total.toString()).minus(r.refund.toString());
  const blockers:{code:string;message:string}[]=[];
  if(r.status==='REJECTED')blockers.push({code:'RETURN_REJECTED',message:'This return was rejected. No replacement may be created from it.'});
  else if(r.status!=='CLOSED'||r.refundStatus!=='ACKNOWLEDGED'||!r.refundId)blockers.push({code:'RETURN_REFUND_PENDING',message:'The demo refund-and-repurchase flow requires completed inspection and an acknowledged original refund.'});
  if(r.replacementOrderId)blockers.push({code:'REPLACEMENT_ALREADY_LINKED',message:'This return already has a linked replacement order.'});
  if(await tx.exchangeRequest.findFirst({where:{returnId:r.id,status:{notIn:['CANCELLED','REJECTED']},...(reviewingRequestId?{id:{not:reviewingRequestId}}:{})}}))blockers.push({code:'EXCHANGE_ALREADY_REQUESTED',message:'An exchange request already exists for this return. Review or cancel that request before choosing another replacement.'});
  let route:null|{locationId:string;name:string;type:string;available:number;inventoryId:string;inventoryRevision:number}=null;
  try{
   const plannedInput=orderInput.parse({externalOrderId:`exchange-preview:${r.id}`,channel:'BLM-AE',currency:'AED',deliveryCity:leg.order.deliveryCity,routingPolicy:input.routingPolicy,total:total.toFixed(2),lines:[{id:'replacement',sku:replacement.sku,quantity:r.quantity,unitGross:replacement.price.toFixed(2)}]});
   const plan=await planOrder(tx,actor,plannedInput),selected=plan.selected[0];
   const inventory=await tx.inventory.findUniqueOrThrow({where:{id:selected.inventoryId}});
   route={locationId:selected.locationId,name:selected.name,type:selected.type,available:selected.available,inventoryId:inventory.id,inventoryRevision:inventory.revision};
  }catch(error){if(!(error instanceof DomainError))throw error;blockers.push({code:error.code,message:error.message});}
  return {
   returnId:r.id,returnVersion:r.version,asOf:(await tx.demoClock.findUniqueOrThrow({where:{id:'main'}})).now,
   policy:'REFUND_AND_REPURCHASE_DEMO_V1' as const,quantity:r.quantity,currency:'AED' as const,
   original:{orderId:leg.orderId,shipmentId:leg.id,lineId:line.id,productId:original.id,sku:line.sku,size:from.size},
   replacement:{productId:replacement.id,sku:replacement.sku,size:to.size,version:replacement.version,saleVersion:replacement.saleVersion,unitPrice:replacement.price.toFixed(2)},
   pricing:{originalRefund:r.refund.toFixed(2),replacementCharge:total.toFixed(2),difference:difference.toFixed(2),direction:difference.isZero()?'EVEN' as const:difference.isPositive()?'ADDITIONAL_COST' as const:'LOWER_COST' as const,discountsCarriedForward:false as const},
   deliveryCity:leg.order.deliveryCity,routingPolicy:input.routingPolicy,route,blockers,
   eligibility:blockers.length?'BLOCKED' as const:'ELIGIBLE_AT_PREVIEW' as const,
   reserved:false as const,replacementCreated:false as const,
   notice:'Read-only demo preview, not a reservation, payment or live Fynd confirmation. Original refund and a new SFCC-owned charge are separate; the displayed difference is informational, not a charge instruction. Original discounts are not carried forward. ATI must confirm the production price and exchange policy. Creation must recheck all gates atomically; the delivered line remains unchanged.',
  };
}

export const exchangeRequestInput=exchangePreviewInput.extend({
 requestId:z.string().min(8).max(100),reason:z.string().trim().min(5).max(1000),
 expectedProductVersion:z.number().int().positive(),expectedSaleVersion:z.number().int().positive(),
 acceptedReplacementTotal:z.string().regex(/^\d{1,10}\.\d{2}$/),acceptedPolicy:z.literal('REFUND_AND_REPURCHASE_DEMO_V1'),
}).strict();
export const exchangeCancelInput=z.object({expectedVersion:z.number().int().positive(),reason:z.string().trim().min(5).max(1000)}).strict();
export const exchangeReviewInput=exchangeCancelInput.extend({action:z.enum(['approve','reject'])}).strict();
function exchangeView(r:ExchangeRequest&{execution?:{id:string}|null}){
 return {id:r.id,companyId:r.companyId,partnerId:r.partnerId,market:r.market,returnId:r.returnId,replacementProductId:r.replacementProductId,actorId:r.actorId,status:r.status,version:r.version,reason:r.reason,quantity:r.quantity,currency:r.currency,replacementTotal:r.replacementTotal.toFixed(2),snapshot:r.snapshot,createdAt:r.createdAt,cancelledAt:r.cancelledAt,cancelledBy:r.cancelledBy,cancellationReason:r.cancellationReason,reviewAction:r.reviewAction,reviewedAt:r.reviewedAt,reviewedBy:r.reviewedBy,reviewReason:r.reviewReason,reviewSnapshot:r.reviewSnapshot,executionId:r.execution?.id??null};
}
export async function listExchanges(actor:Actor,id:string){
 permit(actor,'fulfilment');return transaction(async tx=>{
  requireCondition(await tx.returnCase.findFirst({where:{id,...scope(actor)}}),'NOT_FOUND','Return not found',404);
  const items=await tx.exchangeRequest.findMany({where:{returnId:id,...scope(actor)},include:{execution:{select:{id:true}}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:101});
  return {items:items.slice(0,100).map(exchangeView),hasMore:items.length>100};
 });
}
/** A durable request for ATI review, never payment/order success. All quote gates
 * are recomputed inside the same serializable transaction as evidence + audit. */
export async function requestExchange(actor:Actor,id:string,input:z.infer<typeof exchangeRequestInput>,correlationId:string,retry=0):Promise<{request:ReturnType<typeof exchangeView>;replayed:boolean}>{
 permit(actor,'fulfilment');const hash=digest(JSON.stringify({returnId:id,...input}));
 try{return await transaction(async tx=>{
  const existing=await tx.exchangeRequest.findFirst({where:{actorId:actor.id,requestId:input.requestId,...scope(actor)},include:{execution:{select:{id:true}}}});
  if(existing){requireCondition(existing.requestHash===hash,'EXCHANGE_ID_CONFLICT','Request reference already used with different exchange content',409);return {request:exchangeView(existing),replayed:true};}
  const quote=await previewExchangeTx(tx,actor,id,input);
  requireCondition(quote.eligibility==='ELIGIBLE_AT_PREVIEW','EXCHANGE_BLOCKED',quote.blockers.map(b=>b.message).join(' '),409);
  requireCondition(quote.replacement.version===input.expectedProductVersion&&quote.replacement.saleVersion===input.expectedSaleVersion&&quote.pricing.replacementCharge===input.acceptedReplacementTotal,'EXCHANGE_QUOTE_CHANGED','Product, sales status or price changed; preview and accept the new terms',409);
  const created=await tx.exchangeRequest.create({data:{companyId:actor.companyId,partnerId:(await tx.returnCase.findUniqueOrThrow({where:{id}})).partnerId,market:'AE',returnId:id,replacementProductId:input.replacementProductId,actorId:actor.id,requestId:input.requestId,requestHash:hash,correlationId,reason:input.reason,quantity:quote.quantity,currency:quote.currency,replacementTotal:quote.pricing.replacementCharge,snapshot:json(quote),createdAt:quote.asOf}});
  await audit(tx,{...actor,markets:['AE']},correlationId,'exchange.request',created.id,null,exchangeView(created),input.reason,created.partnerId);
  return {request:exchangeView(created),replayed:false};
 });}catch(error){
  if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002'){
   if(retry<2)return requestExchange(actor,id,input,correlationId,retry+1);
   throw new DomainError('EXCHANGE_CONFLICT','Another request already owns this return or request reference. Refresh the case.',409);
  }throw error;
 }
}
export async function cancelExchange(actor:Actor,id:string,input:z.infer<typeof exchangeCancelInput>,correlationId:string){
 permit(actor,'fulfilment');return transaction(async tx=>{
  const r=await tx.exchangeRequest.findFirst({where:{id,...scope(actor)},include:{execution:{select:{id:true}}}});requireCondition(r,'NOT_FOUND','Exchange request not found',404);
  // A transport retry of this actor's exact cancellation is harmless, including after a new request.
  if(r.status==='CANCELLED'&&r.version===input.expectedVersion+1&&r.cancelledBy===actor.id&&r.cancellationReason===input.reason)return {request:exchangeView(r),replayed:true};
  requireCondition(r.version===input.expectedVersion,'STALE_EXCHANGE','Refresh the exchange before cancelling',409);
  requireCondition(['REQUESTED','APPROVED'].includes(r.status),'EXCHANGE_CANCELLATION_BLOCKED','Only a review request without a replacement order can be cancelled here',409);
  const original=await tx.returnCase.findUniqueOrThrow({where:{id:r.returnId}});
  requireCondition(!original.replacementOrderId,'EXCHANGE_CANCELLATION_BLOCKED','A replacement order is linked; use its fulfilment cancellation workflow',409);
  const updated=await tx.exchangeRequest.update({where:{id},data:{status:'CANCELLED',version:{increment:1},cancelledAt:(await tx.demoClock.findUniqueOrThrow({where:{id:'main'}})).now,cancelledBy:actor.id,cancellationReason:input.reason}});
  await audit(tx,{...actor,markets:[r.market]},correlationId,'exchange.cancel',id,exchangeView(r),exchangeView(updated),input.reason,r.partnerId);
  return {request:exchangeView(updated),replayed:false};
 });
}

/** ATI decision only: never a stock reservation, payment or replacement-order receipt. */
export async function reviewExchange(actor:Actor,id:string,input:z.infer<typeof exchangeReviewInput>,correlationId:string){
 permit(actor,'fulfilment',true);return transaction(async tx=>{
  const r=await tx.exchangeRequest.findFirst({where:{id,...scope(actor)},include:{execution:{select:{id:true}}}});requireCondition(r,'NOT_FOUND','Exchange request not found',404);
  const decision=input.action==='approve'?'APPROVED':'REJECTED';
  // Preserve an exact decision retry even if the approved request was later cancelled.
  if(input.expectedVersion===1&&r.reviewAction===decision&&r.reviewedBy===actor.id&&r.reviewReason===input.reason)return {request:exchangeView(r),replayed:true};
  requireCondition(r.version===input.expectedVersion,'STALE_EXCHANGE','Refresh the exchange before reviewing',409);
  requireCondition(r.status==='REQUESTED','EXCHANGE_REVIEW_BLOCKED','Only an unreviewed exchange request may be decided',409);
  let quote:Awaited<ReturnType<typeof previewExchangeTx>>|null=null;
  if(decision==='APPROVED'){
   const accepted=r.snapshot as unknown as Awaited<ReturnType<typeof previewExchangeTx>>;
   quote=await previewExchangeTx(tx,actor,r.returnId,{expectedReturnVersion:accepted.returnVersion,replacementProductId:r.replacementProductId,routingPolicy:accepted.routingPolicy},r.id);
   requireCondition(quote.eligibility==='ELIGIBLE_AT_PREVIEW','EXCHANGE_BLOCKED',quote.blockers.map(b=>b.message).join(' '),409);
   requireCondition(quote.replacement.version===accepted.replacement.version&&quote.replacement.saleVersion===accepted.replacement.saleVersion&&quote.pricing.replacementCharge===r.replacementTotal.toFixed(2),'EXCHANGE_QUOTE_CHANGED','Accepted product or price changed. Reject or cancel this request and obtain a newly accepted quote.',409);
  }
  const updated=await tx.exchangeRequest.update({where:{id},data:{status:decision,version:{increment:1},reviewAction:decision,reviewedBy:actor.id,reviewedAt:(await tx.demoClock.findUniqueOrThrow({where:{id:'main'}})).now,reviewReason:input.reason,reviewSnapshot:quote?json(quote):Prisma.DbNull}});
  await audit(tx,{...actor,markets:[r.market]},correlationId,`exchange.${input.action}`,id,exchangeView(r),exchangeView(updated),input.reason,r.partnerId);
  return {request:exchangeView(updated),replayed:false};
 });
}
