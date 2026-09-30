import {z} from 'zod';
import Decimal from 'decimal.js';
import {type Actor,isVendor,scope} from '../auth/policy';
import {transaction} from '../db/transaction';
import {requireCondition} from './errors';
export const analyticsRoles=['ATI_SUPER_ADMIN','ATI_OPERATIONS_MANAGER','ATI_FINANCE_ANALYST','ATI_AUDITOR','VENDOR_ADMIN','VENDOR_FINANCE_VIEWER'];
export function analyticsRead(actor:Actor){requireCondition(analyticsRoles.includes(actor.role),'FORBIDDEN','Your role cannot access performance reports',403);scope(actor);}
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>{const d=new Date(`${s}T00:00:00Z`);return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;},'Use a valid calendar date');
export const analyticsMarket=z.object({market:z.enum(['AE','SA','KW'])}).strict();
export const analyticsQuery=analyticsMarket.extend({from:day,to:day,partnerId:z.string().min(1).max(100).optional(),brand:z.string().min(1).max(150).optional()}).strict().refine(q=>{const d=Date.parse(q.to)-Date.parse(q.from);return d>0&&d<=366*86400000;},'Choose a positive period of at most 366 days; end date is exclusive');
const currencyFor={AE:'AED',SA:'SAR',KW:'KWD'};
const lineSchema=z.object({id:z.string(),sku:z.string(),productId:z.string(),quantity:z.number().int().positive(),unitGross:z.string().regex(/^\d+(\.\d+)?$/),net:z.string().regex(/^\d+(\.\d+)?$/)});
const pct=(n:number,d:number)=>d?new Decimal(n).div(d).mul(100).toDecimalPlaces(2).toNumber():null;
const money=(v:Decimal,currency:string)=>v.toFixed(currency==='KWD'?3:2);
export async function analyticsMetadata(actor:Actor,market:'AE'|'SA'|'KW'){
 analyticsRead(actor);scope(actor,market);return transaction(async tx=>{
  const [partners,products,clock]=await Promise.all([tx.partner.findMany({where:{companyId:actor.companyId,markets:{has:market},...(isVendor(actor)?{id:actor.partnerId!}:{})},select:{id:true,displayName:true},orderBy:{displayName:'asc'},take:2001}),tx.product.findMany({where:scope(actor,market),select:{brand:true,partnerId:true},take:10001}),tx.demoClock.findUniqueOrThrow({where:{id:'main'}})]);
  requireCondition(partners.length<=2000&&products.length<=10000,'REPORT_TOO_LARGE','Metadata exceeds local demo limits; narrow the company dataset',422);
  return {market,currency:currencyFor[market],demoNow:clock.now,partners,brands:[...new Set(products.map(p=>p.brand))].sort(),canDrillFulfilment:['ATI_SUPER_ADMIN','ATI_OPERATIONS_MANAGER','VENDOR_ADMIN'].includes(actor.role)};
 });
}
export async function performanceReport(actor:Actor,raw:z.infer<typeof analyticsQuery>){
 analyticsRead(actor);const q=analyticsQuery.parse(raw),base=scope(actor,q.market),currency=currencyFor[q.market];
 return transaction(async tx=>{
  const now=new Date(),clock=await tx.demoClock.findUniqueOrThrow({where:{id:'main'}});
  if(q.partnerId){requireCondition(!isVendor(actor)||q.partnerId===actor.partnerId,'NOT_FOUND','Partner not found',404);requireCondition(await tx.partner.findFirst({where:{id:q.partnerId,companyId:actor.companyId,markets:{has:q.market}}}),'NOT_FOUND','Partner not found',404);}
  const scoped={...base,...(q.partnerId?{partnerId:q.partnerId}:{})};
  const products=await tx.product.findMany({where:scoped,select:{id:true,brand:true,partnerId:true},take:10001});
  requireCondition(products.length<=10000,'REPORT_TOO_LARGE','Product dataset exceeds the local report limit',422);
  if(q.brand)requireCondition(products.some(p=>p.brand===q.brand),'NOT_FOUND','Brand not found in selected scope',404);
  const productMap=new Map(products.map(p=>[p.id,p]));
  const legs=await tx.fulfilmentLeg.findMany({where:{...scoped,order:{companyId:actor.companyId,market:q.market,createdAt:{gte:new Date(q.from),lt:new Date(q.to)}}},include:{order:{select:{id:true,externalId:true,currency:true,createdAt:true}}},orderBy:{id:'asc'},take:5001});
  requireCondition(legs.length<=5000,'REPORT_TOO_LARGE','More than 5,000 shipment legs match. Narrow the date/vendor filters; totals are never silently truncated.',422);
  const selected=legs.flatMap(leg=>{
   requireCondition(leg.order.currency===currency,'REPORT_CURRENCY_MISMATCH','Order currency does not match the selected market; reconcile data first',409);
   const parsed=z.array(lineSchema).safeParse(leg.lines);requireCondition(parsed.success,'REPORT_DATA_INVALID','Shipment line snapshots are invalid; reconcile data first',409);
   const lines=parsed.data.filter(l=>{const p=productMap.get(l.productId);requireCondition(p&&p.partnerId===leg.partnerId,'REPORT_DATA_INVALID','Shipment product ownership or brand mapping is unavailable; reconcile data first',409);return !q.brand||p.brand===q.brand;});
   return lines.length?[{...leg,lines}]:[];
  });
  const ids=selected.map(l=>l.id),byLeg=new Map(selected.map(l=>[l.id,l]));
  const [returns,milestones,inventory,partners]=await Promise.all([
   tx.returnCase.findMany({where:{...scoped,legId:{in:ids}},take:20001}),
   tx.slaMilestone.findMany({where:{...scoped,entityType:'SHIPMENT',entityId:{in:ids}},take:50001}),
   tx.inventory.findMany({where:{product:{...scoped,...(q.brand?{brand:q.brand}:{})},location:{companyId:actor.companyId,market:q.market}},select:{syncedAt:true},take:10001}),
   tx.partner.findMany({where:{companyId:actor.companyId,id:{in:[...new Set(selected.map(l=>l.partnerId))]}},select:{id:true,displayName:true}})
  ]);
  requireCondition(returns.length<=20000&&milestones.length<=50000&&inventory.length<=10000,'REPORT_TOO_LARGE','Related dataset exceeds local report limits; narrow the filters',422);
  const scopedReturns=returns.filter(r=>byLeg.get(r.legId)?.lines.some(l=>l.id===r.lineId&&l.productId===r.productId));
  type Bucket={id:string;name:string;orders:Set<string>;legs:Set<string>;delivered:Set<string>;units:number;deliveredUnits:number;returnedUnits:number;gmv:Decimal;deliveredSales:Decimal};
  const buckets=new Map<string,Bucket>(),brands=new Map<string,Bucket>(),days=new Map<string,{gmv:Decimal;orders:Set<string>}>();
  const bucket=(map:Map<string,Bucket>,id:string,name:string)=>{let b=map.get(id);if(!b){b={id,name,orders:new Set(),legs:new Set(),delivered:new Set(),units:0,deliveredUnits:0,returnedUnits:0,gmv:new Decimal(0),deliveredSales:new Decimal(0)};map.set(id,b);}return b;};
  let gmv=new Decimal(0),netOrdered=new Decimal(0),deliveredSales=new Decimal(0),units=0,deliveredUnits=0,cancelled=0;
  for(const leg of selected){
   const b=bucket(buckets,leg.partnerId,partners.find(p=>p.id===leg.partnerId)?.displayName??leg.partnerId),date=leg.order.createdAt.toISOString().slice(0,10),daily=days.get(date)??{gmv:new Decimal(0),orders:new Set<string>()};days.set(date,daily);daily.orders.add(leg.order.id);
   if(leg.status==='CANCELLED')cancelled++;
   for(const line of leg.lines){
    const brand=productMap.get(line.productId)!.brand,bb=bucket(brands,brand,brand),gross=new Decimal(line.unitGross).mul(line.quantity);
    for(const group of [b,bb]){group.orders.add(leg.order.id);group.legs.add(leg.id);if(leg.status!=='CANCELLED'){group.gmv=group.gmv.plus(gross);group.units+=line.quantity;}if(leg.status==='DELIVERED'){group.delivered.add(leg.id);group.deliveredUnits+=line.quantity;group.deliveredSales=group.deliveredSales.plus(line.net);}}
    if(leg.status!=='CANCELLED'){gmv=gmv.plus(gross);netOrdered=netOrdered.plus(line.net);units+=line.quantity;daily.gmv=daily.gmv.plus(gross);}
    if(leg.status==='DELIVERED'){deliveredSales=deliveredSales.plus(line.net);deliveredUnits+=line.quantity;}
   }
  }
  let receivedReturnUnits=0;
  for(const r of scopedReturns){if(!['RECEIVED','QC_FAILED','REFUND_PENDING','CLOSED'].includes(r.status))continue;receivedReturnUnits+=r.quantity;const b=buckets.get(r.partnerId),bb=brands.get(productMap.get(r.productId)!.brand);if(b)b.returnedUnits+=r.quantity;if(bb)bb.returnedUnits+=r.quantity;}
  // Cancelling a leg closes its timer but is not successful fulfilment evidence.
  const eventCompleted=milestones.filter(m=>m.origin==='EVENT'&&m.completedAt&&!m.waivedAt&&m.status!=='WAIVED'&&byLeg.get(m.entityId)?.status!=='CANCELLED');
  const onTime=eventCompleted.filter(m=>!m.breachedAt&&m.completedAt!<=m.deadline).length;
  const breaches=milestones.filter(m=>m.status==='BREACHED'&&!m.completedAt),canDrill=['ATI_SUPER_ADMIN','ATI_OPERATIONS_MANAGER','VENDOR_ADMIN'].includes(actor.role);
  const outputBucket=(b:Bucket)=>({id:b.id,name:b.name,orders:b.orders.size,shipments:b.legs.size,deliveredShipments:b.delivered.size,units:b.units,deliveredUnits:b.deliveredUnits,receivedReturnUnits:b.returnedUnits,gmv:money(b.gmv,currency),deliveredSales:money(b.deliveredSales,currency),fulfilmentRate:pct(b.delivered.size,b.legs.size),returnRate:pct(b.returnedUnits,b.deliveredUnits)});
  const sorted=(map:Map<string,Bucket>)=>[...map.values()].sort((a,b)=>b.gmv.comparedTo(a.gmv)||a.name.localeCompare(b.name)).map(outputBucket);
  const delivered=selected.filter(l=>l.status==='DELIVERED').length;
  return {filters:{market:q.market,from:q.from,to:q.to,partnerId:q.partnerId??null,brand:q.brand??null},currency,generatedAt:now,demoNow:clock.now,cohort:'ORDER_CREATED_UTC' as const,brandBasis:'CURRENT_CANONICAL_PRODUCT' as const,
   metrics:{gmv:money(gmv,currency),netOrdered:money(netOrdered,currency),deliveredSales:money(deliveredSales,currency),orders:new Set(selected.map(l=>l.order.id)).size,shipments:selected.length,deliveredShipments:delivered,cancelledShipments:cancelled,units,deliveredUnits,receivedReturnUnits,fulfilmentRate:pct(delivered,selected.length),returnRate:pct(receivedReturnUnits,deliveredUnits),slaCompliance:pct(onTime,eventCompleted.length),slaCompletedMeasured:eventCompleted.length,slaCompletedOnTime:onTime,slaLegacyExcluded:milestones.filter(m=>m.origin!=='EVENT').length,slaWaived:milestones.filter(m=>m.waivedAt||m.status==='WAIVED').length,activeBreaches:breaches.length},
   inventory:{basis:'CURRENT_WALL_CLOCK' as const,thresholdMinutes:15,positions:inventory.length,fresh:inventory.filter(r=>r.syncedAt&&now.getTime()-r.syncedAt.getTime()>=0&&now.getTime()-r.syncedAt.getTime()<=900000).length,pending:inventory.filter(r=>!r.syncedAt).length,stale:inventory.filter(r=>r.syncedAt&&(now.getTime()-r.syncedAt.getTime()>900000||r.syncedAt>now)).length},
   partners:sorted(buckets),brands:sorted(brands),trend:[...days].sort(([a],[b])=>a.localeCompare(b)).map(([date,b])=>({date,gmv:money(b.gmv,currency),orders:b.orders.size})),
   canDrillFulfilment:canDrill,breaches:canDrill?breaches.sort((a,b)=>a.deadline.getTime()-b.deadline.getTime()).slice(0,50).map(m=>({id:m.id,shipmentId:m.entityId,partnerId:m.partnerId,partnerName:partners.find(p=>p.id===m.partnerId)?.displayName??m.partnerId,stage:m.stage,deadline:m.deadline,orderReference:byLeg.get(m.entityId)!.order.externalId})):[],breachListLimit:50};
 });
}
/** CSV-safe cells: quoted and protected against spreadsheet formula interpretation. */
export const csvCell=(value:string|number|null)=>{let s=String(value??'');if(/^[\s]*[=+\-@]/.test(s)||/^[\t\r\n]/.test(s))s=`'${s}`;return `"${s.replaceAll('"','""')}"`;};
export function performanceCsv(report:Awaited<ReturnType<typeof performanceReport>>){
 const rows:(string|number|null)[][]=[['ECS scoped operational report — not a settlement or live Fynd report'],['Market',report.filters.market,'Currency',report.currency,'From UTC inclusive',report.filters.from,'To UTC exclusive',report.filters.to],['Partner filter',report.filters.partnerId??'All authorized','Brand filter',report.filters.brand??'All authorized'],['Generated at',report.generatedAt.toISOString(),'Business clock',report.demoNow.toISOString()],['GMV excludes cancelled legs; delivered sales are before return refunds; brand is current canonical mapping'],['Metric','Value'],...Object.entries(report.metrics),['Vendor ID','Vendor','Orders','Shipments','Delivered shipments','GMV','Delivered net sales','Return units','Fulfilment %','Return %'],...report.partners.map(p=>[p.id,p.name,p.orders,p.shipments,p.deliveredShipments,p.gmv,p.deliveredSales,p.receivedReturnUnits,p.fulfilmentRate,p.returnRate]),['Brand','Orders','Shipments','GMV','Delivered net sales'],...report.brands.map(b=>[b.name,b.orders,b.shipments,b.gmv,b.deliveredSales]),['Order date UTC','Orders','GMV'],...report.trend.map(d=>[d.date,d.orders,d.gmv])];rows.push(['SLA: completed event-timed, non-waived milestones on non-cancelled legs only'],['Return rate: physically received units / delivered units, not requested returns'],['Order and mixed-brand shipment counts overlap across groups; do not sum distinct counts'],['Inventory: current mock acknowledgement age using wall clock, independent of order cohort'],['Inventory positions',report.inventory.positions,'Within 15 minutes',report.inventory.fresh,'Stale or clock anomaly',report.inventory.stale,'Not acknowledged',report.inventory.pending]);return '\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
