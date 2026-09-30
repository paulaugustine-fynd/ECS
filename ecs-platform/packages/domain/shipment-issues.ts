import {z} from 'zod';
import {type Actor,permit,scope} from '../auth/policy';
import {audit,transaction} from '../db/transaction';
import {requireCondition} from './errors';
import {openException} from './exception-lifecycle';
import {notifyOperations} from './notifications';
export const shipmentIssueInput=z.object({requestKey:z.string().uuid(),expectedShipmentVersion:z.number().int().positive(),code:z.enum(['STOCK_MISMATCH','DAMAGED_ITEM','PICK_PACK_DELAY','CARRIER_DELAY','DELIVERY_ISSUE','OTHER']),severity:z.enum(['WARNING','CRITICAL']),details:z.string().trim().min(10).max(1000)}).strict();
export async function reportShipmentIssue(actor:Actor,shipmentId:string,raw:z.infer<typeof shipmentIssueInput>,correlationId:string){
 permit(actor,'fulfilment');const input=shipmentIssueInput.parse(raw);
 return transaction(async tx=>{
  const leg=await tx.fulfilmentLeg.findFirst({where:{id:shipmentId,...scope(actor)}});requireCondition(leg,'NOT_FOUND','Shipment not found',404);
  const previous=await tx.shipmentIssue.findUnique({where:{companyId_reporterId_requestKey:{companyId:actor.companyId,reporterId:actor.id,requestKey:input.requestKey}}});
  if(previous){
   requireCondition(previous.shipmentId===leg.id&&previous.code===input.code&&previous.severity===input.severity&&previous.details===input.details&&previous.reportedVersion===input.expectedShipmentVersion,'IDEMPOTENCY_CONFLICT','This request key was already used for a different report',409);
   const exception=await tx.exception.findUniqueOrThrow({where:{kind_entityId:{kind:'FULFILMENT',entityId:previous.id}}});return {issueId:previous.id,exceptionId:exception.id,duplicate:true};
  }
  requireCondition(leg.version===input.expectedShipmentVersion,'STALE_SHIPMENT','Shipment changed. Refresh before reporting.',409);
  const issue=await tx.shipmentIssue.create({data:{companyId:leg.companyId,partnerId:leg.partnerId,market:leg.market,shipmentId:leg.id,reporterId:actor.id,requestKey:input.requestKey,code:input.code,severity:input.severity,details:input.details,reportedStatus:leg.status,reportedVersion:leg.version}});
  const exception=await openException(tx,{companyId:leg.companyId,partnerId:leg.partnerId,market:leg.market,kind:'FULFILMENT',entityId:issue.id,message:input.details});
  await audit(tx,{...actor,markets:[leg.market]},correlationId,'exception.report',exception.id,null,{issueId:issue.id,shipmentId:leg.id,code:issue.code,severity:issue.severity,reportedStatus:leg.status,reportedVersion:leg.version},input.details,leg.partnerId);
  await notifyOperations(tx,{companyId:leg.companyId,partnerId:leg.partnerId,market:leg.market,category:'FULFILMENT',severity:issue.severity as 'WARNING'|'CRITICAL',entityType:'EXCEPTION',entityId:exception.id,eventKey:`shipment-issue:${issue.id}:reported`,title:`Shipment issue: ${issue.code.replaceAll('_',' ').toLowerCase()}`,message:'A shipment issue requires investigation. Open the scoped exception record for details. Shipment status, stock and SLA deadlines are unchanged.',eventAt:issue.createdAt});
  return {issueId:issue.id,exceptionId:exception.id,duplicate:false};
 });
}
export async function listShipmentIssues(actor:Actor,shipmentId:string){
 permit(actor,'fulfilment');return transaction(async tx=>{
  const leg=await tx.fulfilmentLeg.findFirst({where:{id:shipmentId,...scope(actor)}});requireCondition(leg,'NOT_FOUND','Shipment not found',404);
  const rows=await tx.shipmentIssue.findMany({where:{shipmentId,...scope(actor)},orderBy:[{createdAt:'desc'},{id:'desc'}],take:100});
  const exceptions=await tx.exception.findMany({where:{...scope(actor),kind:'FULFILMENT',entityId:{in:rows.map(r=>r.id)}}});
  return {items:rows.map(r=>({id:r.id,code:r.code,severity:r.severity,details:r.details,reportedStatus:r.reportedStatus,reportedVersion:r.reportedVersion,createdAt:r.createdAt,exceptionId:exceptions.find(e=>e.entityId===r.id)?.id??null,status:exceptions.find(e=>e.entityId===r.id)?.status??'UNAVAILABLE'})),limit:100};
 });
}
