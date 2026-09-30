import type {Prisma} from '@prisma/client';
import {z} from 'zod';
import {digest} from '../../../packages/auth/security';
import {json} from '../../../packages/db/transaction';
import {exchangePaymentPayload,exchangePaymentResult,exchangeCancellationPayload,exchangeCancellationResult,type ExchangePaymentPayload} from '../../../packages/contracts/exchange-payment';
import {requireCondition} from '../../../packages/domain/errors';

const same=(a:unknown,b:unknown)=>digest(JSON.stringify(a))===digest(JSON.stringify(b));
/** Simulator-owned row serializes capture/create with cancellation. No ECS state is consulted. */
async function state(tx:Prisma.TransactionClient,system:'SFCC'|'FYND',identity:ExchangePaymentPayload){
 const where={system_exchangeId:{system,exchangeId:identity.exchangeId}};
 let row=await tx.mockExchangeState.findUnique({where});
 if(!row){
  // Preserve receipts produced before this simulator gained cancellation fences.
  const prior=await tx.mockRecord.findUnique({where:{system_idempotencyKey:{system,idempotencyKey:system==='SFCC'?`exchange:${identity.exchangeId}:purchase:v1`:`order:${identity.orderId}:FYND`}}});
  const receipt=system==='SFCC'&&prior?exchangePaymentResult.parse(prior.response).payment:null;
  if(receipt)requireCondition(receipt.status==='CAPTURED'&&same(exchangePaymentPayload.strip().parse(receipt),identity),'PURCHASE_MISMATCH','Existing purchase has different identity or amount',409);
  // Upsert obtains a shared row even when two first requests race. Serializable retry handles conflicts.
  row=await tx.mockExchangeState.upsert({where,update:{},create:{system,exchangeId:identity.exchangeId,orderId:identity.orderId,identity:json(identity),orderCreated:system==='FYND'&&!!prior,...(receipt?{purchaseReceipt:json(receipt)}:{})}});
 }
 requireCondition(same(exchangePaymentPayload.parse(row.identity),identity),'EXCHANGE_IDENTITY_CONFLICT','Exchange identity and amount are immutable',409);
 return row;
}

export async function mockExchange(tx:Prisma.TransactionClient,system:string,operation:string,body:unknown,key:string,externalId:string){
 if(['purchaseExchange','refundExchangePurchase'].includes(operation)){
  requireCondition(system==='SFCC','WRONG_PAYMENT_OWNER','SFCC owns the simulated replacement purchase',400);
  const value=exchangePaymentPayload.parse(body);
  requireCondition(key===`exchange:${value.exchangeId}:${operation==='purchaseExchange'?'purchase':'refund'}:v1`,'INVALID_PAYMENT_KEY','Payment key must match the exchange',400);
  const row=await state(tx,'SFCC',value);
  if(operation==='purchaseExchange')requireCondition(!row.closed,'EXCHANGE_FENCED','Replacement payment has been cancelled',409);
  else requireCondition(row.purchaseReceipt,'PURCHASE_MISSING','No simulated purchase to refund',409);
  const payment={...value,status:operation==='purchaseExchange'?'CAPTURED':'REFUNDED',reference:externalId};
  if(operation==='purchaseExchange')await tx.mockExchangeState.update({where:{system_exchangeId:{system,exchangeId:value.exchangeId}},data:{purchaseReceipt:json(payment),revision:{increment:1}}});
  return {payment};
 }
 if(['cancelExchangePurchase','cancelExchangeOrder'].includes(operation)){
  const owner=operation==='cancelExchangePurchase'?'SFCC':'FYND';
  requireCondition(system===owner,'WRONG_CANCELLATION_OWNER','Cancellation target does not own this operation',400);
  const intent=exchangeCancellationPayload.parse(body),identity=exchangePaymentPayload.strip().parse(intent);
  requireCondition(key===`exchange:${intent.exchangeId}:cancel:${system}:v1`,'INVALID_CANCEL_KEY','Cancellation key must match the exchange',400);
  const row=await state(tx,owner,identity);
  await tx.mockExchangeState.update({where:{system_exchangeId:{system:owner,exchangeId:intent.exchangeId}},data:{closed:true,revision:{increment:1}}});
  const outcome=owner==='FYND'?{resolution:'FENCED',orderExisted:row.orderCreated}:row.purchaseReceipt?{resolution:'CAPTURED',purchase:row.purchaseReceipt}:{resolution:'VOIDED',purchase:null};
  const checked=exchangeCancellationResult.parse({externalId,mode:'mock',system:owner,operation,intent,outcome});
  return {intent:checked.intent,outcome:checked.outcome};
 }
 if(system==='FYND'&&operation==='createOrder'&&body&&typeof body==='object'&&'exchange' in body){
  const value=z.object({orderId:z.string(),externalOrderId:z.string(),currency:z.literal('AED'),total:z.string(),exchange:exchangePaymentPayload}).parse(body);
  requireCondition(value.orderId===value.exchange.orderId&&value.externalOrderId===value.exchange.externalOrderId&&value.currency===value.exchange.currency&&value.total===value.exchange.amount&&key===`order:${value.orderId}:FYND`,'ORDER_IDENTITY_MISMATCH','Replacement order must match the accepted payment identity',409);
  const row=await state(tx,'FYND',value.exchange);
  requireCondition(!row.closed,'EXCHANGE_FENCED','Replacement order has been cancelled',409);
  await tx.mockExchangeState.update({where:{system_exchangeId:{system:'FYND',exchangeId:value.exchange.exchangeId}},data:{orderCreated:true,revision:{increment:1}}});
 }
 if(system==='FYND'&&operation==='createShipment'){
  const value=z.object({leg:z.object({id:z.string(),orderId:z.string()})}).parse(body);
  const row=await tx.mockExchangeState.findUnique({where:{system_orderId:{system:'FYND',orderId:value.leg.orderId}}});
  if(row){
   requireCondition(!row.closed&&row.orderCreated,'EXCHANGE_FENCED','Replacement order cannot accept new shipments',409);
   await tx.mockExchangeState.update({where:{system_exchangeId:{system:'FYND',exchangeId:row.exchangeId}},data:{revision:{increment:1}}});
  }
 }
 return {};
}
