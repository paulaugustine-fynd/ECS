import {z,type ZodTypeAny} from 'zod';
import {exchangePaymentReceipt,exchangeCancellationResult} from './exchange-payment';

const text=z.string(),date=text.datetime(),integer=z.number().int(),money=text.regex(/^\d+(?:\.\d+)?$/);
const policy=z.object({version:integer.positive(),days:integer.nonnegative(),handlingCharge:money}).strict();
const inputLine=z.object({id:text,sku:text,quantity:integer.positive(),unitGross:money,vendorDiscount:money,operatorDiscount:money}).strict();
export const reservedLineResponse=inputLine.extend({productId:text,inventoryId:text,net:money,commissionRate:money,agreementId:text,agreementVersion:integer.positive(),returnPolicy:policy.optional()});
const candidate=z.object({inventoryId:text,locationId:text,name:text,type:text,partnerId:text.nullable(),available:integer.nonnegative(),reasons:z.array(text)}).strict();
const trace=z.object({lineId:text,sku:text,policy:text,chosenLocation:text,reason:text,candidates:z.array(candidate)}).strict();
// Historical deliveries are explicitly identified, not presented as routed live orders.
export const routingTraceResponse=z.union([z.array(trace),z.object({fixture:z.literal(true),explanation:text}).strict()]);
export const shipmentResponse=z.object({id:text,orderId:text,companyId:text,partnerId:text,market:text,locationId:text,status:text,fyndId:text.nullable(),tracking:text.nullable(),version:integer.positive(),requestedStatus:text.nullable(),createdAt:date,deadline:date,deliveredAt:date.nullable(),lines:z.array(reservedLineResponse),routingTrace:routingTraceResponse}).strict();
const orderReference=z.object({externalId:text,currency:text}).strict();
export const shipmentDetailResponse=shipmentResponse.extend({order:orderReference});
const order=z.object({id:text,companyId:text,market:text,channel:text,externalId:text,currency:text,total:money,status:text,fyndId:text.nullable(),correlationId:text,payloadHash:text,lines:z.array(z.union([inputLine,reservedLineResponse])),deliveryCity:text,routingPolicy:text,createdAt:date,legs:z.array(shipmentResponse)}).strict();
// The discriminator is important: a vendor result cannot contain an order total
// or a nested collection of other partners' legs.
export const orderListResponse=z.discriminatedUnion('view',[
 z.object({view:z.literal('orders'),items:z.array(order)}).strict(),
 z.object({view:z.literal('shipments'),items:z.array(shipmentDetailResponse)}).strict(),
]);
const qcDecision=z.object({condition:z.enum(['GOOD','BAD']),disposition:z.enum(['RESTOCK','QUARANTINE']),reason:text,actorId:text,decidedAt:date,evidenceIds:z.array(text)}).strict();
const returnPolicy=policy.extend({daysSinceDelivery:z.number().nonnegative(),deliveredAt:date,line:reservedLineResponse,inventoryId:text,totalPayable:money,customerNet:money,operatorOverrides:z.array(z.never()),refundOverride:z.object({reason:text,actorId:text}).strict().optional(),qcDecision:qcDecision.optional()});
export const returnEvidenceResponse=z.object({id:text,returnId:text,returnVersion:integer.positive(),fileName:text,notes:text,checksum:text.regex(/^[a-f0-9]{64}$/),originalChecksum:text.regex(/^[a-f0-9]{64}$/),contentType:z.literal('image/png'),byteSize:integer.positive(),width:integer.positive(),height:integer.positive(),scanStatus:z.literal('MOCK_CLEAN'),actorId:text,createdAt:date}).strict();
export const returnResponse=z.object({id:text,companyId:text,partnerId:text,market:text,legId:text,lineId:text,requestKey:text,version:integer.positive(),fyndReturnId:text.nullable(),logisticsId:text.nullable(),refundId:text.nullable(),productId:text,quantity:integer.positive(),status:text,reason:text,policy:returnPolicy,qc:text.nullable(),refund:money,payableReversal:money,chargeback:money,currency:text,refundStatus:text,replacementOrderId:text.nullable(),createdAt:date}).strict();
export const exchangePreviewResponse=z.object({
 returnId:text,returnVersion:integer.positive(),asOf:date,policy:z.literal('REFUND_AND_REPURCHASE_DEMO_V1'),quantity:integer.positive(),currency:z.literal('AED'),
 original:z.object({orderId:text,shipmentId:text,lineId:text,productId:text,sku:text,size:text.nullable()}).strict(),
 replacement:z.object({productId:text,sku:text,size:text.nullable(),version:integer.positive(),saleVersion:integer.positive(),unitPrice:money}).strict(),
 pricing:z.object({originalRefund:money,replacementCharge:money,difference:text.regex(/^-?\d+\.\d{2}$/),direction:z.enum(['EVEN','ADDITIONAL_COST','LOWER_COST']),discountsCarriedForward:z.literal(false)}).strict(),
 deliveryCity:text,routingPolicy:z.enum(['HYBRID_WATERFALL','WAREHOUSE_FIRST','STORE_FIRST','BRAND_FIRST']),
 route:z.object({locationId:text,name:text,type:text,available:integer.nonnegative(),inventoryId:text,inventoryRevision:integer.positive()}).strict().nullable(),
 blockers:z.array(z.object({code:text,message:text}).strict()),eligibility:z.enum(['BLOCKED','ELIGIBLE_AT_PREVIEW']),reserved:z.literal(false),replacementCreated:z.literal(false),notice:text,
}).strict();
export const exchangeRequestResponse=z.object({id:text,companyId:text,partnerId:text,market:text,returnId:text,replacementProductId:text,actorId:text,status:z.enum(['REQUESTED','APPROVED','REJECTED','CANCELLED']),version:integer.positive(),reason:text,quantity:integer.positive(),currency:z.literal('AED'),replacementTotal:money,snapshot:exchangePreviewResponse,createdAt:date,cancelledAt:date.nullable(),cancelledBy:text.nullable(),cancellationReason:text.nullable(),reviewAction:z.enum(['APPROVED','REJECTED']).nullable(),reviewedAt:date.nullable(),reviewedBy:text.nullable(),reviewReason:text.nullable(),reviewSnapshot:exchangePreviewResponse.nullable(),executionId:text.nullable()}).strict();
export const exchangeExecutionResponse=z.object({id:text,exchangeId:text,returnId:text,orderId:text,externalOrderId:text,orderStatus:text,paymentStatus:z.enum(['PENDING','CAPTURED','REFUND_PENDING','REFUNDED','VOIDED']),version:integer.positive(),currency:z.literal('AED'),amount:money,createdAt:date,holdExpiresAt:date,cancellation:z.object({id:text,status:z.enum(['REQUESTED','REFUND_PENDING','COMPLETED']),cause:z.enum(['OPERATOR_CANCELLED','PAYMENT_HOLD_EXPIRED']),reason:text,createdAt:date,completedAt:date.nullable(),sfccReceipt:exchangeCancellationResult.options[0].nullable(),fyndReceipt:exchangeCancellationResult.options[1].nullable()}).strict().nullable(),purchaseReceipt:exchangePaymentReceipt.nullable(),refundReceipt:exchangePaymentReceipt.nullable(),shipments:z.array(z.object({id:text,status:text,fyndId:text.nullable(),locationId:text}).strict()),actualMoneyMoved:z.literal(false)}).strict();
const exchangeMutationResponse=z.object({request:exchangeRequestResponse,replayed:z.boolean()}).strict();
const simulatedReceipt=z.union([
 z.object({receiptId:text,duplicate:z.literal(true),sourceMode:z.literal('signed-sfcc-simulator')}).strict(),
 z.object({receiptId:text,status:z.literal('PENDING'),sourceMode:z.literal('signed-sfcc-simulator')}).strict(),
]);
export const invoiceListResponse=z.object({owner:z.literal('SFCC'),merchantOfRecord:z.literal('ATI'),items:z.array(z.object({id:text,invoiceNumber:text,version:integer.positive(),status:z.enum(['ISSUED','VOIDED']),url:text.url(),issuedAt:date,shipmentIds:z.array(text),receiptId:text,updatedAt:date}).strict())}).strict();
const milestone=z.object({id:text,companyId:text,partnerId:text,market:text,entityType:z.enum(['SHIPMENT','RETURN']),entityId:text,stage:text,status:z.enum(['ON_TRACK','AT_RISK','BREACHED','RESOLVED','WAIVED']),version:integer.positive(),policyVersion:integer.nonnegative(),origin:text,startedAt:date,atRiskAt:date,deadline:date,breachedAt:date.nullable(),completedAt:date.nullable(),waivedAt:date.nullable(),waivedBy:text.nullable(),reason:text.nullable()}).strict();
const slaPolicy=z.object({stage:text,version:integer.nonnegative(),durationMinutes:integer.positive(),warningMinutes:integer.positive(),source:z.enum(['CONFIGURED','DEMO_DEFAULT'])}).strict();
export const fulfilmentResponseSchemas:Record<string,ZodTypeAny>={
 'GET /api/v1/returns/{id}/exchanges':z.object({items:z.array(exchangeRequestResponse).max(100),hasMore:z.boolean()}).strict(),
 'POST /api/v1/returns/{id}/exchanges':exchangeMutationResponse,
 'POST /api/v1/exchanges/{id}/cancel':exchangeMutationResponse,
 'POST /api/v1/exchanges/{id}/review':exchangeMutationResponse,
 'GET /api/v1/exchanges/{id}/checkout':exchangeExecutionResponse,
 'POST /api/v1/exchanges/{id}/checkout':z.object({execution:exchangeExecutionResponse,replayed:z.boolean()}).strict(),
 'POST /api/v1/exchanges/{id}/checkout/cancel':z.object({execution:exchangeExecutionResponse,replayed:z.boolean()}).strict(),
 'GET /api/v1/returns/{id}/exchange-options':z.object({returnId:text,returnVersion:integer.positive(),hasMore:z.boolean(),items:z.array(z.object({id:text,sku:text,title:text,size:text.nullable(),unitPrice:money,currency:text,status:text,saleStatus:text}).strict()).max(50),notice:text}).strict(),
 'POST /api/v1/returns/{id}/exchange-preview':exchangePreviewResponse,
 'GET /api/v1/returns/{id}/evidence':z.object({items:z.array(returnEvidenceResponse)}).strict(),
 'POST /api/v1/returns/{id}/evidence':z.object({evidence:returnEvidenceResponse,replayed:z.boolean()}).strict(),
 'GET /api/v1/slas/queue':z.object({now:date,page:integer.positive(),limit:integer.positive(),total:integer.nonnegative(),metrics:z.object({onTrack:integer.nonnegative(),atRisk:integer.nonnegative(),breached:integer.nonnegative(),waived:integer.nonnegative(),resolved:integer.nonnegative(),breachedEver:integer.nonnegative()}).strict(),items:z.array(milestone.extend({partnerName:text}))}).strict(),
 'GET /api/v1/slas/policies':z.object({market:text,appliesTo:z.literal('NEW_MILESTONES_ONLY'),items:z.array(slaPolicy)}).strict(),
 'POST /api/v1/slas/policies':slaPolicy,
 'GET /api/v1/slas':z.object({now:date,items:z.array(milestone)}).strict(),
 'POST /api/v1/slas/{id}/waive':milestone,
 'GET /api/v1/shipments/{id}/invoices':invoiceListResponse,
 'POST /api/v1/demo/invoices':simulatedReceipt,
 'GET /api/v1/orders':orderListResponse,
 'GET /api/v1/shipments':z.object({items:z.array(shipmentDetailResponse)}).strict(),
 'GET /api/v1/shipments/{id}':shipmentDetailResponse,
 'POST /api/v1/shipments/{id}/commands':shipmentResponse,
 'POST /api/v1/demo/orders':simulatedReceipt,
 'GET /api/v1/returns':z.object({items:z.array(returnResponse)}).strict(),
 'POST /api/v1/returns':returnResponse,
 'GET /api/v1/returns/{id}':returnResponse,
 'POST /api/v1/returns/{id}/commands':returnResponse,
};
