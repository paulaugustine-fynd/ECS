import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '../db/client';
import { audit,json,transaction } from '../db/transaction';
import { type Actor,permit,partnerScope } from '../auth/policy';
import { token,digest,hashPassword } from '../auth/security';
import { readEnv } from '../config/env';
import { requireCondition } from './errors';
import { checksum,scanDocument,putDocument } from '../storage/documents';
export const documentTypes=['TRADE_LICENSE','VAT_CERTIFICATE','BANK_LETTER','BRAND_AUTHORIZATION'] as const;
const text=z.string().trim().max(200);
export const applicationFields=z.object({registrationNumber:text,taxRegistrationNumber:text,contactName:text,contactEmail:z.union([z.literal(''),z.string().email().max(200)]),phone:z.string().trim().max(40),address:z.string().trim().max(500),brands:z.string().trim().max(500),website:z.union([z.literal(''),z.string().url().max(300)]),beneficiaryName:text,bankLast4:z.string().regex(/^(\d{4})?$/),estimatedSkus:z.number().int().min(0).max(1000000),fulfilmentModel:z.enum(['VENDOR_WAREHOUSE','BRAND_STORE','ATI_WAREHOUSE']),declaration:z.boolean()}).strict();
export const applicationInput=z.object({expectedVersion:z.number().int().positive(),legalName:text.min(2),displayName:text.min(2),application:applicationFields}).strict();
export function applicationIssues(value:unknown){const parsed=applicationFields.safeParse(value);if(!parsed.success)return ['Complete and save the business application'];const a=parsed.data;return [!a.registrationNumber&&'Business registration number',!a.taxRegistrationNumber&&'Tax registration number',!a.contactName&&'Primary contact',!a.contactEmail&&'Contact email',!a.phone&&'Contact phone',!a.address&&'Registered address',!a.brands&&'Represented brands',!a.beneficiaryName&&'Bank beneficiary name',!a.bankLast4&&'Last four bank account digits',!a.estimatedSkus&&'Estimated assortment size',!a.declaration&&'Demo information declaration'].filter(Boolean) as string[];}
export async function saveApplication(actor:Actor,id:string,input:z.infer<typeof applicationInput>,correlationId:string){
  permit(actor,'partners');return transaction(async tx=>{
    const p=await tx.partner.findFirst({where:{AND:[{id},partnerScope(actor)]}});requireCondition(p,'NOT_FOUND','Partner not found',404);
    requireCondition(['APPLICATION_IN_PROGRESS','MORE_INFO_REQUIRED'].includes(p.status),'APPLICATION_LOCKED','ATI must request information before an application under review can be edited',409);
    requireCondition(p.version===input.expectedVersion,'STALE_VERSION','Application changed; refresh before saving',409);
    const updated=await tx.partner.update({where:{id},data:{legalName:input.legalName,displayName:input.displayName,application:json(input.application),version:{increment:1}}});
    await audit(tx,actor,correlationId,'application.save',id,{version:p.version},{version:updated.version,changedFields:Object.keys(input.application)},'Saved application draft',id);return updated;
  });
}
export const documentInput=z.object({expectedVersion:z.number().int().positive(),type:z.enum(documentTypes),fileName:z.string().min(1).max(160).regex(/^[^/\\\r\n]+$/),contentType:z.enum(['application/pdf','image/png','image/jpeg','text/plain']),base64:z.string().min(4).max(7*1024*1024).regex(/^[A-Za-z0-9+/]+={0,2}$/),expiresAt:z.string().datetime().nullable()}).strict();
export const canReadDocument=(actor:Actor,type:string)=>['ATI_SUPER_ADMIN','ATI_PARTNER_MANAGER','ATI_AUDITOR','VENDOR_ADMIN'].includes(actor.role)||actor.role==='ATI_FINANCE_ANALYST'&&type==='BANK_LETTER';
export function permitDocumentRead(actor:Actor,type:string){
  requireCondition(canReadDocument(actor,type),'FORBIDDEN','Your role cannot access this compliance file',403);
}
export async function uploadDocument(actor:Actor,id:string,input:z.infer<typeof documentInput>,correlationId:string){
  permit(actor,'partners');const p=await db.partner.findFirst({where:{AND:[{id},partnerScope(actor)]}});requireCondition(p,'NOT_FOUND','Partner not found',404);
  requireCondition(['APPLICATION_IN_PROGRESS','MORE_INFO_REQUIRED'].includes(p.status),'APPLICATION_LOCKED','Upload is available while drafting or responding to requested information',409);
  requireCondition(p.version===input.expectedVersion,'STALE_VERSION','Refresh the application before uploading',409);
  const bytes=Buffer.from(input.base64,'base64');requireCondition(bytes.toString('base64')===input.base64,'INVALID_FILE_ENCODING','Malformed file encoding');const scan=scanDocument(bytes,input.contentType);
  const now=(await db.demoClock.findUniqueOrThrow({where:{id:'main'}})).now;
  requireCondition(input.type!=='TRADE_LICENSE'||input.expiresAt,'EXPIRY_REQUIRED','Trade licence expiry date is required');requireCondition(!input.expiresAt||new Date(input.expiresAt)>now,'EXPIRED_DOCUMENT','Upload a currently valid document');
  const key=randomUUID();const storageMode=scan.status==='BLOCKED'?'quarantine':await putDocument(key,bytes,input.contentType);
  return transaction(async tx=>{
    const changed=await tx.partner.updateMany({where:{id,version:input.expectedVersion,status:{in:['APPLICATION_IN_PROGRESS','MORE_INFO_REQUIRED']}},data:{version:{increment:1}}});requireCondition(changed.count,'STALE_VERSION','Application changed; refresh before uploading',409);
    const latest=await tx.document.findFirst({where:{partnerId:id,type:input.type},orderBy:{version:'desc'}});
    const doc=await tx.document.create({data:{partnerId:id,type:input.type,fileName:input.fileName,contentType:input.contentType,objectKey:key,checksum:checksum(bytes),byteSize:bytes.length,scanStatus:scan.status,scanDetail:scan.detail,storageMode,expiresAt:input.expiresAt?new Date(input.expiresAt):null,version:(latest?.version??0)+1,status:scan.status==='BLOCKED'?'REJECTED':'PENDING',reason:scan.status==='BLOCKED'?scan.detail:null}});
    await audit(tx,actor,correlationId,'document.upload',doc.id,null,{type:doc.type,version:doc.version,checksum:doc.checksum,bytes:doc.byteSize,scan:scan.status},'New private document version',id);return doc;
  });
}
export const invitationInput=z.object({email:z.string().email().max(200),legalName:text.min(2),displayName:text.min(2)}).strict();
export async function invitePartner(actor:Actor,input:z.infer<typeof invitationInput>,correlationId:string){
  permit(actor,'partners',true);requireCondition(readEnv().DEMO_MODE==='true','DEMO_ONLY','Local invitation preview is disabled',403);const raw=token();
  return transaction(async tx=>{
    const email=input.email.toLowerCase();requireCondition(!(await tx.user.findUnique({where:{email}})),'EMAIL_EXISTS','An account already exists; manage its existing partner',409);
    requireCondition(!(await tx.invitation.findFirst({where:{email,acceptedAt:null,expiresAt:{gt:new Date()}}})),'INVITATION_EXISTS','An unexpired invitation already exists for this address',409);
    const p=await tx.partner.create({data:{companyId:actor.companyId,markets:actor.markets,code:`VND-${randomUUID().slice(0,8).toUpperCase()}`,legalName:input.legalName,displayName:input.displayName}});
    const invitation=await tx.invitation.create({data:{companyId:actor.companyId,partnerId:p.id,email,tokenHash:digest(raw),expiresAt:new Date(Date.now()+86400000)}});
    await audit(tx,actor,correlationId,'partner.invite',p.id,null,{invitationId:invitation.id,expiresAt:invitation.expiresAt},'Local preview only; no email was sent',p.id);
    return {partner:p,expiresAt:invitation.expiresAt,invitationUrl:`/onboarding/invitation#${raw}`,delivery:'LOCAL_PREVIEW_NOT_SENT'};
  });
}
export const acceptInput=z.object({token:z.string().min(32).max(200),email:z.string().email().max(200),name:text.min(2),password:z.string().min(12).max(128)}).strict();
export async function acceptInvitation(input:z.infer<typeof acceptInput>,correlationId:string){
  requireCondition(readEnv().DEMO_MODE==='true','DEMO_ONLY','Local invitation flow disabled',403);const hash=hashPassword(input.password);
  return transaction(async tx=>{
    const i=await tx.invitation.findUnique({where:{tokenHash:digest(input.token)}});requireCondition(i&&!i.acceptedAt&&i.expiresAt>new Date()&&i.email===input.email.toLowerCase(),'INVALID_INVITATION','Invitation is invalid, expired or already used',400);
    const p=await tx.partner.findUniqueOrThrow({where:{id:i.partnerId}});requireCondition(p.status==='INVITED','INVALID_INVITATION','Partner invitation is no longer open',409);
    requireCondition(!(await tx.user.findUnique({where:{email:i.email}})),'EMAIL_EXISTS','Account already exists',409);
    const user=await tx.user.create({data:{companyId:i.companyId,partnerId:p.id,markets:p.markets,email:i.email,name:input.name,passwordHash:hash,role:'VENDOR_ADMIN'}});
    await tx.invitation.update({where:{id:i.id},data:{acceptedAt:new Date()}});await tx.partner.update({where:{id:p.id},data:{status:'APPLICATION_IN_PROGRESS',version:{increment:1}}});await audit(tx,user,correlationId,'invitation.accept',p.id,null,{invitationId:i.id},'Created restricted partner membership',p.id);
    return {email:user.email,next:'/login?next=/onboarding'};
  });
}
