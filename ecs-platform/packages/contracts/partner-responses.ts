import {z,type ZodTypeAny} from 'zod';
import {applicationFields,documentTypes} from '../domain/onboarding';
import {storefrontContent} from '../domain/storefront-contract';
import {fulfilmentResponseSchemas} from './fulfilment-responses';
import {exceptionResponseSchemas} from './exception-responses';
import {analyticsResponseSchemas} from './analytics-responses';
import {reconciliationResponseSchemas} from './reconciliation-responses';
import {productSalesResponse} from './product-sales-responses';
import {operationsResponseSchemas} from './operations-responses';
import {mediaResponseSchemas} from './media-responses';

const text=z.string(),date=text.datetime(),integer=z.number().int(),money=text.regex(/^-?\d+(?:\.\d+)?$/);
export const partnerSummaryResponse=z.object({id:text,code:text,companyId:text,legalName:text,displayName:text,status:text,markets:z.array(text),erpVendorId:text.nullable(),riskTier:text,trusted:z.boolean(),brandApproved:z.boolean(),fyndMapped:z.boolean(),inventorySynced:z.boolean(),testOrderPassed:z.boolean(),version:integer.positive(),submittedAt:date.nullable(),createdAt:date,updatedAt:date}).strict();
const partnerRecord=partnerSummaryResponse.extend({application:applicationFields.partial(),reviewReason:text.nullable()});
export const documentMetadataResponse=z.object({id:text,partnerId:text,type:text,fileName:text,contentType:text,checksum:text,byteSize:integer.nonnegative(),scanStatus:text,scanDetail:text.nullable(),storageMode:text,version:integer.positive(),status:text,expiresAt:date.nullable(),reason:text.nullable(),createdAt:date}).strict();
const documentRecord=documentMetadataResponse.extend({objectKey:text});
export const agreementResponse=z.object({id:text,partnerId:text,version:integer.positive(),rate:money,currency:text,cadence:text,validFrom:date,validUntil:date,status:text,rules:z.object({market:text.optional(),brand:text.nullable().optional(),categoryRates:z.record(money).optional(),returnDays:integer.nonnegative().optional(),handlingCharge:money.optional()}).strict()}).strict();
const calculation=z.object({rate:money,commission:money,payable:money}).strict();
const gate=z.object({key:text,label:text,passed:z.boolean(),detail:text.optional(),runId:text.optional(),positions:z.array(z.object({inventoryId:text,sku:text,locationName:text,revision:integer,expectedSellable:integer,passed:z.boolean(),issues:z.array(text)}).strict()).optional(),mappings:z.array(z.object({kind:z.enum(['BRAND','LOCATION']),canonicalId:text,market:text,passed:z.boolean(),externalId:text.nullable(),detail:text}).strict()).optional()}).strict();
const accessBase={documentTypes:z.array(z.enum(documentTypes))};
const detailBase=partnerSummaryResponse.extend({documents:z.array(documentMetadataResponse),readiness:z.array(gate)});
// Distinct variants make unauthorized fields invalid, not just optional everywhere.
export const partnerDetailResponse=z.union([
 detailBase.extend({access:z.object({...accessBase,application:z.literal(true),commercials:z.literal(true)}).strict(),application:applicationFields.partial(),applicationIssues:z.array(text),reviewReason:text.nullable(),agreements:z.array(agreementResponse)}),
 detailBase.extend({access:z.object({...accessBase,application:z.literal(false),commercials:z.literal(true)}).strict(),agreements:z.array(agreementResponse)}),
 detailBase.extend({access:z.object({...accessBase,application:z.literal(false),commercials:z.literal(false)}).strict()}),
]);
const brandRight=z.object({id:text,partnerId:text,brand:text,market:text,categories:z.array(text),validFrom:date,validUntil:date,status:text,evidence:text,reason:text,version:integer.positive(),createdAt:date,updatedAt:date}).strict();
const location=z.object({id:text,companyId:text,partnerId:text.nullable(),name:text,type:text,market:text,status:text,fyndId:text.nullable(),version:integer.positive(),deliveryCities:z.array(text),cutoffHour:integer,dailyCapacity:integer}).strict();
const visibilityBase=z.object({mode:z.literal('mock'),sku:text,version:integer.positive(),externalId:text.nullable(),detail:text,purchasable:z.literal(false),notice:text}).strict();
export const domainResponseSchemas:Record<string,ZodTypeAny>={
 ...mediaResponseSchemas,
 ...operationsResponseSchemas,
 'GET /api/v1/catalog/items/{id}/sales-control':productSalesResponse,
 'POST /api/v1/catalog/items/{id}/sales-control':productSalesResponse,
 ...analyticsResponseSchemas,
 ...reconciliationResponseSchemas,
 ...notificationResponseSchemas,
 ...exceptionResponseSchemas,
 ...fulfilmentResponseSchemas,
 'GET /api/v1/partners':z.object({items:z.array(partnerSummaryResponse),total:integer.nonnegative(),page:integer.positive()}).strict(),
 'GET /api/v1/partners/{id}':partnerDetailResponse,
 'POST /api/v1/partners/invite':z.object({partner:partnerRecord,expiresAt:date,invitationUrl:text,delivery:z.literal('LOCAL_PREVIEW_NOT_SENT')}).strict(),
 'POST /api/v1/invitations/accept':z.object({email:text.email(),next:z.literal('/login?next=/onboarding')}).strict(),
 'POST /api/v1/partners/{id}/application':partnerRecord,
 'POST /api/v1/partners/{id}/commands':partnerRecord.extend({readiness:z.array(gate)}),
 'POST /api/v1/partners/{id}/documents':documentRecord,
 'POST /api/v1/documents/{id}/review':documentRecord,
 'GET /api/v1/partners/{id}/agreements':z.object({items:z.array(agreementResponse),latestVersion:integer.nonnegative(),brands:z.array(text),now:date}).strict(),
 'POST /api/v1/partners/{id}/agreements':agreementResponse,
 'POST /api/v1/agreements/{id}/approve':agreementResponse,
 'POST /api/v1/agreements/{id}/reject':agreementResponse,
 'POST /api/v1/partners/{id}/agreements/preview':z.object({currency:text,basis:money,customerNet:money,current:calculation.extend({id:text,version:integer.positive()}).nullable(),proposed:calculation,returnHandling:money,note:text}).strict(),
 'GET /api/v1/partners/{id}/brand-rights':z.object({now:date,items:z.array(brandRight.extend({effectiveState:text})),products:z.array(z.object({id:text,sku:text,brand:text,category:text,market:text,status:text,authorized:z.boolean()}).strict())}).strict(),
 'POST /api/v1/partners/{id}/brand-rights':brandRight,
 'POST /api/v1/brand-rights/{id}/commands':brandRight,
 'GET /api/v1/storage/health':z.union([z.object({status:z.literal('up'),mode:text,scanner:text}).strict(),z.object({status:z.literal('down'),mode:text}).strict()]),
 'GET /api/v1/locations':z.object({items:z.array(location)}).strict(),
 'POST /api/v1/locations':location,
 'POST /api/v1/locations/{id}':location,
 'GET /api/v1/catalog/items/{id}/storefront':z.union([visibilityBase.extend({passed:z.literal(true),content:storefrontContent}),visibilityBase.extend({passed:z.literal(false),content:z.null()})]),
};
export function responseContractKey(method:string,path:string){return `${method.toUpperCase()} ${path.replace(/:([A-Za-z0-9_]+)/g,'{$1}')}`;}
import {notificationResponseSchemas} from './notification-responses';
