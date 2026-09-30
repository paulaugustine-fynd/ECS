import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { type Actor, isVendor, partnerScope, permit } from '../auth/policy';
import { audit, enqueue, transaction } from '../db/transaction';
import { requireCondition } from './errors';
import { applicationIssues } from './onboarding';
import {hasBrandRight,rightState} from './brand-policy';
import {queueStock,reconcileAvailability} from './inventory';
import {inventoryReadiness} from './launch-inventory';
import {createLaunchTest,findExistingLaunch,launchTestReadiness,launchTestInput} from './launch-tests';
import {mappingReadiness,queueMappings} from './mappings';
import {storefrontReadiness} from './storefront';

export const partnerCommand = z.object({
  action: z.enum(['start', 'submit', 'review', 'request-info', 'approve', 'reject', 'authorize-brand', 'sync-erp', 'map-fynd', 'sync-inventory', 'activate', 'pause', 'suspend', 'offboard']),
  reason: z.string().trim().min(5).max(1000).optional(),
  expectedVersion: z.number().int().positive(),
}).strict();

export async function readiness(tx: Prisma.TransactionClient, id: string) {
  const partner = await tx.partner.findUniqueOrThrow({where: {id}, include: {documents: true, agreements: true, brandRights:true, products: {include: {publications: true}}}});
  const now = (await tx.demoClock.findUniqueOrThrow({where: {id: 'main'}})).now;
  const documents = ['TRADE_LICENSE', 'VAT_CERTIFICATE', 'BANK_LETTER'].map(type => partner.documents.filter(d => d.type === type).sort((a,b) => b.version-a.version)[0]);
  return [
    {key: 'documents', label: 'Valid approved compliance documents', passed: documents.every(d => d && d.status === 'APPROVED' && ['MOCK_CLEAN','CLEAN'].includes(d.scanStatus) && d.byteSize>0 && (!d.expiresAt || d.expiresAt > now))},
    {key: 'erp', label: 'ERP legal vendor identity', passed: Boolean(partner.erpVendorId)},
    {key: 'agreement', label: 'Effective commercial agreement', passed: partner.agreements.some(a => a.status === 'APPROVED' && a.validFrom <= now && a.validUntil > now)},
    {key: 'brand', label: 'Effective territorial brand/category authorization', passed: partner.brandRights.some(r=>rightState(r,now)==='EFFECTIVE')&&partner.products.filter(p=>['APPROVED','PUBLISHING','PUBLISHED'].includes(p.status)).every(p=>hasBrandRight(partner.brandRights,p,now))},
    await mappingReadiness(tx,id),
    {key: 'catalogue', label: 'Current catalogue acknowledged by ERP, Fynd and SFCC (mock)', passed: partner.products.some(p => p.status === 'PUBLISHED' && ['FYND','ERP','SFCC'].every(t => p.publications.some(pub => pub.target === t && pub.version === p.version && pub.status === 'SUCCEEDED' && Boolean(pub.externalId))))},
    await inventoryReadiness(tx,id),
    await storefrontReadiness(tx,id),
    await launchTestReadiness(tx,id),
  ];
}

export async function startLaunchTest(actor:Actor,id:string,input:z.infer<typeof launchTestInput>,correlationId:string){
 permit(actor,'partners',true);
 return transaction(async tx=>{
  const partner=await tx.partner.findFirst({where:{AND:[partnerScope(actor),{id}]}});requireCondition(partner,'NOT_FOUND','Partner not found',404);
  const existing=await findExistingLaunch(tx,actor,id,input);if(existing)return existing;
  requireCondition(partner.version===input.expectedVersion,'STALE_VERSION','The partner changed. Refresh before testing.',409);
  requireCondition(['APPROVED','ACTIVE','PAUSED'].includes(partner.status),'INVALID_TRANSITION','Prepare an approved partner before running a launch test',409);
  const pending=(await readiness(tx,id)).filter(g=>g.key!=='test'&&!g.passed);requireCondition(!pending.length,'READINESS_BLOCKED',pending.map(g=>g.label).join('; '));
  const run=await createLaunchTest(tx,actor,id,input,correlationId);
  await tx.partner.update({where:{id},data:{version:{increment:1}}});return run;
 });
}

export async function commandPartner(actor: Actor, id: string, input: z.infer<typeof partnerCommand>, correlationId: string) {
  permit(actor, 'partners');
  if (isVendor(actor)) requireCondition(['start','submit'].includes(input.action), 'FORBIDDEN', 'ATI review is required for this action', 403);
  return transaction(async tx => {
    const partner = await tx.partner.findFirst({where: {AND: [partnerScope(actor), {id}]}});
    requireCondition(partner, 'NOT_FOUND', 'Partner not found', 404);
    requireCondition(partner.version === input.expectedVersion, 'STALE_VERSION', 'The record changed. Refresh before continuing.', 409);
    requireCondition(input.action!=='authorize-brand','BRAND_RIGHTS_REQUIRED','Use Brand rights to create and review dated, market/category-specific authorization',409);
    const guards: Record<string, string[]> = {
      start:['INVITED'], submit:['APPLICATION_IN_PROGRESS','MORE_INFO_REQUIRED'], review:['SUBMITTED'],
      'request-info':['SUBMITTED','UNDER_REVIEW'], approve:['UNDER_REVIEW'], reject:['UNDER_REVIEW'],
      'sync-erp':['APPROVED','ACTIVE'], 'map-fynd':['APPROVED','ACTIVE','PAUSED'], 'sync-inventory':['APPROVED','ACTIVE','PAUSED'], activate:['APPROVED','PAUSED'],
      pause:['ACTIVE'], suspend:['ACTIVE','PAUSED','APPROVED'], offboard:['ACTIVE','PAUSED','SUSPENDED'],
      'authorize-brand':['UNDER_REVIEW','APPROVED','ACTIVE'],
    };
    requireCondition(guards[input.action].includes(partner.status), 'INVALID_TRANSITION', `Cannot ${input.action} while ${partner.status}`, 409);
    if (['request-info','reject','pause','suspend','offboard','authorize-brand'].includes(input.action)) requireCondition(input.reason, 'REASON_REQUIRED', 'A reason or evidence reference is required');
    const gates = await readiness(tx, id);
    if (input.action === 'approve') {requireCondition(!applicationIssues(partner.application).length,'APPLICATION_INCOMPLETE','Complete the business profile before approval');requireCondition(gates[0].passed, 'DOCUMENTS_PENDING', 'Approve current, valid documents before approving the partner');}
    if (input.action === 'submit') {
      const issues=applicationIssues(partner.application);requireCondition(!issues.length,'APPLICATION_INCOMPLETE',issues.join('; '));
      const docs = await tx.document.findMany({where: {partnerId:id},orderBy:{version:'desc'}});
      const now=(await tx.demoClock.findUniqueOrThrow({where:{id:'main'}})).now;
      requireCondition(['TRADE_LICENSE','VAT_CERTIFICATE','BANK_LETTER'].every(t=>{const d=docs.find(d=>d.type===t);return d&&d.byteSize>0&&['MOCK_CLEAN','CLEAN'].includes(d.scanStatus)&&d.status!=='REJECTED'&&(!d.expiresAt||d.expiresAt>now);}), 'DOCUMENTS_MISSING', 'Upload current, valid and scan-passed versions of all three compliance documents');
    }
    if (input.action === 'activate') requireCondition(gates.every(g => g.passed), 'READINESS_BLOCKED', gates.filter(g => !g.passed).map(g => g.label).join('; '));
    const statuses: Record<string,string> = {start:'APPLICATION_IN_PROGRESS',submit:'SUBMITTED',review:'UNDER_REVIEW','request-info':'MORE_INFO_REQUIRED',approve:'APPROVED',reject:'REJECTED',activate:'ACTIVE',pause:'PAUSED',suspend:'SUSPENDED',offboard:'OFFBOARDED'};
    const updated = await tx.partner.update({where: {id}, data: {status: statuses[input.action] ?? partner.status,...(['request-info','reject'].includes(input.action)?{reviewReason:input.reason}:{}),...(input.action==='submit'?{submittedAt:(await tx.demoClock.findUniqueOrThrow({where:{id:'main'}})).now}:{}), version:{increment:1}}});
    if (input.action === 'sync-erp') await enqueue(tx,actor,correlationId,'ERP','upsertVendor',id,{id,legalName:partner.legalName},`partner:${id}:erp`,id);
    if (input.action === 'map-fynd') {
      requireCondition(gates.find(g=>g.key==='brand')?.passed && partner.erpVendorId, 'PROVISIONING_BLOCKED', 'Brand authorization and ERP identity are required');
      await queueMappings(tx,actor,id,correlationId);
    }
    if(input.action==='sync-inventory'){
      const rows=await tx.inventory.findMany({where:{product:{partnerId:id,companyId:actor.companyId,status:'PUBLISHED',market:{in:actor.markets}}},include:{product:true,location:true}});
      requireCondition(rows.length>0,'NO_PUBLISHED_STOCK','Publish a catalogue item and configure its stock position before synchronizing');
      requireCondition(rows.every(r=>r.location.companyId===actor.companyId&&r.location.market===r.product.market&&(r.location.partnerId===null||r.location.partnerId===id)&&r.location.status==='ACTIVE'&&Boolean(r.location.fyndId)),'LOCATION_MAPPING_REQUIRED','Repair inactive, missing or cross-owner location mappings before synchronizing');
      for(const row of rows){
        await tx.inventory.update({where:{id:row.id},data:{revision:{increment:1},syncedAt:null}});
        await queueStock(tx,actor,row.id,correlationId);
      }
    }
    if (['activate','pause','suspend','offboard'].includes(input.action)) {
      await reconcileAvailability(tx,id,correlationId);
      for (const target of ['FYND','SFCC'] as const) await enqueue(tx,actor,correlationId,target,'refreshAvailability',id,{partnerId:id,status:updated.status},`partner:${id}:${updated.version}:${target}`,id);
    }
    await audit(tx,actor,correlationId,`partner.${input.action}`,id,partner,updated,input.reason,id);
    return {...updated, readiness: await readiness(tx,id)};
  });
}
