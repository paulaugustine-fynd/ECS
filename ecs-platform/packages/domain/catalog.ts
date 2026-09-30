import { z } from 'zod';
import type { Prisma, Product } from '@prisma/client';
import { type Actor, permit, scope } from '../auth/policy';
import { audit, enqueue, json, transaction } from '../db/transaction';
import { validGtin } from './calculations';
import { requireCondition } from './errors';
import {hasBrandRight} from './brand-policy';
import {mappingReadiness} from './mappings';
import {randomUUID} from 'node:crypto';
import {projectStorefront} from './storefront-contract';
import {hasCurrentPublication} from './publication-policy';
import {notifyOperations} from './notifications';
import {openException,transitionException} from './exception-lifecycle';

export type CatalogData = {parentSku?:string;attributes?:Record<string,string>;media?:{url:string;status:string;reason?:string;assetId?:string;checksum?:string;width?:number;height?:number}[];reviewReason?:string;[key:string]:unknown};
export const catalogEdit = z.object({expectedVersion:z.number().int().positive(),titleEn:z.string().trim().max(200),titleAr:z.string().trim().max(200),gtin:z.string().max(14),price:z.string().regex(/^\d{1,10}(\.\d{1,2})?$/),attributes:z.record(z.string().max(300))}).strict();
export const catalogCommand = z.object({expectedVersion:z.number().int().positive(),action:z.enum(['submit','approve','request-changes','reject','approve-media','publish','refresh-storefront']),reason:z.string().trim().min(5).max(1000).optional()}).strict();
export type CatalogIssue={code:string;field:string;message:string};

// These are explicit demo taxonomy rules, not a claim about an ATI tenant configuration.
const attributes:Record<string,string[]>={
  'Women/Dresses/Midi':['colour','size','material','countryOfOrigin'],
  'Women/Handbags/Shoulder Bags':['colour','material','countryOfOrigin'],
  'Beauty/Skincare/Serums':['size','skinType','countryOfOrigin'],
  'Beauty/Makeup/Lips':['colour','finish','countryOfOrigin'],
  'Home/Home Fragrance/Candles':['size','scent','countryOfOrigin'],
  'Home/Bedding/Duvet Covers':['size','material','countryOfOrigin'],
  'Men/Shoes/Sneakers':['colour','size','countryOfOrigin'],
};
export async function catalogIssues(tx:Prisma.TransactionClient,p:Omit<Product,'saleStatus'|'saleVersion'|'saleChangedAt'|'saleReason'>):Promise<CatalogIssue[]> {
  const issues:CatalogIssue[]=[];const add=(code:string,field:string,message:string)=>issues.push({code,field,message});
  const data=p.data as CatalogData;const partner=await tx.partner.findUniqueOrThrow({where:{id:p.partnerId},include:{brandRights:true}});
  const now=(await tx.demoClock.findUniqueOrThrow({where:{id:'main'}})).now;
  if(!p.titleEn.trim())add('ENGLISH_TITLE_MISSING','titleEn','English title is required');
  if(!/[\u0600-\u06ff]/.test(p.titleAr))add('ARABIC_TITLE_MISSING','titleAr','An Arabic title must be reviewed');
  if(!p.gtin||!validGtin(p.gtin))add('GTIN_INVALID','gtin','A valid GTIN and check digit are required');
  if(p.gtin&&await tx.product.count({where:{id:{not:p.id},gtin:p.gtin}}))add('EXACT_DUPLICATE','gtin','This GTIN already exists; resolve the duplicate before submitting');
  if(p.price.lt(p.floor))add('BELOW_PRICE_FLOOR','price',`Price must be at least ${p.currency} ${p.floor}`);
  if(p.currency!=='AED'||p.market!=='AE')add('MARKET_CURRENCY','currency','This demonstration is configured for AE / AED only');
  if(!['APPROVED','ACTIVE'].includes(partner.status))add('PARTNER_NOT_AUTHORIZED','partner','Partner approval is required');
  if(!hasBrandRight(partner.brandRights,p,now))add('BRAND_SCOPE_NOT_AUTHORIZED','brand','An effective approved brand, category and market authorization is required');
  if(!partner.markets.includes(p.market))add('MARKET_NOT_AUTHORIZED','market','Partner is not authorized in this market');
  if(!(await mappingReadiness(tx,p.partnerId)).passed)add('LOCATION_MAPPING_MISSING','partner','Current acknowledged brand/location provisioning is required');
  if(!Object.hasOwn(attributes,p.category))add('CATEGORY_NOT_CONFIGURED','category','Category requires an operator taxonomy rule');
  for(const field of Object.hasOwn(attributes,p.category)?attributes[p.category]:[])if(!data.attributes?.[field]?.trim())add('ATTRIBUTE_MISSING',`attributes.${field}`,`${field} is required for this category`);
  if(!data.parentSku)add('PARENT_MISSING','parentSku','Parent SKU is required');
  if(!data.media?.length||data.media.some(m=>m.status!=='APPROVED'))add('MEDIA_REVIEW_REQUIRED','media','Every image requires a human moderation decision; automated image inspection is not implemented');
  for(const media of data.media??[])if(media.assetId){const asset=await tx.mediaAsset.findFirst({where:{id:media.assetId,companyId:p.companyId,partnerId:p.partnerId,market:p.market,checksum:media.checksum,scanStatus:'MOCK_CLEAN'}});if(!asset||!media.checksum||media.url!==`/api/v1/catalog/media/${media.assetId}/content`)add('MEDIA_ASSET_INVALID','media','Attached asset must have matching private ownership, checksum and scanned content');}
  return issues;
}

export async function editCatalog(actor:Actor,id:string,input:z.infer<typeof catalogEdit>,correlationId:string){
  permit(actor,'catalog');
  return transaction(async tx=>{
    const p=await tx.product.findFirst({where:{id,...scope(actor)}});requireCondition(p,'NOT_FOUND','Product not found',404);
    requireCondition(p.version===input.expectedVersion,'STALE_VERSION','Refresh the product before editing',409);
    requireCondition(['DRAFT','CHANGES_REQUESTED','REJECTED'].includes(p.status),'EDIT_LOCKED','Only draft or returned items can be edited in this checkpoint',409);
    const fields={titleEn:input.titleEn,titleAr:input.titleAr,gtin:input.gtin,price:input.price};const editedAttributes=input.attributes;
    const updated=await tx.product.update({where:{id},data:{...fields,status:'DRAFT',version:{increment:1},data:json({...p.data as CatalogData,attributes:editedAttributes})}});
    await audit(tx,actor,correlationId,'catalog.edit',id,p,updated,undefined,p.partnerId);
    return {...updated,issues:await catalogIssues(tx,updated)};
  });
}

export async function commandCatalog(actor:Actor,id:string,input:z.infer<typeof catalogCommand>,correlationId:string){
  permit(actor,'catalog',input.action!=='submit');
  return transaction(async tx=>{
    const p=await tx.product.findFirst({where:{id,...scope(actor)}});requireCondition(p,'NOT_FOUND','Product not found',404);
    requireCondition(p.version===input.expectedVersion,'STALE_VERSION','Refresh the product before continuing',409);
    if(input.action==='refresh-storefront'){
      requireCondition(p.status==='PUBLISHED','INVALID_TRANSITION','Publish the current product before refreshing storefront content',409);
      const pubs=await tx.publication.findMany({where:{productId:id,version:p.version}}),issues=await catalogIssues(tx,p);
      requireCondition(hasCurrentPublication({...p,publications:pubs})&&!issues.length,'CATALOG_INVALID','Current approved content, rights, mappings and all publication identities are required');
      const snapshot=projectStorefront(p,pubs.find(x=>x.target==='SFCC')!.externalId!);
      await enqueue(tx,{...actor,markets:[p.market]},correlationId,'SFCC','publishStorefront',id,snapshot,`storefront:${id}:${p.version}:${randomUUID()}`,p.partnerId);
      await audit(tx,actor,correlationId,'catalog.refresh-storefront',id,null,{version:p.version,fingerprint:snapshot.fingerprint},'Refresh local SFCC customer projection',p.partnerId);
      return p;
    }
    const transitions:Record<string,string[]>={submit:['DRAFT','CHANGES_REQUESTED'],approve:['IN_REVIEW'],'request-changes':['IN_REVIEW'],reject:['IN_REVIEW'],'approve-media':['DRAFT','CHANGES_REQUESTED','IN_REVIEW'],publish:['APPROVED']};
    requireCondition(transitions[input.action].includes(p.status),'INVALID_TRANSITION',`Cannot ${input.action} while ${p.status}`,409);
    if(['approve','request-changes','reject','approve-media'].includes(input.action))requireCondition(input.reason,'REASON_REQUIRED','Provide review evidence or feedback');
    const issues=await catalogIssues(tx,p);
    // Content can enter review while media awaits the moderator, but cannot be approved or published.
    const blocking=input.action==='submit'?issues.filter(i=>i.code!=='MEDIA_REVIEW_REQUIRED'):issues;
    if(['submit','approve','publish'].includes(input.action))requireCondition(!blocking.length,'CATALOG_INVALID',blocking.map(i=>`${i.code}: ${i.message}`).join('; '));
    const data=p.data as CatalogData;
    if(input.action==='approve-media')requireCondition(data.media?.length,'MEDIA_MISSING','Attach an image before moderation');
    const next={submit:'IN_REVIEW',approve:'APPROVED','request-changes':'CHANGES_REQUESTED',reject:'REJECTED',publish:'PUBLISHING','approve-media':p.status}[input.action];
    // Workflow decisions do not change canonical content version; edits do.
    const updated=await tx.product.update({where:{id},data:{status:next,data:json({...data,...(input.reason?{reviewReason:input.reason}:{}),...(input.action==='approve-media'?{media:data.media!.map(m=>({...m,status:'APPROVED',reason:input.reason}))}:{})})}});
    if(input.action==='publish'){
      for(const target of ['ERP','FYND','SFCC'])await tx.publication.upsert({where:{productId_version_target:{productId:id,version:p.version,target}},update:{},create:{productId:id,version:p.version,target,status:target==='ERP'?'PENDING':'BLOCKED'}});
      await enqueue(tx,{...actor,markets:[p.market]},correlationId,'ERP','upsertProduct',id,{version:p.version,product:json(p),merchantOfRecord:'ATI'},`product:${id}:${p.version}:ERP`,p.partnerId);
    }
    const event=await audit(tx,actor,correlationId,`catalog.${input.action}`,id,p,updated,input.reason,p.partnerId);
    if(['reject','request-changes'].includes(input.action))await openException(tx,{companyId:p.companyId,partnerId:p.partnerId,market:p.market,kind:'CATALOG_REVIEW',entityId:p.id,message:input.action==='reject'?'Item rejected. Correct the product and resubmit for moderation.':'Changes requested. Read the product feedback, correct the item and resubmit.'});
    if(input.action==='submit')await transitionException(tx,'CATALOG_REVIEW',p.id,'RESOLVED','Corrected item passed submission validation and returned to moderation; publication is not yet approved.');
    if(['reject','request-changes'].includes(input.action))await notifyOperations(tx,{companyId:p.companyId,partnerId:p.partnerId,market:p.market,category:'CATALOG',severity:input.action==='reject'?'CRITICAL':'WARNING',entityType:'PRODUCT',entityId:p.id,eventKey:`catalog-review:${event.id}`,title:input.action==='reject'?'Catalogue item rejected':'Catalogue changes requested',message:`${p.sku}: open the product review to read the moderator feedback and correct the item.`,eventAt:(await tx.demoClock.findUniqueOrThrow({where:{id:'main'}})).now});
    return {...updated,issues:await catalogIssues(tx,updated),publications:await tx.publication.findMany({where:{productId:id,version:p.version}})};
  });
}
