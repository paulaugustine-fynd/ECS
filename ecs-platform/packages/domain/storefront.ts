import type {Prisma,Outbox,Product} from '@prisma/client';
import {type Actor,scope} from '../auth/policy';
import {db} from '../db/client';
import {AdapterError} from '../integrations/adapter';
import {requireCondition} from './errors';
import {projectStorefront,storefrontEnvelope,storefrontContent,customerContent} from './storefront-contract';
import {launchFingerprint} from './launch-contract';
import {hasCurrentPublication} from './publication-policy';
import {hasBrandRight} from './brand-policy';
import {mappingReadiness} from './mappings';

export async function storefrontEvidence(tx:Prisma.TransactionClient,p:Product){
 const publications=await tx.publication.findMany({where:{productId:p.id,version:p.version}}),pub=publications.find(x=>x.target==='SFCC');
 const record=await tx.mockStorefrontProduct.findUnique({where:{productId:p.id}});
 const expected=projectStorefront(p,pub?.externalId??'not-published');
 const matches=Boolean(record&&record.companyId===p.companyId&&record.partnerId===p.partnerId&&record.market===p.market&&record.version===p.version&&record.externalId===pub?.externalId&&record.fingerprint===expected.fingerprint&&launchFingerprint(record.content)===expected.fingerprint);
 const published=p.status==='PUBLISHED'&&hasCurrentPublication({...p,publications});
 const jobs=await tx.outbox.findMany({where:{companyId:p.companyId,partnerId:p.partnerId,market:p.market,aggregateId:p.id,target:'SFCC',operation:{in:['upsertProduct','publishStorefront']},status:'SUCCEEDED',destinationMode:'mock'}});
 const acknowledged=jobs.some(j=>{try{const payload=j.payload as {version?:number;fingerprint?:string;product?:unknown};return payload.version===p.version&&(j.response as {externalId?:string}|null)?.externalId===pub?.externalId&&(j.operation==='upsertProduct'?launchFingerprint(customerContent(payload.product))===expected.fingerprint:payload.fingerprint===expected.fingerprint);}catch{return false;}});
 const passed=published&&matches&&acknowledged&&Boolean(record?.visible);
 return {passed,sku:p.sku,version:p.version,externalId:pub?.externalId??null,detail:passed?'Current customer content is visible in the SFCC simulator and matches acknowledged publication.':!published?'Current ERP/Fynd/SFCC publication is incomplete.':!matches?'Storefront content is missing, stale or differs from approved content.':!acknowledged?'A successful current SFCC command is missing.':'Product is hidden in the SFCC simulator.',content:passed?storefrontContent.parse(record!.content):null};
}
export async function storefrontReadiness(tx:Prisma.TransactionClient,partnerId:string){
 const products=await tx.product.findMany({where:{partnerId,status:'PUBLISHED'}});
 const items=await Promise.all(products.map(p=>storefrontEvidence(tx,p)));
 return {key:'storefront',label:'Approved SKU visible in storefront simulator',passed:items.some(i=>i.passed),detail:`${items.filter(i=>i.passed).length}/${items.length} published SKUs have matching visible customer content. This is local SFCC simulation, not a live website check.`};
}
export async function previewStorefront(actor:Actor,id:string){
 const p=await db.product.findFirst({where:{id,...scope(actor)}});requireCondition(p,'NOT_FOUND','Product not found',404);
 const evidence=await storefrontEvidence(db,p);
 // Only customer-safe content crosses this preview boundary, never vendor/commercial data.
 return {mode:'mock',...evidence,purchasable:false,notice:'Private SFCC simulator preview. Checkout is disabled; no live storefront has been changed.'};
}
export async function assertStorefrontJob(tx:Prisma.TransactionClient,job:Outbox){
 const value=storefrontEnvelope.parse(job.payload),p=await tx.product.findUniqueOrThrow({where:{id:job.aggregateId},include:{partner:{include:{brandRights:true}},publications:true}});
 const pub=p.publications.find(x=>x.target==='SFCC'&&x.version===p.version),now=(await tx.demoClock.findUniqueOrThrow({where:{id:'main'}})).now;
 if(job.target!=='SFCC'||job.destinationMode!=='mock'||job.companyId!==p.companyId||job.partnerId!==p.partnerId||job.market!==p.market||!pub?.externalId||p.status!=='PUBLISHED'||!hasCurrentPublication(p)||!['APPROVED','ACTIVE'].includes(p.partner.status)||!hasBrandRight(p.partner.brandRights,p,now)||!(await mappingReadiness(tx,p.partnerId)).passed||launchFingerprint(value)!==launchFingerprint(projectStorefront(p,pub.externalId)))throw new AdapterError('Storefront publication configuration or authorization changed; request a fresh publication',false);
 return value;
}
