import {z} from 'zod';
import type {Prisma,Outbox} from '@prisma/client';
import type {Actor} from '../auth/policy';
import {enqueue,audit} from '../db/transaction';
import {rightState} from './brand-policy';
import {launchFingerprint} from './launch-contract';
import {requireCondition} from './errors';
import {AdapterError,type ExternalResult} from '../integrations/adapter';
export const mappingPayload=z.object({key:z.string(),fingerprint:z.string().length(64),kind:z.enum(['BRAND','LOCATION']),canonicalId:z.string(),market:z.string(),companyId:z.string(),partnerId:z.string(),snapshot:z.record(z.unknown())}).strict();
type Mapping=z.infer<typeof mappingPayload>;
export async function mappingRequirements(tx:Prisma.TransactionClient,partnerId:string){
 const partner=await tx.partner.findUniqueOrThrow({where:{id:partnerId},include:{brandRights:true}});
 const now=(await tx.demoClock.findUniqueOrThrow({where:{id:'main'}})).now;
 const rights=partner.brandRights.filter(r=>rightState(r,now)==='EFFECTIVE'&&partner.markets.includes(r.market));
 const targets:Mapping[]=[];
 for(const label of [...new Set(rights.map(r=>`${r.market}:${r.brand}`))].sort()){
  const subset=rights.filter(r=>`${r.market}:${r.brand}`===label).sort((a,b)=>a.id.localeCompare(b.id)),{brand,market}=subset[0];
  const snapshot={companyId:partner.companyId,partnerId,erpVendorId:partner.erpVendorId,brand,market,grants:subset.map(r=>({id:r.id,version:r.version,categories:[...r.categories].sort(),validFrom:r.validFrom.toISOString(),validUntil:r.validUntil.toISOString()}))};
  targets.push({kind:'BRAND',canonicalId:brand,market,companyId:partner.companyId,partnerId,key:launchFingerprint({companyId:partner.companyId,partnerId,kind:'BRAND',brand,market}),fingerprint:launchFingerprint(snapshot),snapshot});
 }
 const locations=await tx.location.findMany({where:{companyId:partner.companyId,market:{in:partner.markets},status:'ACTIVE',OR:[{partnerId},{partnerId:null,inventory:{some:{product:{partnerId}}}}]},orderBy:{id:'asc'}});
 for(const l of locations){
  const snapshot={companyId:l.companyId,ownerId:l.partnerId,market:l.market,locationId:l.id,name:l.name,type:l.type,version:l.version,deliveryCities:[...l.deliveryCities].sort(),cutoffHour:l.cutoffHour,dailyCapacity:l.dailyCapacity};
  targets.push({kind:'LOCATION',canonicalId:l.id,market:l.market,companyId:partner.companyId,partnerId,key:launchFingerprint({companyId:l.companyId,kind:'LOCATION',locationId:l.id}),fingerprint:launchFingerprint(snapshot),snapshot});
 }
 return {partner,targets,locations};
}
export async function mappingReadiness(tx:Prisma.TransactionClient,partnerId:string){
 const {partner,targets,locations}=await mappingRequirements(tx,partnerId);
 const jobs=await tx.outbox.findMany({where:{companyId:partner.companyId,partnerId,operation:'provisionMapping',target:'FYND',status:'SUCCEEDED',destinationMode:'mock'}});
 const records=await tx.mockMapping.findMany({where:{key:{in:targets.map(t=>t.key)}}});
 const mappings=targets.map(target=>{
  const record=records.find(r=>r.key===target.key),job=jobs.find(j=>{const p=mappingPayload.safeParse(j.payload);return p.success&&p.data.key===target.key&&p.data.fingerprint===target.fingerprint;});
  const response=job?.response as {externalId?:string}|null;
  const passed=Boolean(job&&record&&record.fingerprint===target.fingerprint&&record.externalId===response?.externalId&&(target.kind!=='LOCATION'||locations.find(l=>l.id===target.canonicalId)?.fyndId===record.externalId));
  return {kind:target.kind,canonicalId:target.canonicalId,market:target.market,passed,externalId:passed?record!.externalId:null,detail:passed?'Acknowledged and reconciled with the local Fynd mock':'Current provisioning acknowledgement or mock read-back is missing'};
 });
 const enough=targets.some(t=>t.kind==='BRAND')&&targets.some(t=>t.kind==='LOCATION');
 return {key:'mapping',label:'Current brand and location provisioning evidence (mock)',passed:enough&&mappings.every(m=>m.passed),detail:enough?`${mappings.filter(m=>m.passed).length}/${mappings.length} mandatory mappings verified. Seeded flags and bare location IDs are not accepted.`:'Approve a territorial brand right and configure at least one active location before provisioning.',mappings};
}
export async function queueMappings(tx:Prisma.TransactionClient,actor:Actor,partnerId:string,correlationId:string){
 const {partner,targets}=await mappingRequirements(tx,partnerId);
 requireCondition(partner.erpVendorId,'ERP_ID_REQUIRED','Synchronize the ERP legal vendor identity first');
 requireCondition(targets.some(t=>t.kind==='BRAND')&&targets.some(t=>t.kind==='LOCATION'),'MAPPING_CONFIGURATION_REQUIRED','Effective brand rights and an active location are required');
 requireCondition(targets.every(t=>actor.markets.includes(t.market)),'MARKET_FORBIDDEN','Provisioning all required mappings needs access to their markets',403);
 for(const target of targets)await enqueue(tx,{...actor,markets:[target.market]},correlationId,'FYND','provisionMapping',partnerId,target,`mapping:${partnerId}:${target.key}:${target.fingerprint}:${partner.version}`,partnerId);
}
export async function assertMappingCurrent(tx:Prisma.TransactionClient,job:Outbox){
 const payload=mappingPayload.parse(job.payload),{partner,targets}=await mappingRequirements(tx,payload.partnerId);
 if(!['APPROVED','ACTIVE','PAUSED'].includes(partner.status)||job.companyId!==partner.companyId||payload.companyId!==partner.companyId||job.partnerId!==partner.id||job.market!==payload.market||job.target!=='FYND'||job.destinationMode!=='mock'||!targets.some(t=>t.key===payload.key&&t.fingerprint===payload.fingerprint&&t.canonicalId===payload.canonicalId&&t.kind===payload.kind&&t.market===payload.market)||launchFingerprint(payload.snapshot)!==payload.fingerprint)throw new AdapterError('Provisioning configuration or authorization changed; request fresh mappings',false);
 return payload;
}
export async function acknowledgeMapping(tx:Prisma.TransactionClient,job:Outbox,result:ExternalResult){
 const payload=await assertMappingCurrent(tx,job),record=await tx.mockMapping.findUnique({where:{key:payload.key}});
 if(result.operation!=='provisionMapping'||!record||record.fingerprint!==payload.fingerprint||record.externalId!==result.externalId)throw new AdapterError('Provisioning response/read-back does not match the requested mapping',false);
 if(payload.kind==='LOCATION')await tx.location.update({where:{id:payload.canonicalId},data:{fyndId:result.externalId}});
 await audit(tx,{id:'mapping-worker',companyId:job.companyId,partnerId:null,markets:[job.market],role:'ATI_SUPER_ADMIN'},job.correlationId,'mapping.acknowledged',payload.canonicalId,null,{kind:payload.kind,externalId:result.externalId,fingerprint:payload.fingerprint,mode:'mock'},'Current mapping reconciled with local mock',payload.partnerId);
}
