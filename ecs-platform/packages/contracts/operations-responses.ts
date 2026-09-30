import {z,type ZodTypeAny} from 'zod';
import {launchPayload} from '../domain/launch-contract';
import {fieldMapping} from '../domain/catalog-mapping';

const text=z.string(),date=text.datetime(),integer=z.number().int(),count=integer.nonnegative(),version=integer.positive(),money=text.regex(/^-?\d+(?:\.\d+)?$/);
// Historical producer-owned JSON is evidence, not a newly invented canonical event contract.
// Strict envelopes below prohibit new top-level fields. Opaque records remain explicitly labelled.
const evidence=z.record(z.unknown()).describe('Producer-owned JSON evidence object; internal fields vary by operation/version. Not a canonical event schema.');
const auditValue=z.union([evidence,z.array(z.unknown()),text,z.number(),z.boolean(),z.null()]).describe('Original JSON before/after value, including null; retained without reinterpretation.');
export const catalogIssueResponse=z.object({code:text,field:text,message:text}).strict();
export const publicationResponse=z.object({id:text,productId:text,version,target:text,status:text,externalId:text.nullable(),error:text.nullable(),updatedAt:date}).strict();
export const productResponse=z.object({id:text,companyId:text,partnerId:text,sku:text,gtin:text.nullable(),titleEn:text,titleAr:text,category:text,brand:text,market:text,currency:text,price:money,floor:money,status:text,version,saleStatus:z.enum(['ENABLED','PAUSED','DELISTED']),saleVersion:version,saleChangedAt:date.nullable(),saleReason:text.nullable(),data:evidence}).strict();
const publishedProduct=productResponse.extend({publications:z.array(publicationResponse)});
export const inventoryResponse=z.object({id:text,productId:text,locationId:text,onHand:count,reserved:count,damaged:count,unavailable:count,safetyStock:count,sequence:count,revision:version,syncedAt:date.nullable(),lastEligible:z.boolean().nullable()}).strict();
const location=z.object({id:text,companyId:text,partnerId:text.nullable(),name:text,type:text,market:text,status:text,fyndId:text.nullable(),version,deliveryCities:z.array(text),cutoffHour:integer,dailyCapacity:integer}).strict();
const importSummary=z.object({id:text,fileName:text,source:z.enum(['CSV','XLSX','API']),status:z.enum(['STAGED','SUBMITTED']),version,createdAt:date}).strict();
const savedImportRow=z.object({number:integer.positive(),input:z.record(text),excluded:z.boolean().optional(),reason:text.optional(),duplicateApproval:z.object({fingerprint:text,reason:text}).strict().optional(),productId:text.optional()}).strict();
const validatedImportRow=savedImportRow.extend({issues:z.array(catalogIssueResponse),warnings:z.array(catalogIssueResponse),floor:money.nullable(),duplicateCandidates:z.array(z.object({id:text,sku:text,title:text}).strict())});
const importBase=importSummary.omit({status:true}).extend({companyId:text,partnerId:text.nullable(),market:text,actorId:text,requestKey:text,checksum:text,mapping:fieldMapping.extend({version:z.literal(1)}).nullable(),updatedAt:date});
export const importPreviewResponse=z.object({sourceHeaders:z.array(text).max(50),mapping:fieldMapping,missingFields:z.array(text),unmappedHeaders:z.array(text),numericIssues:z.array(text),rowCount:count.max(100),ready:z.boolean(),sampleRows:z.array(z.object({number:integer,raw:z.record(text),canonical:z.record(text)}).strict()).max(5)}).strict();
export const importDetailResponse=z.discriminatedUnion('status',[
 importBase.extend({status:z.literal('STAGED'),rows:z.array(validatedImportRow)}),
 importBase.extend({status:z.literal('SUBMITTED'),rows:z.array(savedImportRow.extend({issues:z.array(z.never()),warnings:z.array(z.never()),floor:z.null()}))}),
]);
const importMetadata=z.object({fields:z.array(text),requiredHeaders:z.array(text),brands:z.array(z.object({id:text,name:text}).strict()),floors:z.record(money),assets:z.array(text),maxRows:integer.positive(),maxBytes:integer.positive(),sources:z.array(z.enum(['CSV','XLSX','API'])),xlsx:z.object({worksheet:text,maxBytes:integer.positive(),formulas:z.literal(false)}).strict(),partners:z.array(z.object({id:text,code:text,displayName:text}).strict()),locations:z.array(z.object({id:text,partnerId:text.nullable(),name:text,code:text}).strict())}).strict();
const launchRun=z.object({id:text,companyId:text,partnerId:text,market:text,actorId:text,requestId:text,reason:text,inventoryId:text,fingerprint:text,snapshot:launchPayload.shape.scenario,destinationOrigin:text,status:text,step:integer.min(0).max(8),error:text.nullable(),createdAt:date,completedAt:date.nullable()}).strict();
const launchHistory=launchRun.pick({id:true,status:true,step:true,reason:true,createdAt:true,completedAt:true,error:true,fingerprint:true}).extend({snapshot:z.object({sku:text,unitGross:money,currency:text,fyndLocationId:text}).strict(),jobs:z.array(z.object({id:text,target:text,status:text,attempts:count,error:text.nullable(),payload:z.object({step:integer.min(0).max(7)}).strict()}).strict())});
export const financialEventResponse=z.object({id:text,companyId:text,partnerId:text,market:text,kind:text,amount:money,currency:text,sourceId:text,idempotencyKey:text,snapshot:evidence,createdAt:date,settlementId:text.nullable()}).strict();
const statementEvidence=z.object({eventIds:z.array(text),events:z.array(financialEventResponse).optional(),reconciledAt:date.optional(),convention:text.optional(),reason:text.optional()}).strict();
export const settlementResponse=z.object({id:text,companyId:text,partnerId:text,market:text,currency:text,status:text,version,from:date,to:date,payable:money,evidence:z.union([statementEvidence,statementEvidence.extend({fixture:z.literal('reconciliation-held-export-v1'),run:text})]),exportedId:text.nullable(),createdAt:date}).strict();
export const inboxResponse=z.object({id:text,source:text,eventId:text,type:text,companyId:text,market:text,payload:evidence,payloadHash:text,correlationId:text,status:text,error:text.nullable(),attempts:count,availableAt:date,createdAt:date,envelopeVersion:z.union([z.literal(0),z.literal(1)]),eventOccurredAt:date.nullable()}).strict();
export const outboxResponse=z.object({id:text,companyId:text,partnerId:text.nullable(),market:text,target:text,destinationMode:z.enum(['mock','live']),destinationOrigin:text,operation:text,aggregateId:text,payload:evidence,correlationId:text,idempotencyKey:text,status:text,attempts:count,availableAt:date,leaseUntil:date.nullable(),leaseToken:text.nullable(),error:text.nullable(),response:evidence.nullable(),createdAt:date,updatedAt:date}).strict();
const auditResponse=z.object({id:text,companyId:text,partnerId:text.nullable(),market:text,actorId:text,action:text,entityId:text,reason:text.nullable(),before:auditValue,after:auditValue,correlationId:text,createdAt:date}).strict();
const items=(schema:ZodTypeAny)=>z.object({items:z.array(schema)}).strict();
export const operationsResponseSchemas:Record<string,ZodTypeAny>={
 'GET /api/v1/partners/{id}/launch-tests':items(launchHistory),
 'POST /api/v1/partners/{id}/launch-tests':launchRun,
 'GET /api/v1/catalog/imports/metadata':importMetadata,
 'GET /api/v1/catalog/imports':items(importSummary),
 'POST /api/v1/catalog/imports':importDetailResponse,
 'POST /api/v1/catalog/imports/preview':importPreviewResponse,
 'GET /api/v1/catalog/imports/{id}':importDetailResponse,
 'POST /api/v1/catalog/imports/{id}/rows':importDetailResponse,
 'POST /api/v1/catalog/imports/{id}/duplicate-decision':importDetailResponse,
 'POST /api/v1/catalog/imports/{id}/submit':importDetailResponse,
 'GET /api/v1/catalog/items':items(publishedProduct).extend({total:count}),
 'GET /api/v1/catalog/items/{id}':publishedProduct.extend({issues:z.array(catalogIssueResponse)}),
 'POST /api/v1/catalog/items/{id}/draft':productResponse.extend({issues:z.array(catalogIssueResponse)}),
 // refresh-storefront returns the unchanged product; review/publish also return current issues/publications.
 'POST /api/v1/catalog/items/{id}/commands':z.union([productResponse,productResponse.extend({issues:z.array(catalogIssueResponse),publications:z.array(publicationResponse)})]),
 'GET /api/v1/inventory':items(inventoryResponse.extend({product:publishedProduct.extend({partner:z.object({id:text,status:text}).strict()}),location,sellable:count})),
 'POST /api/v1/inventory/{id}/adjust':inventoryResponse.extend({sellable:count}),
 'GET /api/v1/finance/events':items(financialEventResponse),
 'POST /api/v1/finance/adjustments':financialEventResponse,
 'GET /api/v1/settlements':items(settlementResponse),
 'POST /api/v1/settlements':settlementResponse,
 'GET /api/v1/settlements/{id}':settlementResponse,
 'POST /api/v1/settlements/{id}/commands':settlementResponse,
 'GET /api/v1/integrations/inbox':items(inboxResponse),
 'POST /api/v1/integrations/inbox/{id}/replay':inboxResponse,
 'GET /api/v1/integrations/jobs':items(outboxResponse),
 'POST /api/v1/integrations/jobs/{id}/replay':outboxResponse,
 'GET /api/v1/audit':items(auditResponse),
};
