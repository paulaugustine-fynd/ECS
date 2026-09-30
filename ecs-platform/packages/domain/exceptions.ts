import {z} from 'zod';
import type {Exception,Prisma} from '@prisma/client';
import {type Actor,scope,isVendor} from '../auth/policy';
import {transaction,audit} from '../db/transaction';
import {requireCondition} from './errors';
import {notifyOperations} from './notifications';
export const exceptionKinds=['SLA','CATALOG_REVIEW','INTEGRATION_DLQ','INBOX_DLQ','FULFILMENT'] as const;
const roles:Record<string,readonly string[]>={ATI_SUPER_ADMIN:exceptionKinds,ATI_OPERATIONS_MANAGER:['SLA','INTEGRATION_DLQ','INBOX_DLQ','FULFILMENT'],ATI_CATALOG_MODERATOR:['CATALOG_REVIEW'],VENDOR_ADMIN:['SLA','CATALOG_REVIEW','FULFILMENT'],VENDOR_FULFILMENT_OPERATOR:['SLA','FULFILMENT'],VENDOR_CATALOG_MANAGER:['CATALOG_REVIEW']};
export function exceptionAccess(actor:Actor){const kinds=roles[actor.role]??[];requireCondition(kinds.length,'FORBIDDEN','Your role has no operational exception workspace',403);return kinds;}
function owner(actor:Actor,market?:string):Prisma.ExceptionWhereInput{return {...scope(actor,market),kind:{in:[...exceptionAccess(actor)]}};}
export const exceptionQuery=z.object({kind:z.enum(exceptionKinds).optional(),status:z.enum(['ACTIONABLE','ALL','OPEN','REPLAY_REQUESTED','RESOLVED','WAIVED']).default('ACTIONABLE'),market:z.string().regex(/^[A-Z]{2}$/).optional(),ownership:z.enum(['ALL','MINE','UNASSIGNED']).default('ALL'),page:z.coerce.number().int().positive().max(10000).default(1),limit:z.coerce.number().int().positive().max(100).default(25)}).strict();
export const exceptionCommand=z.object({action:z.enum(['CLAIM','RELEASE','COMMENT','RESOLVE_REPORT']),expectedVersion:z.number().int().positive(),reason:z.string().trim().min(10).max(1000)}).strict();
const actionable=(e:Exception)=>['OPEN','REPLAY_REQUESTED'].includes(e.status);
async function project(tx:Prisma.TransactionClient,actor:Actor,rows:Exception[]){
 const [users,milestones,products,partners,jobs,receipts,reports]=await Promise.all([
  tx.user.findMany({where:{companyId:actor.companyId,id:{in:rows.flatMap(e=>e.assigneeId?[e.assigneeId]:[])}},select:{id:true,name:true,active:true}}),
  tx.slaMilestone.findMany({where:{id:{in:rows.filter(e=>e.kind==='SLA').map(e=>e.entityId)},...scope(actor)}}),
  tx.product.findMany({where:{id:{in:rows.filter(e=>e.kind==='CATALOG_REVIEW').map(e=>e.entityId)},...scope(actor)},select:{id:true,sku:true,status:true}}),
  tx.partner.findMany({where:{companyId:actor.companyId,id:{in:rows.flatMap(e=>e.partnerId?[e.partnerId]:[])}},select:{id:true,displayName:true}}),
  tx.outbox.findMany({where:{id:{in:rows.filter(e=>e.kind==='INTEGRATION_DLQ').map(e=>e.entityId)},...scope(actor)},select:{id:true,status:true}}),
  tx.inbox.findMany({where:{id:{in:rows.filter(e=>e.kind==='INBOX_DLQ').map(e=>e.entityId)},companyId:actor.companyId,market:{in:actor.markets}},select:{id:true,status:true}}),
  tx.shipmentIssue.findMany({where:{id:{in:rows.filter(e=>e.kind==='FULFILMENT').map(e=>e.entityId)},...scope(actor)},include:{shipment:{select:{id:true,status:true}}}}),
 ]);
 return rows.map(e=>{
  const milestone=milestones.find(m=>m.id===e.entityId),product=products.find(p=>p.id===e.entityId),job=jobs.find(j=>j.id===e.entityId),receipt=receipts.find(r=>r.id===e.entityId),assignee=users.find(u=>u.id===e.assigneeId);
  const report=reports.find(r=>r.id===e.entityId);
  const source=report?{type:'SHIPMENT',id:report.shipment.id,status:report.shipment.status}:milestone?{type:milestone.entityType,id:milestone.entityId,status:milestone.status}:product?{type:'PRODUCT',id:product.id,status:product.status}:job?{type:'INTEGRATION_JOB',id:job.id,status:job.status}:receipt?{type:'INBOX_RECEIPT',id:receipt.id,status:receipt.status}:null;
  const label=e.kind==='FULFILMENT'?`Shipment issue · ${report?.code.replaceAll('_',' ').toLowerCase()??'reported issue'}`:e.kind==='SLA'?`${milestone?.stage.replaceAll('_',' ')??'SLA'} service-level exception`:e.kind==='CATALOG_REVIEW'?`Catalogue review · ${product?.sku??e.entityId}`:e.kind==='INTEGRATION_DLQ'?'Outbound integration failure':'Inbound processing failure';
  const canRelease=!!e.assigneeId&&(e.assigneeId===actor.id||!isVendor(actor));
  return {id:e.id,kind:e.kind,status:e.status,version:e.version,partnerId:e.partnerId,partnerName:partners.find(p=>p.id===e.partnerId)?.displayName??null,market:e.market,title:label,summary:['SLA','CATALOG_REVIEW','FULFILMENT'].includes(e.kind)?e.message:'Open the restricted integration trace for the failure evidence. No payload or error body is included in this queue.',reason:e.reason,createdAt:e.createdAt,updatedAt:e.updatedAt,resolvedAt:e.resolvedAt,assignee:assignee?{id:assignee.id,name:assignee.name,active:assignee.active}:null,source,actions:actionable(e)?[...(!e.assigneeId?['CLAIM']:[]),...(canRelease?['RELEASE']:[]),'COMMENT',...(report&&!isVendor(actor)?['RESOLVE_REPORT']:[])]:[],canReplay:!isVendor(actor)&&!!(job??receipt)&&['DEAD_LETTER','RETRY'].includes((job??receipt)!.status)};
 });
}
export async function listExceptions(actor:Actor,input:z.infer<typeof exceptionQuery>){
 return transaction(async tx=>{
  const base:Prisma.ExceptionWhereInput={...owner(actor,input.market),...(input.kind?{AND:[{kind:input.kind}]}:{}),...(input.ownership==='MINE'?{assigneeId:actor.id}:input.ownership==='UNASSIGNED'?{assigneeId:null}:{})};
  const where={...base,...(input.status==='ALL'?{}:input.status==='ACTIONABLE'?{status:{in:['OPEN','REPLAY_REQUESTED']}}:{status:input.status})};
  const [rows,total,groups,unassigned]=await Promise.all([tx.exception.findMany({where,orderBy:[{updatedAt:'desc'},{id:'desc'}],take:input.limit,skip:(input.page-1)*input.limit}),tx.exception.count({where}),tx.exception.groupBy({by:['status'],where:base,_count:{_all:true}}),tx.exception.count({where:{AND:[base,{assigneeId:null,status:{in:['OPEN','REPLAY_REQUESTED']}}]}})]);
  const count=(s:string)=>groups.find(g=>g.status===s)?._count._all??0;
  return {items:await project(tx,actor,rows),total,page:input.page,limit:input.limit,kinds:exceptionAccess(actor),metrics:{open:count('OPEN'),replayRequested:count('REPLAY_REQUESTED'),resolved:count('RESOLVED'),waived:count('WAIVED'),unassigned}};
 });
}
export async function getException(actor:Actor,id:string){
 return transaction(async tx=>{
  const e=await tx.exception.findFirst({where:{id,...owner(actor)}});requireCondition(e,'NOT_FOUND','Exception not found',404);
  const events=await tx.auditEvent.findMany({where:{companyId:actor.companyId,market:e.market,entityId:id,action:{startsWith:'exception.'}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:50,select:{id:true,actorId:true,action:true,reason:true,createdAt:true}});
  const users=await tx.user.findMany({where:{companyId:actor.companyId,id:{in:events.map(e=>e.actorId)}},select:{id:true,name:true}});
  return {item:(await project(tx,actor,[e]))[0],activity:events.map(event=>({id:event.id,action:event.action,reason:event.reason,createdAt:event.createdAt,actorName:users.find(u=>u.id===event.actorId)?.name??'Former workspace user'}))};
 });
}
export async function commandException(actor:Actor,id:string,input:z.infer<typeof exceptionCommand>,correlationId:string){
 input=exceptionCommand.parse(input);
 return transaction(async tx=>{
  const e=await tx.exception.findFirst({where:{id,...owner(actor)}});requireCondition(e,'NOT_FOUND','Exception not found',404);
  requireCondition(e.version===input.expectedVersion,'STALE_EXCEPTION','Exception changed. Refresh before acting.',409);requireCondition(actionable(e),'EXCEPTION_CLOSED','Completed exceptions are read-only; reopen through the source workflow.',409);
  if(input.action==='CLAIM')requireCondition(!e.assigneeId,'ALREADY_ASSIGNED','This exception already has an owner. Ask them or ATI to release it first.',409);
  if(input.action==='RELEASE')requireCondition(e.assigneeId&&(e.assigneeId===actor.id||!isVendor(actor)),'NOT_ASSIGNEE','Only the assigned user or an authorized ATI operator may release ownership.',403);
  if(input.action==='RESOLVE_REPORT'){
   requireCondition(e.kind==='FULFILMENT'&&!isVendor(actor),'SOURCE_RESOLUTION_REQUIRED','Only ATI fulfilment operators can resolve a reported shipment issue; other exception types require source resolution.',403);
   requireCondition(await tx.shipmentIssue.findFirst({where:{id:e.entityId,...scope(actor)}}),'NOT_FOUND','Shipment issue not found',404);
  }
  const updated=await tx.exception.update({where:{id},data:{version:{increment:1},...(input.action==='CLAIM'?{assigneeId:actor.id}:input.action==='RELEASE'?{assigneeId:null}:input.action==='RESOLVE_REPORT'?{status:'RESOLVED',reason:input.reason,resolvedAt:new Date()}:{})}});
  await audit(tx,{...actor,markets:[e.market]},correlationId,`exception.${input.action.toLowerCase()}`,id,{status:e.status,assigneeId:e.assigneeId,version:e.version},{status:updated.status,assigneeId:updated.assigneeId,version:updated.version},input.reason,e.partnerId??undefined);
  if(input.action==='RESOLVE_REPORT')await notifyOperations(tx,{companyId:e.companyId,partnerId:e.partnerId,market:e.market,category:'FULFILMENT',severity:'WARNING',entityType:'EXCEPTION',entityId:e.id,eventKey:`shipment-issue:${e.entityId}:resolved`,title:'Shipment investigation resolved by ATI',message:'ATI recorded a resolution. Review the investigation history; shipment, stock, finance and SLA state are unchanged by this action.',eventAt:updated.resolvedAt!});
  return (await project(tx,actor,[updated]))[0];
 });
}
