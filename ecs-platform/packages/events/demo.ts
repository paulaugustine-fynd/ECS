import {isDeepStrictEqual} from 'node:util';
import {db} from '../db/client';
import {digest} from '../auth/security';
import {requireCondition} from '../domain/errors';
import {eventEnvelope} from './envelope';
type Input={eventId:string;type:'order.created'|'invoice.updated';companyId:string;market:string;data:Record<string,unknown>};
type Prior={source:string;eventId:string;type:string;companyId:string;market:string;payload:unknown;rawEnvelope:string|null;payloadHash:string};
export function encodeDemoWebhook(input:Input,occurredAt:string,prior:Prior|null){
 const payload=JSON.parse(JSON.stringify(input.data));
 const same=prior&&prior.source==='SFCC'&&prior.eventId===input.eventId&&prior.type===input.type&&prior.companyId===input.companyId&&prior.market===input.market&&isDeepStrictEqual(prior.payload,payload);
 if(same){
  // Re-sign the original bytes with a fresh delivery timestamp; never change event occurrence/correlation.
  if(prior.rawEnvelope){requireCondition(digest(prior.rawEnvelope)===prior.payloadHash,'EVENT_EVIDENCE_MISMATCH','Stored demo event checksum differs from its original content');return prior.rawEnvelope;}
  // The old presenter emitted this exact shape. If its bytes cannot be reconstructed,
  // normal ingress rejects the conflict; do not rewrite historical evidence to force a match.
  return JSON.stringify(input);
 }
 const value=eventEnvelope.parse({eventId:input.eventId,type:input.type,version:1,occurredAt,producer:'SFCC',tenantId:input.companyId,market:input.market,correlationId:`demo-${digest(`SFCC:${input.eventId}`).slice(0,32)}`,subject:{entityType:input.type==='order.created'?'ORDER':'INVOICE',entityId:input.type==='order.created'?input.data.externalOrderId:input.data.invoiceNumber},data:input.data,metadata:{demoOnly:true}});
 return JSON.stringify(value);
}
export async function demoWebhook(input:Input){
 const [clock,prior]=await Promise.all([db.demoClock.findUniqueOrThrow({where:{id:'main'}}),db.inbox.findUnique({where:{source_eventId:{source:'SFCC',eventId:input.eventId}}})]);
 return encodeDemoWebhook(input,clock.now.toISOString(),prior);
}
