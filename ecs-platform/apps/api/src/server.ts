import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { randomUUID } from 'node:crypto';
import {startSimulation,getSimulation,listSimulations,commandSimulation} from '../../../packages/domain/simulations';
import {simStart,simCommand} from '../../../packages/simulation/engine';
import {createCoach,readCoach,listCoach,updateCoach} from '../../../packages/domain/coach-journey';
import {coachStart,coachCommand} from '../../../packages/simulation/coach-engine';
import {normalizeWebhook,inboxPublicSelect} from '../../../packages/events/envelope';
import {demoWebhook} from '../../../packages/events/demo';
import { z, ZodError } from 'zod';
import { Prisma, type User } from '@prisma/client';
import { db } from '../../../packages/db/client';
import { audit, transaction } from '../../../packages/db/transaction';
import { readEnv, systems } from '../../../packages/config/env';
import { digest, token, verifyPassword, verifyWebhook, signWebhook } from '../../../packages/auth/security';
import { partnerScope, permit, scope, isVendor } from '../../../packages/auth/policy';
import { DomainError, requireCondition } from '../../../packages/domain/errors';
import { commandPartner, partnerCommand, readiness,startLaunchTest } from '../../../packages/domain/partners';
import {previewStorefront} from '../../../packages/domain/storefront';
import {launchTestInput,listLaunchTests} from '../../../packages/domain/launch-tests';
import {listLocations,createLocation,editLocation,locationCreate,locationEdit} from '../../../packages/domain/locations';
import {mappingReadiness} from '../../../packages/domain/mappings';
import { sellable } from '../../../packages/domain/calculations';
import { catalogCommand, catalogEdit, catalogIssues, commandCatalog, editCatalog } from '../../../packages/domain/catalog';
import {salesControlInput,readSalesControl,commandSalesControl} from '../../../packages/domain/product-sales';
import { stockUpdate, updateStock } from '../../../packages/domain/inventory';
import { commandLeg, legCommand, type ReservedLine } from '../../../packages/domain/orders';
import { demoOrder } from '../../../seed/demo-order';
import {demoInvoiceInput,listShipmentInvoices} from '../../../packages/domain/invoices';
import {listSlas,slaQuery,slaWaiver,waiveSla,reconcileSlas,slaQueue,slaQueueQuery,listSlaPolicies,slaPolicyQuery,saveSlaPolicy,slaPolicyInput} from '../../../packages/domain/sla';
import {listNotifications,notificationQuery,markNotification,notificationRead} from '../../../packages/domain/notifications';
import {listNotificationPolicies,saveNotificationPolicy,notificationPolicyQuery,notificationPolicyInput} from '../../../packages/domain/notification-policy';
import {exceptionQuery,exceptionCommand,listExceptions,getException,commandException} from '../../../packages/domain/exceptions';
import {transitionException} from '../../../packages/domain/exception-lifecycle';
import {shipmentIssueInput,reportShipmentIssue,listShipmentIssues} from '../../../packages/domain/shipment-issues';
import {analyticsMarket,analyticsQuery,analyticsMetadata,performanceReport,performanceCsv} from '../../../packages/domain/analytics';
import {reconciliationQuery,reconciliationEntity,reconciliationScan,reconciliationResolve,reconciliationRepair,repairDeliveryLedger,reconciliationList,reconciliationDetail,scanReconciliation,resolveReconciliation} from '../../../packages/domain/reconciliation';
import { returnInput, requestReturn, returnCommand, commandReturn } from '../../../packages/domain/returns';
import {exchangePreviewInput,previewExchange,exchangeOptions,exchangeRequestInput,exchangeCancelInput,exchangeReviewInput,requestExchange,cancelExchange,reviewExchange,listExchanges} from '../../../packages/domain/exchanges';
import {exchangeCheckoutInput,startExchangeCheckout,getExchangeExecution} from '../../../packages/domain/exchange-checkout';
import {exchangeCancellationInput,cancelExchangeCheckout} from '../../../packages/domain/exchange-cancellation';
import {returnEvidenceInput,listReturnEvidence,readReturnEvidence,uploadReturnEvidence} from '../../../packages/domain/return-evidence';
import { financeRead, statementCreate, createStatement, statementCommand, commandStatement, adjustmentInput, adjustment } from '../../../packages/domain/finance';
import { applicationInput,saveApplication,documentInput,uploadDocument,permitDocumentRead,invitationInput,invitePartner,acceptInput,acceptInvitation } from '../../../packages/domain/onboarding';
import { getDocument,documentSignature,verifyDocumentSignature,checksum,storageHealth } from '../../../packages/storage/documents';
import {agreementDraft,agreementApproval,previewInput,listAgreements,createAgreement,approveAgreement,rejectAgreement,previewAgreement} from '../../../packages/domain/commercials';
import {brandRightInput,brandRightCommand,listBrandRights,createBrandRight,commandBrandRight} from '../../../packages/domain/brand-rights';
import {stockEligible} from '../../../packages/domain/inventory';
import {importFields,importReportCsv,importRequest,importRowEdit,importDecision,importSubmit,importMetadata,stageImport,previewImport,listImports,readImport,editImportRow,allowImportDuplicate,submitImport} from '../../../packages/domain/catalog-import';
import {documentOpenApi} from './openapi';
import {partnerSummary,partnerDetail} from '../../../packages/domain/partner-view';
import {domainResponseSchemas,responseContractKey} from '../../../packages/contracts/partner-responses';
import type {OpenAPIV3_1} from 'openapi-types';
import {pagination,loginInput,documentReviewInput,documentDownloadQuery,demoOrderInput,inboxReplayInput,jobReplayInput,clockInput,faultInput,webhookInput} from './request-schemas';
import {uploadMediaInput,uploadProductMedia,listProductMedia,readMediaContent,mediaDecisionInput,decideProductMedia,replaceMediaInput,replaceProductMedia} from '../../../packages/domain/catalog-media';
import {zipMediaInput,importMediaZip} from '../../../packages/domain/catalog-media-zip';
import {urlMediaInput,importMediaUrl} from '../../../packages/domain/catalog-media-url';
import {mediaJobInput,mediaJobReplay,listMediaJobs,queueMediaJob,replayMediaJob,urlMediaJobInput,queueUrlMediaJob,zipMediaJobInput,queueZipMediaJob} from '../../../packages/domain/media-source-jobs';

declare module 'fastify' { interface FastifyRequest {actor: User; csrf: string; rawBody: string;} }
const idSchema = {type:'object',required:['id'],properties:{id:{type:'string',minLength:1}}};
const publicUser = (u: User) => ({id:u.id,name:u.name,email:u.email,role:u.role,companyId:u.companyId,partnerId:u.partnerId,markets:u.markets,locale:u.locale});

export async function createServer(options:{verifyResponseContracts?:boolean}={}) {
  const env = readEnv();
  const origins=[env.WEB_ORIGIN,...(process.env.ECS_HOSTED_DEMO_PROJECT&&process.env.VERCEL_URL?[`https://${process.env.VERCEL_URL}`]:[])];
  const app = Fastify({logger:{serializers:{req(req){return {method:req.method,url:req.url?.split('?')[0],hostname:req.hostname,remoteAddress:req.ip};}},level:env.NODE_ENV === 'test'?'silent':'info',redact:['req.headers.cookie','req.headers.authorization','req.headers.x-csrf-token','req.headers.x-mock-secret','body.password','body.token','body.base64']},bodyLimit:1024*1024,genReqId:()=>randomUUID()});
  await app.register(cookie);
  await app.register(cors,{origin:origins,credentials:true});
  await app.register(rateLimit,{max:200,timeWindow:60000,keyGenerator:async req=>{
    // The web proxy shares an IP across partners. Only a currently valid server
    // session earns a user bucket; arbitrary cookies/forwarded headers do not.
    // Public credential endpoints always retain their stricter IP protection.
    if(!['/api/v1/auth/login','/api/v1/invitations/accept'].includes(req.routeOptions.url??'')&&req.cookies.ecs_session){
      const session=await db.session.findUnique({where:{tokenHash:digest(req.cookies.ecs_session)},select:{expiresAt:true,user:{select:{id:true,active:true}}}});
      if(session&&session.expiresAt>new Date()&&session.user.active)return `user:${session.user.id}`;
    }
    return `ip:${req.ip}`;
  }});
  await app.register(swagger,{openapi:{openapi:'3.1.0',info:{title:'ATI ECS demo API',version:'0.1.0'},components:{securitySchemes:{session:{type:'apiKey',in:'cookie',name:'ecs_session'}}}},transformObject:document=>'openapiObject' in document?documentOpenApi(document.openapiObject as OpenAPIV3_1.Document):document.swaggerObject});
  await app.register(swaggerUi,{routePrefix:'/docs'});
  if(options.verifyResponseContracts){
    if(env.NODE_ENV!=='test')throw new Error('Response conformance verification is enabled only in the isolated test runtime.');
    app.addHook('onSend',async(req,reply,payload)=>{
      const schema=domainResponseSchemas[responseContractKey(req.method,req.routeOptions.url??'')];
      if(schema&&reply.statusCode>=200&&reply.statusCode<300){
        const result=schema.safeParse(typeof payload==='string'?JSON.parse(payload):null);
        if(!result.success)throw new DomainError('RESPONSE_CONTRACT_MISMATCH',`Response schema mismatch at ${result.error.issues.map(i=>i.path.join('.')).join(', ')}`,500);
      }
      return payload;
    });
  }
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json',{parseAs:'string'},(req,body,done) => {
    req.rawBody = body as string;
    try {done(null,JSON.parse(body as string));} catch {done(new DomainError('INVALID_JSON','Malformed JSON',400),undefined);}
  });
  app.addHook('onRequest',async (req,reply) => {
    reply.header('x-correlation-id',req.id).header('x-content-type-options','nosniff').header('cache-control','no-store').header('x-frame-options','DENY');
    if (['POST','PUT','PATCH','DELETE'].includes(req.method) && req.headers.origin && !origins.includes(req.headers.origin)) throw new DomainError('ORIGIN_FORBIDDEN','Origin is not allowed',403);
  });
  app.setErrorHandler((error,req,reply) => {
    const detail = error as Error & {validation?:unknown;statusCode?:number};
    const status = error instanceof DomainError ? error.statusCode : error instanceof ZodError || detail.validation ? 400 : detail.statusCode && detail.statusCode < 500 ? detail.statusCode : 500;
    if (status === 500) req.log.error({err:error},'Request failed');
    reply.code(status).send({error:{code:error instanceof DomainError ? error.code : status===400?'VALIDATION_ERROR':'REQUEST_FAILED',message:status===500?'Internal error; reference the correlation ID':detail.message,correlationId:req.id}});
  });
  async function authenticated(req: FastifyRequest) {
    const raw = req.cookies.ecs_session;
    requireCondition(raw,'UNAUTHENTICATED','Sign in to continue',401);
    const session = await db.session.findUnique({where:{tokenHash:digest(raw)},include:{user:true}});
    requireCondition(session && session.expiresAt > new Date() && session.user.active,'UNAUTHENTICATED','Session expired',401);
    req.actor=session.user;req.csrf=session.csrfToken;
    if (!['GET','HEAD'].includes(req.method)) requireCondition(req.headers['x-csrf-token'] === req.csrf,'CSRF_FAILED','Invalid CSRF token',403);
  }
  const protectedRoute = {preHandler:authenticated,schema:{security:[{session:[]}]}};
  app.get('/api/v1/simulations',protectedRoute,async req=>listSimulations(req.actor));
  app.get('/api/v1/coach-journeys',protectedRoute,async req=>listCoach(req.actor));
  app.post('/api/v1/coach-journeys',protectedRoute,async req=>createCoach(req.actor,coachStart.parse(req.body),req.id));
  app.get('/api/v1/coach-journeys/:id',protectedRoute,async req=>readCoach(req.actor,z.object({id:z.string().uuid()}).parse(req.params).id));
  app.post('/api/v1/coach-journeys/:id/commands',protectedRoute,async req=>updateCoach(req.actor,z.object({id:z.string().uuid()}).parse(req.params).id,coachCommand.parse(req.body),req.id));
  app.post('/api/v1/simulations',protectedRoute,async req=>startSimulation(req.actor,simStart.parse(req.body),req.id));
  app.get('/api/v1/simulations/:id',protectedRoute,async req=>getSimulation(req.actor,z.object({id:z.string().uuid()}).parse(req.params).id));
  app.post('/api/v1/simulations/:id/commands',protectedRoute,async req=>commandSimulation(req.actor,z.object({id:z.string().uuid()}).parse(req.params).id,simCommand.parse(req.body),req.id));
  app.get('/api/v1/reconciliation',protectedRoute,async req=>reconciliationList(req.actor,reconciliationQuery.parse(req.query)));
  app.post('/api/v1/reconciliation/shipments/:id/repair-ledger',protectedRoute,async req=>repairDeliveryLedger(req.actor,z.object({id:z.string()}).parse(req.params).id,reconciliationRepair.parse(req.body),req.id));
  app.get('/api/v1/reconciliation/evidence',protectedRoute,async req=>reconciliationDetail(req.actor,reconciliationEntity.parse(req.query)));
  app.post('/api/v1/reconciliation/scan',protectedRoute,async req=>scanReconciliation(req.actor,reconciliationScan.parse(req.body),req.id));
  app.post('/api/v1/reconciliation/issues/:id/resolve',protectedRoute,async req=>resolveReconciliation(req.actor,z.object({id:z.string()}).parse(req.params).id,reconciliationResolve.parse(req.body),req.id));
  app.get('/api/v1/analytics/metadata',protectedRoute,async req=>analyticsMetadata(req.actor,analyticsMarket.parse(req.query).market));
  app.get('/api/v1/analytics/performance',protectedRoute,async req=>performanceReport(req.actor,analyticsQuery.parse(req.query)));
  app.get('/api/v1/analytics/export',protectedRoute,async(req,reply)=>{
    const report=await performanceReport(req.actor,analyticsQuery.parse(req.query));
    return reply.type('text/csv; charset=utf-8').header('content-disposition',`attachment; filename="ecs-performance-${report.filters.market}-${report.filters.from}.csv"`).send(performanceCsv(report));
  });

  app.get('/health',async (_req,reply) => {
    try {await db.$queryRaw`SELECT 1`;return {status:'ok',database:'up',mode:'demo',integrations:'mock-unless-explicitly-configured'};}
    catch {return reply.code(503).send({status:'unavailable',database:'down'});}
  });
  app.post('/api/v1/auth/login',{config:{rateLimit:{max:15,timeWindow:60000}},schema:{body:{type:'object',additionalProperties:false,required:['email','password'],properties:{email:{type:'string',format:'email'},password:{type:'string',minLength:1,maxLength:256}}}}},async (req,reply) => {
    const input = loginInput.parse(req.body);
    const user = await db.user.findUnique({where:{email:input.email.toLowerCase()}});
    // A fixed dummy hash keeps unknown-user attempts on the same scrypt path.
    const valid = verifyPassword(input.password,user?.passwordHash ?? `${'0'.repeat(32)}:${'0'.repeat(128)}`);
    requireCondition(user && user.active && valid,'INVALID_LOGIN','Email or password is incorrect',401);
    const sessionToken=token(),csrfToken=token();
    await db.session.create({data:{tokenHash:digest(sessionToken),userId:user.id,csrfToken,expiresAt:new Date(Date.now()+8*3600*1000)}});
    reply.setCookie('ecs_session',sessionToken,{httpOnly:true,sameSite:'strict',secure:env.NODE_ENV==='production',path:'/',maxAge:8*3600});
    return {user:publicUser(user),csrfToken};
  });
  app.get('/api/v1/auth/me',protectedRoute,async req=>({user:publicUser(req.actor),csrfToken:req.csrf}));
  app.post('/api/v1/auth/logout',protectedRoute,async (req,reply)=>{
    await db.session.deleteMany({where:{tokenHash:digest(req.cookies.ecs_session!)}});
    reply.clearCookie('ecs_session',{path:'/'});return {ok:true};
  });
  app.get('/api/v1/partners',protectedRoute,async req=>{
    const p=pagination.parse(req.query);const where={...partnerScope(req.actor),...(p.q?{displayName:{contains:p.q,mode:'insensitive' as const}}:{})};
    const [items,total]=await Promise.all([db.partner.findMany({where,skip:(p.page-1)*p.limit,take:p.limit,orderBy:{displayName:'asc'}}),db.partner.count({where})]);
    return {items:items.map(partnerSummary),total,page:p.page};
  });
  app.get('/api/v1/partners/:id',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>{
    const {id}=z.object({id:z.string()}).parse(req.params);
    const partner=await db.partner.findFirst({where:{AND:[partnerScope(req.actor),{id}]},include:{documents:{orderBy:{version:'desc'}},agreements:true}});
    requireCondition(partner,'NOT_FOUND','Partner not found',404);
    return {...partnerDetail(req.actor,partner),readiness:await readiness(db,id)};
  });
  app.post('/api/v1/partners/invite',protectedRoute,async req=>invitePartner(req.actor,invitationInput.parse(req.body),req.id));
  app.get('/api/v1/partners/:id/brand-rights',protectedRoute,async req=>listBrandRights(req.actor,z.object({id:z.string()}).parse(req.params).id));
  app.post('/api/v1/partners/:id/brand-rights',protectedRoute,async req=>createBrandRight(req.actor,z.object({id:z.string()}).parse(req.params).id,brandRightInput.parse(req.body),req.id));
  app.post('/api/v1/brand-rights/:id/commands',protectedRoute,async req=>commandBrandRight(req.actor,z.object({id:z.string()}).parse(req.params).id,brandRightCommand.parse(req.body),req.id));
  app.get('/api/v1/partners/:id/agreements',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>listAgreements(req.actor,z.object({id:z.string()}).parse(req.params).id));
  app.post('/api/v1/partners/:id/agreements',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>createAgreement(req.actor,z.object({id:z.string()}).parse(req.params).id,agreementDraft.parse(req.body),req.id));
  app.post('/api/v1/partners/:id/agreements/preview',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>previewAgreement(req.actor,z.object({id:z.string()}).parse(req.params).id,previewInput.parse(req.body)));
  app.post('/api/v1/agreements/:id/approve',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>approveAgreement(req.actor,z.object({id:z.string()}).parse(req.params).id,agreementApproval.parse(req.body).reason,req.id));
  app.post('/api/v1/agreements/:id/reject',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>rejectAgreement(req.actor,z.object({id:z.string()}).parse(req.params).id,agreementApproval.parse(req.body).reason,req.id));
  app.post('/api/v1/invitations/accept',{config:{rateLimit:{max:10,timeWindow:60000}}},async req=>acceptInvitation(acceptInput.parse(req.body),req.id));
  app.post('/api/v1/partners/:id/application',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>saveApplication(req.actor,z.object({id:z.string()}).parse(req.params).id,applicationInput.parse(req.body),req.id));
  app.post('/api/v1/partners/:id/documents',{...protectedRoute,bodyLimit:8*1024*1024,schema:{...protectedRoute.schema,params:idSchema}},async req=>uploadDocument(req.actor,z.object({id:z.string()}).parse(req.params).id,documentInput.parse(req.body),req.id));
  app.get('/api/v1/storage/health',protectedRoute,async req=>{permit(req.actor,'integrations',true);return storageHealth();});
  app.post('/api/v1/documents/:id/download-link',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>{
    const {id}=z.object({id:z.string()}).parse(req.params);const doc=await db.document.findFirst({where:{id,partner:partnerScope(req.actor)}});requireCondition(doc,'NOT_FOUND','Document not found',404);permitDocumentRead(req.actor,doc.type);
    requireCondition(['CLEAN','MOCK_CLEAN'].includes(doc.scanStatus)&&doc.byteSize>0,'DOCUMENT_UNAVAILABLE','This file is blocked or is metadata only',409);
    const expires=String(Date.now()+60000);return {url:`/api/v1/documents/${id}/download?expires=${expires}&signature=${documentSignature(req.actor.id,id,expires)}`,expiresAt:new Date(Number(expires)),scan:doc.scanStatus};
  });
  app.get('/api/v1/documents/:id/download',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async(req,reply)=>{
    const {id}=z.object({id:z.string()}).parse(req.params);const q=documentDownloadQuery.parse(req.query);verifyDocumentSignature(req.actor.id,id,q.expires,q.signature);
    const doc=await db.document.findFirst({where:{id,partner:partnerScope(req.actor)}});requireCondition(doc,'NOT_FOUND','Document not found',404);permitDocumentRead(req.actor,doc.type);requireCondition(['CLEAN','MOCK_CLEAN'].includes(doc.scanStatus)&&doc.byteSize>0,'DOCUMENT_UNAVAILABLE','Document is blocked or unavailable',409);
    const bytes=await getDocument(doc.objectKey,doc.storageMode);requireCondition(checksum(bytes)===doc.checksum,'INTEGRITY_FAILURE','Stored document checksum does not match',409);
    await transaction(tx=>audit(tx,req.actor,req.id,'document.download',id,null,{version:doc.version,checksum:doc.checksum},'Authenticated private evidence download',doc.partnerId));
    return reply.type(doc.contentType).header('content-disposition',`attachment; filename="evidence-${doc.type.toLowerCase()}-v${doc.version}.${({'application/pdf':'pdf','image/png':'png','image/jpeg':'jpg','text/plain':'txt'} as Record<string,string>)[doc.contentType]??'bin'}"`).header('content-security-policy',"default-src 'none'; sandbox").send(bytes);
  });
  app.post('/api/v1/partners/:id/commands',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>commandPartner(req.actor,z.object({id:z.string()}).parse(req.params).id,partnerCommand.parse(req.body),req.id));
  app.get('/api/v1/partners/:id/launch-tests',protectedRoute,async req=>listLaunchTests(req.actor,z.object({id:z.string()}).parse(req.params).id));
  app.post('/api/v1/partners/:id/launch-tests',protectedRoute,async req=>startLaunchTest(req.actor,z.object({id:z.string()}).parse(req.params).id,launchTestInput.parse(req.body),req.id));
  app.post('/api/v1/documents/:id/review',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>{
    permit(req.actor,'partners',true);
    const {id}=z.object({id:z.string()}).parse(req.params);
    const input=documentReviewInput.parse(req.body);
    return transaction(async tx=>{
      const doc=await tx.document.findFirst({where:{id,partner:partnerScope(req.actor)}});
      requireCondition(doc,'NOT_FOUND','Document not found',404);
      const latest=await tx.document.findFirst({where:{partnerId:doc.partnerId,type:doc.type},orderBy:{version:'desc'}});
      requireCondition(latest?.id===id,'SUPERSEDED_DOCUMENT','Only the current version can be reviewed',409);
      const now=(await tx.demoClock.findUniqueOrThrow({where:{id:'main'}})).now;
      requireCondition(input.status!=='APPROVED'||!doc.expiresAt||doc.expiresAt>=now,'DOCUMENT_EXPIRED','An expired document cannot be approved');
      requireCondition(input.status!=='APPROVED'||['CLEAN','MOCK_CLEAN'].includes(doc.scanStatus)&&doc.byteSize>0,'DOCUMENT_NOT_SCANNED','Stored scan-passed evidence is required before approval');
      const partner=await tx.partner.findUniqueOrThrow({where:{id:doc.partnerId}});requireCondition(['SUBMITTED','UNDER_REVIEW'].includes(partner.status),'REVIEW_NOT_OPEN','Documents can be reviewed after submission',409);
      const updated=await tx.document.update({where:{id},data:input});
      await audit(tx,req.actor,req.id,'document.review',id,doc,updated,input.reason,doc.partnerId);
      return updated;
    });
  });
  app.get('/api/v1/catalog/imports/metadata',protectedRoute,async req=>importMetadata(req.actor));
  app.get('/api/v1/catalog/imports/template',protectedRoute,async(req,reply)=>{permit(req.actor,'catalog');return reply.type('text/csv; charset=utf-8').header('content-disposition','attachment; filename="ecs-catalogue-template.csv"').send('\ufeff'+importFields.join(',')+'\r\n');});
  app.get('/api/v1/catalog/imports/:id/errors.csv',protectedRoute,async(req,reply)=>{const batch=await readImport(req.actor,z.object({id:z.string()}).parse(req.params).id);return reply.type('text/csv; charset=utf-8').header('content-disposition','attachment; filename="ecs-import-validation.csv"').send(importReportCsv(batch.rows));});
  app.get('/api/v1/catalog/imports',protectedRoute,async req=>({items:await listImports(req.actor)}));
  app.post('/api/v1/catalog/imports',protectedRoute,async req=>stageImport(req.actor,importRequest.parse(req.body),req.id));
  app.post('/api/v1/catalog/imports/preview',protectedRoute,async req=>previewImport(req.actor,importRequest.parse(req.body)));
  app.get('/api/v1/catalog/imports/:id',protectedRoute,async req=>readImport(req.actor,z.object({id:z.string()}).parse(req.params).id));
  app.post('/api/v1/catalog/imports/:id/rows',protectedRoute,async req=>editImportRow(req.actor,z.object({id:z.string()}).parse(req.params).id,importRowEdit.parse(req.body),req.id));
  app.post('/api/v1/catalog/imports/:id/duplicate-decision',protectedRoute,async req=>allowImportDuplicate(req.actor,z.object({id:z.string()}).parse(req.params).id,importDecision.parse(req.body),req.id));
  app.post('/api/v1/catalog/imports/:id/submit',protectedRoute,async req=>submitImport(req.actor,z.object({id:z.string()}).parse(req.params).id,importSubmit.parse(req.body),req.id));
  app.get('/api/v1/catalog/items/:id/media',protectedRoute,async req=>listProductMedia(req.actor,z.object({id:z.string()}).parse(req.params).id));
  app.get('/api/v1/catalog/items/:id/media/jobs',protectedRoute,async req=>listMediaJobs(req.actor,z.object({id:z.string()}).parse(req.params).id));
  app.post('/api/v1/catalog/items/:id/media/jobs',protectedRoute,async req=>queueMediaJob(req.actor,z.object({id:z.string()}).parse(req.params).id,mediaJobInput.parse(req.body),req.id));
  app.post('/api/v1/catalog/items/:id/media/url/jobs',protectedRoute,async req=>queueUrlMediaJob(req.actor,z.object({id:z.string()}).parse(req.params).id,urlMediaJobInput.parse(req.body),req.id));
  app.post('/api/v1/catalog/media/jobs/:id/replay',protectedRoute,async req=>replayMediaJob(req.actor,z.object({id:z.string()}).parse(req.params).id,mediaJobReplay.parse(req.body),req.id));
  app.post('/api/v1/catalog/items/:id/media/url',protectedRoute,async req=>importMediaUrl(req.actor,z.object({id:z.string()}).parse(req.params).id,urlMediaInput.parse(req.body),req.id));
  app.post('/api/v1/catalog/items/:id/media/zip',{...protectedRoute,bodyLimit:15*1024*1024},async req=>importMediaZip(req.actor,z.object({id:z.string()}).parse(req.params).id,zipMediaInput.parse(req.body),req.id));
  app.post('/api/v1/catalog/items/:id/media/zip/jobs',{...protectedRoute,bodyLimit:15*1024*1024},async req=>queueZipMediaJob(req.actor,z.object({id:z.string()}).parse(req.params).id,zipMediaJobInput.parse(req.body),req.id));
  app.post('/api/v1/catalog/items/:id/media/commands',protectedRoute,async req=>decideProductMedia(req.actor,z.object({id:z.string()}).parse(req.params).id,mediaDecisionInput.parse(req.body),req.id));
  app.post('/api/v1/catalog/items/:id/media',{...protectedRoute,bodyLimit:8*1024*1024},async req=>uploadProductMedia(req.actor,z.object({id:z.string()}).parse(req.params).id,uploadMediaInput.parse(req.body),req.id));
  app.post('/api/v1/catalog/items/:id/media/replace',{...protectedRoute,bodyLimit:8*1024*1024},async req=>replaceProductMedia(req.actor,z.object({id:z.string()}).parse(req.params).id,replaceMediaInput.parse(req.body),req.id));
  app.get('/api/v1/catalog/media/:id/content',protectedRoute,async(req,reply)=>reply.type('image/png').header('content-disposition','inline; filename="catalogue-image.png"').header('content-security-policy',"default-src 'none'; sandbox").send(await readMediaContent(req.actor,z.object({id:z.string()}).parse(req.params).id)));
  app.get('/api/v1/catalog/items/:id/sales-control',protectedRoute,async req=>readSalesControl(req.actor,z.object({id:z.string()}).parse(req.params).id));
  app.post('/api/v1/catalog/items/:id/sales-control',protectedRoute,async req=>commandSalesControl(req.actor,z.object({id:z.string()}).parse(req.params).id,salesControlInput.parse(req.body),req.id));
  app.get('/api/v1/catalog/items/:id/storefront',protectedRoute,async req=>previewStorefront(req.actor,z.object({id:z.string()}).parse(req.params).id));
  app.get('/api/v1/catalog/items',protectedRoute,async req=>{
    const p=pagination.parse(req.query);const where={...scope(req.actor,p.market),...(p.q?{OR:[{titleEn:{contains:p.q,mode:'insensitive' as const}},{sku:{contains:p.q,mode:'insensitive' as const}}]}:{})};
    return {items:await db.product.findMany({where,include:{publications:true},skip:(p.page-1)*p.limit,take:p.limit,orderBy:{sku:'asc'}}),total:await db.product.count({where})};
  });
  app.get('/api/v1/catalog/items/:id',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>{
    const {id}=z.object({id:z.string()}).parse(req.params);
    const p=await db.product.findFirst({where:{id,...scope(req.actor)},include:{publications:{orderBy:{version:'desc'}}}});
    requireCondition(p,'NOT_FOUND','Product not found',404);
    return {...p,issues:await catalogIssues(db,p)};
  });
  app.post('/api/v1/catalog/items/:id/draft',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>editCatalog(req.actor,z.object({id:z.string()}).parse(req.params).id,catalogEdit.parse(req.body),req.id));
  app.post('/api/v1/catalog/items/:id/commands',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>commandCatalog(req.actor,z.object({id:z.string()}).parse(req.params).id,catalogCommand.parse(req.body),req.id));
  app.get('/api/v1/inventory',protectedRoute,async req=>{
    const p=pagination.parse(req.query);
    const rows=await db.inventory.findMany({where:{product:scope(req.actor,p.market)},include:{product:{include:{publications:true,partner:{include:{brandRights:true}}}},location:true},skip:(p.page-1)*p.limit,take:p.limit});
    const now=(await db.demoClock.findUniqueOrThrow({where:{id:'main'}})).now;
    const mapped=new Map<string,boolean>();for(const id of new Set(rows.map(r=>r.product.partnerId)))mapped.set(id,(await mappingReadiness(db,id)).passed);
    return {items:rows.map(r=>({...r,product:{...r.product,partner:{id:r.product.partner.id,status:r.product.partner.status}},sellable:sellable(r,stockEligible(r,now)&&mapped.get(r.product.partnerId)!)}))};
  });
  app.get('/api/v1/locations',protectedRoute,async req=>listLocations(req.actor));
  app.post('/api/v1/locations',protectedRoute,async req=>createLocation(req.actor,locationCreate.parse(req.body),req.id));
  app.post('/api/v1/locations/:id',protectedRoute,async req=>editLocation(req.actor,z.object({id:z.string()}).parse(req.params).id,locationEdit.parse(req.body),req.id));
  app.post('/api/v1/inventory/:id/adjust',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>updateStock(req.actor,z.object({id:z.string()}).parse(req.params).id,stockUpdate.parse(req.body),req.id));
  app.get('/api/v1/orders',protectedRoute,async req=>{
    permit(req.actor,'fulfilment');const p=pagination.parse(req.query);
    // Vendors see only their legs and no other partner's totals, items or routing decisions.
    if(isVendor(req.actor))return {items:await db.fulfilmentLeg.findMany({where:scope(req.actor,p.market),include:{order:{select:{externalId:true,currency:true}}},orderBy:{createdAt:'desc'},take:p.limit,skip:(p.page-1)*p.limit}),view:'shipments'};
    return {items:await db.order.findMany({where:{companyId:req.actor.companyId,market:scope(req.actor,p.market).market},include:{legs:true},orderBy:{createdAt:'desc'},take:p.limit,skip:(p.page-1)*p.limit}),view:'orders'};
  });
  app.get('/api/v1/shipments',protectedRoute,async req=>{
    permit(req.actor,'fulfilment');const p=pagination.parse(req.query);
    return {items:await db.fulfilmentLeg.findMany({where:scope(req.actor,p.market),include:{order:{select:{externalId:true,currency:true}}},orderBy:{createdAt:'desc'},take:p.limit,skip:(p.page-1)*p.limit})};
  });
  app.get('/api/v1/shipments/:id',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>{
    permit(req.actor,'fulfilment');const {id}=z.object({id:z.string()}).parse(req.params);
    const leg=await db.fulfilmentLeg.findFirst({where:{id,...scope(req.actor)},include:{order:{select:{externalId:true,currency:true}}}});requireCondition(leg,'NOT_FOUND','Shipment not found',404);return leg;
  });
  app.post('/api/v1/shipments/:id/commands',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>commandLeg(req.actor,z.object({id:z.string()}).parse(req.params).id,legCommand.parse(req.body),req.id));
  app.get('/api/v1/shipments/:id/issues',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>listShipmentIssues(req.actor,z.object({id:z.string()}).parse(req.params).id));
  app.post('/api/v1/shipments/:id/issues',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>reportShipmentIssue(req.actor,z.object({id:z.string()}).parse(req.params).id,shipmentIssueInput.parse(req.body),req.id));
  app.get('/api/v1/shipments/:id/packing-slip',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async(req,reply)=>{
    permit(req.actor,'fulfilment');const {id}=z.object({id:z.string()}).parse(req.params);
    const leg=await db.fulfilmentLeg.findFirst({where:{id,...scope(req.actor)},include:{order:{select:{externalId:true}}}});requireCondition(leg,'NOT_FOUND','Shipment not found',404);
    requireCondition(['PACKED','READY_TO_DISPATCH','DISPATCHED','DELIVERED'].includes(leg.status),'NOT_PACKED','Packing slip is available after picking quantities are confirmed',409);
    const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
    reply.type('text/html').header('content-disposition',`attachment; filename="packing-slip-${leg.id}.html"`);
    return `<!doctype html><html lang="en"><meta charset="utf-8"><title>ATI packing slip</title><style>body{font:16px Arial;margin:50px}table{width:100%;border-collapse:collapse}td,th{padding:16px;border-bottom:1px solid #ddd;text-align:left}small{color:#666}</style><h1>Bloomingdale’s</h1><h2>Packing slip · Local demonstration</h2><p>Al Tayer Insignia LLC · UAE</p><p>Order ${esc(leg.order.externalId)}<br>Shipment ${esc(leg.id)}</p><table><tr><th>Item</th><th>Quantity</th></tr>${(leg.lines as ReservedLine[]).map(l=>`<tr><td>${esc(l.sku)}</td><td>${l.quantity}</td></tr>`).join('')}</table><p><small>This is not a VAT invoice. Customer invoicing and payment remain with ATI/SFCC. Fictional demonstration only.</small></p></html>`;
  });
  app.post('/api/v1/demo/orders',protectedRoute,async req=>{
    permit(req.actor,'fulfilment',true);requireCondition(env.DEMO_MODE==='true','DISABLED','Demo controls disabled',403);
    const input=demoOrderInput.parse(req.body);
    requireCondition(input.routingPolicy!=='MANUAL_OVERRIDE','MANUAL_INPUT_REQUIRED','Manual routing requires explicit line locations; use the signed order contract');
    const {partnerId,...orderOptions}=input;
    let basket=demoOrder;
    if(partnerId){
      const partner=await db.partner.findFirst({where:{AND:[{id:partnerId},partnerScope(req.actor)]}});
      requireCondition(partner,'NOT_FOUND','Partner not found',404);
      requireCondition(partner.status==='ACTIVE','PARTNER_NOT_ACTIVE','Complete launch checks and open this partner for sales first',409);
      const products=await db.product.findMany({where:{partnerId,companyId:req.actor.companyId,market:'AE',currency:'AED',status:'PUBLISHED',saleStatus:'ENABLED'},orderBy:{sku:'asc'},take:3});
      requireCondition(products.length,'NO_PUBLISHED_PRODUCTS','Publish products for this partner before receiving a sample order',409);
      basket={...demoOrder,total:products.reduce((sum,p)=>sum.plus(p.price),new Prisma.Decimal(0)).toFixed(2),lines:products.map((p,i)=>({id:'ol_'+(i+1),sku:p.sku,quantity:1,unitGross:p.price.toFixed(2),vendorDiscount:'0.00',operatorDiscount:'0.00'}))};
    }
    const raw=await demoWebhook({eventId:`demo-${input.externalOrderId}`,type:'order.created',companyId:req.actor.companyId,market:'AE',data:{...basket,...orderOptions}}),timestamp=String(Math.floor(Date.now()/1000));
    const response=await app.inject({method:'POST',url:'/api/v1/webhooks/SFCC',headers:{'content-type':'application/json','x-webhook-timestamp':timestamp,'x-webhook-signature':signWebhook(raw,timestamp,env.WEBHOOK_SECRET)},payload:raw});
    requireCondition(response.statusCode===202,'INTAKE_REJECTED',response.json().error?.message??'Signed intake rejected',response.statusCode);
    await transaction(tx=>audit(tx,req.actor,req.id,'demo.sfcc-order',input.externalOrderId,null,input,'Presenter generated a signed fictional SFCC order'));
    return {...response.json<Record<string,unknown>>(),sourceMode:'signed-sfcc-simulator'};
  });
  app.get('/api/v1/shipments/:id/invoices',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>listShipmentInvoices(req.actor,z.object({id:z.string()}).parse(req.params).id));
  app.post('/api/v1/demo/invoices',protectedRoute,async req=>{
    permit(req.actor,'fulfilment',true);requireCondition(env.DEMO_MODE==='true','DISABLED','Demo controls disabled',403);
    const input=demoInvoiceInput.parse(req.body);
    const leg=await db.fulfilmentLeg.findFirst({where:{id:input.shipmentId,...scope(req.actor)},include:{order:true}});
    requireCondition(leg,'NOT_FOUND','Shipment not found',404);
    requireCondition(['DISPATCHED','DELIVERED'].includes(leg.status),'INVOICE_BEFORE_FULFILMENT','Dispatch the shipment before receiving an invoice reference',409);
    const data={externalOrderId:leg.order.externalId,channel:leg.order.channel,invoiceNumber:input.invoiceNumber,version:1,status:'ISSUED',url:`https://sfcc.demo.invalid/invoices/${encodeURIComponent(input.invoiceNumber)}`,issuedAt:leg.deliveredAt?.toISOString()??leg.order.createdAt.toISOString(),shipmentIds:[leg.id]};
    const raw=await demoWebhook({eventId:`demo-invoice-${digest(JSON.stringify(data))}`,type:'invoice.updated',companyId:leg.companyId,market:leg.market,data}),timestamp=String(Math.floor(Date.now()/1000));
    const response=await app.inject({method:'POST',url:'/api/v1/webhooks/SFCC',headers:{'content-type':'application/json','x-webhook-timestamp':timestamp,'x-webhook-signature':signWebhook(raw,timestamp,env.WEBHOOK_SECRET)},payload:raw});
    requireCondition(response.statusCode===202,'INTAKE_REJECTED',response.json().error?.message??'Signed intake rejected',response.statusCode);
    await transaction(tx=>audit(tx,req.actor,req.id,'demo.sfcc-invoice',leg.id,null,data,'Presenter sent a fictional invoice reference; no tax document generated'));
    return {...response.json<Record<string,unknown>>(),sourceMode:'signed-sfcc-simulator'};
  });
  app.get('/api/v1/returns/:id/evidence',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>listReturnEvidence(req.actor,z.object({id:z.string()}).parse(req.params).id));
  app.post('/api/v1/returns/:id/evidence',{...protectedRoute,bodyLimit:8*1024*1024,schema:{...protectedRoute.schema,params:idSchema}},async req=>uploadReturnEvidence(req.actor,z.object({id:z.string()}).parse(req.params).id,returnEvidenceInput.parse(req.body),req.id));
  app.get('/api/v1/returns/evidence/:id/content',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async(req,reply)=>{
    const bytes=await readReturnEvidence(req.actor,z.object({id:z.string()}).parse(req.params).id);
    return reply.type('image/png').header('content-disposition','inline; filename="inspection.png"').header('cache-control','private, no-store').send(bytes);
  });
  app.get('/api/v1/returns',protectedRoute,async req=>{
    permit(req.actor,'fulfilment');const p=pagination.parse(req.query);
    return {items:await db.returnCase.findMany({where:scope(req.actor,p.market),orderBy:{createdAt:'desc'},take:p.limit,skip:(p.page-1)*p.limit})};
  });
  app.post('/api/v1/returns',protectedRoute,async req=>requestReturn(req.actor,returnInput.parse(req.body),req.id));
  app.get('/api/v1/returns/:id',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>{
    permit(req.actor,'fulfilment');const {id}=z.object({id:z.string()}).parse(req.params);
    const r=await db.returnCase.findFirst({where:{id,...scope(req.actor)}});requireCondition(r,'NOT_FOUND','Return not found',404);return r;
  });
  app.post('/api/v1/returns/:id/commands',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>commandReturn(req.actor,z.object({id:z.string()}).parse(req.params).id,returnCommand.parse(req.body),req.id));
  app.post('/api/v1/returns/:id/exchange-preview',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>previewExchange(req.actor,z.object({id:z.string()}).parse(req.params).id,exchangePreviewInput.parse(req.body)));
  app.get('/api/v1/returns/:id/exchange-options',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>exchangeOptions(req.actor,z.object({id:z.string()}).parse(req.params).id));
  app.get('/api/v1/returns/:id/exchanges',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>listExchanges(req.actor,z.object({id:z.string()}).parse(req.params).id));
  app.post('/api/v1/returns/:id/exchanges',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>requestExchange(req.actor,z.object({id:z.string()}).parse(req.params).id,exchangeRequestInput.parse(req.body),req.id));
  app.post('/api/v1/exchanges/:id/cancel',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>cancelExchange(req.actor,z.object({id:z.string()}).parse(req.params).id,exchangeCancelInput.parse(req.body),req.id));
  app.post('/api/v1/exchanges/:id/review',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>reviewExchange(req.actor,z.object({id:z.string()}).parse(req.params).id,exchangeReviewInput.parse(req.body),req.id));
  app.get('/api/v1/exchanges/:id/checkout',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>getExchangeExecution(req.actor,z.object({id:z.string()}).parse(req.params).id));
  app.post('/api/v1/exchanges/:id/checkout',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>startExchangeCheckout(req.actor,z.object({id:z.string()}).parse(req.params).id,exchangeCheckoutInput.parse(req.body),req.id));
  app.post('/api/v1/exchanges/:id/checkout/cancel',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>cancelExchangeCheckout(req.actor,z.object({id:z.string()}).parse(req.params).id,exchangeCancellationInput.parse(req.body),req.id));
  app.get('/api/v1/finance/events',protectedRoute,async req=>{
    financeRead(req.actor);const p=pagination.parse(req.query);
    return {items:await db.financialEvent.findMany({where:scope(req.actor,p.market),orderBy:{createdAt:'desc'},take:p.limit,skip:(p.page-1)*p.limit})};
  });
  app.post('/api/v1/finance/adjustments',protectedRoute,async req=>adjustment(req.actor,adjustmentInput.parse(req.body),req.id));
  app.get('/api/v1/settlements',protectedRoute,async req=>{
    financeRead(req.actor);const p=pagination.parse(req.query);
    return {items:await db.settlement.findMany({where:scope(req.actor,p.market),orderBy:{createdAt:'desc'},take:p.limit,skip:(p.page-1)*p.limit})};
  });
  app.post('/api/v1/settlements',protectedRoute,async req=>createStatement(req.actor,statementCreate.parse(req.body),req.id));
  app.get('/api/v1/settlements/:id',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>{
    financeRead(req.actor);const {id}=z.object({id:z.string()}).parse(req.params);
    const s=await db.settlement.findFirst({where:{id,...scope(req.actor)}});requireCondition(s,'NOT_FOUND','Statement not found',404);return s;
  });
  app.post('/api/v1/settlements/:id/commands',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>commandStatement(req.actor,z.object({id:z.string()}).parse(req.params).id,statementCommand.parse(req.body),req.id));
  app.get('/api/v1/settlements/:id/export',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async(req,reply)=>{
    financeRead(req.actor);const {id}=z.object({id:z.string()}).parse(req.params);
    const s=await db.settlement.findFirst({where:{id,...scope(req.actor)}});requireCondition(s,'NOT_FOUND','Statement not found',404);
    requireCondition(['LOCKED','EXPORT_PENDING','EXPORTED','PAYMENT_PENDING','PAID'].includes(s.status),'NOT_LOCKED','Only locked statement evidence can be downloaded',409);
    const events=(s.evidence as {events?:{id:string;kind:string;amount:string;sourceId:string}[]}).events??[];
    const csv=(value:string)=>`"${(/^[=+@\t\r-]/.test(value)&&!/^-[0-9]+(\.[0-9]+)?$/.test(value)?"'":"")+value.replaceAll('"','""')}"`;
    reply.type('text/csv').header('content-disposition',`attachment; filename="ati-statement-${s.id}.csv"`);
    return [['statement_id','partner_id','currency','event_id','kind','signed_amount','source_id'],...events.map(e=>[s.id,s.partnerId,s.currency,e.id,e.kind,e.amount,e.sourceId])].map(row=>row.map(csv).join(',')).join('\r\n');
  });
  app.get('/api/v1/integrations/inbox',protectedRoute,async req=>{
    permit(req.actor,'integrations',true);const p=pagination.parse(req.query);
    return {items:await db.inbox.findMany({where:{companyId:req.actor.companyId,market:scope(req.actor,p.market).market},select:inboxPublicSelect,orderBy:{createdAt:'desc'},take:p.limit,skip:(p.page-1)*p.limit})};
  });
  app.post('/api/v1/integrations/inbox/:id/replay',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>{
    permit(req.actor,'integrations',true);const {id}=z.object({id:z.string()}).parse(req.params);const {reason}=inboxReplayInput.parse(req.body);
    return transaction(async tx=>{
      const receipt=await tx.inbox.findFirst({where:{id,companyId:req.actor.companyId,market:{in:req.actor.markets}}});requireCondition(receipt,'NOT_FOUND','Receipt not found',404);
      requireCondition(['RETRY','DEAD_LETTER'].includes(receipt.status),'NOT_REPLAYABLE','Only failed receipts can be replayed',409);
      const updated=await tx.inbox.update({where:{id},data:{status:'PENDING',attempts:0,availableAt:new Date()},select:inboxPublicSelect});await transitionException(tx,'INBOX_DLQ',id,'REPLAY_REQUESTED',reason);await audit(tx,req.actor,req.id,'inbox.replay',id,{status:receipt.status},{status:updated.status},reason);return updated;
    });
  });
  app.get('/api/v1/integrations/jobs',protectedRoute,async req=>{
    permit(req.actor,'integrations',true);const p=pagination.parse(req.query);
    return {items:await db.outbox.findMany({where:scope(req.actor,p.market),orderBy:{createdAt:'desc'},skip:(p.page-1)*p.limit,take:p.limit})};
  });
  app.post('/api/v1/integrations/jobs/:id/replay',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>{
    permit(req.actor,'integrations',true);const {id}=z.object({id:z.string()}).parse(req.params);
    const {reason}=jobReplayInput.parse(req.body);
    return transaction(async tx=>{
      const job=await tx.outbox.findFirst({where:{id,...scope(req.actor)}});
      requireCondition(job,'NOT_FOUND','Job not found',404);
      requireCondition(['DEAD_LETTER','RETRY'].includes(job.status),'NOT_REPLAYABLE','Only failed jobs can be replayed',409);
      const updated=await tx.outbox.update({where:{id},data:{status:'PENDING',attempts:0,availableAt:new Date(),leaseUntil:null,leaseToken:null}});
      await transitionException(tx,'INTEGRATION_DLQ',id,'REPLAY_REQUESTED',reason);
      await audit(tx,req.actor,req.id,'integration.replay',id,{status:job.status},{status:updated.status},reason,job.partnerId??undefined);
      return updated;
    });
  });
  app.get('/api/v1/audit',protectedRoute,async req=>{
    permit(req.actor,'audit',true);const p=pagination.parse(req.query);
    return {items:await db.auditEvent.findMany({where:scope(req.actor,p.market),orderBy:{createdAt:'desc'},skip:(p.page-1)*p.limit,take:p.limit})};
  });
  app.get('/api/v1/slas',protectedRoute,async req=>listSlas(req.actor,slaQuery.parse(req.query)));
  app.get('/api/v1/exceptions',protectedRoute,async req=>listExceptions(req.actor,exceptionQuery.parse(req.query)));
  app.get('/api/v1/exceptions/:id',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>getException(req.actor,z.object({id:z.string()}).parse(req.params).id));
  app.post('/api/v1/exceptions/:id/commands',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>commandException(req.actor,z.object({id:z.string()}).parse(req.params).id,exceptionCommand.parse(req.body),req.id));
  app.get('/api/v1/notifications',protectedRoute,async req=>listNotifications(req.actor,notificationQuery.parse(req.query)));
  app.get('/api/v1/notification-policies',protectedRoute,async req=>listNotificationPolicies(req.actor,notificationPolicyQuery.parse(req.query).market));
  app.post('/api/v1/notification-policies',protectedRoute,async req=>saveNotificationPolicy(req.actor,notificationPolicyInput.parse(req.body),req.id));
  app.post('/api/v1/notifications/:id/read',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>markNotification(req.actor,z.object({id:z.string()}).parse(req.params).id,notificationRead.parse(req.body).read));
  app.get('/api/v1/slas/queue',protectedRoute,async req=>slaQueue(req.actor,slaQueueQuery.parse(req.query)));
  app.get('/api/v1/slas/policies',protectedRoute,async req=>listSlaPolicies(req.actor,slaPolicyQuery.parse(req.query).market));
  app.post('/api/v1/slas/policies',protectedRoute,async req=>saveSlaPolicy(req.actor,slaPolicyInput.parse(req.body),req.id));
  app.post('/api/v1/slas/:id/waive',{...protectedRoute,schema:{...protectedRoute.schema,params:idSchema}},async req=>waiveSla(req.actor,z.object({id:z.string()}).parse(req.params).id,slaWaiver.parse(req.body),req.id));
  app.get('/api/v1/demo/clock',protectedRoute,async()=>db.demoClock.findUniqueOrThrow({where:{id:'main'}}));
  app.post('/api/v1/demo/clock',protectedRoute,async req=>{
    permit(req.actor,'rules',true);requireCondition(env.DEMO_MODE==='true','DISABLED','Demo controls disabled',403);
    const {minutes}=clockInput.parse(req.body);
    return transaction(async tx=>{
      const old=await tx.demoClock.findUniqueOrThrow({where:{id:'main'}});
      const next=await tx.demoClock.update({where:{id:'main'},data:{now:new Date(old.now.getTime()+minutes*60000)}});
      await reconcileSlas(tx);
      await audit(tx,req.actor,req.id,'demo.advance-clock','main',old,next,'Presenter advanced demo time');return next;
    });
  });
  app.post('/api/v1/demo/faults',protectedRoute,async req=>{
    permit(req.actor,'integrations',true);requireCondition(env.DEMO_MODE==='true','DISABLED','Demo controls disabled',403);
    const input=faultInput.parse(req.body);
    return transaction(async tx=>{const result=await tx.adapterFault.upsert({where:{system:input.system},update:input,create:input});await audit(tx,req.actor,req.id,'demo.adapter-fault',input.system,null,input,'Presenter injected a mock failure');return result;});
  });
  app.post('/api/v1/webhooks/:source',{schema:{params:{type:'object',required:['source'],properties:{source:{type:'string',enum:[...systems]}}}}},async(req,reply)=>{
    const {source}=z.object({source:z.enum(systems)}).parse(req.params);
    verifyWebhook(req.rawBody,String(req.headers['x-webhook-timestamp']??''),String(req.headers['x-webhook-signature']??''),env.WEBHOOK_SECRET);
    const input=normalizeWebhook(webhookInput.parse(req.body),source,req.id);
    reply.header('x-event-correlation-id',input.correlationId);
    const hash=digest(req.rawBody);
    const existing=await db.inbox.findUnique({where:{source_eventId:{source,eventId:input.eventId}}});
    if(existing){requireCondition(existing.payloadHash===hash,'IDEMPOTENCY_CONFLICT','Event ID was already used with different content',409);return reply.header('x-event-correlation-id',existing.correlationId).code(202).send({receiptId:existing.id,duplicate:true});}
    try {
      const receipt=await db.inbox.create({data:{...input,source,payload:input.payload as Prisma.InputJsonObject,payloadHash:hash,rawEnvelope:req.rawBody,signatureTimestamp:String(req.headers['x-webhook-timestamp']),signature:String(req.headers['x-webhook-signature'])}});
      return reply.code(202).send({receiptId:receipt.id,status:'PENDING'});
    } catch(error) {
      if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002'){
        const receipt=await db.inbox.findUniqueOrThrow({where:{source_eventId:{source,eventId:input.eventId}}});
        requireCondition(receipt.payloadHash===hash,'IDEMPOTENCY_CONFLICT','Event ID content conflict',409);return reply.header('x-event-correlation-id',receipt.correlationId).code(202).send({receiptId:receipt.id,duplicate:true});
      } throw error;
    }
  });
  await app.ready();
  return app;
}
