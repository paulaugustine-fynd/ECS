import type {OpenAPIV3_1} from 'openapi-types';
import {z, type ZodTypeAny} from 'zod';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {eventEnvelope,legacyWebhook} from '../../../packages/events/envelope';
import {sfccOrderEventV1,sfccInvoiceEventV1} from '../../../packages/events/contracts';
import {partnerCommand} from '../../../packages/domain/partners';
import {catalogCommand,catalogEdit} from '../../../packages/domain/catalog';
import {salesControlInput} from '../../../packages/domain/product-sales';
import {uploadMediaInput,mediaDecisionInput,replaceMediaInput} from '../../../packages/domain/catalog-media';
import {zipMediaInput} from '../../../packages/domain/catalog-media-zip';
import {urlMediaInput} from '../../../packages/domain/catalog-media-url';
import {mediaJobInput,mediaJobReplay,urlMediaJobInput,zipMediaJobInput} from '../../../packages/domain/media-source-jobs';
import {stockUpdate} from '../../../packages/domain/inventory';
import {legCommand,orderInput} from '../../../packages/domain/orders';
import {returnInput,returnCommand} from '../../../packages/domain/returns';
import {exchangePreviewInput,exchangeRequestInput,exchangeCancelInput,exchangeReviewInput} from '../../../packages/domain/exchanges';
import {exchangeCheckoutInput} from '../../../packages/domain/exchange-checkout';
import {exchangeCancellationInput} from '../../../packages/domain/exchange-cancellation';
import {returnEvidenceInput} from '../../../packages/domain/return-evidence';
import {invoiceInput,demoInvoiceInput} from '../../../packages/domain/invoices';
import {statementCreate,statementCommand,adjustmentInput} from '../../../packages/domain/finance';
import {applicationInput,documentInput,invitationInput,acceptInput} from '../../../packages/domain/onboarding';
import {agreementDraft,agreementApproval,previewInput} from '../../../packages/domain/commercials';
import {brandRightInput,brandRightCommand} from '../../../packages/domain/brand-rights';
import {locationCreate,locationEdit} from '../../../packages/domain/locations';
import {launchTestInput} from '../../../packages/domain/launch-tests';
import {importRequest,importRowEdit,importDecision,importSubmit} from '../../../packages/domain/catalog-import';
import {pagination,loginInput,documentReviewInput,documentDownloadQuery,demoOrderInput,inboxReplayInput,jobReplayInput,clockInput,faultInput,webhookInput} from './request-schemas';
import {domainResponseSchemas} from '../../../packages/contracts/partner-responses';
import {slaQuery,slaWaiver,slaPolicyQuery,slaPolicyInput,slaQueueQuery} from '../../../packages/domain/sla';
import {notificationQuery,notificationRead} from '../../../packages/domain/notifications';
import {notificationPolicyQuery,notificationPolicyInput} from '../../../packages/domain/notification-policy';
import {exceptionQuery,exceptionCommand} from '../../../packages/domain/exceptions';
import {shipmentIssueInput} from '../../../packages/domain/shipment-issues';
import {analyticsMarket,analyticsQuery} from '../../../packages/domain/analytics';
import {reconciliationQuery,reconciliationEntity,reconciliationScan,reconciliationResolve,reconciliationRepair} from '../../../packages/domain/reconciliation';

type Operation=OpenAPIV3_1.OperationObject & {'x-ecs-response-contract'?:string;'x-ecs-request-contract'?:string};
type Response=OpenAPIV3_1.ResponseObject;
const json=(schema:ZodTypeAny):OpenAPIV3_1.SchemaObject=>{
 const converted=zodToJsonSchema(schema,{$refStrategy:'none',effectStrategy:'input',removeAdditionalStrategy:'strict'});
 // OAS 3.1 provides the dialect. No external dialect/definition fetch is needed.
 const {$schema:discard,...result}=converted;void discard;
 return result as OpenAPIV3_1.SchemaObject;
};
const response=(schema:ZodTypeAny,description='Success'):Response=>({description,content:{'application/json':{schema:json(schema)}}});
const user=z.object({id:z.string(),name:z.string(),email:z.string().email(),role:z.string(),companyId:z.string(),partnerId:z.string().nullable(),markets:z.array(z.string()),locale:z.string()}).strict();
const error=z.object({error:z.object({code:z.string(),message:z.string(),correlationId:z.string()}).strict()}).strict();
const errorResponse=response(error,'Rejected request; code and correlationId identify the failure.');
const bodyContracts:Record<string,ZodTypeAny|null>={
 '/returns/{id}/exchange-preview':exchangePreviewInput,
 '/returns/{id}/exchanges':exchangeRequestInput,
 '/exchanges/{id}/cancel':exchangeCancelInput,
 '/exchanges/{id}/review':exchangeReviewInput,
 '/exchanges/{id}/checkout':exchangeCheckoutInput,
 '/exchanges/{id}/checkout/cancel':exchangeCancellationInput,
 '/returns/{id}/evidence':returnEvidenceInput,
 '/catalog/items/{id}/media':uploadMediaInput,
 '/catalog/items/{id}/media/replace':replaceMediaInput,
 '/catalog/items/{id}/media/jobs':mediaJobInput,
 '/catalog/items/{id}/media/url/jobs':urlMediaJobInput,
 '/catalog/media/jobs/{id}/replay':mediaJobReplay,
 '/catalog/items/{id}/media/url':urlMediaInput,
 '/catalog/items/{id}/media/zip':zipMediaInput,
 '/catalog/items/{id}/media/zip/jobs':zipMediaJobInput,
 '/catalog/items/{id}/media/commands':mediaDecisionInput,
 '/catalog/items/{id}/sales-control':salesControlInput,
 '/reconciliation/scan':reconciliationScan,
 '/reconciliation/shipments/{id}/repair-ledger':reconciliationRepair,
 '/reconciliation/issues/{id}/resolve':reconciliationResolve,
 '/slas/{id}/waive':slaWaiver,
 '/slas/policies':slaPolicyInput,
 '/notifications/{id}/read':notificationRead,
 '/notification-policies':notificationPolicyInput,
 '/exceptions/{id}/commands':exceptionCommand,
 '/shipments/{id}/issues':shipmentIssueInput,
 '/demo/invoices':demoInvoiceInput,
 '/auth/login':loginInput,'/auth/logout':null,'/partners/invite':invitationInput,
 '/partners/{id}/brand-rights':brandRightInput,'/brand-rights/{id}/commands':brandRightCommand,
 '/partners/{id}/agreements':agreementDraft,'/partners/{id}/agreements/preview':previewInput,
 '/agreements/{id}/approve':agreementApproval,'/agreements/{id}/reject':agreementApproval,
 '/invitations/accept':acceptInput,'/partners/{id}/application':applicationInput,
 '/partners/{id}/documents':documentInput,'/documents/{id}/download-link':null,
 '/partners/{id}/commands':partnerCommand,'/partners/{id}/launch-tests':launchTestInput,
 '/documents/{id}/review':documentReviewInput,'/catalog/imports':importRequest,'/catalog/imports/preview':importRequest,
 '/catalog/imports/{id}/rows':importRowEdit,'/catalog/imports/{id}/duplicate-decision':importDecision,
 '/catalog/imports/{id}/submit':importSubmit,'/catalog/items/{id}/draft':catalogEdit,
 '/catalog/items/{id}/commands':catalogCommand,'/locations':locationCreate,'/locations/{id}':locationEdit,
 '/inventory/{id}/adjust':stockUpdate,'/shipments/{id}/commands':legCommand,
 '/demo/orders':demoOrderInput,'/returns':returnInput,'/returns/{id}/commands':returnCommand,
 '/finance/adjustments':adjustmentInput,'/settlements':statementCreate,'/settlements/{id}/commands':statementCommand,
 '/integrations/inbox/{id}/replay':inboxReplayInput,'/integrations/jobs/{id}/replay':jobReplayInput,
 '/demo/clock':clockInput,'/demo/faults':faultInput,'/webhooks/{source}':webhookInput,
};
const listPaths=new Set(['/partners','/catalog/items','/inventory','/orders','/shipments','/returns','/finance/events','/settlements','/integrations/inbox','/integrations/jobs','/audit']);
const getPaths=new Set([...listPaths,'/auth/me','/partners/{id}','/partners/{id}/brand-rights','/partners/{id}/agreements','/storage/health','/documents/{id}/download','/partners/{id}/launch-tests','/catalog/imports/metadata','/catalog/imports/template','/catalog/imports/{id}/errors.csv','/catalog/imports','/catalog/imports/{id}','/catalog/items/{id}/storefront','/catalog/items/{id}','/locations','/shipments/{id}','/shipments/{id}/packing-slip','/returns/{id}','/settlements/{id}','/settlements/{id}/export','/demo/clock']);
getPaths.add('/shipments/{id}/invoices');
getPaths.add('/slas');
getPaths.add('/slas/queue');getPaths.add('/slas/policies');
getPaths.add('/notifications');
getPaths.add('/notification-policies');
getPaths.add('/exceptions');getPaths.add('/exceptions/{id}');
getPaths.add('/shipments/{id}/issues');
for(const path of ['/analytics/metadata','/analytics/performance','/analytics/export'])getPaths.add(path);
getPaths.add('/reconciliation');getPaths.add('/reconciliation/evidence');
getPaths.add('/catalog/items/{id}/sales-control');
getPaths.add('/catalog/items/{id}/media');
getPaths.add('/catalog/items/{id}/media/jobs');
getPaths.add('/catalog/media/{id}/content');
getPaths.add('/returns/{id}/evidence');getPaths.add('/returns/evidence/{id}/content');
getPaths.add('/returns/{id}/exchange-options');
getPaths.add('/returns/{id}/exchanges');
getPaths.add('/exchanges/{id}/checkout');
const typedResponses:Record<string,Response>={
 ...Object.fromEntries(Object.entries(domainResponseSchemas).map(([key,schema])=>[key.toLowerCase().replace('/api/v1',''),response(schema)])),
 'post /auth/login':response(z.object({user,csrfToken:z.string()}).strict()),
 'get /auth/me':response(z.object({user,csrfToken:z.string()}).strict()),
 'post /auth/logout':response(z.object({ok:z.literal(true)}).strict()),
 'post /documents/{id}/download-link':response(z.object({url:z.string(),expiresAt:z.string().datetime(),scan:z.string()}).strict()),
 'get /demo/clock':response(z.object({id:z.literal('main'),now:z.string().datetime()}).strict()),
 'post /demo/clock':response(z.object({id:z.literal('main'),now:z.string().datetime()}).strict()),
 'post /demo/faults':response(z.object({system:z.string(),remaining:z.number().int(),statusCode:z.number().int()}).strict()),
 'post /webhooks/{source}':response(z.union([z.object({receiptId:z.string(),duplicate:z.literal(true)}).strict(),z.object({receiptId:z.string(),status:z.literal('PENDING')}).strict()]),'Accepted into the durable inbox, not proof of business processing.'),
};
const downloads:Record<string,string[]>={
 '/returns/evidence/{id}/content':['image/png'],
 '/catalog/media/{id}/content':['image/png'],
 '/analytics/export':['text/csv'],
 '/documents/{id}/download':['application/pdf','image/png','image/jpeg','text/plain'],
 '/catalog/imports/template':['text/csv'],'/catalog/imports/{id}/errors.csv':['text/csv'],
 '/shipments/{id}/packing-slip':['text/html'],'/settlements/{id}/export':['text/csv'],
};
function queryParameters(schema:ZodTypeAny):OpenAPIV3_1.ParameterObject[]{
 const object=json(schema);
 return Object.entries(object.properties??{}).map(([name,field])=>({name,in:'query',required:object.required?.includes(name)??false,schema:field as OpenAPIV3_1.ParameterObject['schema']}));
}

/** Documentation-only transform: do not mutate signed bodies or response serialization. */
export function documentOpenApi(input:OpenAPIV3_1.Document):OpenAPIV3_1.Document{
 const document=structuredClone(input);
 document.info.description='Local ATI ECS implementation; all business integrations are mocks. Cookie sessions + CSRF, not the source skeleton’s bearer authentication. Request schemas are shared with handlers; state/ownership/refinement rules also run in the domain. Incomplete success schemas are explicitly marked pending.';
 document.components??={};document.components.schemas??={};
 document.components.schemas.Error=json(error);
 document.components.schemas.SfccOrderCreatedData=json(orderInput);
 document.components.schemas.SfccInvoiceUpdatedData=json(invoiceInput);
 document.components.schemas.EcsEventEnvelopeV1=json(eventEnvelope);
 document.components.schemas.LegacyDemoWebhook=json(legacyWebhook);
 document.components.schemas.SfccOrderCreatedV1=json(sfccOrderEventV1);
 document.components.schemas.SfccInvoiceUpdatedV1=json(sfccInvoiceEventV1);
 document.components.securitySchemes={session:{type:'apiKey',in:'cookie',name:'ecs_session'},csrf:{type:'apiKey',in:'header',name:'x-csrf-token',description:'Use the csrfToken returned by login/me together with its session cookie.'},webhookSignature:{type:'apiKey',in:'header',name:'x-webhook-signature',description:'SHA-256 HMAC of timestamp + dot + exact raw JSON body. Not a bearer token.'}};
 for(const [path,item] of Object.entries(document.paths??{})){
  if(!item)continue;
  for(const method of ['get','post','put','patch','delete'] as const){
   const operation=item[method] as Operation|undefined;if(!operation)continue;
   const local=path.replace(/^\/api\/v1/,'');
   if(path!='/health'&&!path.startsWith('/api/v1/'))continue;
   const known=path==='/health'||method==='get'&&getPaths.has(local)||method==='post'&&Object.hasOwn(bodyContracts,local);
   operation.operationId=`${method}_${local.replace(/[^a-zA-Z0-9]+/g,'_').replace(/^_|_$/g,'')}`;
   operation.tags=[path==='/health'?'health':local.split('/')[1]];
   operation['x-ecs-request-contract']=known?'documented':'pending';
   operation.summary??=`${method.toUpperCase()} ${local}`;
   const publicEndpoint=path==='/health'||['/auth/login','/invitations/accept','/webhooks/{source}'].includes(local);
   operation.security=publicEndpoint?[]:method==='get'?[{session:[]}]:[{session:[],csrf:[]}];
   operation.parameters=[...path.matchAll(/\{([^}]+)\}/g)].map(([,name])=>({name,in:'path',required:true,schema:{type:'string',minLength:1,...(name==='source'?{enum:['FYND','SFCC','ERP','WMS','FINANCE','LOGISTICS']}:{})}}));
   if(method==='get'&&listPaths.has(local))operation.parameters.push(...queryParameters(pagination));
   if(method==='get'&&local==='/slas')operation.parameters.push(...queryParameters(slaQuery));
   if(method==='get'&&local==='/slas/queue')operation.parameters.push(...queryParameters(slaQueueQuery));
   if(method==='get'&&local==='/slas/policies')operation.parameters.push(...queryParameters(slaPolicyQuery));
   if(method==='get'&&local==='/notifications')operation.parameters.push(...queryParameters(notificationQuery));
   if(method==='get'&&local==='/notification-policies')operation.parameters.push(...queryParameters(notificationPolicyQuery));
   if(method==='get'&&local==='/exceptions')operation.parameters.push(...queryParameters(exceptionQuery));
   if(method==='get'&&local==='/analytics/metadata')operation.parameters.push(...queryParameters(analyticsMarket));
   if(method==='get'&&local==='/reconciliation')operation.parameters.push(...queryParameters(reconciliationQuery));
   if(method==='get'&&local==='/reconciliation/evidence')operation.parameters.push(...queryParameters(reconciliationEntity));
   if(method==='get'&&['/analytics/performance','/analytics/export'].includes(local))operation.parameters.push(...queryParameters(analyticsQuery));
   if(method==='get'&&local==='/documents/{id}/download')operation.parameters.push(...queryParameters(documentDownloadQuery));
   const body=method==='post'?bodyContracts[local]:undefined;
   if(body)operation.requestBody={required:true,description:'Input shape; business validation, cross-field rules, permissions and current-revision checks may additionally reject the request.',content:{'application/json':{schema:json(body)}}};
   if(body===null)delete operation.requestBody;
   if(local==='/webhooks/{source}'){
    operation.security=[{webhookSignature:[]}];
    operation.parameters.push({name:'x-webhook-timestamp',in:'header',required:true,schema:{type:'string',pattern:'^[0-9]+$'},description:'Unix seconds; must be within the server replay window.'});
    operation.description='Sign the exact raw body. Accepts ECS v1 or the legacy demo envelope. The local credential remains bound to cmp_ati_uae / AE; v1 producer must equal the source path and a supplied idempotencyKey must equal eventId. Only v1 is supported; market is required. SFCC order.created and invoice.updated have asynchronous business handlers and subject/data identity checks; unsupported events enter DLQ, never false success. See EcsEventEnvelopeV1, LegacyDemoWebhook, SfccOrderCreatedV1 and SfccInvoiceUpdatedV1. Original raw/signature evidence is private. x-event-correlation-id identifies the retained event chain; x-correlation-id identifies this HTTP attempt. Native Fynd webhook compatibility is not established.';
   }
   if(listPaths.has(local))operation.description='Pagination defaults: page 1, limit 25 (maximum 100). q is only applied by partners/catalogue; partner listing does not apply market. Other list routes apply market scoping. Authorization and partner isolation are enforced server-side.';
   const codes=['400','401','403','404','409','413','415','422','429','500'];
   operation.responses=Object.fromEntries(codes.map(code=>[code,structuredClone(errorResponse)]));
   const typed=typedResponses[`${method} ${local}`];
   const status=local==='/webhooks/{source}'?'202':'200';
   operation['x-ecs-response-contract']=typed?'documented':'pending';
   operation.responses[status]=typed??{description:'Success. Full success payload schema is pending; do not infer a stable DTO from this placeholder.'};
   if(local==='/webhooks/{source}')(operation.responses[status] as Response).headers={'x-event-correlation-id':{schema:{type:'string'},description:'Original event correlation, stable across retries. Legacy events receive a generated correlation on first acceptance.'}};
   if(method==='get'&&downloads[local]){
    operation.responses['200']={description:'Scoped downloadable evidence.',headers:{'Content-Disposition':{schema:{type:'string'},description:'Attachment filename.'}},content:Object.fromEntries(downloads[local].map(type=>[type,{schema:{type:'string',...(type==='text/csv'||type==='text/html'||type==='text/plain'?{}:{format:'binary'})}}]))};
    operation['x-ecs-response-contract']='documented';
   }
   if(path==='/health'){
    operation.responses={'200':response(z.object({status:z.literal('ok'),database:z.literal('up'),mode:z.literal('demo'),integrations:z.literal('mock-unless-explicitly-configured')}).strict()),'503':response(z.object({status:z.literal('unavailable'),database:z.literal('down')}).strict(),'Database unavailable'),'429':structuredClone(errorResponse)};
    operation['x-ecs-response-contract']='documented';
   }
   for(const r of Object.values(operation.responses))if(!('$ref' in r))r.headers={...r.headers,'x-correlation-id':{schema:{type:'string'},description:'Request correlation identifier.'}};
  }
 }
 return document;
}

export function contractCoverage(document:OpenAPIV3_1.Document){
 const operations=Object.entries(document.paths??{}).flatMap(([path,item])=>['get','post','put','patch','delete'].flatMap(method=>{
  const op=item?.[method as OpenAPIV3_1.HttpMethods] as Operation|undefined;
  return op&&(path==='/health'||path.startsWith('/api/v1/'))?[{key:`${method.toUpperCase()} ${path}`,op}]:[];
 }));
 return {operations:operations.length,missingRequests:operations.filter(({op})=>op['x-ecs-request-contract']!=='documented').map(({key})=>key),missingResponses:operations.filter(({op})=>op['x-ecs-response-contract']!=='documented').map(({key})=>key)};
}
