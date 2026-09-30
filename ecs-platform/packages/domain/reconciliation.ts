import {z} from 'zod';
import Decimal from 'decimal.js';
import type {Prisma} from '@prisma/client';
import {type Actor,scope} from '../auth/policy';
import {digest} from '../auth/security';
import {transaction,audit} from '../db/transaction';
import {requireCondition} from './errors';
import {reservedLineResponse} from '../contracts/fulfilment-responses';
import {payable} from './calculations';
import {contribution,recognizeDelivery} from './finance';
import {readEnv} from '../config/env';
import {orderInput} from './orders';
export const reconciliationRoles=['ATI_SUPER_ADMIN','ATI_FINANCE_ANALYST','ATI_AUDITOR'];
export function reconciliationRead(actor:Actor,write=false){requireCondition((write?['ATI_SUPER_ADMIN','ATI_FINANCE_ANALYST']:reconciliationRoles).includes(actor.role),'FORBIDDEN','ATI finance reconciliation access required',403);scope(actor);}
const entityType=z.enum(['SHIPMENT','SETTLEMENT']);
export const reconciliationQuery=z.object({market:z.enum(['AE','SA','KW']),status:z.enum(['OPEN','RESOLVED','ALL']).default('OPEN')}).strict();
export const reconciliationEntity=z.object({entityType,id:z.string().min(1).max(100)}).strict();
export const reconciliationScan=reconciliationEntity.extend({reason:z.string().trim().min(10).max(1000)}).strict();
export const reconciliationResolve=z.object({expectedVersion:z.number().int().positive(),reason:z.string().trim().min(10).max(1000)}).strict();
export const reconciliationRepair=z.object({expectedShipmentVersion:z.number().int().positive(),reason:z.string().trim().min(10).max(1000)}).strict();
type Check={key:string;source:'SFCC'|'FYND'|'ECS_LEDGER'|'FINANCE';label:string;status:'MATCH'|'MISMATCH'|'MISSING'|'NOT_DUE';expected:string;actual:string};
type Target=z.infer<typeof reconciliationEntity>;
const precision=(v:Decimal.Value)=>new Decimal(v).toFixed(3);
function check(key:string,source:Check['source'],label:string,expected:string,actual:string|null,due=true):Check{return {key,source,label,status:!due?'NOT_DUE':actual===null?'MISSING':expected===actual?'MATCH':'MISMATCH',expected,actual:actual??'No eligible evidence recorded'};}
/** A receipt proves a recorded exchange, not current remote object state. */
async function receipt(tx:Prisma.TransactionClient,owner:{companyId:string;partnerId:string;market:string},target:string,operation:string,id:string){
 const job=await tx.outbox.findFirst({where:{...owner,target,operation,aggregateId:id},orderBy:[{createdAt:'desc'},{id:'desc'}]});
 if(!job||job.status!=='SUCCEEDED'||job.destinationMode!=='mock')return null;
 const saved=await tx.mockRecord.findUnique({where:{system_idempotencyKey:{system:target,idempotencyKey:job.idempotencyKey}}});
 const r=z.object({externalId:z.string(),system:z.literal(target),mode:z.literal('mock'),operation:z.literal(operation)}).safeParse(saved?.response);
 const ack=z.object({externalId:z.string(),system:z.literal(target),mode:z.literal('mock'),operation:z.literal(operation)}).safeParse(job.response);
 if(!saved||saved.payloadHash!==digest(JSON.stringify(job.payload))||!r.success||!ack.success||r.data.externalId!==ack.data.externalId)return null;
 return {job,externalId:r.data.externalId};
}
async function evidence(tx:Prisma.TransactionClient,actor:Actor,target:Target){
 const checks:Check[]=[];
 if(target.entityType==='SHIPMENT'){
  const leg=await tx.fulfilmentLeg.findFirst({where:{id:target.id,...scope(actor)},include:{order:true}});requireCondition(leg&&leg.order.companyId===actor.companyId&&leg.order.market===leg.market,'NOT_FOUND','Shipment not found',404);
  const owner={companyId:leg.companyId,partnerId:leg.partnerId,market:leg.market};
  const parsed=z.array(reservedLineResponse).min(1).max(12).refine(lines=>new Set(lines.map(l=>l.id)).size===lines.length).safeParse(leg.lines);
  checks.push(check('LINE_SNAPSHOT','ECS_LEDGER','Captured shipment line schema','Valid captured lines',parsed.success?'Valid captured lines':'Invalid or empty line snapshots'));
  const received=await tx.inbox.findFirst({where:{companyId:leg.companyId,market:leg.market,source:'SFCC',type:'order.created',status:'PROCESSED',AND:[{payload:{path:['externalOrderId'],equals:leg.order.externalId}},{payload:{path:['channel'],equals:leg.order.channel}}]},orderBy:[{createdAt:'desc'},{id:'desc'}]});
  const source=orderInput.safeParse(received?.payload);
  if(parsed.success){
   const canonical=(lines:{id:string;sku:string;quantity:number;unitGross:string;vendorDiscount:string;operatorDiscount:string}[])=>JSON.stringify(lines.map(l=>({id:l.id,sku:l.sku,quantity:l.quantity,gross:precision(l.unitGross),vendorDiscount:precision(l.vendorDiscount),operatorDiscount:precision(l.operatorDiscount)})).sort((a,b)=>a.id.localeCompare(b.id)));
   const matching=source.success?source.data.lines.filter(l=>parsed.data.some(s=>s.id===l.id)):null;
   checks.push(check('SFCC_SOURCE_LINES','SFCC','Source order receipt → captured shipment lines',canonical(parsed.data),matching?canonical(matching):null));
  }
  checks.push(check('SFCC_CURRENCY','SFCC','Source currency → ECS order',leg.order.currency,source.success?source.data.currency:null));
  const fynd=await receipt(tx,owner,'FYND','createShipment',leg.id);
  checks.push(check('FYND_REFERENCE','FYND','Shipment identity → recorded mock receipt',leg.fyndId??'Required Fynd shipment ID',fynd?.externalId??null));
  const transition=await receipt(tx,owner,'FYND','transitionShipment',leg.id);
  const transitioned=z.object({next:z.string(),fyndShipmentId:z.string()}).safeParse(transition?.job.payload);
  const expectedStage=JSON.stringify({status:leg.status,shipmentId:leg.fyndId});
  checks.push(check('FYND_STATUS','FYND','Current shipment stage → acknowledged command',expectedStage,transitioned.success?JSON.stringify({status:transitioned.data.next,shipmentId:transitioned.data.fyndShipmentId}):leg.status==='ASSIGNED'&&fynd?JSON.stringify({status:'ASSIGNED',shipmentId:fynd.externalId}):null));
  const feedback=await receipt(tx,owner,'SFCC','shipmentStatus',leg.id),feedbackBody=z.object({status:z.string(),shipmentId:z.string(),externalOrderId:z.string(),currency:z.string()}).safeParse(feedback?.job.payload);
  const expectedFeedback=JSON.stringify({status:leg.status,shipmentId:leg.id,externalOrderId:leg.order.externalId,currency:leg.order.currency});
  checks.push(check('SFCC_STATUS','SFCC','Shipment status → recorded SFCC feedback',expectedFeedback,feedbackBody.success?JSON.stringify(feedbackBody.data):null,leg.status!=='ASSIGNED'));
  if(parsed.success)for(const line of parsed.data){
   const gross=new Decimal(line.unitGross).mul(line.quantity);
   checks.push(check(`LINE_NET:${line.id}`,'ECS_LEDGER',`Captured net value · ${line.sku}`,precision(gross.minus(line.vendorDiscount).minus(line.operatorDiscount)),precision(line.net)));
   if(new Decimal(line.vendorDiscount).gt(gross)||new Decimal(line.commissionRate).gt(1)){checks.push(check(`LEDGER:${line.id}`,'ECS_LEDGER',`Delivery ledger · ${line.sku}`,'Valid captured commercial terms','Discount or rate outside valid range'));continue;}
   const calc=payable(gross.toString(),line.vendorDiscount,line.commissionRate);
   const expected=[['SALE_RECOGNISED',gross.toString()],['VENDOR_FUNDED_DISCOUNT',new Decimal(line.vendorDiscount).negated().toString()],['OPERATOR_FUNDED_DISCOUNT',new Decimal(line.operatorDiscount).negated().toString()],['COMMISSION_ACCRUED',new Decimal(calc.commission).negated().toString()]];
   const events=await tx.financialEvent.findMany({where:{...owner,sourceId:`${leg.id}:${line.id}`,kind:{in:expected.map(([kind])=>kind)}},orderBy:{kind:'asc'},take:101});
   const summary=(rows:{kind:string;amount:string;currency:string}[])=>JSON.stringify(rows.sort((a,b)=>a.kind.localeCompare(b.kind)));
   const want=summary(expected.map(([kind,amount])=>({kind,amount:precision(amount),currency:leg.order.currency})));
   checks.push(check(`LEDGER:${line.id}`,'ECS_LEDGER',`Delivery ledger · ${line.sku}`,leg.status==='DELIVERED'?want:'[]',events.length?summary(events.map(e=>({kind:e.kind,amount:precision(e.amount.toString()),currency:e.currency}))):null,leg.status==='DELIVERED'||events.length>0));
  }
  return {...owner,...target,reference:leg.order.externalId,currency:leg.order.currency,entityStatus:leg.status,entityVersion:leg.version,checks};
 }
 const s=await tx.settlement.findFirst({where:{id:target.id,...scope(actor)}});requireCondition(s,'NOT_FOUND','Statement not found',404);
 const owner={companyId:s.companyId,partnerId:s.partnerId,market:s.market};
 const ids=z.object({eventIds:z.array(z.string()).max(5000).refine(v=>new Set(v).size===v.length)}).safeParse(s.evidence);
 const events=ids.success?await tx.financialEvent.findMany({where:{...owner,id:{in:ids.data.eventIds}}}):[];
 const complete=ids.success&&ids.data.eventIds.length>0&&events.length===ids.data.eventIds.length&&events.every(e=>e.currency===s.currency);
 const total=complete?events.reduce((v,e)=>v.plus(contribution(e.kind,e.amount.toString())),new Decimal(0)):null;
 checks.push(check('STATEMENT_LEDGER','ECS_LEDGER','Statement payable → evidence ledger',precision(s.payable.toString()),total===null?null:precision(total),s.status!=='DRAFT'));
 const locked=['LOCKED','EXPORT_PENDING','EXPORTED','PAYMENT_PENDING','PAID'].includes(s.status);
 checks.push(check('STATEMENT_CLAIMS','ECS_LEDGER','Locked ledger ownership','All evidence events claimed by this statement',complete&&events.every(e=>e.settlementId===s.id)?'All evidence events claimed by this statement':null,locked));
 const exported=await receipt(tx,owner,'FINANCE','exportStatement',s.id),body=z.object({statementId:z.string(),partnerId:z.string(),currency:z.string(),payable:z.string().regex(/^\d+(\.\d+)?$/),eventIds:z.array(z.string())}).safeParse(exported?.job.payload);
 const exportedFacts=(id:string,partnerId:string,currency:string,amount:string,events:string[],externalId:string|null)=>JSON.stringify({statementId:id,partnerId,currency,payable:precision(amount),eventIds:[...events].sort(),externalId});
 checks.push(check('FINANCE_EXPORT','FINANCE','Locked statement → recorded Finance export',exportedFacts(s.id,s.partnerId,s.currency,s.payable.toString(),ids.success?ids.data.eventIds:[],s.exportedId),body.success?exportedFacts(body.data.statementId,body.data.partnerId,body.data.currency,body.data.payable,body.data.eventIds,exported!.externalId):null,['EXPORT_PENDING','EXPORTED','PAYMENT_PENDING','PAID'].includes(s.status)));
 return {...owner,...target,reference:s.id,currency:s.currency,entityStatus:s.status,entityVersion:s.version,checks};
}
function repairSafe(result:Awaited<ReturnType<typeof evidence>>){return result.entityType==='SHIPMENT'&&result.entityStatus==='DELIVERED'&&result.market==='AE'&&result.currency==='AED'&&result.checks.every(c=>c.key.startsWith('LEDGER:')?['MATCH','MISSING'].includes(c.status):c.status==='MATCH');}
export async function reconciliationList(actor:Actor,input:z.infer<typeof reconciliationQuery>){
 reconciliationRead(actor);const where=scope(actor,input.market);return transaction(async tx=>{
  const [items,total,shipments,statements]=await Promise.all([tx.reconciliationIssue.findMany({where:{...where,...(input.status==='ALL'?{}:{status:input.status})},orderBy:{observedAt:'desc'},take:100}),tx.reconciliationIssue.count({where:{...where,...(input.status==='ALL'?{}:{status:input.status})}}),tx.fulfilmentLeg.findMany({where,select:{id:true,status:true,partnerId:true,order:{select:{externalId:true}}},orderBy:{createdAt:'desc'},take:100}),tx.settlement.findMany({where,select:{id:true,status:true,partnerId:true},orderBy:{createdAt:'desc'},take:100})]);
  return {items,total,limit:100,shipments:shipments.map(s=>({id:s.id,status:s.status,partnerId:s.partnerId,reference:s.order.externalId})),statements,canManage:actor.role!=='ATI_AUDITOR'};
 });
}
export async function reconciliationDetail(actor:Actor,target:Target){reconciliationRead(actor);return transaction(async tx=>{
 const result=await evidence(tx,actor,target),where={companyId:result.companyId,market:result.market,entityType:target.entityType,entityId:target.id};
 const issues=await tx.reconciliationIssue.findMany({where,orderBy:{firstSeenAt:'asc'}});
 const history=await tx.auditEvent.findMany({where:{companyId:result.companyId,market:result.market,entityId:{in:[target.id,...issues.map(i=>i.id)]},action:{startsWith:'reconciliation.'}},select:{id:true,action:true,reason:true,createdAt:true},orderBy:{createdAt:'desc'},take:50});
 return {...result,issues,history,evidenceMode:'RECORDED_LOCAL_MOCK_EXCHANGES' as const,historyLimit:50,canRepairLedger:actor.role!=='ATI_AUDITOR'&&readEnv().DEMO_MODE==='true'&&repairSafe(result)&&result.checks.some(c=>c.key.startsWith('LEDGER:')&&c.status==='MISSING')};
});}
export async function scanReconciliation(actor:Actor,input:z.infer<typeof reconciliationScan>,correlationId:string){reconciliationRead(actor,true);return transaction(async tx=>{
 const result=await evidence(tx,actor,input),now=new Date(),scopedActor={...actor,markets:[result.market]};
 for(const c of result.checks){if(!['MISSING','MISMATCH'].includes(c.status))continue;
  const old=await tx.reconciliationIssue.findUnique({where:{entityType_entityId_checkKey:{entityType:input.entityType,entityId:input.id,checkKey:c.key}}});
  if(old){requireCondition(old.companyId===actor.companyId&&old.market===result.market&&old.partnerId===result.partnerId,'SCOPE_CONFLICT','Reconciliation ownership mismatch',409);
   if(old.status==='RESOLVED'||old.expected!==c.expected||old.actual!==c.actual){const updated=await tx.reconciliationIssue.update({where:{id:old.id},data:{expected:c.expected,actual:c.actual,status:'OPEN',resolvedAt:null,observedAt:now,version:{increment:1}}});await audit(tx,scopedActor,correlationId,old.status==='RESOLVED'?'reconciliation.reopened':'reconciliation.observed',old.id,old,updated,input.reason,result.partnerId);}
  }else{const issue=await tx.reconciliationIssue.create({data:{companyId:result.companyId,partnerId:result.partnerId,market:result.market,entityType:input.entityType,entityId:input.id,checkKey:c.key,source:c.source,firstExpected:c.expected,firstActual:c.actual,expected:c.expected,actual:c.actual}});await audit(tx,scopedActor,correlationId,'reconciliation.detected',issue.id,null,issue,input.reason,result.partnerId);}
 }
 await audit(tx,scopedActor,correlationId,'reconciliation.scan',input.id,null,result,input.reason,result.partnerId);
 return {entityType:input.entityType,id:input.id,failedChecks:result.checks.filter(c=>['MISSING','MISMATCH'].includes(c.status)).length};
});}
export async function resolveReconciliation(actor:Actor,id:string,input:z.infer<typeof reconciliationResolve>,correlationId:string){reconciliationRead(actor,true);return transaction(async tx=>{
 const issue=await tx.reconciliationIssue.findFirst({where:{id,...scope(actor)}});requireCondition(issue,'NOT_FOUND','Issue not found',404);requireCondition(issue.status==='OPEN'&&issue.version===input.expectedVersion,'STALE_RECONCILIATION','Refresh this issue before resolving',409);
 const result=await evidence(tx,actor,{entityType:entityType.parse(issue.entityType),id:issue.entityId}),c=result.checks.find(c=>c.key===issue.checkKey);
 requireCondition(c?.status==='MATCH','MISMATCH_UNRESOLVED','Source evidence still differs or is unavailable. Correct it through its source workflow, then verify again.',409);
 const updated=await tx.reconciliationIssue.update({where:{id},data:{expected:c.expected,actual:c.actual,status:'RESOLVED',resolvedAt:new Date(),observedAt:new Date(),version:{increment:1}}});await audit(tx,{...actor,markets:[issue.market]},correlationId,'reconciliation.resolved',id,issue,updated,input.reason,issue.partnerId);return updated;
});}
export async function repairDeliveryLedger(actor:Actor,id:string,input:z.infer<typeof reconciliationRepair>,correlationId:string){
 reconciliationRead(actor,true);requireCondition(readEnv().DEMO_MODE==='true','DEMO_ONLY','Ledger reconstruction is restricted to the local demonstration',403);
 return transaction(async tx=>{
  const result=await evidence(tx,actor,{entityType:'SHIPMENT',id});requireCondition(result.entityVersion===input.expectedShipmentVersion,'STALE_SHIPMENT','Refresh shipment evidence before reconstruction',409);
  requireCondition(repairSafe(result),'LEDGER_REPAIR_UNSAFE','Only missing delivery entries with matching source and mock delivery receipts can be reconstructed; existing differences require source investigation.',409);
  const leg=await tx.fulfilmentLeg.findUniqueOrThrow({where:{id}}),lines=z.array(reservedLineResponse).parse(leg.lines),sourceIds=lines.map(l=>`${id}:${l.id}`);
  for(const c of result.checks.filter(c=>c.key.startsWith('LEDGER:')&&c.status==='MISSING'))requireCondition(await tx.financialEvent.count({where:{sourceId:`${id}:${c.key.slice(7)}`}})===0,'LEDGER_REPAIR_UNSAFE','Unexpected financial events already exist for a missing line; investigate without automatic reconstruction.',409);
  const scopedActor={...actor,markets:[leg.market]},before=await tx.financialEvent.count({where:{companyId:leg.companyId,sourceId:{in:sourceIds}}});
  await recognizeDelivery(tx,scopedActor,leg);
  const createdEntries=await tx.financialEvent.count({where:{companyId:leg.companyId,sourceId:{in:sourceIds}}})-before;
  await audit(tx,scopedActor,correlationId,'reconciliation.repair_delivery',id,{checks:result.checks},{createdEntries,mode:'LOCAL_DEMO',actualMoneyMoved:false},input.reason,leg.partnerId);
  return {shipmentId:id,createdEntries,actualMoneyMoved:false as const};
 });
}
