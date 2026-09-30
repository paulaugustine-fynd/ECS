import {z} from 'zod';
import type {Outbox,Prisma} from '@prisma/client';
import {db} from '../db/client';
import {type Actor,permit,scope} from '../auth/policy';
import {digest} from '../auth/security';
import {audit,enqueue,json,transaction} from '../db/transaction';
import {readEnv} from '../config/env';
import {isDemoRuntime} from '../config/hosted-demo';
import {exchangeCancellationPayload,exchangeCancellationResult,exchangePaymentPayload} from '../contracts/exchange-payment';
import {AdapterError} from '../integrations/adapter';
import {executionInclude,executionView,queueExchangeCancellationRefund} from './exchange-checkout';
import {requireCondition} from './errors';
import type {ReservedLine} from './orders';
import {queueStock} from './inventory';
import {syncSla} from './sla';
import {transitionException} from './exception-lifecycle';
import {launchFingerprint} from './launch-contract';

export const exchangeCancellationInput=z.object({expectedVersion:z.number().int().positive(),reason:z.string().trim().min(5).max(1000)}).strict();
type Input=z.infer<typeof exchangeCancellationInput>;
const same=(a:unknown,b:unknown)=>launchFingerprint(a)===launchFingerprint(b);
function demoOnly(){readEnv();requireCondition(isDemoRuntime(),'DEMO_ONLY','Replacement cancellation is a simulated workflow',403);}

async function requestCancellation(tx:Prisma.TransactionClient,actor:Actor,id:string,input:Input,correlationId:string,cause:'OPERATOR_CANCELLED'|'PAYMENT_HOLD_EXPIRED'){
 const e=await tx.exchangeExecution.findFirst({where:{exchangeId:id,...scope(actor)},include:executionInclude});requireCondition(e,'NOT_FOUND','Replacement execution not found',404);
 const hash=digest(JSON.stringify({input,cause}));
 if(e.cancellation){requireCondition(e.cancellation.actorId===actor.id&&e.cancellation.requestHash===hash,'CANCELLATION_CONFLICT','Cancellation already requested; refresh its acknowledgement history',409);return {execution:executionView(e),replayed:true};}
 const now=(await tx.demoClock.findUniqueOrThrow({where:{id:'main'}})).now;
 requireCondition(e.version===input.expectedVersion&&['PENDING','CAPTURED'].includes(e.paymentStatus),'STALE_EXECUTION','Refresh replacement payment and shipment state',409);
 requireCondition(e.order.legs.length>0&&e.order.legs.every(l=>['AWAITING_PAYMENT','AWAITING_FYND','ASSIGNED'].includes(l.status)&&!l.requestedStatus),'CANCELLATION_TOO_LATE','Use the shipment cancellation flow once fulfilment has begun',409);
 if(cause==='PAYMENT_HOLD_EXPIRED')requireCondition(e.paymentStatus==='PENDING'&&e.holdExpiresAt<=now,'HOLD_NOT_EXPIRED','Payment is captured or its hold is still current',409);
 const payload=exchangeCancellationPayload.parse({...exchangePaymentPayload.parse(e.paymentPayload),shipmentIds:e.order.legs.map(l=>l.id).sort()});
 await tx.exchangeCancellation.create({data:{executionId:e.id,actorId:actor.id,reason:input.reason,requestHash:hash,cause,payload:json(payload),createdAt:now}});
 // Losing the lease makes any already-in-flight worker response unable to advance local state.
 // Remote effects are reconciled by the two cancellation jobs, never assumed absent.
 const jobs=await tx.outbox.findMany({where:{companyId:e.companyId,status:{in:['PENDING','RETRY','DEAD_LETTER','PROCESSING']},OR:[{aggregateId:e.id,operation:'purchaseExchange'},{aggregateId:e.orderId,operation:'createOrder'},{aggregateId:{in:payload.shipmentIds},operation:'createShipment'}]}});
 await tx.outbox.updateMany({where:{id:{in:jobs.map(j=>j.id)}},data:{status:'CANCELLED',leaseToken:null,leaseUntil:null}});
 await tx.fulfilmentLeg.updateMany({where:{orderId:e.orderId},data:{requestedStatus:'CANCELLED',version:{increment:1}}});
 const owner={...actor,partnerId:e.partnerId,markets:[e.market]};
 for(const target of ['SFCC','FYND'] as const)await enqueue(tx,owner,correlationId,target,target==='SFCC'?'cancelExchangePurchase':'cancelExchangeOrder',e.id,payload,`exchange:${id}:cancel:${target}:v1`,e.partnerId);
 await audit(tx,owner,correlationId,'exchange.cancellation-requested',id,null,{cause,executionId:e.id,supersededJobs:jobs.map(j=>({id:j.id,status:j.status})),stockReleased:false},input.reason,e.partnerId);
 return {execution:executionView(await tx.exchangeExecution.findUniqueOrThrow({where:{id:e.id},include:executionInclude})),replayed:false};
}

export async function cancelExchangeCheckout(actor:Actor,id:string,input:Input,correlationId:string){
 permit(actor,'fulfilment',true);demoOnly();return transaction(tx=>requestCancellation(tx,actor,id,input,correlationId,'OPERATOR_CANCELLED'));
}

/** Bounded sweep of pending holds using the demo clock, not wall-clock time. */
export async function expireExchangePaymentHolds(companyId?:string){
 demoOnly();const now=(await db.demoClock.findUniqueOrThrow({where:{id:'main'}})).now;
 const due=await db.exchangeExecution.findMany({where:{companyId,paymentStatus:'PENDING',holdExpiresAt:{lte:now},cancellation:null},orderBy:{holdExpiresAt:'asc'},take:50});
 let expired=0;
 for(const e of due)expired+=await transaction(async tx=>{
  const current=await tx.exchangeExecution.findUniqueOrThrow({where:{id:e.id},include:{cancellation:true}});
  if(current.paymentStatus!=='PENDING'||current.cancellation)return 0;
  const actor={id:'integration-worker',companyId:e.companyId,partnerId:e.partnerId,markets:[e.market],role:'ATI_SUPER_ADMIN'};
  await requestCancellation(tx,actor,e.exchangeId,{expectedVersion:current.version,reason:'Unacknowledged simulated payment reached the 30-minute demo hold deadline'},`exchange-expiry:${e.id}`,'PAYMENT_HOLD_EXPIRED');return 1;
 });
 return expired;
}

export async function assertExchangeCancellationJob(tx:Pick<Prisma.TransactionClient,'exchangeExecution'>,job:Outbox){
 const payload=exchangeCancellationPayload.safeParse(job.payload),e=await tx.exchangeExecution.findUnique({where:{id:job.aggregateId},include:executionInclude});
 if(!payload.success||!e?.cancellation||e.cancellation.status!=='REQUESTED'||e.companyId!==job.companyId||e.partnerId!==job.partnerId||e.market!==job.market||!same(payload.data,e.cancellation.payload)||job.target!==(job.operation==='cancelExchangePurchase'?'SFCC':'FYND')||job.idempotencyKey!==`exchange:${e.exchangeId}:cancel:${job.target}:v1`)throw new AdapterError('Cancellation job does not match the retained owner and intent',false);
 return e;
}

export async function acknowledgeExchangeCancellation(tx:Prisma.TransactionClient,job:Outbox,result:unknown){
 const e=await assertExchangeCancellationJob(tx,job),parsed=exchangeCancellationResult.safeParse(result);
 if(!parsed.success||parsed.data.system!==job.target||parsed.data.operation!==job.operation||!same(parsed.data.intent,job.payload))throw new AdapterError('Invalid replacement cancellation acknowledgement',false);
 const receipt=parsed.data,c=e.cancellation!,actor={id:'integration-worker',companyId:e.companyId,partnerId:e.partnerId,markets:[e.market],role:'ATI_SUPER_ADMIN'};
 if(receipt.system==='SFCC'){
  if(receipt.outcome.resolution==='CAPTURED'){
   const purchase=receipt.outcome.purchase;
   if(!same(exchangePaymentPayload.strip().parse(purchase),exchangePaymentPayload.parse(e.paymentPayload)))throw new AdapterError('Cancellation recovered a different purchase identity or amount',false);
   if(e.paymentStatus==='PENDING')await tx.exchangeExecution.update({where:{id:e.id},data:{paymentStatus:'CAPTURED',version:{increment:1},purchaseReceipt:json(purchase)}});
   else if(e.paymentStatus!=='CAPTURED'||!same(e.purchaseReceipt,purchase))throw new AdapterError('Captured payment receipt disagrees with retained evidence',false);
  }else{
   if(e.paymentStatus!=='PENDING')throw new AdapterError('A captured payment cannot be voided without a refund',false);
   await tx.exchangeExecution.update({where:{id:e.id},data:{paymentStatus:'VOIDED',version:{increment:1}}});
  }
 }
 const updated=await tx.exchangeCancellation.update({where:{id:c.id},data:{version:{increment:1},...(receipt.system==='SFCC'?{sfccReceipt:json(receipt)}:{fyndReceipt:json(receipt)})}});
 await audit(tx,actor,job.correlationId,'exchange.cancellation-acknowledged',e.exchangeId,null,receipt,'Versioned local simulator cancellation evidence',e.partnerId);
 if(!updated.sfccReceipt||!updated.fyndReceipt)return;
 // Both independent systems are fenced. Only now may the reservation be released.
 for(const leg of e.order.legs){
  requireCondition(leg.requestedStatus==='CANCELLED'&&['AWAITING_PAYMENT','AWAITING_FYND','ASSIGNED'].includes(leg.status),'CANCELLATION_STATE','Replacement advanced while cancellation was pending',409);
  for(const line of leg.lines as ReservedLine[]){
   const moved=await tx.inventory.updateMany({where:{id:line.inventoryId,reserved:{gte:line.quantity}},data:{reserved:{decrement:line.quantity},revision:{increment:1},syncedAt:null}});
   requireCondition(moved.count===1,'RESERVATION_INVARIANT','Replacement reservation is missing',409);
   await queueStock(tx,actor,line.inventoryId,job.correlationId);
  }
  const cancelled=await tx.fulfilmentLeg.update({where:{id:leg.id},data:{status:'CANCELLED',requestedStatus:null}});
  await syncSla(tx,'SHIPMENT',cancelled,job.correlationId);
 }
 await tx.order.update({where:{id:e.orderId},data:{status:'CANCELLED'}});
 const payment=await tx.exchangeExecution.findUniqueOrThrow({where:{id:e.id}}),now=(await tx.demoClock.findUniqueOrThrow({where:{id:'main'}})).now;
 const refund=payment.paymentStatus==='CAPTURED';
 if(refund)await queueExchangeCancellationRefund(tx,e.orderId,job.correlationId);
 else requireCondition(payment.paymentStatus==='VOIDED','CANCELLATION_PAYMENT_STATE','Payment outcome is not resolved',409);
 await tx.exchangeCancellation.update({where:{id:c.id},data:{status:refund?'REFUND_PENDING':'COMPLETED',version:{increment:1},...(refund?{}:{completedAt:now})}});
 const superseded=await tx.outbox.findMany({where:{companyId:e.companyId,status:'CANCELLED',aggregateId:{in:[e.id,e.orderId,...e.order.legs.map(l=>l.id)]}}});
 for(const prior of superseded)await transitionException(tx,'INTEGRATION_DLQ',prior.id,'RESOLVED','Superseded by acknowledged replacement cancellation; both simulators fenced.');
 await audit(tx,actor,job.correlationId,'exchange.reservation-released',e.exchangeId,null,{orderId:e.orderId,refundPending:refund,actualMoneyMoved:false},'Both payment and fulfilment cancellation acknowledgements received',e.partnerId);
}
