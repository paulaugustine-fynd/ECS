import {z} from 'zod';
import type {Prisma} from '@prisma/client';
import {type Actor,permit,scope} from '../auth/policy';
import {audit,transaction} from '../db/transaction';
import {requireCondition} from './errors';
import {queueStock,stockEligible} from './inventory';
import {sellable} from './calculations';
import {catalogIssues} from './catalog';
import {hasCurrentPublication} from './publication-policy';
import {mappingReadiness} from './mappings';

export const salesControlInput=z.object({action:z.enum(['pause','delist','restore']),expectedVersion:z.number().int().positive(),reason:z.string().trim().min(5).max(1000)}).strict();

async function evidence(tx:Prisma.TransactionClient,actor:Actor,id:string){
 const p=await tx.product.findFirst({where:{id,...scope(actor)},include:{publications:true,partner:{include:{brandRights:true}},inventory:{include:{location:true}}}});
 requireCondition(p,'NOT_FOUND','Product not found',404);
 const now=(await tx.demoClock.findUniqueOrThrow({where:{id:'main'}})).now,mapped=(await mappingReadiness(tx,p.partnerId)).passed;
 const positions=await Promise.all(p.inventory.map(async row=>{
  const atp=sellable(row,stockEligible({...row,product:p},now)&&mapped);
  const targets=await Promise.all((['FYND','SFCC'] as const).map(async target=>{
   const key=`stock:${row.id}:r${row.revision}:${target}`;
   const job=await tx.outbox.findUnique({where:{idempotencyKey:key}}),remote=await tx.mockInventory.findUnique({where:{system_inventoryId:{system:target,inventoryId:row.id}}});
   const payload=job?.payload as {revision?:number;sellable?:number}|undefined;
   const acknowledged=job?.status==='SUCCEEDED'&&job.destinationMode==='mock'&&job.companyId===p.companyId&&job.partnerId===p.partnerId&&job.market===p.market&&payload?.revision===row.revision&&payload.sellable===atp;
   return {target,status:job?.status??'NOT_REQUESTED',verified:Boolean(acknowledged&&remote?.revision===row.revision&&remote.sellable===atp),observedSellable:remote?.sellable??null,observedRevision:remote?.revision??null};
  }));
  return {id:row.id,location:row.location.name,onHand:row.onHand,reserved:row.reserved,revision:row.revision,sellable:atp,targets};
 }));
 const history=await tx.auditEvent.findMany({where:{companyId:p.companyId,partnerId:p.partnerId,market:p.market,entityId:id,action:{startsWith:'catalog.sales-'}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:50});
 const openShipments=await tx.fulfilmentLeg.count({where:{companyId:p.companyId,partnerId:p.partnerId,market:p.market,status:{notIn:['DELIVERED','CANCELLED']},lines:{array_contains:[{productId:id}]}}});
 return {id:p.id,sku:p.sku,market:p.market,status:p.saleStatus,version:p.saleVersion,effectiveAt:p.saleChangedAt,reason:p.saleReason,openShipments,mode:'mock' as const,positions,history:history.map(h=>({id:h.id,action:h.action,actorId:h.actorId,reason:h.reason,at:h.createdAt})),notice:'ECS blocks new orders immediately. FYND/SFCC availability changes asynchronously; verified means current local mock acknowledgement and read-back, not a live channel update. Physical stock, reservations and open orders are retained.'};
}
export async function readSalesControl(actor:Actor,id:string){return transaction(tx=>evidence(tx,actor,id));}
export async function commandSalesControl(actor:Actor,id:string,input:z.infer<typeof salesControlInput>,correlationId:string){
 permit(actor,'catalog',true);
 return transaction(async tx=>{
  const p=await tx.product.findFirst({where:{id,...scope(actor)},include:{publications:true,partner:true}});
  requireCondition(p,'NOT_FOUND','Product not found',404);
  requireCondition(p.saleVersion===input.expectedVersion,'STALE_VERSION','Refresh sales controls before making another decision',409);
  const allowed={pause:['ENABLED'],delist:['ENABLED','PAUSED'],restore:['PAUSED','DELISTED']};
  requireCondition(allowed[input.action].includes(p.saleStatus),'INVALID_TRANSITION',`Cannot ${input.action} an item that is ${p.saleStatus}`,409);
  if(input.action==='restore'){
   requireCondition(p.status==='PUBLISHED'&&hasCurrentPublication(p)&&p.partner.status==='ACTIVE','RESTORE_NOT_READY','Restore requires an active partner and the current fully published product',409);
   const issues=await catalogIssues(tx,p);requireCondition(!issues.length,'RESTORE_NOT_READY',issues.map(i=>i.message).join('; '),409);
  }
  const next=input.action==='pause'?'PAUSED':input.action==='delist'?'DELISTED':'ENABLED';
  const at=(await tx.demoClock.findUniqueOrThrow({where:{id:'main'}})).now;
  await tx.product.update({where:{id},data:{saleStatus:next,saleVersion:{increment:1},saleChangedAt:at,saleReason:input.reason}});
  const positions=await tx.inventory.findMany({where:{productId:id}});
  // Always issue a fresh revision, even when another gate already made ATP zero.
  // Physical quantities/source sequence remain untouched; older receipts cannot win.
  for(const row of positions){await tx.inventory.update({where:{id:row.id},data:{revision:{increment:1},syncedAt:null}});await queueStock(tx,{...actor,markets:[p.market]},row.id,correlationId);}
  await audit(tx,{...actor,markets:[p.market]},correlationId,`catalog.sales-${input.action}`,id,{status:p.saleStatus,version:p.saleVersion},{status:next,version:p.saleVersion+1,effectiveAt:at,positions:positions.map(r=>r.id)},input.reason,p.partnerId);
  return evidence(tx,actor,id);
 });
}
