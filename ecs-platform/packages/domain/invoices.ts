import {z} from 'zod';
import type {Prisma} from '@prisma/client';
import {db} from '../db/client';
import {audit} from '../db/transaction';
import {digest} from '../auth/security';
import {type Actor,scope} from '../auth/policy';
import {requireCondition} from './errors';

// A reference only: no tax calculations, invoice generation, URL fetch or payment.
const reference=z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._/-]+$/);
export const invoiceInput=z.object({
 externalOrderId:reference,channel:reference,invoiceNumber:reference,
 version:z.number().int().positive(),status:z.enum(['ISSUED','VOIDED']),
 url:z.string().url().max(1000).refine(value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash;}catch{return false;}},'Use an HTTPS document reference without credentials, query or fragment'),
 issuedAt:z.string().datetime(),shipmentIds:z.array(z.string().min(1).max(100)).min(1).max(100).refine(ids=>new Set(ids).size===ids.length,'Shipment IDs must be unique'),
}).strict();
export const demoInvoiceInput=z.object({shipmentId:z.string().min(1).max(100),invoiceNumber:reference}).strict();
export function permitInvoiceRead(actor:Actor){
 requireCondition(['ATI_SUPER_ADMIN','ATI_OPERATIONS_MANAGER','ATI_FINANCE_ANALYST','ATI_AUDITOR'].includes(actor.role),'FORBIDDEN','Customer invoice references are restricted to ATI operations, finance and audit',403);
}
export async function listShipmentInvoices(actor:Actor,shipmentId:string){
 permitInvoiceRead(actor);
 const leg=await db.fulfilmentLeg.findFirst({where:{id:shipmentId,...scope(actor)}});
 requireCondition(leg,'NOT_FOUND','Shipment not found',404);
 const items=await db.invoiceReference.findMany({where:{orderId:leg.orderId,shipmentIds:{has:leg.id}},orderBy:{issuedAt:'desc'},select:{id:true,invoiceNumber:true,version:true,status:true,url:true,issuedAt:true,shipmentIds:true,receiptId:true,updatedAt:true}});
 return {owner:'SFCC' as const,merchantOfRecord:'ATI' as const,items};
}
export async function ingestInvoice(tx:Prisma.TransactionClient,actor:Actor,input:z.infer<typeof invoiceInput>,receiptId:string,correlationId:string){
 const order=await tx.order.findFirst({where:{externalId:input.externalOrderId,channel:input.channel,companyId:actor.companyId,market:{in:actor.markets}},include:{legs:true}});
 requireCondition(order,'ORDER_NOT_FOUND','Invoice order mapping is missing',409);
 const hosts=(process.env.SFCC_INVOICE_ALLOWED_HOSTS??'sfcc.demo.invalid').split(',').map(h=>h.trim().toLowerCase()).filter(Boolean);
 requireCondition(hosts.includes(new URL(input.url).hostname.toLowerCase()),'INVOICE_HOST_NOT_ALLOWED','Invoice host is not configured for this integration');
 requireCondition(!new URL(input.url).port,'INVOICE_HOST_NOT_ALLOWED','Custom invoice URL ports are not supported');
 const legs=input.shipmentIds.map(id=>order.legs.find(leg=>leg.id===id));
 requireCondition(legs.every(Boolean),'INVOICE_SHIPMENT_MISMATCH','Every invoice shipment must belong to the scoped order');
 requireCondition(legs.every(leg=>leg&&['DISPATCHED','DELIVERED'].includes(leg.status)),'INVOICE_BEFORE_FULFILMENT','Invoice references require dispatched or delivered shipments',409);
 requireCondition(new Date(input.issuedAt)>=order.createdAt,'INVALID_INVOICE_DATE','Invoice issue date precedes the order');
 const canonical={...input,shipmentIds:[...input.shipmentIds].sort(),issuedAt:new Date(input.issuedAt).toISOString()};
 const payloadHash=digest(JSON.stringify(canonical));
 const key={companyId:order.companyId,market:order.market,channel:input.channel,invoiceNumber:input.invoiceNumber};
 const existing=await tx.invoiceReference.findUnique({where:{companyId_market_channel_invoiceNumber:key}});
 if(existing){
  requireCondition(existing.orderId===order.id,'INVOICE_ORDER_CONFLICT','Invoice number already belongs to another order',409);
  if(existing.version===input.version){requireCondition(existing.payloadHash===payloadHash,'INVOICE_VERSION_CONFLICT','Invoice revision already has different content',409);return existing;}
  requireCondition(input.version===existing.version+1,'INVOICE_VERSION_SEQUENCE','Invoice revisions must follow the current revision',409);
  requireCondition(existing.status!=='VOIDED','INVOICE_ALREADY_VOIDED','A voided invoice cannot be reissued; use a new invoice number',409);
  requireCondition(JSON.stringify(existing.shipmentIds)===JSON.stringify(canonical.shipmentIds)&&existing.issuedAt.toISOString()===canonical.issuedAt,'INVOICE_IDENTITY_CONFLICT','Issued date and shipment coverage cannot change; void and issue a new invoice',409);
 }else requireCondition(input.version===1&&input.status==='ISSUED','INVOICE_INITIAL_STATE','First invoice revision must be issued version 1',409);
 const data={...key,orderId:order.id,version:input.version,status:input.status,url:input.url,issuedAt:new Date(input.issuedAt),shipmentIds:canonical.shipmentIds,payloadHash,receiptId};
 const result=existing?await tx.invoiceReference.update({where:{id:existing.id},data}):await tx.invoiceReference.create({data});
 await audit(tx,actor,correlationId,'invoice.sfcc-reference',result.id,existing,result,'Signed SFCC reference; ECS did not generate a customer invoice');
 return result;
}
