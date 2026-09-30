import {z} from 'zod';
import type {Prisma,SlaMilestone} from '@prisma/client';
import {type Actor,permit,scope} from '../auth/policy';
import {db} from '../db/client';
import {audit,transaction} from '../db/transaction';
import {requireCondition} from './errors';
import {notifyOperations} from './notifications';
import {openException,transitionException} from './exception-lifecycle';

export const slaStages=['CONFIRMATION','PICK','PACK','DISPATCH','DELIVERY','RETURN_VERIFICATION','RETURN_PICKUP','QC','REFUND_ACK'] as const;
type Stage=typeof slaStages[number];
// Demonstration policies, not contractual Fynd/ATI service commitments.
export const defaultSla:Record<Stage,[number,number]>={CONFIRMATION:[60,15],PICK:[120,30],PACK:[120,30],DISPATCH:[120,30],DELIVERY:[2880,240],RETURN_VERIFICATION:[240,60],RETURN_PICKUP:[2880,240],QC:[240,60],REFUND_ACK:[1440,120]};
export function slaStage(type:string,status:string):Stage|null{
 return (type==='SHIPMENT'?{AWAITING_FYND:'CONFIRMATION',ASSIGNED:'CONFIRMATION',ACCEPTED:'PICK',PICKING:'PACK',PACKED:'DISPATCH',READY_TO_DISPATCH:'DISPATCH'}[status]??(status==='DISPATCHED'?'DELIVERY':null):{REQUESTED:'RETURN_VERIFICATION',APPROVAL_PENDING:'RETURN_VERIFICATION',APPROVED:'RETURN_PICKUP',PICKUP_PENDING:'RETURN_PICKUP',PICKUP_BOOKED:'RETURN_PICKUP',RECEIVED:'QC',QC_FAILED:'QC',REFUND_PENDING:'REFUND_ACK'}[status]) as Stage|null??null;
}
type Entity={id:string;companyId:string;partnerId:string;market:string;status:string;createdAt:Date;deadline?:Date};
const actorFor=(e:{companyId:string;partnerId:string;market:string}):Actor=>({id:'sla-monitor',role:'ATI_SUPER_ADMIN',companyId:e.companyId,partnerId:e.partnerId,markets:[e.market]});
export function slaState(m:{deadline:Date;atRiskAt:Date},now:Date){return now>m.deadline?'BREACHED':now>=m.atRiskAt?'AT_RISK':'ON_TRACK';}
async function observe(tx:Prisma.TransactionClient,m:SlaMilestone,now:Date,correlationId:string){
 if(['RESOLVED','WAIVED'].includes(m.status))return m;
 const status=slaState(m,now);
 if(['AT_RISK','BREACHED'].includes(status))await notifyOperations(tx,{companyId:m.companyId,partnerId:m.partnerId,market:m.market,category:'SLA',severity:status==='BREACHED'?'CRITICAL':'WARNING',entityType:m.entityType as 'SHIPMENT'|'RETURN',entityId:m.entityId,eventKey:`sla:${m.id}:${status}`,title:status==='BREACHED'?'SLA breached — action required':'SLA approaching its deadline',message:`${m.stage.replaceAll('_',' ')}: review the ${m.entityType.toLowerCase()} and its stage evidence. The original deadline remains recorded.`,eventAt:status==='BREACHED'?m.deadline:m.atRiskAt});
 if(status===m.status)return m;
 const updated=await tx.slaMilestone.update({where:{id:m.id},data:{status,version:{increment:1},...(status==='BREACHED'?{breachedAt:m.deadline}:{})}});
 // One durable in-app alert/exception per milestone; scoped to its partner and ATI.
 await openException(tx,{companyId:m.companyId,partnerId:m.partnerId,market:m.market,kind:'SLA',entityId:m.id,message:`${m.stage} ${status}: ${m.entityType} ${m.entityId}`,createdAt:now});
 await audit(tx,actorFor(m),correlationId,`sla.${status.toLowerCase()}`,m.id,m,updated,'Demo-clock stage policy',m.partnerId);return updated;
}
/** Call in the same transaction as authoritative status changes; polling only backfills legacy records. */
export async function syncSla(tx:Prisma.TransactionClient,type:'SHIPMENT'|'RETURN',entity:Entity,correlationId:string,origin='EVENT'){
 const now=(await tx.demoClock.findUniqueOrThrow({where:{id:'main'}})).now,stage=slaStage(type,entity.status);
 const prior=await tx.slaMilestone.findMany({where:{entityType:type,entityId:entity.id}});
 for(const m of prior){
  const observed=await observe(tx,m,now,correlationId);
  if(m.stage!==stage&&!m.completedAt){
   const updated=await tx.slaMilestone.update({where:{id:m.id},data:{completedAt:now,status:m.status==='WAIVED'?'WAIVED':'RESOLVED',version:{increment:1}}});
   await transitionException(tx,'SLA',m.id,m.status==='WAIVED'?'WAIVED':'RESOLVED');
   await audit(tx,actorFor(m),correlationId,'sla.resolved',m.id,observed,updated,'Authoritative stage completed',m.partnerId);
  }
 }
 if(!stage)return null;
 let current=prior.find(m=>m.stage===stage);
 if(!current){
  const policy=await tx.slaPolicy.findUnique({where:{companyId_market_stage:{companyId:entity.companyId,market:entity.market,stage}}});
  const [duration,warning]=policy?[policy.durationMinutes,policy.warningMinutes]:defaultSla[stage];
  // Existing downstream records have no reliable stage-start timestamp. Explicitly
  // observe them from now; never fabricate historical SLA compliance.
  const initial=['CONFIRMATION','RETURN_VERIFICATION'].includes(stage);
  const startedAt=origin==='LEGACY_OBSERVED'&&initial?entity.createdAt:now;
  const deadline=origin==='LEGACY_OBSERVED'&&stage==='CONFIRMATION'&&entity.deadline?entity.deadline:new Date(startedAt.getTime()+duration*60000);
  const atRiskAt=new Date(Math.max(startedAt.getTime(),deadline.getTime()-warning*60000));
  current=await tx.slaMilestone.create({data:{companyId:entity.companyId,partnerId:entity.partnerId,market:entity.market,entityType:type,entityId:entity.id,stage,origin,policyVersion:policy?.version??0,startedAt,atRiskAt,deadline}});
  await audit(tx,actorFor(entity),correlationId,'sla.started',current.id,null,current,origin,entity.partnerId);
 }
 if(type==='SHIPMENT')await tx.fulfilmentLeg.update({where:{id:entity.id},data:{deadline:current.deadline}});
 return observe(tx,await tx.slaMilestone.findUniqueOrThrow({where:{id:current.id}}),now,correlationId);
}
export async function reconcileSlas(tx:Prisma.TransactionClient){
 for(const leg of await tx.fulfilmentLeg.findMany({where:{status:{notIn:['DELIVERED','CANCELLED']}}}))await syncSla(tx,'SHIPMENT',leg,'sla-monitor','LEGACY_OBSERVED');
 for(const r of await tx.returnCase.findMany({where:{status:{notIn:['CLOSED','REJECTED']}}}))await syncSla(tx,'RETURN',r,'sla-monitor','LEGACY_OBSERVED');
}
export const slaWaiver=z.object({expectedVersion:z.number().int().positive(),reason:z.string().trim().min(10).max(1000)}).strict();
export async function waiveSla(actor:Actor,id:string,input:z.infer<typeof slaWaiver>,correlationId:string){
 permit(actor,'fulfilment',true);
 return transaction(async tx=>{
  const m=await tx.slaMilestone.findFirst({where:{id,...scope(actor)}});requireCondition(m,'NOT_FOUND','SLA milestone not found',404);
  const entity=m.entityType==='SHIPMENT'?await tx.fulfilmentLeg.findUnique({where:{id:m.entityId}}):await tx.returnCase.findUnique({where:{id:m.entityId}});
  requireCondition(entity&&slaStage(m.entityType,entity.status)===m.stage&&!m.completedAt,'SLA_COMPLETED','Only the current milestone can be waived',409);
  requireCondition(m.version===input.expectedVersion,'STALE_SLA','Refresh the SLA evidence before waiving',409);
  const now=(await tx.demoClock.findUniqueOrThrow({where:{id:'main'}})).now;
  const observed=await observe(tx,m,now,correlationId);
  requireCondition(['AT_RISK','BREACHED'].includes(observed.status),'SLA_NOT_ACTIONABLE','Only an at-risk or breached milestone may be waived',409);
  const updated=await tx.slaMilestone.update({where:{id},data:{status:'WAIVED',version:{increment:1},waivedAt:now,waivedBy:actor.id,reason:input.reason}});
  await transitionException(tx,'SLA',id,'WAIVED',input.reason);
  await audit(tx,{...actor,markets:[m.market]},correlationId,'sla.waived',id,observed,updated,input.reason,m.partnerId);return updated;
 });
}
export const slaQuery=z.object({entityType:z.enum(['SHIPMENT','RETURN']),entityId:z.string().min(1)}).strict();
export async function listSlas(actor:Actor,query:z.infer<typeof slaQuery>){
 permit(actor,'fulfilment');
 const entity=query.entityType==='SHIPMENT'?await db.fulfilmentLeg.findFirst({where:{id:query.entityId,...scope(actor)}}):await db.returnCase.findFirst({where:{id:query.entityId,...scope(actor)}});
 requireCondition(entity,'NOT_FOUND','Operational entity not found',404);
 return {now:(await db.demoClock.findUniqueOrThrow({where:{id:'main'}})).now,items:await db.slaMilestone.findMany({where:{...query,...scope(actor)},orderBy:{startedAt:'asc'}})};
}

export const slaPolicyQuery=z.object({market:z.string().regex(/^[A-Z]{2}$/)}).strict();
export const slaPolicyInput=z.object({market:z.string().regex(/^[A-Z]{2}$/),stage:z.enum(slaStages),expectedVersion:z.number().int().nonnegative(),durationMinutes:z.number().int().min(2).max(43200),warningMinutes:z.number().int().min(1).max(43199),reason:z.string().trim().min(10).max(1000)}).strict().refine(p=>p.warningMinutes<p.durationMinutes,{path:['warningMinutes'],message:'Warning must be shorter than the total stage duration'});
export async function listSlaPolicies(actor:Actor,market:string){
 permit(actor,'fulfilment');scope(actor,market);
 const rows=await db.slaPolicy.findMany({where:{companyId:actor.companyId,market}});
 return {market,appliesTo:'NEW_MILESTONES_ONLY' as const,items:slaStages.map(stage=>{const p=rows.find(p=>p.stage===stage);return {stage,version:p?.version??0,durationMinutes:p?.durationMinutes??defaultSla[stage][0],warningMinutes:p?.warningMinutes??defaultSla[stage][1],source:p?'CONFIGURED' as const:'DEMO_DEFAULT' as const};})};
}
export async function saveSlaPolicy(actor:Actor,raw:z.infer<typeof slaPolicyInput>,correlationId:string){
 permit(actor,'rules',true);const input=slaPolicyInput.parse(raw);scope(actor,input.market);
 return transaction(async tx=>{
  const key={companyId:actor.companyId,market:input.market,stage:input.stage};
  const existing=await tx.slaPolicy.findUnique({where:{companyId_market_stage:key}});
  requireCondition((existing?.version??0)===input.expectedVersion,'STALE_SLA_POLICY','The policy changed. Refresh before saving a new revision.',409);
  const before={stage:input.stage,version:existing?.version??0,durationMinutes:existing?.durationMinutes??defaultSla[input.stage][0],warningMinutes:existing?.warningMinutes??defaultSla[input.stage][1]};
  requireCondition(before.durationMinutes!==input.durationMinutes||before.warningMinutes!==input.warningMinutes,'UNCHANGED_SLA_POLICY','Change a duration or warning threshold before saving');
  const policy=await tx.slaPolicy.upsert({where:{companyId_market_stage:key},create:{...key,durationMinutes:input.durationMinutes,warningMinutes:input.warningMinutes},update:{durationMinutes:input.durationMinutes,warningMinutes:input.warningMinutes,version:{increment:1}}});
  await audit(tx,{...actor,markets:[input.market]},correlationId,'sla.policy-revised',policy.id,before,policy,input.reason);
  return {stage:input.stage,version:policy.version,durationMinutes:policy.durationMinutes,warningMinutes:policy.warningMinutes,source:'CONFIGURED' as const};
 });
}

export const slaQueueQuery=z.object({market:z.string().regex(/^[A-Z]{2}$/).optional(),status:z.enum(['ACTIONABLE','ALL','ON_TRACK','AT_RISK','BREACHED','WAIVED','RESOLVED']).default('ACTIONABLE'),entityType:z.enum(['SHIPMENT','RETURN']).optional(),stage:z.enum(slaStages).optional(),q:z.string().trim().max(100).default(''),page:z.coerce.number().int().positive().max(10000).default(1),limit:z.coerce.number().int().positive().max(100).default(25)}).strict();
export async function slaQueue(actor:Actor,input:z.infer<typeof slaQueueQuery>){
 permit(actor,'fulfilment');const owner=scope(actor,input.market);
 return transaction(async tx=>{
  // Search names are restricted before their identifiers enter the milestone query.
  const names=input.q?await tx.partner.findMany({where:{companyId:actor.companyId,...(actor.role.startsWith('VENDOR_')?{id:actor.partnerId!}:{}),displayName:{contains:input.q,mode:'insensitive'}},select:{id:true}}):[];
  const base:Prisma.SlaMilestoneWhereInput={...owner,...(input.entityType?{entityType:input.entityType}:{}),...(input.stage?{stage:input.stage}:{}),...(input.q?{OR:[{entityId:{contains:input.q,mode:'insensitive'}},{partnerId:{in:names.map(p=>p.id)}},{partnerId:{contains:input.q,mode:'insensitive'}}]}:{})};
  const where:Prisma.SlaMilestoneWhereInput={...base,...(input.status==='ALL'?{}:input.status==='ACTIONABLE'?{status:{in:['AT_RISK','BREACHED']},completedAt:null}:{status:input.status})};
  const [rows,total,groups,breachedEver,clock]=await Promise.all([
   tx.slaMilestone.findMany({where,orderBy:[{deadline:'asc'},{id:'asc'}],take:input.limit,skip:(input.page-1)*input.limit}),
   tx.slaMilestone.count({where}),tx.slaMilestone.groupBy({by:['status'],where:base,_count:{_all:true}}),
   tx.slaMilestone.count({where:{...base,breachedAt:{not:null}}}),tx.demoClock.findUniqueOrThrow({where:{id:'main'}}),
  ]);
  const partners=await tx.partner.findMany({where:{companyId:actor.companyId,id:{in:rows.map(m=>m.partnerId)}},select:{id:true,displayName:true}});
  const count=(state:string)=>groups.find(g=>g.status===state)?._count._all??0;
  return {now:clock.now,page:input.page,limit:input.limit,total,metrics:{onTrack:count('ON_TRACK'),atRisk:count('AT_RISK'),breached:count('BREACHED'),waived:count('WAIVED'),resolved:count('RESOLVED'),breachedEver},items:rows.map(m=>({...m,partnerName:partners.find(p=>p.id===m.partnerId)?.displayName??m.partnerId}))};
 });
}
