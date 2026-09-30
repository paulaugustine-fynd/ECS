import {createHash} from 'node:crypto';
import {parse} from 'csv-parse/sync';
import {Prisma,type CatalogImport,type Product} from '@prisma/client';
import {z} from 'zod';
import {type Actor,permit,scope,partnerScope,isVendor} from '../auth/policy';
import {db} from '../db/client';
import {audit,json,transaction} from '../db/transaction';
import {catalogIssues,type CatalogData,type CatalogIssue} from './catalog';
import {requireCondition,DomainError} from './errors';
import locationFixtures from '../../seed/locations.json';
import {parseCatalogXlsx,xlsxMaxBytes} from './catalog-xlsx';
import {importFields,requiredHeaders} from './catalog-fields';
import {fieldMapping,mapCatalogSource,checkSourceHeaders} from './catalog-mapping';

export {importFields};
const value=z.string().max(500);
const rawSchema=z.object(Object.fromEntries(importFields.map(k=>[k,value.optional()]))).strict();
export type ImportInput=Record<string,string>;
type SavedRow={number:number;input:ImportInput;excluded?:boolean;reason?:string;duplicateApproval?:{fingerprint:string;reason:string};productId?:string};
const brands=[{id:'br_coach',name:'Coach'},{id:'br_maz',name:'Maison Azure'},{id:'br_lum',name:'Lumera'},{id:'br_nrh',name:'Northline Home'},{id:'br_orb',name:'Orbit'}];
// Explicit AE demo policies from the supplied sample assortment, not ATI tenant rules.
export const importFloors:Record<string,string>={
 'br_coach|Women/Handbags/Shoulder Bags':'1000.00', // Fictional demo policy, not Coach pricing advice.
 'br_maz|Women/Dresses/Midi':'1750.00','br_maz|Women/Handbags/Shoulder Bags':'3000.00',
 'br_lum|Beauty/Skincare/Serums':'280.00','br_lum|Beauty/Makeup/Lips':'130.00',
 'br_nrh|Home/Home Fragrance/Candles':'220.00','br_nrh|Home/Bedding/Duvet Covers':'750.00','br_orb|Men/Shoes/Sneakers':'650.00',
};
const media=new Set(['coach-tabby','coach-brooklyn','coach-swinger','maz-dress-black','maz-bag-tan','lum-serum','lum-lip-ruby','nrh-candle','nrh-duvet','orb-sneaker'].map(n=>`/demo-assets/${n}.svg`));
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const mappingHash=(v:unknown):string=>{if(v===null)return hash(null);const m=fieldMapping.parse(v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>k!=='version')):v);return hash([Object.entries(m.fields).sort(),[...m.ignoredHeaders].sort(),m.values.map(r=>[r.field,r.from,r.to]).sort()]);};
export const importRequest=z.discriminatedUnion('source',[
 z.object({source:z.literal('CSV'),fileName:z.string().trim().min(1).max(120).regex(/^[^/\\]+\.csv$/i).refine(s=>[...s].every(c=>c.charCodeAt(0)>=32),'Control characters are not allowed'),content:z.string().min(1).max(262144),requestKey:z.string().uuid(),mapping:fieldMapping.optional()}).strict(),
 z.object({source:z.literal('XLSX'),fileName:z.string().trim().min(1).max(120).regex(/^[^/\\]+\.xlsx$/i).refine(s=>[...s].every(c=>c.charCodeAt(0)>=32),'Control characters are not allowed'),base64:z.string().min(1).max(4*Math.ceil(xlsxMaxBytes/3)),requestKey:z.string().uuid(),mapping:fieldMapping.optional()}).strict(),
 z.object({source:z.literal('API'),fileName:z.literal('API batch'),rows:z.array(rawSchema).min(1).max(100),requestKey:z.string().uuid()}).strict(),
]);
export function parseCatalogCsv(content:string,inspection=false):ImportInput[]{
 requireCondition(Buffer.byteLength(content,'utf8')<=262144,'IMPORT_TOO_LARGE','CSV exceeds 256 KB',413);
 try{
  const result=parse(content,{bom:true,skip_empty_lines:true,trim:true,max_record_size:16000,columns:(headers:string[])=>{
   requireCondition(new Set(headers).size===headers.length,'CSV_HEADERS','Duplicate headers are not allowed',400);
   if(inspection)checkSourceHeaders(headers);
   else requireCondition(requiredHeaders.every(h=>headers.includes(h))&&headers.every(h=>(importFields as readonly string[]).includes(h)),'CSV_HEADERS','Use the defined catalogue CSV headers. Optional category attributes may be added.',400);return headers;
  }}) as ImportInput[];
  requireCondition(result.length>0&&result.length<=100,'CSV_ROW_LIMIT','Upload between 1 and 100 product rows',400);
  return result.map(r=>(inspection?z.record(value):rawSchema).parse(r) as ImportInput);
 }catch(error){if(error instanceof DomainError)throw error;throw new DomainError('CSV_INVALID','Malformed CSV, inconsistent columns or oversized field. Use UTF-8 CSV with quoted comma-containing values.',400);}
}
async function mappedSource(input:z.infer<typeof importRequest>){
 const numericHeaders=new Set<string>();
 const rows=input.source==='CSV'?parseCatalogCsv(input.content,true):input.source==='XLSX'?await parseCatalogXlsx(input.base64,importFields,requiredHeaders,{numericHeaders}):input.rows as ImportInput[];
 return {rows,...mapCatalogSource(rows,'mapping' in input?input.mapping:undefined,[...numericHeaders])};
}
export async function previewImport(actor:Actor,input:z.infer<typeof importRequest>){
 permit(actor,'catalog');scope(actor,'AE');
 const {canonicalRows:_canonicalRows,rows:_rows,...preview}=await mappedSource(input);
 void _canonicalRows;void _rows;
 // Preview echoes only the caller's bounded upload; it never reads another partner's data or persists a batch.
 return preview;
}
export const importRowEdit=z.object({expectedVersion:z.number().int().positive(),rowNumber:z.number().int().min(2).max(101),input:rawSchema,excluded:z.boolean().default(false),reason:z.string().trim().min(5).max(500)}).strict();
export const importDecision=z.object({expectedVersion:z.number().int().positive(),rowNumber:z.number().int().min(2).max(101),reason:z.string().trim().min(10).max(500)}).strict();
export const importSubmit=z.object({expectedVersion:z.number().int().positive()}).strict();
export function titleSimilarity(a:string,b:string){
 const words=(s:string)=>new Set(s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu,' ').trim().split(/\s+/).filter(Boolean));
 const aa=words(a),bb=words(b),union=new Set([...aa,...bb]);return union.size?[...aa].filter(w=>bb.has(w)).length/union.size:0;
}
export function importReportCsv(rows:{number:number;input:ImportInput;issues:CatalogIssue[];excluded?:boolean}[]){
 const cell=(v:unknown)=>{let text=String(v??'');if(/^[\s]*[=+@-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
 const records=[['row','vendor_sku','field','code','message','excluded'],...rows.flatMap(r=>r.issues.map(i=>[r.number,r.input.vendor_sku,i.field,i.code,i.message,r.excluded?'yes':'no']))];
 return '\ufeff'+records.map(r=>r.map(cell).join(',')).join('\r\n');
}
async function batchFor(tx:Prisma.TransactionClient,actor:Actor,id:string){
 permit(actor,'catalog');const batch=await tx.catalogImport.findFirst({where:{id,...scope(actor)}});requireCondition(batch,'NOT_FOUND','Import batch not found',404);return batch;
}
function cleanInput(input:ImportInput):ImportInput{return Object.fromEntries(importFields.map(k=>[k,(input[k]??'').trim()]));}
function attrs(input:ImportInput){return {colour:input.colour,size:input.size,material:input.material,countryOfOrigin:input.country_of_origin,skinType:input.skin_type,finish:input.finish,scent:input.scent};}
type ImportProduct=Omit<Product,'saleStatus'|'saleVersion'|'saleChangedAt'|'saleReason'>;
type CheckedRow=SavedRow&{issues:CatalogIssue[];warnings:CatalogIssue[];floor:string|null;candidate:ImportProduct|null;locationId:string|null;duplicateFingerprint:string;duplicateCandidates:{id:string;sku:string;title:string}[]};
async function validateRows(tx:Prisma.TransactionClient,actor:Actor,batch:CatalogImport):Promise<CheckedRow[]>{
 const rows=batch.rows as SavedRow[];
 const partners=await tx.partner.findMany({where:partnerScope(actor)});
 const known=await tx.product.findMany({where:{companyId:actor.companyId,market:batch.market}});
 const checked:CheckedRow[]=[];
 for(const row of rows){
  const r=cleanInput(row.input),issues:CatalogIssue[]=[],warnings:CatalogIssue[]=[];
  const add=(code:string,field:string,message:string)=>issues.push({code,field,message});
  const partner=partners.find(p=>p.code===r.partner_code);
  const brand=brands.find(b=>b.id===r.brand||b.name.toLowerCase()===r.brand.toLowerCase())?.id??r.brand;
  const floor=Object.hasOwn(importFloors,`${brand}|${r.category}`)?importFloors[`${brand}|${r.category}`]:null;
  let candidate:ImportProduct|null=null,locationId:string|null=null;
  if(!partner)add('PARTNER_NOT_AUTHORIZED','partner_code','Partner code is not in your permitted scope');
  if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{1,79}$/.test(r.vendor_sku))add('SKU_INVALID','vendor_sku','Use a 2–80 character SKU with letters, digits, dots, underscores or hyphens');
  if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{1,79}$/.test(r.parent_sku)||r.parent_sku===r.vendor_sku)add('PARENT_INVALID','parent_sku','A distinct valid parent SKU is required');
  if(!floor)add('PRICE_POLICY_MISSING','category','No operator-owned demo floor policy exists for this brand/category');
  const priceValid=/^\d{1,10}(\.\d{1,2})?$/.test(r.selling_price),listValid=/^\d{1,10}(\.\d{1,2})?$/.test(r.list_price);
  if(!priceValid)add('PRICE_INVALID','selling_price','Use a non-negative decimal with at most two decimal places');
  if(!listValid)add('PRICE_INVALID','list_price','List price is required as a decimal');
  if(priceValid&&listValid&&new Prisma.Decimal(r.selling_price).gt(r.list_price))add('PRICE_RANGE','selling_price','Selling price cannot exceed list price');
  if(!/^\d{1,7}$/.test(r.quantity))add('QUANTITY_INVALID','quantity','Quantity must be a whole number from 0 to 9,999,999');
  if(!media.has(r.image_url))add('MEDIA_NOT_INGESTED','image_url','Bulk imports currently use local demo assets. Upload/ZIP/URL/DAM imagery is available per product; batch linkage is pending.');
  if(r.title_en.length>200||r.title_ar.length>200)add('TITLE_TOO_LONG','title_en','Titles must be at most 200 characters');
  if(partner){
   const locationCode=locationFixtures.find(l=>l.code===r.location_code)?.id??r.location_code;
   const location=await tx.location.findFirst({where:{id:locationCode,companyId:actor.companyId,partnerId:partner.id,market:batch.market,status:'ACTIVE',fyndId:{not:null}}});
   if(!location)add('LOCATION_INVALID','location_code','An active mapped location owned by this partner is required');else locationId=location.id;
   if(priceValid&&floor){
    candidate={id:`import-${batch.id}-${row.number}`,companyId:actor.companyId,partnerId:partner.id,market:batch.market,brand,sku:r.vendor_sku,gtin:r.gtin,titleEn:r.title_en,titleAr:r.title_ar,category:r.category,currency:r.currency,price:new Prisma.Decimal(r.selling_price),floor:new Prisma.Decimal(floor),status:'IN_REVIEW',version:1,data:json({parentSku:r.parent_sku,attributes:attrs(r),media:[{url:r.image_url,status:'PENDING'}],pricing:{listPrice:r.list_price},import:{batchId:batch.id,rowNumber:row.number,source:batch.source,checksum:batch.checksum},demoOnly:true}) as Prisma.JsonObject};
    for(const issue of await catalogIssues(tx,candidate)){if(issue.code==='MEDIA_REVIEW_REQUIRED')warnings.push(issue);else issues.push(issue);}
   }
  }
  const duplicates=known.filter(p=>p.id!==row.productId&&(p.sku===r.vendor_sku||p.gtin===r.gtin||(p.data as CatalogData).sourceGtin===r.gtin));
  if(duplicates.length||await tx.product.count({where:{sku:r.vendor_sku,id:{not:row.productId??''}}}))add('EXACT_DUPLICATE','vendor_sku','A SKU or GTIN already exists. This create-only import will not overwrite existing products.');
  const siblings=known.filter(p=>(p.data as CatalogData).parentSku===r.parent_sku);
  if(siblings.some(p=>p.partnerId!==partner?.id||p.brand!==brand||p.category!==r.category))add('PARENT_CONFLICT','parent_sku','Parent family belongs to another partner, brand or category');
  const sameVariant=(p:Product)=>{const a=(p.data as CatalogData).attributes;return (a?.size??'')===r.size&&(a?.colour??'')===r.colour;};
  if(siblings.some(p=>p.partnerId===partner?.id&&sameVariant(p)))add('VARIANT_DUPLICATE','parent_sku','This parent already has the same size and colour variant');
  const probable=known.filter(p=>p.id!==row.productId&&p.brand===brand&&p.category===r.category&&titleSimilarity(p.titleEn,r.title_en)>=0.8&&!((p.data as CatalogData).parentSku===r.parent_sku&&!sameVariant(p)));
  const fingerprint=hash([r,probable.map(p=>[p.id,p.version]).sort()]);
  if(probable.length&&row.duplicateApproval?.fingerprint!==fingerprint)add('PROBABLE_DUPLICATE','title_en','Similar brand/category/title exists. ATI moderation must review this candidate before submission.');
  checked.push({...row,input:r,issues,warnings,floor,candidate,locationId,duplicateFingerprint:fingerprint,duplicateCandidates:probable.filter(p=>!isVendor(actor)||p.partnerId===actor.partnerId).map(p=>({id:p.id,sku:p.sku,title:p.titleEn}))});
 }
 for(const row of checked){
  const others=checked.filter(r=>r.number!==row.number&&!r.excluded);
  if(!row.excluded&&others.some(r=>r.input.vendor_sku===row.input.vendor_sku||!!row.input.gtin&&r.input.gtin===row.input.gtin))row.issues.push({code:'BATCH_DUPLICATE',field:'vendor_sku',message:'SKU or GTIN is duplicated inside this batch'});
  if(!row.excluded&&others.some(r=>r.input.parent_sku===row.input.parent_sku&&(r.input.partner_code!==row.input.partner_code||r.candidate?.brand!==row.candidate?.brand||r.input.category!==row.input.category)))row.issues.push({code:'PARENT_CONFLICT',field:'parent_sku',message:'Rows sharing a parent must use the same partner, brand and category'});
  if(!row.excluded&&others.some(r=>r.input.parent_sku===row.input.parent_sku&&r.input.size===row.input.size&&r.input.colour===row.input.colour))row.issues.push({code:'VARIANT_DUPLICATE',field:'parent_sku',message:'A parent cannot contain repeated size and colour variants'});
 }
 return checked;
}
async function present(tx:Prisma.TransactionClient,actor:Actor,batch:CatalogImport){
 // Submitted evidence is immutable. Subsequent product changes are visible on its product page.
 if(batch.status==='SUBMITTED')return {...batch,originalRows:undefined,rows:(batch.rows as SavedRow[]).map(r=>({...r,issues:[],warnings:[],floor:null}))};
 const rows=await validateRows(tx,actor,batch);
 return {...batch,originalRows:undefined,rows:rows.map(({candidate:_candidate,locationId:_locationId,duplicateFingerprint:_fingerprint,...row})=>row)};
}
export async function importMetadata(actor:Actor){
 permit(actor,'catalog');return {fields:importFields,requiredHeaders,brands,floors:importFloors,assets:[...media],maxRows:100,maxBytes:262144,sources:['CSV','XLSX','API'],xlsx:{worksheet:'Catalogue',maxBytes:xlsxMaxBytes,formulas:false},
 partners:await db.partner.findMany({where:partnerScope(actor),select:{id:true,code:true,displayName:true}}),
 locations:(await db.location.findMany({where:{...scope(actor),status:'ACTIVE'},select:{id:true,partnerId:true,name:true}})).map(l=>({...l,code:locationFixtures.find(f=>f.id===l.id)?.code??l.id}))};
}
export async function stageImport(actor:Actor,input:z.infer<typeof importRequest>,correlationId:string){
 permit(actor,'catalog');scope(actor,'AE');
 const mapped=input.source==='API'?null:await mappedSource(input);
 requireCondition(!mapped||mapped.ready,'IMPORT_MAPPING_INCOMPLETE','Map required fields, explicitly ignore unused columns and store identifiers as text before staging',400);
 const inputs=mapped?mapped.canonicalRows:input.source==='API'?input.rows as ImportInput[]:[];
 const mapping=mapped?{version:1,...mapped.mapping}:null;
 const checksum=input.source==='XLSX'?createHash('sha256').update(Buffer.from(input.base64,'base64')).digest('hex'):hash(input.source==='CSV'?input.content:input.rows);
 return transaction(async tx=>{
  const prior=await tx.catalogImport.findUnique({where:{actorId_requestKey:{actorId:actor.id,requestKey:input.requestKey}}});
  if(prior){const legacy=prior.mapping===null&&input.source!=='API'&&!input.mapping;requireCondition(prior.checksum===checksum&&prior.fileName===input.fileName&&prior.source===input.source&&(legacy||mappingHash(prior.mapping)===mappingHash(mapping)),'IMPORT_KEY_CONFLICT','Request key already belongs to a different upload or mapping',409);return present(tx,actor,await batchFor(tx,actor,prior.id));}
  if(isVendor(actor)){
   const partner=await tx.partner.findFirst({where:partnerScope(actor)});
   requireCondition(partner&&inputs.every(r=>r.partner_code?.trim()===partner.code),'PARTNER_NOT_AUTHORIZED','A vendor upload may contain only its own partner code',403);
  }
  const batch=await tx.catalogImport.create({data:{companyId:actor.companyId,partnerId:isVendor(actor)?actor.partnerId:null,market:'AE',actorId:actor.id,requestKey:input.requestKey,source:input.source,fileName:input.fileName,checksum,mapping:mapping?json(mapping):Prisma.DbNull,originalRows:json(mapped?.rows??inputs),rows:json(inputs.map((r,i)=>({number:i+2,input:cleanInput(r)})))}});
  await audit(tx,actor,correlationId,'catalog.import-staged',batch.id,null,{source:batch.source,checksum,rowCount:inputs.length,mapping},undefined,batch.partnerId??undefined);
  return present(tx,actor,batch);
 });
}
export async function listImports(actor:Actor){permit(actor,'catalog');return db.catalogImport.findMany({where:scope(actor),orderBy:{createdAt:'desc'},take:50,select:{id:true,fileName:true,source:true,status:true,version:true,createdAt:true}});}
export async function readImport(actor:Actor,id:string){return transaction(async tx=>present(tx,actor,await batchFor(tx,actor,id)));}
export async function editImportRow(actor:Actor,id:string,input:z.infer<typeof importRowEdit>,correlationId:string){
 return transaction(async tx=>{
  const batch=await batchFor(tx,actor,id);requireCondition(batch.status==='STAGED'&&batch.version===input.expectedVersion,'IMPORT_STALE','Refresh the staged batch before editing',409);
  const rows=batch.rows as SavedRow[],row=rows.find(r=>r.number===input.rowNumber);requireCondition(row,'ROW_NOT_FOUND','Row not found',404);
  if(isVendor(actor)){const p=await tx.partner.findFirst({where:partnerScope(actor)});requireCondition(p&&input.input.partner_code?.trim()===p.code,'PARTNER_NOT_AUTHORIZED','Row must retain your partner code',403);}
  const before={...row};row.input=cleanInput(input.input as ImportInput);row.excluded=input.excluded;row.reason=input.reason;delete row.duplicateApproval;
  const updated=await tx.catalogImport.update({where:{id},data:{rows:json(rows),version:{increment:1}}});
  await audit(tx,actor,correlationId,'catalog.import-row-corrected',id,before,row,input.reason,batch.partnerId??undefined);return present(tx,actor,updated);
 });
}
export async function allowImportDuplicate(actor:Actor,id:string,input:z.infer<typeof importDecision>,correlationId:string){
 permit(actor,'catalog',true);
 return transaction(async tx=>{
  const batch=await batchFor(tx,actor,id);requireCondition(batch.status==='STAGED'&&batch.version===input.expectedVersion,'IMPORT_STALE','Refresh the staged batch before review',409);
  const checked=(await validateRows(tx,actor,batch)).find(r=>r.number===input.rowNumber);requireCondition(checked&&checked.issues.some(i=>i.code==='PROBABLE_DUPLICATE'),'NOT_A_CANDIDATE','No unresolved probable duplicate on this row');
  const rows=batch.rows as SavedRow[],row=rows.find(r=>r.number===input.rowNumber)!;
  row.duplicateApproval={fingerprint:checked.duplicateFingerprint,reason:input.reason};
  const updated=await tx.catalogImport.update({where:{id},data:{rows:json(rows),version:{increment:1}}});
  await audit(tx,actor,correlationId,'catalog.import-duplicate-distinct',id,null,{row:row.number,fingerprint:checked.duplicateFingerprint},input.reason,batch.partnerId??undefined);return present(tx,actor,updated);
 });
}
export async function submitImport(actor:Actor,id:string,input:z.infer<typeof importSubmit>,correlationId:string){
 return transaction(async tx=>{
  const batch=await batchFor(tx,actor,id);
  if(batch.status==='SUBMITTED')return present(tx,actor,batch);
  requireCondition(batch.version===input.expectedVersion,'IMPORT_STALE','Batch has changed. Refresh before submitting.',409);
  const checked=await validateRows(tx,actor,batch),included=checked.filter(r=>!r.excluded);
  requireCondition(included.length,'IMPORT_EMPTY','Include at least one row');
  requireCondition(included.every(r=>r.issues.length===0&&r.candidate&&r.locationId),'IMPORT_INVALID','Batch has blocking issues. Refresh validation and correct or exclude affected rows.');
  const rows=batch.rows as SavedRow[];
  for(const row of included){
   const {id:temporaryId,...data}=row.candidate!;void temporaryId;
   const product=await tx.product.create({data:{...data,data:json(data.data)}});
   await tx.inventory.create({data:{productId:product.id,locationId:row.locationId!,onHand:Number(row.input.quantity),sequence:1,lastEligible:false}});
   rows.find(r=>r.number===row.number)!.productId=product.id;
   await audit(tx,actor,correlationId,'catalog.import-product-created',product.id,null,{batchId:id,row:row.number,sku:product.sku,status:'IN_REVIEW'},'Awaiting independent media/product moderation; no publication requested',product.partnerId);
  }
  const updated=await tx.catalogImport.update({where:{id},data:{rows:json(rows),status:'SUBMITTED',version:{increment:1}}});
  await audit(tx,actor,correlationId,'catalog.import-submitted',id,{version:batch.version},{created:included.length,excluded:checked.length-included.length},undefined,batch.partnerId??undefined);return present(tx,actor,updated);
 });
}
