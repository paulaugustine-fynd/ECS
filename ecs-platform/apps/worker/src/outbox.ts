import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { db } from '../../../packages/db/client';
import { audit, enqueue, json, transaction } from '../../../packages/db/transaction';
import { adapter, AdapterError } from '../../../packages/integrations/adapter';
import type { System } from '../../../packages/config/env';
import type { ReservedLine } from '../../../packages/domain/orders';
import { queueStock,reconcileAvailability } from '../../../packages/domain/inventory';
import { ledger, recognizeDelivery } from '../../../packages/domain/finance';
import {hasBrandRight} from '../../../packages/domain/brand-policy';
import {assertLaunchJob,acknowledgeLaunch} from '../../../packages/domain/launch-tests';
import {assertMappingCurrent,acknowledgeMapping,mappingReadiness} from '../../../packages/domain/mappings';
import {assertStorefrontJob} from '../../../packages/domain/storefront';
import {customerContent} from '../../../packages/domain/storefront-contract';
import {launchFingerprint} from '../../../packages/domain/launch-contract';
import {syncSla} from '../../../packages/domain/sla';
import {notifyOperations} from '../../../packages/domain/notifications';
import {openException,transitionException} from '../../../packages/domain/exception-lifecycle';
import {assertExchangePaymentJob,acknowledgeExchangePayment,queueExchangeCancellationRefund} from '../../../packages/domain/exchange-checkout';
import {assertExchangeCancellationJob,acknowledgeExchangeCancellation} from '../../../packages/domain/exchange-cancellation';

export async function processOutbox(id: string) {
  const leaseToken = randomUUID();
  const claimed = await db.outbox.updateMany({where:{id,availableAt:{lte:new Date()},OR:[{status:'PENDING'},{status:'RETRY'},{status:'PROCESSING',leaseUntil:{lt:new Date()}}]},data:{status:'PROCESSING',leaseToken,leaseUntil:new Date(Date.now()+30000),attempts:{increment:1}}});
  if (!claimed.count) return false;
  const job = await db.outbox.findUniqueOrThrow({where:{id}});
  const start = Date.now();
  try {
    if(['cancelExchangePurchase','cancelExchangeOrder'].includes(job.operation))await assertExchangeCancellationJob(db,job);
    if(['purchaseExchange','refundExchangePurchase'].includes(job.operation))await assertExchangePaymentJob(db,job);
    if(job.operation==='launchOrderStep')await assertLaunchJob(db,job);
    if(job.operation==='provisionMapping')await assertMappingCurrent(db,job);
    if(job.operation==='publishStorefront')await assertStorefrontJob(db,job);
    if(job.operation==='upsertProduct'){
      const product=await db.product.findUniqueOrThrow({where:{id:job.aggregateId},include:{partner:{include:{brandRights:true}}}});
      const now=(await db.demoClock.findUniqueOrThrow({where:{id:'main'}})).now;
      const payload=job.payload as {version:number;product:unknown};
      if(product.version!==payload.version||job.companyId!==product.companyId||job.partnerId!==product.partnerId||job.market!==product.market||launchFingerprint(customerContent(product))!==launchFingerprint(customerContent(payload.product)))throw new AdapterError('Publication content or identity is stale',false);
      if(!['APPROVED','ACTIVE'].includes(product.partner.status)||!product.partner.markets.includes(product.market)||!hasBrandRight(product.partner.brandRights,product,now))throw new AdapterError('Publication blocked: current brand/category/market rights or partner approval missing',false);
      if(!(await mappingReadiness(db,product.partnerId)).passed)throw new AdapterError('Publication blocked: current mapping evidence missing',false);
    }
    const result = await adapter(job.target as System,job).execute(job.operation,job.payload,{correlationId:job.correlationId,idempotencyKey:job.idempotencyKey});
    await transaction(async tx => {
      const owned = await tx.outbox.updateMany({where:{id,leaseToken,status:'PROCESSING'},data:{status:'SUCCEEDED',response:json(result),error:null,leaseUntil:null,leaseToken:null}});
      if (!owned.count) return;
      if(['cancelExchangePurchase','cancelExchangeOrder'].includes(job.operation))await acknowledgeExchangeCancellation(tx,job,result);
      if(['purchaseExchange','refundExchangePurchase'].includes(job.operation))await acknowledgeExchangePayment(tx,job,result);
      if(job.operation==='launchOrderStep')await acknowledgeLaunch(tx,job,result);
      if(job.operation==='provisionMapping'){await acknowledgeMapping(tx,job,result);await reconcileAvailability(tx,job.partnerId!,job.correlationId);}
      if(job.operation==='publishStorefront'){
        const expected=await assertStorefrontJob(tx,job),record=await tx.mockStorefrontProduct.findUnique({where:{productId:job.aggregateId}});
        if(!record?.visible||record.fingerprint!==expected.fingerprint||launchFingerprint(record.content)!==expected.fingerprint||result.externalId!==expected.externalId)throw new AdapterError('Storefront read-back did not match publication',false);
      }
      if (job.operation === 'upsertVendor') await tx.partner.update({where:{id:job.aggregateId},data:{erpVendorId:result.externalId,version:{increment:1}}});
      if (job.operation === 'provisionPartner') await tx.partner.update({where:{id:job.aggregateId},data:{fyndMapped:true,version:{increment:1}}});
      const workerActor={id:'integration-worker',companyId:job.companyId,partnerId:job.partnerId,markets:[job.market],role:'ATI_SUPER_ADMIN'};
      if(['createShipment','transitionShipment'].includes(job.operation))await syncSla(tx,'SHIPMENT',await tx.fulfilmentLeg.findUniqueOrThrow({where:{id:job.aggregateId}}),job.correlationId,'LEGACY_OBSERVED');
      if(['createReturn','bookReturnPickup','requestRefund'].includes(job.operation))await syncSla(tx,'RETURN',await tx.returnCase.findUniqueOrThrow({where:{id:job.aggregateId}}),job.correlationId,'LEGACY_OBSERVED');
      if(job.operation==='syncInventory'&&job.target==='FYND')await tx.inventory.updateMany({where:{id:job.aggregateId,revision:(job.payload as {revision:number}).revision},data:{syncedAt:new Date()}});
      if(job.operation==='createOrder'){
        const order=await tx.order.update({where:{id:job.aggregateId},data:{fyndId:result.externalId,status:'ALLOCATED'},include:{legs:true}});
        for(const leg of order.legs)await enqueue(tx,workerActor,job.correlationId,'FYND','createShipment',leg.id,{fyndOrderId:result.externalId,leg},`shipment:${leg.id}:create`,leg.partnerId);
      }
      if(job.operation==='createShipment')await tx.fulfilmentLeg.update({where:{id:job.aggregateId},data:{fyndId:result.externalId,status:'ASSIGNED',version:{increment:1}}});
      if(job.operation==='transitionShipment'){
        const payload=job.payload as {next:string;version:number;tracking?:string};
        const leg=await tx.fulfilmentLeg.findUniqueOrThrow({where:{id:job.aggregateId}});
        if(leg.version===payload.version&&leg.requestedStatus===payload.next){
          const now=(await tx.demoClock.findUniqueOrThrow({where:{id:'main'}})).now;
          await tx.fulfilmentLeg.update({where:{id:leg.id},data:{status:payload.next,requestedStatus:null,...(payload.tracking?{tracking:payload.tracking}:{}),...(payload.next==='DELIVERED'?{deliveredAt:now}:{}),deadline:new Date(now.getTime()+(payload.next==='DISPATCHED'?48*60:120)*60000)}});
          await audit(tx,workerActor,job.correlationId,'shipment.transition-acknowledged',leg.id,{status:leg.status},{status:payload.next,externalId:result.externalId},'Fynd mock acknowledgement',leg.partnerId);
          if(payload.next==='DELIVERED')await recognizeDelivery(tx,workerActor,{...leg,deliveredAt:now,status:'DELIVERED'});
          if(['DISPATCHED','CANCELLED'].includes(payload.next))for(const line of leg.lines as ReservedLine[]){
            const moved=await tx.inventory.updateMany({where:{id:line.inventoryId,reserved:{gte:line.quantity},...(payload.next==='DISPATCHED'?{onHand:{gte:line.quantity}}:{})},data:{reserved:{decrement:line.quantity},revision:{increment:1},syncedAt:null,...(payload.next==='DISPATCHED'?{onHand:{decrement:line.quantity}}:{})}});
            if(!moved.count)throw new Error('Reservation invariant failed');
            await queueStock(tx,workerActor,line.inventoryId,job.correlationId);
          }
          const siblings=await tx.fulfilmentLeg.findMany({where:{orderId:leg.orderId}});
          const orderStatus=siblings.every(l=>l.status==='CANCELLED')?'CANCELLED':siblings.every(l=>['DELIVERED','CANCELLED'].includes(l.status))?'DELIVERED':siblings.some(l=>['DISPATCHED','DELIVERED'].includes(l.status))?'PARTIALLY_FULFILLED':'FULFILLING';
          const order=await tx.order.update({where:{id:leg.orderId},data:{status:orderStatus}});
          if(orderStatus==='CANCELLED')await queueExchangeCancellationRefund(tx,order.id,job.correlationId);
          // SFCC owns customer invoicing. Send fulfilment facts, never a second tax document.
          await enqueue(tx,workerActor,job.correlationId,'SFCC','shipmentStatus',leg.id,{orderId:leg.orderId,externalOrderId:order.externalId,channel:order.channel,currency:order.currency,shipmentId:leg.id,fyndShipmentId:leg.fyndId,status:payload.next,tracking:payload.tracking??leg.tracking,lines:(leg.lines as ReservedLine[]).map(line=>({id:line.id,sku:line.sku,quantity:line.quantity})),merchantOfRecord:'ATI',invoiceOwner:'SFCC'},`shipment:${leg.id}:${payload.version}:SFCC`,leg.partnerId);
          if(payload.next==='PICKING'){
            const location=await tx.location.findUniqueOrThrow({where:{id:leg.locationId}});
            if(location.type.includes('WAREHOUSE'))await enqueue(tx,workerActor,job.correlationId,'WMS','createPickTask',leg.id,{shipmentId:leg.id,locationId:leg.locationId,lines:leg.lines},`shipment:${leg.id}:pick`,leg.partnerId);
          }
        }
      }
      if(job.operation==='createReturn')await tx.returnCase.update({where:{id:job.aggregateId},data:{fyndReturnId:result.externalId,status:'APPROVED',version:{increment:1}}});
      if(job.operation==='bookReturnPickup')await tx.returnCase.update({where:{id:job.aggregateId},data:{logisticsId:result.externalId,status:'PICKUP_BOOKED',version:{increment:1}}});
      if(job.operation==='requestRefund')await tx.returnCase.update({where:{id:job.aggregateId},data:{refundId:result.externalId,status:'CLOSED',refundStatus:'ACKNOWLEDGED',version:{increment:1}}});
      if(['createShipment','transitionShipment'].includes(job.operation))await syncSla(tx,'SHIPMENT',await tx.fulfilmentLeg.findUniqueOrThrow({where:{id:job.aggregateId}}),job.correlationId);
      if(['createReturn','bookReturnPickup','requestRefund'].includes(job.operation))await syncSla(tx,'RETURN',await tx.returnCase.findUniqueOrThrow({where:{id:job.aggregateId}}),job.correlationId);
      if(job.operation==='exportStatement'){
        const s=await tx.settlement.update({where:{id:job.aggregateId},data:{status:'EXPORTED',exportedId:result.externalId,version:{increment:1}}});
        await ledger(tx,workerActor,s.partnerId,'PAYOUT_EXPORTED',s.payable.toFixed(2),s.id,`statement:${s.id}:export-marker`,{externalId:result.externalId,demoOnly:true});
      }
      if(job.operation==='confirmPayout'){
        const s=await tx.settlement.update({where:{id:job.aggregateId},data:{status:'PAID',version:{increment:1}}});
        await ledger(tx,workerActor,s.partnerId,'PAYOUT_CONFIRMED',s.payable.toFixed(2),s.id,`statement:${s.id}:payment-marker`,{externalId:result.externalId,demoOnly:true,actualMoneyMoved:false});
      }
      if(['createReturn','bookReturnPickup','requestRefund','exportStatement','confirmPayout'].includes(job.operation))await audit(tx,workerActor,job.correlationId,`${job.operation}.acknowledged`,job.aggregateId,null,{target:job.target,mode:result.mode,externalId:result.externalId},'Deterministic mock acknowledgement; no real money or shipment movement',job.partnerId??undefined);
      if (job.operation === 'upsertProduct') {
        const current=await tx.product.findUniqueOrThrow({where:{id:job.aggregateId},include:{partner:{include:{brandRights:true}}}});
        const at=(await tx.demoClock.findUniqueOrThrow({where:{id:'main'}})).now;
        if(!['APPROVED','ACTIVE'].includes(current.partner.status)||!current.partner.markets.includes(current.market)||!hasBrandRight(current.partner.brandRights,current,at))throw new AdapterError('Authorization changed during publication; inventory remains gated and review/replay is required',false);
        if(!(await mappingReadiness(tx,current.partnerId)).passed)throw new AdapterError('Mapping changed during publication; refresh mapping evidence before replay',false);
        const payload = job.payload as {version:number;product:Prisma.JsonValue};
        if(current.version!==payload.version||launchFingerprint(customerContent(current))!==launchFingerprint(customerContent(payload.product)))throw new AdapterError('Catalogue changed during publication',false);
        if(job.target==='SFCC'){
          const record=await tx.mockStorefrontProduct.findUnique({where:{productId:current.id}});
          if(!record?.visible||record.companyId!==current.companyId||record.partnerId!==current.partnerId||record.market!==current.market||record.version!==current.version||record.externalId!==result.externalId||record.fingerprint!==launchFingerprint(customerContent(current))||launchFingerprint(record.content)!==record.fingerprint)throw new AdapterError('SFCC storefront content does not match publication acknowledgement',false);
        }
        await tx.publication.updateMany({where:{productId:job.aggregateId,version:payload.version,target:job.target},data:{status:'SUCCEEDED',externalId:result.externalId,error:null}});
        const product = await tx.product.findUniqueOrThrow({where:{id:job.aggregateId},include:{publications:true}});
        if(job.target==='ERP'&&product.version===payload.version){
          // ATI ERP acknowledgement is a hard dependency. SFCC never receives a product without it.
          for(const target of ['FYND','SFCC'] as const){
            await tx.publication.updateMany({where:{productId:product.id,version:payload.version,target,status:'BLOCKED'},data:{status:'PENDING'}});
            await enqueue(tx,{id:'integration-worker',companyId:job.companyId,partnerId:job.partnerId,markets:[job.market],role:'ATI_SUPER_ADMIN'},job.correlationId,target,'upsertProduct',product.id,{...payload,erpItemId:result.externalId,merchantOfRecord:'ATI'},`product:${product.id}:${payload.version}:${target}`,product.partnerId);
          }
        }
        if (product.version === payload.version && ['ERP','FYND','SFCC'].every(t => product.publications.some(p => p.target === t && p.version === product.version && p.status === 'SUCCEEDED'))) await tx.product.update({where:{id:product.id},data:{status:'PUBLISHED'}});
      }
      await transitionException(tx,'INTEGRATION_DLQ',id,'RESOLVED','Adapter acknowledgement received successfully.');
      await tx.integrationAttempt.create({data:{jobId:id,attempt:job.attempts,status:'SUCCEEDED',durationMs:Date.now()-start,detail:json(result)}});
    });
  } catch(error) {
    const failure = error instanceof AdapterError ? error : new AdapterError('Internal dispatch or acknowledgement failure',true);
    const dead = !failure.retryable || job.attempts >= 5;
    await transaction(async tx => {
      const owned = await tx.outbox.updateMany({where:{id,leaseToken,status:'PROCESSING'},data:{status:dead?'DEAD_LETTER':'RETRY',error:failure.message,leaseToken:null,leaseUntil:null,availableAt:new Date(Date.now()+Math.min(60000,1000*2**job.attempts)+Math.floor(Math.random()*500))}});
      if (!owned.count) return;
      if(job.operation==='launchOrderStep')await tx.launchTest.updateMany({where:{id:job.aggregateId,status:{in:['RUNNING','FAILED']}},data:{status:dead?'FAILED':'RUNNING',error:failure.message}});
      if(job.operation==='upsertProduct')await tx.publication.updateMany({where:{productId:job.aggregateId,version:(job.payload as {version:number}).version,target:job.target},data:{status:'FAILED',error:failure.message}});
      await tx.integrationAttempt.create({data:{jobId:id,attempt:job.attempts,status:dead?'DEAD_LETTER':'RETRY',durationMs:Date.now()-start,detail:{message:failure.message,retryable:failure.retryable}}});
      if(dead){const exception=await openException(tx,{companyId:job.companyId,partnerId:job.partnerId,market:job.market,kind:'INTEGRATION_DLQ',entityId:id,message:failure.message});
       await notifyOperations(tx,{companyId:job.companyId,partnerId:job.partnerId,market:job.market,category:'INTEGRATION',severity:'CRITICAL',entityType:'INTEGRATION_JOB',entityId:id,eventKey:`outbox-dlq:${id}:exception-v${exception.version}`,title:'Integration job needs operator review',message:`${job.target} ${job.operation} reached the dead-letter queue. Review the restricted integration trace before replaying.`,eventAt:new Date()});}
    });
  }
  return true;
}
