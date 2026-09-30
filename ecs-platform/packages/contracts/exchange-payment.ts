import {z} from 'zod';
const id=z.string().min(1).max(150),money=z.string().regex(/^\d{1,10}\.\d{2}$/);
/** Local simulator v1, NOT a claimed native SFCC/Fynd payment API. */
export const exchangePaymentPayload=z.object({schemaVersion:z.literal('1.0'),exchangeId:id,orderId:id,externalOrderId:id,companyId:id,partnerId:id,market:z.literal('AE'),currency:z.literal('AED'),amount:money,policy:z.literal('REFUND_AND_REPURCHASE_DEMO_V1'),simulatedCustomerAcceptance:z.literal(true),actualMoneyMoved:z.literal(false)}).strict();
export const exchangePaymentReceipt=exchangePaymentPayload.extend({status:z.enum(['CAPTURED','REFUNDED']),reference:id}).strict();
export const exchangePurchaseReceipt=exchangePaymentReceipt.extend({status:z.literal('CAPTURED')}).strict();
export const exchangeRefundReceipt=exchangePaymentReceipt.extend({status:z.literal('REFUNDED')}).strict();
const paymentResultBase=z.object({externalId:id,mode:z.literal('mock'),system:z.literal('SFCC')}).strict();
export const exchangePaymentResult=z.discriminatedUnion('operation',[
 paymentResultBase.extend({operation:z.literal('purchaseExchange'),payment:exchangePurchaseReceipt}).strict(),
 paymentResultBase.extend({operation:z.literal('refundExchangePurchase'),payment:exchangeRefundReceipt}).strict(),
]);
export type ExchangePaymentPayload=z.infer<typeof exchangePaymentPayload>;
export const exchangeCancellationPayload=exchangePaymentPayload.extend({shipmentIds:z.array(id).min(1).max(20).refine(ids=>new Set(ids).size===ids.length,'Shipment IDs must be unique')}).strict();
const purchaseOutcome=z.discriminatedUnion('resolution',[
 z.object({resolution:z.literal('VOIDED'),purchase:z.null()}).strict(),
 z.object({resolution:z.literal('CAPTURED'),purchase:exchangePurchaseReceipt}).strict(),
]);
export const exchangeCancellationResult=z.discriminatedUnion('system',[
 z.object({externalId:id,mode:z.literal('mock'),system:z.literal('SFCC'),operation:z.literal('cancelExchangePurchase'),intent:exchangeCancellationPayload,outcome:purchaseOutcome}).strict(),
 z.object({externalId:id,mode:z.literal('mock'),system:z.literal('FYND'),operation:z.literal('cancelExchangeOrder'),intent:exchangeCancellationPayload,outcome:z.object({resolution:z.literal('FENCED'),orderExisted:z.boolean()}).strict()}).strict(),
]);
