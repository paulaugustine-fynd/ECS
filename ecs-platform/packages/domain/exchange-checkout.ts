import {z} from 'zod';
import type {Outbox,Prisma} from '@prisma/client';
import {type Actor,permit,scope} from '../auth/policy';
import {digest} from '../auth/security';
import {audit,enqueue,json,transaction} from '../db/transaction';
import {readEnv} from '../config/env';
import {exchangePaymentPayload,exchangePaymentResult} from '../contracts/exchange-payment';
import {AdapterError} from '../integrations/adapter';
import {previewExchangeTx} from './exchanges';
import {ingestOrder,orderInput,queueFyndOrder} from './orders';
import {requireCondition} from './errors';
import {syncSla} from './sla';

export const exchangeCheckoutInput=z.object({expectedVersion:z.number().int().positive(),reason:z.string().trim().min(5).max(1000),simulatedCustomerAcceptance:z.literal(true)}).strict();
export const executionInclude={order:{include:{legs:true}},exchange:{select:{returnId:true}},cancellation:true} as const;
type Execution=Prisma.ExchangeExecutionGetPayload<{include:typeof executionInclude}>;
export function executionView(e:Execution){
 return {id:e.id,exchangeId:e.exchangeId,returnId:e.exchange.returnId,orderId:e.orderId,externalOrderId:e.order.externalId,orderStatus:e.order.status,paymentStatus:e.paymentStatus,version:e.version,currency:e.currency,amount:e.amount.toFixed(2),createdAt:e.createdAt,holdExpiresAt:e.holdExpiresAt,cancellation:e.cancellation?{id:e.cancellation.id,status:e.cancellation.status,cause:e.cancellation.cause,reason:e.cancellation.reason,createdAt:e.cancellation.createdAt,completedAt:e.cancellation.completedAt,sfccReceipt:e.cancellation.sfccReceipt,fyndReceipt:e.cancellation.fyndReceipt}:null,purchaseReceipt:e.purchaseReceipt,refundReceipt:e.refundReceipt,shipments:e.order.legs.map(l=>({id:l.id,status:l.status,fyndId:l.fyndId,locationId:l.locationId})),actualMoneyMoved:false as const};
}
export async function getExchangeExecution(actor:Actor,id:string){
 permit(actor,'fulfilment');return transaction(async tx=>{
  const e=await tx.exchangeExecution.findFirst({where:{exchangeId:id,...scope(actor)},include:executionInclude});requireCondition(e,'NOT_FOUND','Replacement execution not found',404);return executionView(e);
 });
}
export async function startExchangeCheckout(actor:Actor,id:string,input:z.infer<typeof exchangeCheckoutInput>,correlationId:string){
 permit(actor,'fulfilment',true);const env=readEnv();requireCondition(env.DEMO_MODE==='true'&&env.NODE_ENV!=='production','DEMO_ONLY','Simulated replacement checkout is available only in the local demo',403);
 const hash=digest(JSON.stringify(input));
 return transaction(async tx=>{
  const request=await tx.exchangeRequest.findFirst({where:{id,...scope(actor)}});requireCondition(request,'NOT_FOUND','Exchange request not found',404);
  const existing=await tx.exchangeExecution.findUnique({where:{exchangeId:id},include:executionInclude});
  if(existing){requireCondition(existing.actorId===actor.id&&existing.requestHash===hash,'EXCHANGE_CHECKOUT_CONFLICT','Replacement checkout already started; refresh its execution history',409);return {execution:executionView(existing),replayed:true};}
  requireCondition(request.status==='APPROVED'&&request.version===input.expectedVersion,'EXCHANGE_NOT_APPROVED','A current ATI approval is required to start replacement checkout',409);
  const accepted=request.snapshot as unknown as Awaited<ReturnType<typeof previewExchangeTx>>;
  const quote=await previewExchangeTx(tx,actor,request.returnId,{expectedReturnVersion:accepted.returnVersion,replacementProductId:request.replacementProductId,routingPolicy:accepted.routingPolicy},id);
  requireCondition(quote.eligibility==='ELIGIBLE_AT_PREVIEW','EXCHANGE_BLOCKED',quote.blockers.map(b=>b.message).join(' '),409);
  requireCondition(quote.replacement.version===accepted.replacement.version&&quote.replacement.saleVersion===accepted.replacement.saleVersion&&quote.pricing.replacementCharge===request.replacementTotal.toFixed(2),'EXCHANGE_QUOTE_CHANGED','Accepted terms changed; obtain a new request and ATI approval before checkout',409);
  const scoped={...actor,markets:[request.market]};
  const order=await ingestOrder(tx,scoped,orderInput.parse({externalOrderId:`ECS-EX-${id}`,channel:'BLM-AE',currency:'AED',deliveryCity:quote.deliveryCity,routingPolicy:quote.routingPolicy,total:quote.pricing.replacementCharge,lines:[{id:'replacement',sku:quote.replacement.sku,quantity:quote.quantity,unitGross:quote.replacement.unitPrice}]}),correlationId,{deferFyndForPayment:true});
  const payload=exchangePaymentPayload.parse({schemaVersion:'1.0',exchangeId:id,orderId:order.id,externalOrderId:order.externalId,companyId:request.companyId,partnerId:request.partnerId,market:request.market,currency:request.currency,amount:request.replacementTotal.toFixed(2),policy:accepted.policy,simulatedCustomerAcceptance:true,actualMoneyMoved:false});
  const execution=await tx.exchangeExecution.create({data:{exchangeId:id,orderId:order.id,companyId:request.companyId,partnerId:request.partnerId,market:request.market,actorId:actor.id,reason:input.reason,requestHash:hash,currency:request.currency,amount:request.replacementTotal,paymentPayload:json(payload),createdAt:quote.asOf,holdExpiresAt:new Date(new Date(quote.asOf).getTime()+30*60000)},include:executionInclude});
  await tx.returnCase.update({where:{id:request.returnId},data:{replacementOrderId:order.id,version:{increment:1}}});
  await enqueue(tx,scoped,correlationId,'SFCC','purchaseExchange',execution.id,payload,`exchange:${id}:purchase:v1`,request.partnerId);
  await audit(tx,scoped,correlationId,'exchange.checkout-started',id,null,{executionId:execution.id,orderId:order.id,returnId:request.returnId,paymentStatus:'PENDING',actualMoneyMoved:false},input.reason,request.partnerId);
  return {execution:executionView(execution),replayed:false};
 });
}

/** Validate typed, pinned payment evidence before advancing any local fulfilment. */
export async function assertExchangePaymentJob(tx:Pick<Prisma.TransactionClient,'exchangeExecution'>,job:Outbox){
 const payload=exchangePaymentPayload.safeParse(job.payload);
 const e=await tx.exchangeExecution.findUnique({where:{id:job.aggregateId},include:executionInclude});
 if(!payload.success||!e||job.target!=='SFCC'||e.companyId!==job.companyId||e.partnerId!==job.partnerId||e.market!==job.market||digest(JSON.stringify(exchangePaymentPayload.parse(e.paymentPayload)))!==digest(JSON.stringify(payload.data))||e.paymentStatus!==(job.operation==='purchaseExchange'?'PENDING':'REFUND_PENDING'))throw new AdapterError('Exchange payment job does not match retained owner, state and intent',false);
}

export async function acknowledgeExchangePayment(tx:Prisma.TransactionClient,job:Outbox,result:unknown){
 const parsed=exchangePaymentResult.safeParse(result),expected=exchangePaymentPayload.safeParse(job.payload);
 if(!parsed.success||!expected.success||job.target!=='SFCC'||parsed.data.operation!==job.operation)throw new AdapterError('Invalid versioned exchange payment acknowledgement',false);
 const receipt=parsed.data.payment,{status,reference,...identity}=receipt;
 if(digest(JSON.stringify(identity))!==digest(JSON.stringify(expected.data))||reference!==parsed.data.externalId||status!==(job.operation==='purchaseExchange'?'CAPTURED':'REFUNDED'))throw new AdapterError('Exchange payment identity, amount or status mismatch',false);
 const e=await tx.exchangeExecution.findUniqueOrThrow({where:{id:job.aggregateId},include:executionInclude});
 if(e.companyId!==job.companyId||e.partnerId!==job.partnerId||e.market!==job.market||e.exchangeId!==receipt.exchangeId||e.orderId!==receipt.orderId||digest(JSON.stringify(exchangePaymentPayload.parse(e.paymentPayload)))!==digest(JSON.stringify(expected.data)))throw new AdapterError('Exchange payment ownership or retained payload mismatch',false);
 const actor={id:'integration-worker',companyId:e.companyId,partnerId:e.partnerId,markets:[e.market],role:'ATI_SUPER_ADMIN'};
 if(job.operation==='purchaseExchange'){
  if(e.paymentStatus!=='PENDING')throw new AdapterError('Replacement purchase already advanced',false);
  requireCondition(e.order.status==='AWAITING_PAYMENT'&&e.order.legs.every(l=>l.status==='AWAITING_PAYMENT'),'EXCHANGE_ORDER_STATE','Replacement order is not awaiting payment',409);
  await tx.exchangeExecution.update({where:{id:e.id},data:{paymentStatus:'CAPTURED',version:{increment:1},purchaseReceipt:json(receipt)}});
  await tx.order.update({where:{id:e.orderId},data:{status:'AWAITING_FYND'}});
  await tx.fulfilmentLeg.updateMany({where:{orderId:e.orderId},data:{status:'AWAITING_FYND'}});
  for(const leg of e.order.legs)await syncSla(tx,'SHIPMENT',{...leg,status:'AWAITING_FYND'},job.correlationId);
  await queueFyndOrder(tx,actor,e.orderId,job.correlationId);
 }else{
  requireCondition(e.paymentStatus==='REFUND_PENDING'&&e.order.status==='CANCELLED'&&e.order.legs.every(l=>l.status==='CANCELLED'),'EXCHANGE_REFUND_STATE','Replacement refund requires acknowledged cancellation',409);
  await tx.exchangeExecution.update({where:{id:e.id},data:{paymentStatus:'REFUNDED',version:{increment:1},refundReceipt:json(receipt)}});
  if(e.cancellation?.status==='REFUND_PENDING')await tx.exchangeCancellation.update({where:{id:e.cancellation.id},data:{status:'COMPLETED',version:{increment:1},completedAt:(await tx.demoClock.findUniqueOrThrow({where:{id:'main'}})).now}});
 }
 await audit(tx,actor,job.correlationId,`exchange.${job.operation==='purchaseExchange'?'purchase':'refund'}-acknowledged`,e.exchangeId,{paymentStatus:e.paymentStatus},{receipt,actualMoneyMoved:false},'Versioned local SFCC simulator acknowledgement',e.partnerId);
}

/** Called only after the replacement's Fynd cancellation acknowledgement. */
export async function queueExchangeCancellationRefund(tx:Prisma.TransactionClient,orderId:string,correlationId:string){
 const e=await tx.exchangeExecution.findUnique({where:{orderId},include:executionInclude});if(!e)return;
 requireCondition(e.paymentStatus==='CAPTURED'&&e.order.legs.every(l=>l.status==='CANCELLED'),'EXCHANGE_REFUND_STATE','Cancel all replacement legs before refunding',409);
 const actor={id:'integration-worker',companyId:e.companyId,partnerId:e.partnerId,markets:[e.market],role:'ATI_SUPER_ADMIN'};
 await tx.exchangeExecution.update({where:{id:e.id},data:{paymentStatus:'REFUND_PENDING',version:{increment:1}}});
 await enqueue(tx,actor,correlationId,'SFCC','refundExchangePurchase',e.id,exchangePaymentPayload.parse(e.paymentPayload),`exchange:${e.exchangeId}:refund:v1`,e.partnerId);
 await audit(tx,actor,correlationId,'exchange.refund-requested',e.exchangeId,{paymentStatus:'CAPTURED'},{paymentStatus:'REFUND_PENDING'},'Fynd mock acknowledged replacement cancellation',e.partnerId);
}
