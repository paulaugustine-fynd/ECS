import { z } from 'zod';
import { permit, scope, isVendor, type Actor } from '../auth/policy';
import { audit, enqueue, transaction } from '../db/transaction';
import { requireCondition } from './errors';
import { sellable } from './calculations';
import type { Prisma } from '@prisma/client';
import {hasBrandRight} from './brand-policy';
import {hasCurrentPublication} from './publication-policy';
import {mappingReadiness} from './mappings';
export function stockEligible(row:{product:Parameters<typeof hasCurrentPublication>[0]&{companyId:string;partnerId:string;status:string;saleStatus:string;brand:string;category:string;market:string;partner:{status:string;markets:string[];brandRights:Parameters<typeof hasBrandRight>[0]}};location:{companyId:string;partnerId:string|null;status:string;market:string;fyndId:string|null}},now:Date){
 return row.product.saleStatus==='ENABLED'&&row.product.status==='PUBLISHED'&&hasCurrentPublication(row.product)&&row.product.partner.status==='ACTIVE'&&row.product.partner.markets.includes(row.product.market)&&row.location.companyId===row.product.companyId&&(!row.location.partnerId||row.location.partnerId===row.product.partnerId)&&row.location.status==='ACTIVE'&&row.location.market===row.product.market&&Boolean(row.location.fyndId)&&hasBrandRight(row.product.partner.brandRights,row.product,now);
}
export async function queueStock(tx:Prisma.TransactionClient,actor:Actor,id:string,correlationId:string){
  const row=await tx.inventory.findUniqueOrThrow({where:{id},include:{product:{include:{publications:true,partner:{include:{brandRights:true}}}},location:true}});
  const eligible=stockEligible(row,(await tx.demoClock.findUniqueOrThrow({where:{id:'main'}})).now)&&(await mappingReadiness(tx,row.product.partnerId)).passed;
  await tx.inventory.update({where:{id},data:{lastEligible:eligible}});
  const atp=sellable(row,eligible);
  for(const target of ['FYND','SFCC'] as const)await enqueue(tx,{...actor,markets:[row.product.market]},correlationId,target,'syncInventory',id,{inventoryId:id,sku:row.product.sku,locationId:row.locationId,fyndLocationId:row.location.fyndId,sequence:row.sequence,revision:row.revision,onHand:row.onHand,reserved:row.reserved,sellable:atp},`stock:${id}:r${row.revision}:${target}`,row.product.partnerId);
  return atp;
}
// Expiry and partner/location state are rechecked by both worker transports.
// A new inventory revision prevents late older stock messages restoring availability.
export async function reconcileAvailability(tx:Prisma.TransactionClient,partnerId?:string,correlationId='availability-reconciliation'){
 const now=(await tx.demoClock.findUniqueOrThrow({where:{id:'main'}})).now;
 const rows=await tx.inventory.findMany({where:partnerId?{product:{partnerId}}:{},include:{product:{include:{publications:true,partner:{include:{brandRights:true}}}},location:true}});
 let changed=0;
 const mapped=new Map<string,boolean>();
 for(const row of rows){if(!mapped.has(row.product.partnerId))mapped.set(row.product.partnerId,(await mappingReadiness(tx,row.product.partnerId)).passed);const eligible=stockEligible(row,now)&&mapped.get(row.product.partnerId)!;if(row.lastEligible===eligible)continue;
  await tx.inventory.update({where:{id:row.id},data:{lastEligible:eligible,revision:{increment:1},syncedAt:null}});
  const actor={id:'eligibility-worker',companyId:row.product.companyId,partnerId:null,markets:[row.product.market],role:'ATI_SUPER_ADMIN'};
  await queueStock(tx,actor,row.id,correlationId);
  await audit(tx,actor,correlationId,'inventory.eligibility',row.id,{eligible:row.lastEligible},{eligible,revision:row.revision+1},'Current partner, brand/category/market rights, product and location gates; existing reservations unchanged',row.product.partnerId);changed++;
 }
 return changed;
}
export const stockUpdate=z.object({expectedSequence:z.number().int().nonnegative(),sourceSequence:z.number().int().positive(),onHand:z.number().int().min(0).max(10000000),damaged:z.number().int().min(0),unavailable:z.number().int().min(0),safetyStock:z.number().int().min(0),reason:z.string().trim().min(5).max(1000)}).strict();
export async function updateStock(actor:Actor,id:string,input:z.infer<typeof stockUpdate>,correlationId:string){
  permit(actor,'fulfilment');
  return transaction(async tx=>{
    const row=await tx.inventory.findFirst({where:{id,product:scope(actor)},include:{product:{include:{partner:true}},location:true}});
    requireCondition(row,'NOT_FOUND','Inventory position not found',404);
    requireCondition(!isVendor(actor)||row.location.partnerId===actor.partnerId,'WAREHOUSE_OWNERSHIP','ATI controls stock at operator warehouses',403);
    requireCondition(row.sequence===input.expectedSequence&&input.sourceSequence>row.sequence,'STALE_STOCK','Refresh this position; stale stock updates are rejected',409);
    requireCondition(input.onHand>=row.reserved+input.damaged+input.unavailable,'RESERVATIONS_PROTECTED','Physical stock cannot be lower than reserved and non-sellable units');
    const updated=await tx.inventory.update({where:{id},data:{onHand:input.onHand,damaged:input.damaged,unavailable:input.unavailable,safetyStock:input.safetyStock,sequence:input.sourceSequence,revision:{increment:1},syncedAt:null}});
    const atp=await queueStock(tx,actor,id,correlationId);
    await audit(tx,actor,correlationId,'inventory.adjust',id,row,updated,input.reason,row.product.partnerId);
    return {...updated,sellable:atp};
  });
}
