import {z} from 'zod';
import {isDeepStrictEqual} from 'node:util';
import {digest} from '../auth/security';
import {requireCondition} from '../domain/errors';
import {systems,type System} from '../config/env';

const identity=z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/);
// Executable profile of the supplied envelope: only v1, required market, bounded IDs.
// data is validated asynchronously by the registered business handler after durable acceptance.
export const eventEnvelope=z.object({
 eventId:identity,type:z.string().min(1).max(100).regex(/^[a-z][a-z0-9.-]*$/),version:z.literal(1),
 occurredAt:z.string().datetime(),producer:z.enum(['ECS',...systems]),tenantId:identity,market:z.string().regex(/^[A-Z]{2}$/),
 correlationId:identity,causationId:identity.nullable().optional(),idempotencyKey:identity.nullable().optional(),
 subject:z.object({entityType:identity,entityId:identity}).strict(),data:z.record(z.unknown()),metadata:z.record(z.unknown()).optional(),
}).strict();
export const legacyWebhook=z.object({eventId:z.string().min(1).max(200),type:z.string().min(1),companyId:z.literal('cmp_ati_uae'),market:z.literal('AE'),data:z.record(z.unknown())}).strict();
export const acceptedWebhook=z.union([eventEnvelope,legacyWebhook]);
export type EventEnvelope=z.infer<typeof eventEnvelope>;
export function normalizeWebhook(body:unknown,source:System,requestId:string){
 const input=acceptedWebhook.parse(body);
 if('version' in input){
  requireCondition(input.producer===source,'EVENT_SOURCE_MISMATCH','Envelope producer must match authenticated webhook source',403);
  // This mapping is the existing local ATI demo binding, not a claim of multi-tenant credentials.
  requireCondition(input.tenantId==='cmp_ati_uae'&&input.market==='AE','EVENT_SCOPE_FORBIDDEN','Webhook credential is bound to the local ATI AE demonstration',403);
  requireCondition(!input.idempotencyKey||input.idempotencyKey===input.eventId,'EVENT_KEY_MISMATCH','This profile uses eventId as the source idempotency key',400);
  return {eventId:input.eventId,type:input.type,companyId:input.tenantId,market:input.market,payload:input.data,correlationId:input.correlationId,envelopeVersion:1,eventOccurredAt:new Date(input.occurredAt)};
 }
 return {eventId:input.eventId,type:input.type,companyId:input.companyId,market:input.market,payload:input.data,correlationId:requestId,envelopeVersion:0,eventOccurredAt:null};
}

type Receipt={source:string;eventId:string;type:string;companyId:string;market:string;payload:unknown;payloadHash:string;correlationId:string;envelopeVersion:number;eventOccurredAt:Date|null;rawEnvelope:string|null};
export function verifyStoredEnvelope(receipt:Receipt){
 // Older records keep their original semantics; never fabricate raw text or a v1 timestamp.
 if(receipt.rawEnvelope===null){requireCondition(receipt.envelopeVersion===0,'EVENT_EVIDENCE_MISSING','Versioned receipt has no original envelope');return;}
 requireCondition(digest(receipt.rawEnvelope)===receipt.payloadHash,'EVENT_EVIDENCE_MISMATCH','Stored raw envelope checksum differs from accepted content');
 let body:unknown;try{body=JSON.parse(receipt.rawEnvelope);}catch{requireCondition(false,'EVENT_EVIDENCE_MISMATCH','Stored envelope is not JSON');}
 const source=z.enum(systems).parse(receipt.source),value=normalizeWebhook(body,source,receipt.correlationId);
 requireCondition(value.eventId===receipt.eventId&&value.type===receipt.type&&value.companyId===receipt.companyId&&value.market===receipt.market&&value.correlationId===receipt.correlationId&&value.envelopeVersion===receipt.envelopeVersion&&value.eventOccurredAt?.getTime()===receipt.eventOccurredAt?.getTime()&&isDeepStrictEqual(value.payload,receipt.payload),'EVENT_EVIDENCE_MISMATCH','Stored receipt identity or data differs from its accepted envelope');
 if(receipt.envelopeVersion===1){
  const envelope=eventEnvelope.parse(body),data=envelope.data;
  if(source==='SFCC'&&receipt.type==='order.created')requireCondition(envelope.subject.entityType==='ORDER'&&envelope.subject.entityId===data.externalOrderId,'EVENT_SUBJECT_MISMATCH','Order event subject must identify its external order');
  if(source==='SFCC'&&receipt.type==='invoice.updated')requireCondition(envelope.subject.entityType==='INVOICE'&&envelope.subject.entityId===data.invoiceNumber,'EVENT_SUBJECT_MISMATCH','Invoice event subject must identify its invoice number');
 }
}

// Explicit safe DTO: signed raw text/HMAC evidence stays private to receipt storage.
export const inboxPublicSelect={id:true,source:true,eventId:true,type:true,companyId:true,market:true,payload:true,payloadHash:true,correlationId:true,status:true,error:true,attempts:true,availableAt:true,createdAt:true,envelopeVersion:true,eventOccurredAt:true} as const;
