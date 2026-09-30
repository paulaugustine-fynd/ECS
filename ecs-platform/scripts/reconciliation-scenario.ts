import {pathToFileURL} from 'node:url';
import {z} from 'zod';
import {db} from '../packages/db/client';
import {audit,enqueue,json,transaction} from '../packages/db/transaction';
import {ledger,contribution} from '../packages/domain/finance';
import {captureDestination,validateDestination} from '../packages/integrations/destination';
import {requireCondition} from '../packages/domain/errors';
import Decimal from 'decimal.js';

const partnerId='vnd_reconciliation_training';
const companyId='cmp_ati_uae';
const holdUntil=new Date('2100-01-01T00:00:00Z');
const runSchema=z.string().regex(/^[a-z0-9][a-z0-9-]{0,23}$/);
function ids(run:string){runSchema.parse(run);const id=`demo_reconciliation_${run}`;return {id,key:`${id}:finance-export`,source:`${id}:historical-sale`};}
function localOnly(){
 const url=new URL(process.env.DATABASE_URL??'');
 if(process.env.NODE_ENV==='production'||process.env.DEMO_MODE!=='true'||!['localhost','127.0.0.1'].includes(url.hostname)||!['/ecs_demo','/ecs_test'].includes(url.pathname))throw Error('Reconciliation fixtures require an explicitly enabled local demo/test database');
 captureDestination('FINANCE');
}

/** Additive historical finance fixture. Never rewrites an existing scenario or fabricates receipts. */
export async function prepareReconciliationScenario(run='01'){
 localOnly();const {id,key,source}=ids(run);
 return transaction(async tx=>{
  const actor=await tx.user.findUniqueOrThrow({where:{email:'admin@ati.demo'}});
  requireCondition(actor.companyId===companyId&&actor.role==='ATI_SUPER_ADMIN'&&actor.markets.includes('AE'),'FIXTURE_OWNER','Expected local ATI administrator is unavailable',409);
  const scopedActor={...actor,markets:['AE']};
  const old=await tx.settlement.findUnique({where:{id}});
  if(old){
   requireCondition(old.companyId===companyId&&old.partnerId===partnerId&&old.market==='AE'&&old.currency==='AED','FIXTURE_CONFLICT','Scenario identifier belongs to different data',409);
   const job=await tx.outbox.findUniqueOrThrow({where:{idempotencyKey:key}});
   requireCondition(job.aggregateId===id&&job.companyId===companyId&&job.partnerId===partnerId&&job.operation==='exportStatement'&&job.target==='FINANCE','FIXTURE_CONFLICT','Existing scenario export does not match',409);
   requireCondition(await tx.auditEvent.count({where:{companyId,entityId:id,action:'demo.reconciliation-prepared',after:{path:['jobId'],equals:job.id}}})===1,'FIXTURE_CONFLICT','Existing records have no matching scenario provenance',409);
   return {statementId:id,partnerId,jobId:job.id,status:old.status,created:false};
  }
  const partner=await tx.partner.findUnique({where:{id:partnerId}});
  requireCondition(!partner||(partner.companyId===companyId&&partner.code==='DEMO-RECONCILIATION'&&partner.markets.length===1&&partner.markets[0]==='AE'),'FIXTURE_CONFLICT','Training partner identifier is already in use',409);
  if(!partner)await tx.partner.create({data:{id:partnerId,companyId,code:'DEMO-RECONCILIATION',displayName:'Reconciliation training · fictional',legalName:'Fictional reconciliation training partner',status:'PAUSED',markets:['AE'],erpVendorId:'fixture-erp-reconciliation-training',application:{demoOnly:true,purpose:'Historical finance training only; not approved for selling'}}});
  // These are explicit historical opening events, not a customer order or payment.
  // No stock, Fynd shipment identity, customer invoice or remote receipt is invented.
  const amounts=[['SALE_RECOGNISED','200.00'],['VENDOR_FUNDED_DISCOUNT','-10.00'],['OPERATOR_FUNDED_DISCOUNT','-5.00'],['COMMISSION_ACCRUED','-38.00']] as const;
  requireCondition(await tx.financialEvent.count({where:{OR:[{sourceId:source},{idempotencyKey:{in:amounts.map(([kind])=>`${source}:${kind}`)}}]}})===0&&await tx.outbox.count({where:{idempotencyKey:key}})===0,'FIXTURE_CONFLICT','Scenario financial or export keys already exist without its statement',409);
  const events=[];
  for(const [kind,amount] of amounts)events.push(await ledger(tx,scopedActor,partnerId,kind,amount,source,`${source}:${kind}`,{demoOnly:true,fixture:'reconciliation-held-export-v1',run,provenance:'Fictional historical opening transaction, not an ingested customer order',gross:'200.00',vendorDiscount:'10.00',operatorDiscount:'5.00',commissionRate:'0.20',actualMoneyMoved:false}));
  const now=(await tx.demoClock.findUniqueOrThrow({where:{id:'main'}})).now;
  const payable=events.reduce((sum,event)=>sum.plus(contribution(event.kind,event.amount.toString())),new Decimal(0)).toFixed(2);
  const statement=await tx.settlement.create({data:{id,companyId,partnerId,market:'AE',currency:'AED',status:'EXPORT_PENDING',version:1,from:new Date(now.getTime()-1),to:new Date(now.getTime()+1),payable,evidence:json({eventIds:events.map(e=>e.id),events,fixture:'reconciliation-held-export-v1',run,reason:'Seeded historical locked statement; export intentionally held for reconciliation training',convention:'Signed vendor-payable contributions; operator-funded discount excluded'})}});
  await tx.financialEvent.updateMany({where:{id:{in:events.map(e=>e.id)},settlementId:null},data:{settlementId:id}});
  const job=await enqueue(tx,scopedActor,id,'FINANCE','exportStatement',id,{statementId:id,partnerId,erpVendorId:'fixture-erp-reconciliation-training',currency:'AED',payable,eventIds:events.map(e=>e.id)},key,partnerId);
  // Atomic with enqueue: a running worker can never see this job before its hold.
  await tx.outbox.update({where:{id:job.id},data:{availableAt:holdUntil}});
  await audit(tx,scopedActor,id,'demo.reconciliation-prepared',id,null,{statementId:id,jobId:job.id,payable,heldUntil:holdUntil.toISOString(),fixture:true,actualMoneyMoved:false},'Additive fictional finance history; export held deliberately, no existing transactions changed',partnerId);
  return {statementId:id,partnerId,jobId:job.id,status:statement.status,created:true};
 });
}

/** Releases only this scenario's held job. Actual acknowledgement remains the worker's responsibility. */
export async function releaseReconciliationScenario(run='01'){
 localOnly();const {id,key}=ids(run);
 return transaction(async tx=>{
  const actor=await tx.user.findUniqueOrThrow({where:{email:'admin@ati.demo'}});
  requireCondition(actor.companyId===companyId&&actor.role==='ATI_SUPER_ADMIN'&&actor.markets.includes('AE'),'FIXTURE_OWNER','Expected local ATI administrator is unavailable',409);
  const statement=await tx.settlement.findUniqueOrThrow({where:{id}}),job=await tx.outbox.findUniqueOrThrow({where:{idempotencyKey:key}});
  requireCondition(statement.companyId===companyId&&statement.partnerId===partnerId&&statement.market==='AE'&&statement.currency==='AED'&&job.companyId===companyId&&job.partnerId===partnerId&&job.market==='AE'&&job.aggregateId===id&&job.target==='FINANCE'&&job.operation==='exportStatement','FIXTURE_CONFLICT','Scenario export identity does not match',409);
  requireCondition(await tx.auditEvent.count({where:{companyId,entityId:id,action:'demo.reconciliation-prepared',after:{path:['jobId'],equals:job.id}}})===1,'FIXTURE_CONFLICT','Export has no matching scenario provenance',409);
  validateDestination(job);
  if(job.availableAt.getTime()!==holdUntil.getTime())return {statementId:id,jobId:job.id,released:false,status:job.status};
  requireCondition(statement.status==='EXPORT_PENDING'&&job.status==='PENDING'&&job.attempts===0,'FIXTURE_CONFLICT','Held scenario has changed; investigate without overwriting it',409);
  await tx.outbox.update({where:{id:job.id},data:{availableAt:new Date()}});
  await audit(tx,{...actor,markets:['AE']},id,'demo.reconciliation-export-released',id,{availableAt:holdUntil.toISOString()},{jobId:job.id,destination:'LOCAL_MOCK',actualMoneyMoved:false},'Presenter released the held mock export; worker must obtain the acknowledgement',partnerId);
  return {statementId:id,jobId:job.id,released:true,status:job.status};
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const action=z.enum(['prepare','release']).parse(process.argv[2]??'prepare');console.log(JSON.stringify(await(action==='prepare'?prepareReconciliationScenario:releaseReconciliationScenario)(process.argv[3]??'01'),null,2));}
 finally{await db.$disconnect();}
}
