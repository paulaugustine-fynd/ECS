import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {eventEnvelope,normalizeWebhook,verifyStoredEnvelope} from '../../packages/events/envelope';
import {eventEnvelopeJsonSchema,sfccOrderEventV1} from '../../packages/events/contracts';
import {digest} from '../../packages/auth/security';
import {encodeDemoWebhook} from '../../packages/events/demo';
const value=()=>({eventId:'evt-1',type:'order.created',version:1,occurredAt:'2026-09-25T10:00:00.000Z',producer:'SFCC',tenantId:'cmp_ati_uae',market:'AE',correlationId:'chain-1',subject:{entityType:'ORDER',entityId:'ORDER-1'},data:{externalOrderId:'ORDER-1',nested:{a:1,b:2}}});
const stored=()=>{const body=value(),rawEnvelope=JSON.stringify(body);return {...normalizeWebhook(body,'SFCC','http-1'),source:'SFCC',rawEnvelope,payloadHash:digest(rawEnvelope)};};
it('keeps the committed 2020-12 envelope schema identical to the executable contract',()=>{
 const file=JSON.parse(readFileSync(new URL('../../schemas/event-envelope.schema.json',import.meta.url),'utf8'));
 expect(file).toEqual(eventEnvelopeJsonSchema());expect(file.required).toContain('market');expect(file.additionalProperties).toBe(false);expect(file.properties.version).toEqual({type:'number',const:1});
});
it('rejects unsupported versions, missing/invalid identity fields and extra subject or root fields',()=>{
 expect(eventEnvelope.safeParse(value()).success).toBe(true);
 for(const change of [{version:2},{occurredAt:'yesterday'},{market:null},{correlationId:'line\nbreak'},{tenantId:''},{subject:{entityType:'ORDER',entityId:'ORDER-1',partnerId:'spoof'}},{companyId:'shadow'}])expect(eventEnvelope.safeParse({...value(),...change}).success).toBe(false);
});
it('binds source, tenant and market without treating arbitrary producer metadata as authority',()=>{
 expect(normalizeWebhook(value(),'SFCC','http-1')).toMatchObject({companyId:'cmp_ati_uae',correlationId:'chain-1',envelopeVersion:1});
 for(const change of [{producer:'FYND'},{tenantId:'foreign'},{market:'SA'},{idempotencyKey:'different'}])expect(()=>normalizeWebhook({...value(),...change},'SFCC','http-1')).toThrow();
 expect(()=>normalizeWebhook({...value(),idempotencyKey:'evt-1'},'SFCC','http-1')).not.toThrow();
});
it('detects checksum, identity, payload and subject mismatches without depending on JSON key order',()=>{
 const receipt=stored();expect(()=>verifyStoredEnvelope({...receipt,payload:{nested:{b:2,a:1},externalOrderId:'ORDER-1'}})).not.toThrow();
 for(const change of [{payloadHash:'bad'},{companyId:'foreign'},{correlationId:'other'},{envelopeVersion:0},{eventOccurredAt:null},{payload:{externalOrderId:'ORDER-2'}}])expect(()=>verifyStoredEnvelope({...receipt,...change})).toThrow();
 const body={...value(),subject:{entityType:'ORDER',entityId:'WRONG'}},rawEnvelope=JSON.stringify(body);
 expect(()=>verifyStoredEnvelope({...receipt,rawEnvelope,payloadHash:digest(rawEnvelope)})).toThrow('subject');
});
it('keeps legacy receipts legacy and never fabricates raw evidence or event occurrence time',()=>{
 const raw={eventId:'old',type:'order.created',companyId:'cmp_ati_uae',market:'AE',data:{}};
 const receipt=normalizeWebhook(raw,'SFCC','first-http');expect(receipt).toMatchObject({envelopeVersion:0,eventOccurredAt:null,correlationId:'first-http'});
 expect(()=>verifyStoredEnvelope({...receipt,source:'SFCC',rawEnvelope:null,payloadHash:'historic-unrecoverable'})).not.toThrow();
 expect(()=>verifyStoredEnvelope({...receipt,source:'SFCC',rawEnvelope:null,payloadHash:'historic-unrecoverable',envelopeVersion:1})).toThrow('no original envelope');
});
it('distinguishes envelope acceptance from business-payload acceptance',()=>{
 expect(eventEnvelope.safeParse(value()).success).toBe(true);expect(sfccOrderEventV1.safeParse(value()).success).toBe(false);
 const data={externalOrderId:'ORDER-1',channel:'BLM-AE',currency:'AED',deliveryCity:'Dubai',total:'150.00',lines:[{id:'line-1',sku:'TEST-SKU',quantity:1,unitGross:'150.00'}]};
 expect(sfccOrderEventV1.safeParse({...value(),data}).success).toBe(true);
});
it('emits v1 presenter events and reuses original bytes across retries and clock changes',()=>{
 const input={eventId:'demo-1',type:'order.created' as const,companyId:'cmp_ati_uae',market:'AE',data:{externalOrderId:'ORDER-1'}},raw=encodeDemoWebhook(input,'2026-09-25T10:00:00.000Z',null);
 expect(JSON.parse(raw)).toMatchObject({version:1,producer:'SFCC',subject:{entityType:'ORDER',entityId:'ORDER-1'}});
 const prior={source:'SFCC',...input,payload:input.data,rawEnvelope:raw,payloadHash:digest(raw)};
 expect(encodeDemoWebhook(input,'2026-09-28T10:00:00.000Z',prior)).toBe(raw);
 expect(encodeDemoWebhook({...input,data:{externalOrderId:'ORDER-2'}},'2026-09-28T10:00:00.000Z',prior)).not.toBe(raw);
 expect(()=>encodeDemoWebhook(input,'2026-09-28T10:00:00.000Z',{...prior,payloadHash:'wrong'})).toThrow();
});
it('reconstructs only the original legacy presenter shape when old raw bytes are unavailable',()=>{
 const input={eventId:'demo-old',type:'invoice.updated' as const,companyId:'cmp_ati_uae',market:'AE',data:{invoiceNumber:'INV/1'}},raw=JSON.stringify(input);
 const prior={source:'SFCC',...input,payload:input.data,rawEnvelope:null,payloadHash:digest(raw)};
 expect(encodeDemoWebhook(input,'2026-09-28T10:00:00.000Z',prior)).toBe(raw);
});
