import { z } from 'zod';
import {selectAgreement,commercialRate} from './commercials';
import Decimal from 'decimal.js';
import type { Prisma } from '@prisma/client';
import { type Actor, permit, scope } from '../auth/policy';
import { digest } from '../auth/security';
import { audit, enqueue, json, transaction } from '../db/transaction';
import { sellable, transitionLeg } from './calculations';
import { requireCondition } from './errors';
import { queueStock } from './inventory';
import {hasBrandRight} from './brand-policy';
import {hasCurrentPublication} from './publication-policy';
import {mappingReadiness} from './mappings';
import {syncSla} from './sla';

const money=z.string().regex(/^\d{1,10}(\.\d{1,2})?$/);
export const routingPolicies=['WAREHOUSE_FIRST','BRAND_FIRST','STORE_FIRST','HYBRID_WATERFALL','LOWEST_SPLIT_COUNT','MANUAL_OVERRIDE'] as const;
export const orderInput=z.object({externalOrderId:z.string().min(1).max(100),channel:z.literal('BLM-AE'),currency:z.literal('AED'),deliveryCity:z.string().min(1).max(80),routingPolicy:z.enum(routingPolicies).default('HYBRID_WATERFALL'),overrideReason:z.string().trim().min(5).max(500).optional(),manualLocations:z.record(z.string()).optional(),total:money,lines:z.array(z.object({id:z.string().min(1).max(80),sku:z.string().min(1).max(100),quantity:z.number().int().positive().max(1000),unitGross:money,vendorDiscount:money.default('0.00'),operatorDiscount:money.default('0.00')} ).strict()).min(1).max(12)}).strict();
export type OrderInput=z.infer<typeof orderInput>;
type Candidate={inventoryId:string;locationId:string;name:string;type:string;partnerId:string|null;available:number;reasons:string[]};
export type ReservedLine={id:string;sku:string;productId:string;inventoryId:string;quantity:number;unitGross:string;vendorDiscount:string;operatorDiscount:string;net:string;commissionRate:string;agreementId:string;agreementVersion:number;returnPolicy?:{version:number;days:number;handlingCharge:string}};
const rank=(c:Candidate,policy:OrderInput['routingPolicy'])=>{
  if(policy==='STORE_FIRST')return c.type==='BRAND_STORE'?0:c.partnerId?1:2;
  if(policy==='BRAND_FIRST')return c.partnerId?c.type==='BRAND_STORE'?0:1:2;
  // HYBRID and WAREHOUSE prefer ATI warehouse, then partner warehouse, then store.
  return !c.partnerId?0:c.type==='VENDOR_WAREHOUSE'?1:2;
};

/** Read-only routing plan. Intake MUST recompute this inside its reservation transaction;
 * a preview is not a reservation or a promise of later availability. */
export async function planOrder(tx:Prisma.TransactionClient,actor:Actor,input:OrderInput){
  requireCondition(new Set(input.lines.map(l=>l.id)).size===input.lines.length,'DUPLICATE_LINE_ID','Line IDs must be unique');
  requireCondition(new Set(input.lines.map(l=>l.sku)).size===input.lines.length,'DUPLICATE_SKU','Consolidate repeated SKUs into one order line');
  const now=(await tx.demoClock.findUniqueOrThrow({where:{id:'main'}})).now;
  const dubaiHour=(now.getUTCHours()+4)%24;
  const dayStart=new Date(now);dayStart.setUTCHours(-4,0,0,0);if(dayStart>now)dayStart.setUTCDate(dayStart.getUTCDate()-1);
  const plans:{line:OrderInput['lines'][number];productId:string;partnerId:string;agreementId:string;agreementVersion:number;rate:string;candidates:Candidate[]}[]=[];
  let sum=new Decimal(0);
  for(const line of input.lines){
    const product=await tx.product.findFirst({where:{sku:line.sku,companyId:actor.companyId,market:'AE'},include:{partner:{include:{agreements:true,brandRights:true}},publications:true,inventory:{include:{location:true}}}});
    requireCondition(product,'UNKNOWN_SKU',`SKU ${line.sku} has no canonical mapping`);
    requireCondition(product.saleStatus==='ENABLED'&&product.status==='PUBLISHED'&&product.partner.status==='ACTIVE'&&hasBrandRight(product.partner.brandRights,product,now)&&product.partner.markets.includes('AE'),'ITEM_NOT_SELLABLE',`${line.sku} is unpublished, paused, delisted, inactive or lacks effective brand/category/market rights`);
    requireCondition(hasCurrentPublication(product),'MAPPING_MISSING',`${line.sku} needs current ERP, Fynd and SFCC publication acknowledgements`);
    requireCondition((await mappingReadiness(tx,product.partnerId)).passed,'MAPPING_MISSING',`${line.sku} needs current brand/location provisioning evidence`);
    requireCondition(new Decimal(line.unitGross).eq(product.price),'PRICE_MISMATCH',`${line.sku} price does not match the current canonical price`);
    const gross=new Decimal(line.unitGross).mul(line.quantity),discount=new Decimal(line.vendorDiscount).plus(line.operatorDiscount);
    requireCondition(discount.lte(gross),'INVALID_DISCOUNT','Discount cannot exceed gross line value');
    sum=sum.plus(gross.minus(discount));
    const agreement=selectAgreement(product.partner.agreements,now,product.market,product.currency,product.brand);
    requireCondition(agreement,'COMMERCIALS_MISSING',`${line.sku} needs an effective agreement`);
    const categoryRate=commercialRate(agreement,product.category);
    const candidates:Candidate[]=[];
    for(const position of product.inventory){
      const loc=position.location,reasons:string[]=[];
      if(loc.companyId!==actor.companyId||loc.market!=='AE')reasons.push('Wrong company or market');
      if(loc.partnerId&&loc.partnerId!==product.partnerId)reasons.push('Location belongs to another partner');
      if(loc.status!=='ACTIVE')reasons.push('Location is inactive');
      if(!loc.fyndId)reasons.push('No Fynd location mapping');
      if(!loc.deliveryCities.some(city=>city.toLowerCase()===input.deliveryCity.toLowerCase()))reasons.push('Destination outside service area');
      if(dubaiHour>=loc.cutoffHour)reasons.push('Daily cut-off passed (Asia/Dubai)');
      const allocated=await tx.fulfilmentLeg.count({where:{locationId:loc.id,createdAt:{gte:dayStart,lte:now},status:{not:'CANCELLED'}}});
      if(allocated>=loc.dailyCapacity)reasons.push('Daily capacity exhausted');
      const available=sellable(position,true);if(available<line.quantity)reasons.push(`Insufficient ATP: ${available} available`);
      candidates.push({inventoryId:position.id,locationId:loc.id,name:loc.name,type:loc.type,partnerId:loc.partnerId,available,reasons});
    }
    candidates.sort((a,b)=>rank(a,input.routingPolicy)-rank(b,input.routingPolicy)||a.locationId.localeCompare(b.locationId));
    requireCondition(candidates.some(c=>!c.reasons.length),'NO_ROUTE',`${line.sku}: ${candidates.map(c=>`${c.name}: ${c.reasons.join(', ')}`).join('; ')||'No inventory positions'}`);
    plans.push({line,productId:product.id,partnerId:product.partnerId,agreementId:agreement.id,agreementVersion:agreement.version,rate:categoryRate??agreement.rate.toString(),candidates});
  }
  requireCondition(sum.eq(input.total),'TOTAL_MISMATCH','Order total must equal gross less vendor and operator discounts');
  let selected=plans.map(p=>p.candidates.find(c=>!c.reasons.length)!);
  if(input.routingPolicy==='MANUAL_OVERRIDE'){
    requireCondition(input.overrideReason&&input.manualLocations,'OVERRIDE_REASON_REQUIRED','Manual routing needs a reason and a location per line');
    selected=plans.map(p=>{const c=p.candidates.find(c=>c.locationId===input.manualLocations![p.line.id]);requireCondition(c&&!c.reasons.length,'INVALID_OVERRIDE',`Override for ${p.line.sku} cannot bypass eligibility gates`);return c;});
  }
  if(input.routingPolicy==='LOWEST_SPLIT_COUNT'){
    let best=selected,bestCount=new Set(best.map((c,i)=>`${plans[i].partnerId}:${c.locationId}`)).size,visits=0;
    const search=(i:number,choice:Candidate[],keys:Set<string>)=>{
      requireCondition(++visits<100000,'ROUTING_COMPLEXITY','Exact routing search exceeded the demo bound; use a priority policy');
      if(keys.size>=bestCount)return;
      if(i===plans.length){best=[...choice];bestCount=keys.size;return;}
      for(const c of plans[i].candidates.filter(c=>!c.reasons.length)){choice.push(c);search(i+1,choice,new Set([...keys,`${plans[i].partnerId}:${c.locationId}`]));choice.pop();}
    };search(0,[],new Set());selected=best;
  }
  return {now,dayStart,plans,selected};
}

export async function ingestOrder(tx:Prisma.TransactionClient,actor:Actor,input:OrderInput,correlationId:string,options:{deferFyndForPayment?:boolean}={}){
  const payloadHash=digest(JSON.stringify(input));
  const existing=await tx.order.findUnique({where:{channel_externalId:{channel:input.channel,externalId:input.externalOrderId}}});
  if(existing){requireCondition(existing.companyId===actor.companyId&&actor.markets.includes(existing.market)&&existing.payloadHash===payloadHash,'ORDER_ID_CONFLICT','Order reference already exists with different content',409);return existing;}
  const {now,dayStart,plans,selected}=await planOrder(tx,actor,input);
  const initialStatus=options.deferFyndForPayment?'AWAITING_PAYMENT':'AWAITING_FYND';
  const order=await tx.order.create({data:{companyId:actor.companyId,market:'AE',channel:input.channel,externalId:input.externalOrderId,currency:input.currency,total:input.total,payloadHash,lines:json(input.lines),deliveryCity:input.deliveryCity,routingPolicy:input.routingPolicy,status:initialStatus,correlationId,createdAt:now}});
  const groups=new Map<string,{partnerId:string;locationId:string;lines:ReservedLine[];traces:unknown[]}>();
  for(let i=0;i<plans.length;i++){
    const p=plans[i],c=selected[i],key=`${p.partnerId}:${c.locationId}`;
    await tx.inventory.update({where:{id:c.inventoryId},data:{reserved:{increment:p.line.quantity},revision:{increment:1},syncedAt:null}});
    await queueStock(tx,actor,c.inventoryId,correlationId);
    const group=groups.get(key)??{partnerId:p.partnerId,locationId:c.locationId,lines:[],traces:[]};
    const agreement=await tx.agreement.findUniqueOrThrow({where:{id:p.agreementId}});const rules=agreement.rules as {returnDays?:number;handlingCharge?:string};
    group.lines.push({...p.line,productId:p.productId,inventoryId:c.inventoryId,net:new Decimal(p.line.unitGross).mul(p.line.quantity).minus(p.line.vendorDiscount).minus(p.line.operatorDiscount).toFixed(2),commissionRate:p.rate,agreementId:p.agreementId,agreementVersion:p.agreementVersion,returnPolicy:{version:p.agreementVersion,days:rules.returnDays??30,handlingCharge:rules.handlingCharge??'20.00'}});
    group.traces.push({lineId:p.line.id,sku:p.line.sku,policy:input.routingPolicy,chosenLocation:c.locationId,reason:input.overrideReason??'Highest ranked eligible location',candidates:p.candidates});groups.set(key,group);
  }
  for(const group of groups.values()){
    const location=await tx.location.findUniqueOrThrow({where:{id:group.locationId}});
    const allocated=await tx.fulfilmentLeg.count({where:{locationId:group.locationId,createdAt:{gte:dayStart,lte:now},status:{not:'CANCELLED'}}});
    requireCondition(allocated<location.dailyCapacity,'CAPACITY_EXHAUSTED','Combined order allocations exceed location capacity');
    await tx.fulfilmentLeg.create({data:{orderId:order.id,companyId:actor.companyId,partnerId:group.partnerId,market:'AE',locationId:group.locationId,status:initialStatus,deadline:new Date(now.getTime()+60*60000),createdAt:now,lines:json(group.lines),routingTrace:json(group.traces)}});
  }
  const legs=await tx.fulfilmentLeg.findMany({where:{orderId:order.id}});
  for(const leg of legs)await syncSla(tx,'SHIPMENT',leg,correlationId);
  if(!options.deferFyndForPayment)await queueFyndOrder(tx,actor,order.id,correlationId);
  await audit(tx,actor,correlationId,'order.routed',order.id,null,{order,legs},input.overrideReason??(options.deferFyndForPayment?'Approved exchange checkout; simulated payment acknowledgement required':'Signed SFCC order intake'));
  return order;
}

export async function queueFyndOrder(tx:Prisma.TransactionClient,actor:Actor,orderId:string,correlationId:string){
 const order=await tx.order.findUniqueOrThrow({where:{id:orderId},include:{legs:true,exchangeExecution:true}});
 await enqueue(tx,actor,correlationId,'FYND','createOrder',order.id,{orderId:order.id,externalOrderId:order.externalId,merchantOfRecord:'Al Tayer Insignia LLC',currency:order.currency,total:order.total.toFixed(2),legs:json(order.legs),...(order.exchangeExecution?{exchange:order.exchangeExecution.paymentPayload}:{})},`order:${order.id}:FYND`);
}

export const legCommand=z.object({expectedVersion:z.number().int().positive(),next:z.enum(['ACCEPTED','PICKING','PACKED','READY_TO_DISPATCH','DISPATCHED','DELIVERED','CANCELLED']),tracking:z.string().trim().min(3).max(100).optional(),reason:z.string().trim().min(5).max(1000).optional(),confirmedQuantities:z.record(z.number().int().nonnegative()).optional()}).strict();
export async function commandLeg(actor:Actor,id:string,input:z.infer<typeof legCommand>,correlationId:string){
  permit(actor,'fulfilment',input.next==='DELIVERED');
  return transaction(async tx=>{
    const leg=await tx.fulfilmentLeg.findFirst({where:{id,...scope(actor)}});requireCondition(leg,'NOT_FOUND','Shipment not found',404);
    requireCondition(leg.version===input.expectedVersion&&!leg.requestedStatus,'STALE_SHIPMENT','Refresh; a transition may already be awaiting Fynd',409);
    requireCondition(leg.fyndId,'FYND_ACK_REQUIRED','Shipment must be acknowledged by Fynd first',409);
    const milestone=await syncSla(tx,'SHIPMENT',leg,correlationId,'LEGACY_OBSERVED');
    if(input.next==='CANCELLED')requireCondition(['ASSIGNED','ACCEPTED','PICKING'].includes(leg.status)&&input.reason,'CANCELLATION_BLOCKED','Only unshipped, unpacked legs can be cancelled with a reason');
    else transitionLeg(leg.status,input.next,input.tracking);
    if(input.next==='ACCEPTED')requireCondition(milestone?.status!=='BREACHED','CONFIRMATION_SLA_BREACHED','Confirmation SLA expired; an audited operator waiver is required');
    if(input.next==='PACKED')for(const line of leg.lines as ReservedLine[])requireCondition(input.confirmedQuantities?.[line.id]===line.quantity,'PICK_QUANTITY_MISMATCH',`Confirm all ${line.quantity} units of ${line.sku}`);
    const updated=await tx.fulfilmentLeg.update({where:{id},data:{requestedStatus:input.next,version:{increment:1}}});
    await enqueue(tx,actor,correlationId,'FYND','transitionShipment',id,{fyndShipmentId:leg.fyndId,from:leg.status,next:input.next,version:updated.version,tracking:input.tracking,reason:input.reason},`shipment:${id}:${updated.version}:${input.next}`,leg.partnerId);
    await audit(tx,actor,correlationId,'shipment.transition-requested',id,leg,updated,input.reason,leg.partnerId);return updated;
  });
}
