import {z} from 'zod';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {eventEnvelope} from './envelope';
import {orderInput} from '../domain/orders';
import {invoiceInput} from '../domain/invoices';

export const sfccOrderEventV1=eventEnvelope.extend({producer:z.literal('SFCC'),type:z.literal('order.created'),subject:eventEnvelope.shape.subject.extend({entityType:z.literal('ORDER')}),data:orderInput});
export const sfccInvoiceEventV1=eventEnvelope.extend({producer:z.literal('SFCC'),type:z.literal('invoice.updated'),subject:eventEnvelope.shape.subject.extend({entityType:z.literal('INVOICE')}),data:invoiceInput});
export function eventEnvelopeJsonSchema(){
 const {$schema:_dialect,...body}=zodToJsonSchema(eventEnvelope,{$refStrategy:'none',removeAdditionalStrategy:'strict'});void _dialect;
 return {$schema:'https://json-schema.org/draft/2020-12/schema',$id:'https://demo.altayer.example/schemas/event-envelope.schema.json',title:'ECS Event Envelope v1 — executable local profile',...body};
}
