import {z} from 'zod';
import type {Prisma,Outbox,LaunchTest} from '@prisma/client';
import {type Actor,partnerScope,permit} from '../auth/policy';
import {db} from '../db/client';

import {audit,enqueue,json} from '../db/transaction';
import {captureDestination} from '../integrations/destination';
import {AdapterError,type ExternalResult} from '../integrations/adapter';
import {requireCondition} from './errors';
import {sellable} from './calculations';
import {hasBrandRight} from './brand-policy';
import {hasCurrentPublication} from './publication-policy';
import {selectAgreement,commercialRate} from './commercials';
import {launchPayload,launchReceipt,launchStates,launchFingerprint} from './launch-contract';
import {mappingReadiness} from './mappings';
import {storefrontEvidence} from './storefront';

export const launchTestInput=z.object({expectedVersion:z.number().int().positive(),requestId:z.string().uuid(),reason:z.string().trim().min(5).max(1000)}).strict();

// Use actual canonical configuration, but only a private, virtual one-unit order.
// Operational stock, Order/FulfilmentLeg, money, carrier and refund handlers are
// never used by this protocol. Volatile stock revisions/partner status are not
// the configuration fingerprint; eligibility and quantities are checked anew.
async function scenario(tx:Prisma.TransactionClient,partnerId:string,inventoryId?:string){
 if(!(await mappingReadiness(tx,partnerId)).passed)return null;
 const now=(await tx.demoClock.findUniqueOrThrow({where:{id:'main'}})).now;
 const rows=await tx.inventory.findMany({where:{...(inventoryId?{id:inventoryId}:{}),product:{partnerId,status:'PUBLISHED',saleStatus:'ENABLED',market:'AE'}},include:{location:true,product:{include:{publications:{orderBy:{target:'asc'}},partner:{include:{brandRights:{orderBy:{id:'asc'}},agreements:true}}}}},orderBy:{id:'asc'}});
 for(const row of rows){
  const p=row.product,partner=p.partner,l=row.location;
  if(!(await storefrontEvidence(tx,p)).passed)continue;
  if(p.currency!=='AED'||!['APPROVED','ACTIVE','PAUSED'].includes(partner.status)||!partner.markets.includes('AE')||!partner.erpVendorId||!hasCurrentPublication(p)||!hasBrandRight(partner.brandRights,p,now))continue;
  if(l.companyId!==p.companyId||l.market!==p.market||(l.partnerId!==null&&l.partnerId!==partnerId)||l.status!=='ACTIVE'||!l.fyndId||!l.deliveryCities.length||l.dailyCapacity<1||sellable(row,true)<1)continue;
  const agreement=selectAgreement(partner.agreements,now,p.market,p.currency,p.brand);if(!agreement)continue;
  return {companyId:p.companyId,partnerId,market:'AE' as const,inventoryId:row.id,sku:p.sku,currency:'AED' as const,unitGross:p.price.toFixed(2),productId:p.id,productVersion:p.version,locationId:l.id,fyndLocationId:l.fyndId,sourceSequence:row.sequence,
   configuration:{erpVendorId:partner.erpVendorId,brand:p.brand,category:p.category,titleEn:p.titleEn,titleAr:p.titleAr,gtin:p.gtin,price:p.price.toString(),floor:p.floor.toString(),productData:p.data,
    publications:p.publications.filter(pub=>pub.version===p.version).map(pub=>({target:pub.target,externalId:pub.externalId})),
    rights:partner.brandRights.filter(r=>hasBrandRight([r],p,now)).map(r=>({id:r.id,version:r.version,validFrom:r.validFrom.toISOString(),validUntil:r.validUntil.toISOString()})),
    agreement:{id:agreement.id,version:agreement.version,rate:commercialRate(agreement,p.category),rules:agreement.rules,validUntil:agreement.validUntil.toISOString()},
    location:{type:l.type,deliveryCities:[...l.deliveryCities].sort(),cutoffHour:l.cutoffHour,dailyCapacity:l.dailyCapacity}}};
 }
 return null;
}
export async function launchTestReadiness(tx:Prisma.TransactionClient,partnerId:string){
 const latest=await tx.launchTest.findFirst({where:{partnerId},orderBy:[{createdAt:'desc'},{id:'desc'}]});
 if(!latest)return {key:'test',label:'Isolated test-order evidence (mock)',passed:false,detail:'No isolated launch test recorded. ATI can run the test after all preparation gates pass.'};
 const current=await scenario(tx,partnerId,latest.inventoryId);
 const same=Boolean(current&&launchFingerprint(current)===latest.fingerprint);
 const jobs=await tx.outbox.count({where:{aggregateId:latest.id,operation:'launchOrderStep',status:'SUCCEEDED',companyId:latest.companyId,partnerId,destinationMode:'mock',destinationOrigin:latest.destinationOrigin}});
 const readback=await tx.mockLaunchOrder.findUnique({where:{runId:latest.id}});
 const passed=latest.status==='PASSED'&&same&&jobs===8&&readback?.state==='CONFIRMED'&&readback.fingerprint===latest.fingerprint&&readback.virtualOnHand===0&&readback.virtualReserved===0;
 return {key:'test',label:'Isolated test-order evidence (mock)',passed,detail:!same?'Configuration or eligibility changed. Prepare inventory and run a new test.':passed?'Eight persisted mock acknowledgements: allocated → accepted → picked → packed → ready → dispatched → delivered → SFCC confirmed. No business stock, customer order or financial entry was created.':`${latest.status} · ${latest.step}/8 acknowledgements. ${latest.error??'Use launch-test history for progress.'}`,runId:latest.id};
}
export async function createLaunchTest(tx:Prisma.TransactionClient,actor:Actor,partnerId:string,input:z.infer<typeof launchTestInput>,correlationId:string){
 const current=await scenario(tx,partnerId);requireCondition(current,'NO_LAUNCH_SCENARIO','A mapped, authorized, published AE/AED SKU with effective terms and one physically available unit is required');
 requireCondition(actor.markets.includes(current.market),'MARKET_FORBIDDEN','Market not permitted',403);
 const fynd=captureDestination('FYND'),sfcc=captureDestination('SFCC');requireCondition(fynd.destinationOrigin===sfcc.destinationOrigin,'DESTINATION_MISMATCH','Launch test mocks must share the same isolated destination');
 const running=await tx.launchTest.findFirst({where:{companyId:actor.companyId,partnerId,status:'RUNNING'}});
 if(running){const actual=await scenario(tx,partnerId,running.inventoryId);requireCondition(!actual||launchFingerprint(actual)!==running.fingerprint,'TEST_RUNNING','A test is already running. Refresh its evidence or replay the failed job.',409);await tx.launchTest.update({where:{id:running.id},data:{status:'STALE',error:'Configuration changed before completion'}});}
 const run=await tx.launchTest.create({data:{companyId:actor.companyId,partnerId,market:current.market,actorId:actor.id,requestId:input.requestId,reason:input.reason,inventoryId:current.inventoryId,snapshot:json(current),fingerprint:launchFingerprint(current),destinationOrigin:fynd.destinationOrigin}});
 await enqueueStep(tx,actor,run,0,correlationId);
 await audit(tx,actor,correlationId,'launch-test.started',run.id,null,{...run,virtualQuantity:1,noBusinessSideEffects:true},input.reason,partnerId);
 return run;
}
async function enqueueStep(tx:Prisma.TransactionClient,actor:Actor,run:LaunchTest,step:number,correlationId:string){
 const payload=launchPayload.parse({runId:run.id,fingerprint:run.fingerprint,step,quantity:1,tracking:`MOCK-LAUNCH-${run.id}`,scenario:run.snapshot});
 const job=await enqueue(tx,{...actor,markets:[run.market]},correlationId,step===7?'SFCC':'FYND','launchOrderStep',run.id,payload,`launch:${run.id}:${step}`,run.partnerId);
 requireCondition(job.destinationOrigin===run.destinationOrigin&&job.destinationMode==='mock','DESTINATION_MISMATCH','Launch destination changed; review configuration before replay');
}
export async function assertLaunchJob(tx:Prisma.TransactionClient,job:Outbox){
 const payload=launchPayload.parse(job.payload),run=await tx.launchTest.findUniqueOrThrow({where:{id:job.aggregateId}});
 const latest=await tx.launchTest.findFirst({where:{companyId:run.companyId,partnerId:run.partnerId},orderBy:[{createdAt:'desc'},{id:'desc'}]});
 const current=await scenario(tx,run.partnerId,run.inventoryId);
 if(!current||launchFingerprint(current)!==run.fingerprint||latest?.id!==run.id||!['RUNNING','FAILED'].includes(run.status))throw new AdapterError('Launch test is stale or no longer eligible; create a new test after preparation',false);
 if(job.companyId!==run.companyId||job.partnerId!==run.partnerId||job.market!==run.market||job.destinationMode!=='mock'||job.destinationOrigin!==run.destinationOrigin||job.target!==(run.step===7?'SFCC':'FYND')||payload.step!==run.step||payload.runId!==run.id||payload.fingerprint!==run.fingerprint||launchFingerprint(payload.scenario)!==run.fingerprint)throw new AdapterError('Launch job identity, step or snapshot mismatch',false);
 return run;
}
export async function acknowledgeLaunch(tx:Prisma.TransactionClient,job:Outbox,result:ExternalResult){
 const run=await assertLaunchJob(tx,job),receipt=launchReceipt.safeParse(result.launch);
 if(result.operation!=='launchOrderStep'||!receipt.success||receipt.data.runId!==run.id||receipt.data.fingerprint!==run.fingerprint||receipt.data.step!==run.step||receipt.data.state!==launchStates[run.step]||receipt.data.virtualOnHand!==(run.step>=5?0:1)||receipt.data.virtualReserved!==(run.step>=5?0:1))throw new AdapterError('Invalid isolated launch-test acknowledgement',false);
 const completed=run.step===7;
 const updated=await tx.launchTest.update({where:{id:run.id},data:{step:{increment:1},status:completed?'PASSED':'RUNNING',error:null,...(completed?{completedAt:new Date()}: {})}});
 const actor={id:'launch-test-worker',companyId:run.companyId,partnerId:null,markets:[run.market],role:'ATI_SUPER_ADMIN'};
 await audit(tx,actor,job.correlationId,'launch-test.step-acknowledged',run.id,{step:run.step},receipt.data,'Isolated virtual order; no operational stock or finance effects',run.partnerId);
 if(!completed)await enqueueStep(tx,actor,updated,updated.step,job.correlationId);
}
export async function listLaunchTests(actor:Actor,partnerId:string){
 const p=await db.partner.findFirst({where:{AND:[partnerScope(actor),{id:partnerId}]}});requireCondition(p,'NOT_FOUND','Partner not found',404);
 requireCondition(['ATI_SUPER_ADMIN','ATI_PARTNER_MANAGER','ATI_OPERATIONS_MANAGER','ATI_AUDITOR','VENDOR_ADMIN'].includes(actor.role),'FORBIDDEN','Your role cannot read launch-test history',403);
 const runs=await db.launchTest.findMany({where:{partnerId,companyId:actor.companyId,market:{in:actor.markets}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:20});
 return {items:await Promise.all(runs.map(async run=>{
  const snapshot=launchPayload.shape.scenario.parse(run.snapshot);
  const jobs=await db.outbox.findMany({where:{companyId:actor.companyId,partnerId,aggregateId:run.id,operation:'launchOrderStep'},select:{id:true,target:true,status:true,attempts:true,error:true,payload:true},orderBy:{createdAt:'asc'}});
  // Operational readers do not gain access to commercial terms or raw payloads.
  return {id:run.id,status:run.status,step:run.step,reason:run.reason,createdAt:run.createdAt,completedAt:run.completedAt,error:run.error,fingerprint:run.fingerprint,snapshot:{sku:snapshot.sku,unitGross:snapshot.unitGross,currency:snapshot.currency,fyndLocationId:snapshot.fyndLocationId},jobs:jobs.map(j=>({...j,payload:{step:launchPayload.parse(j.payload).step}}))};
 }))};
}
export async function findExistingLaunch(tx:Prisma.TransactionClient,actor:Actor,partnerId:string,input:z.infer<typeof launchTestInput>){
 permit(actor,'partners',true);
 const run=await tx.launchTest.findUnique({where:{companyId_partnerId_requestId:{companyId:actor.companyId,partnerId,requestId:input.requestId}}});
 if(run)requireCondition(run.actorId===actor.id&&run.reason===input.reason,'REQUEST_CONFLICT','Request ID was already used with different content',409);
 return run;
}
