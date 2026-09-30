import Decimal from 'decimal.js';
import { z } from 'zod';
import type { FulfilmentLeg, Prisma } from '@prisma/client';
import { type Actor, permit, scope } from '../auth/policy';
import { audit, enqueue, json, transaction } from '../db/transaction';
import { payable } from './calculations';
import { requireCondition } from './errors';
import type { ReservedLine } from './orders';
import { readEnv } from '../config/env';

export function financeRead(actor:Actor){requireCondition(['ATI_SUPER_ADMIN','ATI_FINANCE_ANALYST','ATI_AUDITOR','VENDOR_ADMIN','VENDOR_FINANCE_VIEWER'].includes(actor.role),'FORBIDDEN','Your role cannot access partner financial statements',403);}
export const contribution=(kind:string,amount:string)=>['OPERATOR_FUNDED_DISCOUNT','PAYOUT_EXPORTED','PAYOUT_CONFIRMED'].includes(kind)?new Decimal(0):new Decimal(amount);
export async function ledger(tx:Prisma.TransactionClient,actor:Actor,partnerId:string,kind:string,amount:string,sourceId:string,key:string,snapshot:unknown){
  const now=(await tx.demoClock.findUniqueOrThrow({where:{id:'main'}})).now;
  return tx.financialEvent.upsert({where:{idempotencyKey:key},update:{},create:{companyId:actor.companyId,partnerId,market:actor.markets[0],kind,amount,currency:'AED',sourceId,idempotencyKey:key,snapshot:json(snapshot),createdAt:now}});
}
export async function recognizeDelivery(tx:Prisma.TransactionClient,actor:Actor,leg:FulfilmentLeg){
  for(const line of leg.lines as ReservedLine[]){
    const gross=new Decimal(line.unitGross).mul(line.quantity).toFixed(2),calc=payable(gross,line.vendorDiscount,line.commissionRate),key=`sale:${leg.id}:${line.id}`;
    const snapshot={line,calculation:calc,deliveredLegId:leg.id,merchantOfRecord:'ATI'};
    for(const [kind,amount] of [['SALE_RECOGNISED',gross],['VENDOR_FUNDED_DISCOUNT',new Decimal(line.vendorDiscount).negated().toFixed(2)],['OPERATOR_FUNDED_DISCOUNT',new Decimal(line.operatorDiscount).negated().toFixed(2)],['COMMISSION_ACCRUED',new Decimal(calc.commission).negated().toFixed(2)]])await ledger(tx,actor,leg.partnerId,kind,amount,`${leg.id}:${line.id}`,`${key}:${kind}`,snapshot);
  }
}
export const statementCreate=z.object({partnerId:z.string(),from:z.string().datetime(),to:z.string().datetime()}).strict();
export async function createStatement(actor:Actor,input:z.infer<typeof statementCreate>,correlationId:string){
  permit(actor,'finance',true);requireCondition(new Date(input.from)<new Date(input.to),'INVALID_PERIOD','Statement end must be after start');
  return transaction(async tx=>{
    const partner=await tx.partner.findFirst({where:{id:input.partnerId,companyId:actor.companyId,markets:{hasSome:actor.markets}}});requireCondition(partner,'NOT_FOUND','Partner not found',404);
    const result=await tx.settlement.create({data:{companyId:actor.companyId,partnerId:input.partnerId,market:actor.markets[0],currency:'AED',status:'DRAFT',from:new Date(input.from),to:new Date(input.to),payable:'0',evidence:{eventIds:[]}}});
    await audit(tx,actor,correlationId,'statement.create',result.id,null,result,undefined,partner.id);return result;
  });
}
export const statementCommand=z.object({action:z.enum(['calculate','review','lock','export','confirm-payment']),expectedVersion:z.number().int().positive(),reason:z.string().trim().min(5).max(1000)}).strict();
export async function commandStatement(actor:Actor,id:string,input:z.infer<typeof statementCommand>,correlationId:string){
  permit(actor,'finance',true);
  return transaction(async tx=>{
    const s=await tx.settlement.findFirst({where:{id,...scope(actor)}});requireCondition(s,'NOT_FOUND','Statement not found',404);
    requireCondition(s.version===input.expectedVersion,'STALE_STATEMENT','Refresh this statement before continuing',409);
    const allowed={calculate:['DRAFT','CALCULATED','REVIEWED'],review:['CALCULATED'],lock:['REVIEWED'],export:['LOCKED'],'confirm-payment':['EXPORTED']}[input.action];
    requireCondition(allowed.includes(s.status),'INVALID_TRANSITION',`Cannot ${input.action} while ${s.status}`,409);
    const candidates=await tx.financialEvent.findMany({where:{companyId:s.companyId,partnerId:s.partnerId,market:s.market,currency:s.currency,settlementId:null,createdAt:{gte:s.from,lt:s.to},kind:{notIn:['PAYOUT_EXPORTED','PAYOUT_CONFIRMED']}},orderBy:{id:'asc'}});
    const evidence=s.evidence as {eventIds:string[]};
    if(['review','lock'].includes(input.action))requireCondition(JSON.stringify(evidence.eventIds)===JSON.stringify(candidates.map(e=>e.id)),'RECONCILIATION_CHANGED','Ledger changed or entries were claimed by another statement; recalculate first',409);
    let data:Prisma.SettlementUpdateInput={version:{increment:1}};
    if(input.action==='calculate'){
      requireCondition(candidates.length,'EMPTY_STATEMENT','No unassigned ledger entries in this period');
      const sum=candidates.reduce((total,e)=>total.plus(contribution(e.kind,e.amount.toString())),new Decimal(0));
      data={...data,status:'CALCULATED',payable:sum.toFixed(2),evidence:json({eventIds:candidates.map(e=>e.id),events:candidates,reconciledAt:(await tx.demoClock.findUniqueOrThrow({where:{id:'main'}})).now,convention:'Signed vendor-payable contributions; operator-funded discounts and payout markers excluded',reason:input.reason})};
    }
    if(input.action==='review')data.status='REVIEWED';
    if(input.action==='lock'){
      const claimed=await tx.financialEvent.updateMany({where:{id:{in:evidence.eventIds},settlementId:null},data:{settlementId:id}});requireCondition(claimed.count===evidence.eventIds.length,'STATEMENT_CONFLICT','Some ledger entries were already assigned',409);data.status='LOCKED';
    }
    if(input.action==='export'){
      requireCondition(s.payable.gte(0),'NEGATIVE_PAYOUT','A negative balance must be carried forward or adjusted; no negative payout export');data.status='EXPORT_PENDING';
      const partner=await tx.partner.findUniqueOrThrow({where:{id:s.partnerId}});requireCondition(partner.erpVendorId,'ERP_VENDOR_MISSING','An ERP vendor identity is required for export');
      await enqueue(tx,actor,correlationId,'FINANCE','exportStatement',id,{statementId:id,partnerId:s.partnerId,erpVendorId:partner.erpVendorId,currency:s.currency,payable:s.payable.toFixed(2),eventIds:evidence.eventIds},`statement:${id}:export`,s.partnerId);
    }
    if(input.action==='confirm-payment'){
      requireCondition(readEnv().DEMO_MODE==='true','DEMO_ONLY','Manual payout confirmation is a local demonstration control',403);
      data.status='PAYMENT_PENDING';await enqueue(tx,actor,correlationId,'FINANCE','confirmPayout',id,{statementId:id,exportedId:s.exportedId,payable:s.payable.toFixed(2),currency:s.currency,demoOnly:true},`statement:${id}:payment`,s.partnerId);
    }
    const updated=await tx.settlement.update({where:{id},data});await audit(tx,actor,correlationId,`statement.${input.action}`,id,s,updated,input.reason,s.partnerId);return updated;
  });
}
export const adjustmentInput=z.object({partnerId:z.string(),amount:z.string().regex(/^-?\d{1,9}(\.\d{1,2})?$/),reason:z.string().trim().min(10).max(1000),requestId:z.string().min(8).max(100)}).strict();
export async function adjustment(actor:Actor,input:z.infer<typeof adjustmentInput>,correlationId:string){
  permit(actor,'finance',true);requireCondition(!new Decimal(input.amount).isZero(),'ZERO_ADJUSTMENT','Adjustment must be non-zero');
  return transaction(async tx=>{
    requireCondition(await tx.partner.count({where:{id:input.partnerId,companyId:actor.companyId,markets:{hasSome:actor.markets}}}),'NOT_FOUND','Partner not found',404);
    const key=`adjustment:${actor.companyId}:${input.requestId}`;const old=await tx.financialEvent.findUnique({where:{idempotencyKey:key}});
    if(old){requireCondition(old.partnerId===input.partnerId&&old.amount.eq(input.amount)&&(old.snapshot as {reason:string}).reason===input.reason,'ADJUSTMENT_CONFLICT','Adjustment reference already used with different content',409);return old;}
    const event=await ledger(tx,actor,input.partnerId,'MANUAL_ADJUSTMENT',input.amount,input.requestId,key,{reason:input.reason,actorId:actor.id});await audit(tx,actor,correlationId,'finance.adjustment',event.id,null,event,input.reason,input.partnerId);return event;
  });
}
