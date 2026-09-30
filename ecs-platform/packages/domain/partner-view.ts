import type {Partner,Document,Agreement} from '@prisma/client';
import type {Actor} from '../auth/policy';
import {applicationIssues,canReadDocument,documentTypes} from './onboarding';
import {canReadCommercials} from './commercials';

// Explicit DTOs: adding a database field must not automatically expose it in lists.
export function partnerSummary(p:Partner){
 return {id:p.id,code:p.code,companyId:p.companyId,legalName:p.legalName,displayName:p.displayName,status:p.status,markets:p.markets,erpVendorId:p.erpVendorId,riskTier:p.riskTier,trusted:p.trusted,brandApproved:p.brandApproved,fyndMapped:p.fyndMapped,inventorySynced:p.inventorySynced,testOrderPassed:p.testOrderPassed,version:p.version,submittedAt:p.submittedAt,createdAt:p.createdAt,updatedAt:p.updatedAt};
}
export const canReadApplication=(actor:Actor)=>['ATI_SUPER_ADMIN','ATI_PARTNER_MANAGER','ATI_AUDITOR','VENDOR_ADMIN'].includes(actor.role);
export function partnerDetail(actor:Actor,p:Partner&{documents:Document[];agreements:Agreement[]}){
 const application=canReadApplication(actor),commercials=canReadCommercials(actor),allowedDocuments=documentTypes.filter(t=>canReadDocument(actor,t));
 return {...partnerSummary(p),access:{application,commercials,documentTypes:allowedDocuments},
  ...(application?{application:p.application,applicationIssues:applicationIssues(p.application),reviewReason:p.reviewReason}:{}),
  ...(commercials?{agreements:p.agreements.filter(a=>actor.markets.includes((a.rules as {market?:string}).market??'AE'))}:{}),
  documents:p.documents.filter(d=>allowedDocuments.includes(d.type as typeof documentTypes[number])).map(d=>({id:d.id,partnerId:d.partnerId,type:d.type,fileName:d.fileName,contentType:d.contentType,checksum:d.checksum,byteSize:d.byteSize,scanStatus:d.scanStatus,scanDetail:d.scanDetail,storageMode:d.storageMode,version:d.version,status:d.status,expiresAt:d.expiresAt,reason:d.reason,createdAt:d.createdAt})),
 };
}
