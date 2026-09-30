import { z } from 'zod';
import Decimal from 'decimal.js';
import { type Actor, permit, scope } from '../auth/policy';
import { audit, enqueue, json, transaction } from '../db/transaction';
import { requireCondition } from './errors';
import { payable } from './calculations';
import { ledger } from './finance';
import { queueStock } from './inventory';
import type { ReservedLine } from './orders';
import type { Prisma, ReturnCase } from '@prisma/client';
import {syncSla} from './sla';

export const returnInput=z.object({legId:z.string(),lineId:z.string(),quantity:z.number().int().positive().max(1000),reason:z.string().trim().min(5).max(500),requestId:z.string().min(8).max(100)}).strict();
export async function requestReturn(actor:Actor,input:z.infer<typeof returnInput>,correlationId:string){
  permit(actor,'fulfilment');
  return transaction(async tx=>{
    const key=`return:${actor.companyId}:${actor.partnerId??'operator'}:${input.requestId}`;
    const existing=await tx.returnCase.findFirst({where:{requestKey:key,...scope(actor)}});
    if(existing){requireCondition(existing.legId===input.legId&&existing.lineId===input.lineId&&existing.quantity===input.quantity&&existing.reason===input.reason,'RETURN_ID_CONFLICT','Return reference already used with different content',409);return existing;}
    const leg=await tx.fulfilmentLeg.findFirst({where:{id:input.legId,...scope(actor)},include:{order:true}});requireCondition(leg,'NOT_FOUND','Shipment not found',404);
    requireCondition(leg.status==='DELIVERED'&&leg.deliveredAt,'NOT_DELIVERED','Only delivered items are eligible for a return');
    const line=(leg.lines as ReservedLine[]).find(l=>l.id===input.lineId);requireCondition(line,'NOT_FOUND','Line not found',404);
    const agreement=await tx.agreement.findUniqueOrThrow({where:{id:line.agreementId}});
    const rules=agreement.rules as {returnDays?:number;handlingCharge?:string};
    const policy=line.returnPolicy??{version:line.agreementVersion,days:rules.returnDays??30,handlingCharge:rules.handlingCharge??'20.00'};
    const now=(await tx.demoClock.findUniqueOrThrow({where:{id:'main'}})).now;
    const days=(now.getTime()-leg.deliveredAt.getTime())/86400000;
    requireCondition(days>=0&&days<=policy.days,'RETURN_WINDOW_EXPIRED',`Return window is ${policy.days} days from delivery`);
    const prior=await tx.returnCase.findMany({where:{legId:leg.id,lineId:line.id,status:{not:'REJECTED'}}});const claimed=prior.reduce((s,r)=>s+r.quantity,0);
    requireCondition(claimed+input.quantity<=line.quantity,'RETURN_QUANTITY_EXCEEDED','Requested and completed returns exceed delivered quantity');
    const last=claimed+input.quantity===line.quantity;
    const allocate=(total:string,field:'refund'|'payableReversal')=>last?new Decimal(total).minus(prior.reduce((s,r)=>s.plus(r[field].toString()),new Decimal(0))):new Decimal(total).mul(input.quantity).div(line.quantity).toDecimalPlaces(2,Decimal.ROUND_HALF_UP);
    const totalPayable=payable(new Decimal(line.unitGross).mul(line.quantity).toFixed(2),line.vendorDiscount,line.commissionRate).payable;
    const result=await tx.returnCase.create({data:{companyId:actor.companyId,partnerId:leg.partnerId,market:leg.market,legId:leg.id,lineId:line.id,productId:line.productId,requestKey:key,quantity:input.quantity,reason:input.reason,currency:leg.order.currency,refund:allocate(line.net,'refund').toFixed(2),payableReversal:allocate(totalPayable,'payableReversal').toFixed(2),chargeback:policy.handlingCharge,policy:json({...policy,daysSinceDelivery:days,deliveredAt:leg.deliveredAt,line,inventoryId:line.inventoryId,totalPayable,customerNet:line.net,operatorOverrides:[]}),createdAt:now}});
    await syncSla(tx,'RETURN',result,correlationId);
    await audit(tx,actor,correlationId,'return.request',result.id,null,result,input.reason,leg.partnerId);return result;
  });
}
async function refundAndReverse(tx:Prisma.TransactionClient,actor:Actor,r:ReturnCase,correlationId:string,reason:string){
  const leg=await tx.fulfilmentLeg.findUniqueOrThrow({where:{id:r.legId},include:{order:true}});
  await ledger(tx,actor,r.partnerId,'RETURN_REVERSAL',r.payableReversal.negated().toFixed(2),r.id,`return:${r.id}:reversal`,{policy:r.policy,customerRefund:r.refund.toFixed(2),reason});
  await ledger(tx,actor,r.partnerId,'RETURN_HANDLING_CHARGEBACK',r.chargeback.negated().toFixed(2),r.id,`return:${r.id}:handling`,{reason,policy:r.policy});
  await enqueue(tx,actor,correlationId,'SFCC','requestRefund',r.id,{returnId:r.id,externalOrderId:leg.order.externalId,lineId:r.lineId,amount:r.refund.toFixed(2),currency:r.currency,reason,merchantOfRecord:'ATI'},`return:${r.id}:refund`,r.partnerId);
}
export const returnCommand=z.object({expectedVersion:z.number().int().positive(),action:z.enum(['approve','reject','book-pickup','receive','qc-good','qc-bad','approve-refund']),reason:z.string().trim().min(5).max(1000)}).strict();
export async function commandReturn(actor:Actor,id:string,input:z.infer<typeof returnCommand>,correlationId:string){
  permit(actor,'fulfilment',true);
  return transaction(async tx=>{
    const r=await tx.returnCase.findFirst({where:{id,...scope(actor)}});requireCondition(r,'NOT_FOUND','Return not found',404);
    requireCondition(r.version===input.expectedVersion,'STALE_RETURN','Refresh the return before continuing',409);
    const allowed={approve:['REQUESTED'],reject:['REQUESTED'],'book-pickup':['APPROVED'],receive:['PICKUP_BOOKED'],'qc-good':['RECEIVED'],'qc-bad':['RECEIVED'],'approve-refund':['QC_FAILED']}[input.action];
    requireCondition(allowed.includes(r.status),'INVALID_TRANSITION',`Cannot ${input.action} while ${r.status}`,409);
    let data:Prisma.ReturnCaseUpdateInput={version:{increment:1}};
    if(input.action==='reject')data.status='REJECTED';
    if(input.action==='approve'){const leg=await tx.fulfilmentLeg.findUniqueOrThrow({where:{id:r.legId}});requireCondition(leg.fyndId,'SHIPMENT_MAPPING_MISSING','Fynd shipment mapping is required');data.status='APPROVAL_PENDING';await enqueue(tx,actor,correlationId,'FYND','createReturn',id,{returnId:id,fyndShipmentId:leg.fyndId,lineId:r.lineId,quantity:r.quantity,policy:r.policy},`return:${id}:FYND`,r.partnerId);}
    if(input.action==='book-pickup'){data.status='PICKUP_PENDING';await enqueue(tx,actor,correlationId,'LOGISTICS','bookReturnPickup',id,{returnId:id,fyndReturnId:r.fyndReturnId,quantity:r.quantity,demoOnly:true},`return:${id}:pickup`,r.partnerId);}
    if(input.action==='receive')data.status='RECEIVED';
    if(['qc-good','qc-bad'].includes(input.action)){
      const good=input.action==='qc-good';data={...data,status:good?'REFUND_PENDING':'QC_FAILED',qc:good?'GOOD':'BAD',refundStatus:good?'REQUESTED':'HELD'};
      const evidence=await tx.returnEvidence.findMany({where:{returnId:id},select:{id:true},orderBy:[{createdAt:'asc'},{id:'asc'}]});
      data.policy=json({...r.policy as Record<string,unknown>,qcDecision:{condition:good?'GOOD':'BAD',disposition:good?'RESTOCK':'QUARANTINE',reason:input.reason,actorId:actor.id,decidedAt:(await tx.demoClock.findUniqueOrThrow({where:{id:'main'}})).now,evidenceIds:evidence.map(e=>e.id)}});
      const policy=r.policy as {inventoryId:string};
      await tx.inventory.update({where:{id:policy.inventoryId},data:{onHand:{increment:r.quantity},damaged:{increment:good?0:r.quantity},revision:{increment:1},syncedAt:null}});
      await queueStock(tx,actor,policy.inventoryId,correlationId);
      if(good)await refundAndReverse(tx,actor,{...r,policy:data.policy as Prisma.JsonValue},correlationId,input.reason);
    }
    if(input.action==='approve-refund'){
      data={...data,status:'REFUND_PENDING',refundStatus:'REQUESTED',policy:json({...r.policy as Record<string,unknown>,refundOverride:{reason:input.reason,actorId:actor.id}})};
      await refundAndReverse(tx,actor,r,correlationId,input.reason);
    }
    await syncSla(tx,'RETURN',r,correlationId,'LEGACY_OBSERVED');
    const updated=await tx.returnCase.update({where:{id},data});await syncSla(tx,'RETURN',updated,correlationId);await audit(tx,actor,correlationId,`return.${input.action}`,id,r,updated,input.reason,r.partnerId);return updated;
  });
}
