import {z} from 'zod';
import Decimal from 'decimal.js';
import {coachSteps,coachDefaults} from './coach-catalog';

const text=z.string(),n=z.number().finite(),scalar=z.union([text,n,z.boolean()]);
export const coachInput=z.record(scalar);
export const coachCommand=z.object({expectedVersion:z.number().int().positive(),commandId:z.string().uuid(),step:text,values:coachInput,fail:z.boolean().default(false)}).strict();
export const coachStart=z.object({requestId:z.string().uuid()}).strict();
const product=z.object({sku:text,title:text,arabic:text,category:text,colour:text,parent:text,location:text,image:text,price:n,paid:text,onHand:z.number().int().nonnegative(),reserved:z.number().int().nonnegative(),damaged:z.number().int().nonnegative(),safety:z.number().int().nonnegative(),approved:z.boolean(),published:z.boolean(),visible:z.boolean(),approval:text}).strict();
const leg=z.object({id:text,partner:text,product:text,quantity:z.number().int().positive(),location:text,state:text,tracking:text}).strict();
const entry=z.object({id:text,kind:text,product:text,gross:text,tax:text,commission:text,fee:text}).strict();
const history=z.object({id:text,step:text,title:text,owner:text,at:text.datetime(),result:text,system:text,status:z.enum(['done','needs_attention']),key:text,values:coachInput}).strict();
export const coachRun=z.object({id:text.uuid(),version:z.number().int().positive(),cursor:z.number().int().nonnegative(),createdAt:text.datetime(),updatedAt:text.datetime(),status:z.enum(['in_progress','needs_attention','complete']),partnerStatus:text,profile:coachInput,terms:coachInput,checks:z.record(z.boolean()),products:z.array(product),legs:z.array(leg),ledger:z.array(entry),facts:coachInput,history:z.array(history).max(240),commands:z.record(text),statement:z.object({sales:text,tax:text,commission:text,charges:text,payable:text,locked:z.boolean()}).nullable()}).strict();
export type CoachRun=z.infer<typeof coachRun>;
export type CoachValues=z.infer<typeof coachInput>;
export const coachResponse=z.object({run:coachRun}).strict();
export const coachListResponse=z.object({runs:z.array(coachRun)}).strict();
const money=(v:Decimal.Value)=>new Decimal(v).toDecimalPlaces(2,Decimal.ROUND_HALF_UP).toFixed(2);
const assert=(condition:unknown,message:string)=>{if(!condition)throw new Error(message);};
const count=(v:unknown)=>Number(v);
export const coachAvailable=(p:CoachRun['products'][number],active=true)=>active?Math.max(0,p.onHand-p.reserved-p.damaged-p.safety):0;
export function startCoach(id:string,now:string):CoachRun{
 return {id,version:1,cursor:0,createdAt:now,updatedAt:now,status:'in_progress',partnerStatus:'Not invited',profile:{brand:'Coach UAE',market:'UAE',currency:'AED'},terms:{},checks:{},products:[],legs:[],ledger:[],facts:{},history:[],commands:{},statement:null};
}
function validateValues(step:typeof coachSteps[number],values:CoachValues){
 const expected=step.fields.map(f=>f.key);
 assert(Object.keys(values).every(k=>expected.includes(k)),'This form contains an unexpected field. Refresh and try again.');
 for(const f of step.fields){
  const v=values[f.key];
  if(f.kind==='number'){assert(typeof v==='number'&&Number.isFinite(v)&&v>=(f.min??0)&&v<=(f.max??100000),`Enter a valid ${f.label.toLowerCase()}.`);if(['stock','safety','quantity','packed','walletPacked','received','day','receiptDay','hours','deadline','window','grace'].includes(f.key))assert(Number.isInteger(v),`${f.label} must be a whole number.`);}
  else if(f.kind==='checkbox')assert(typeof v==='boolean',`Choose ${f.label.toLowerCase()}.`);
  else {assert(typeof v==='string'&&v.trim().length>0&&v.length<=500,`Complete ${f.label.toLowerCase()}.`);if(f.kind==='email')assert(z.string().email().safeParse(v).success,'Enter a valid fictional email address.');if(f.options)assert(f.options.includes(String(v)),'Choose one of the available options.');}
 }
 if('reason' in values)assert(String(values.reason).trim().length>=5,'Add a decision note of at least five characters.');
}
function products():CoachRun['products']{
 return [
  ['COACH-BAG-BLK','Coach leather shoulder bag — demo','حقيبة كتف جلدية من Coach — نموذج تجريبي','Bags','Black','COACH-SHOULDER','Coach warehouse',1800],
  ['COACH-BAG-TAN','Coach leather shoulder bag, tan — demo','حقيبة كتف بلون بني من Coach — نموذج تجريبي','Bags','Tan','COACH-SHOULDER','ATI warehouse',1800],
  ['COACH-WALLET-BLK','Coach compact wallet — demo','محفظة سوداء من Coach — نموذج تجريبي','Wallets','Black','COACH-WALLET','Coach store',650],
  ['COACH-WALLET-TAN','Coach compact wallet, tan — demo','محفظة بنية من Coach — نموذج تجريبي','Wallets','Tan','COACH-WALLET','Coach store',700],
  ['COACH-CARDHOLDER','Coach cardholder — demo','حافظة بطاقات من Coach — نموذج تجريبي','Wallets','Brown','COACH-CARD','Coach store',350],
 ].map(([sku,title,arabic,category,colour,parent,location,price])=>({sku:String(sku),title:String(title),arabic:String(arabic),category:String(category),colour:String(colour),parent:String(parent),location:String(location),price:Number(price),paid:money(price),image:'/demo-assets/maz-bag-tan.svg',onHand:0,reserved:0,damaged:0,safety:0,approved:false,published:false,visible:false,approval:'Awaiting review'}));
}
function financialEntry(r:CoachRun,id:string,kind:string,p:CoachRun['products'][number],amount:string,fee=0){
 assert(!r.ledger.some(e=>e.id===id),'This financial entry has already been recorded.');
 const gross=new Decimal(amount),tax=gross.minus(gross.div(new Decimal(1).plus(count(r.terms.tax)/100))).toDecimalPlaces(2,Decimal.ROUND_HALF_UP);
 const rate=count(p.category==='Wallets'?r.terms.walletCommission:r.terms.commission);
 r.ledger.push({id,kind,product:p.sku,gross:money(gross),tax:money(tax),commission:money(gross.minus(tax).mul(rate).div(100)),fee:money(fee)});
}
export function coachTotals(r:CoachRun){
 const sum=(key:'gross'|'tax'|'commission'|'fee')=>r.ledger.reduce((v,e)=>v.plus(e[key]),new Decimal(0));
 return {sales:money(sum('gross')),tax:money(sum('tax')),commission:money(sum('commission')),charges:money(sum('fee')),payable:money(sum('gross').minus(sum('tax')).minus(sum('commission')).minus(sum('fee'))),locked:false};
}
/** Each action changes one saved journey. External outcomes are deterministic demo responses. */
export function advanceCoach(current:CoachRun,c:z.infer<typeof coachCommand>,now:string):CoachRun{
 const signature=JSON.stringify({step:c.step,values:Object.entries(c.values).sort(([a],[b])=>a.localeCompare(b)),fail:c.fail});
 if(current.commands[c.commandId]){assert(current.commands[c.commandId]===signature,'This action reference was already used with different details.');return current;}
 assert(current.version===c.expectedVersion,'This journey was updated in another tab. Refresh to continue.');
 assert(current.history.length<240,'This demonstration has reached its history limit. Start a new journey; this one remains saved.');
 const step=coachSteps[current.cursor];assert(step&&c.step===step.id,'Complete the highlighted step before moving on.');
 validateValues(step,c.values);
 const r=structuredClone(current),v=c.values;
 const key=`coach:${r.id}:${step.id}`;
 let result=step.result;
 if(c.fail){
  assert(step.system,'This step has no external update to interrupt.');
  r.status='needs_attention';result=`${step.system} did not respond. Nothing was changed. Try the same action again.`;
 }else{
  switch(step.id){
   case 'invite':r.profile.email=v.email;r.partnerStatus='Invited';r.facts.invitation=`COACH-${r.id.slice(0,8)}`;r.facts.invitationEmail='Preview only — not sent';break;
   case 'apply':assert(v.documents&&v.consent,'Attach the sample documents and confirm that the details are fictional.');r.profile={...r.profile,...v};r.facts.documentVersion=1;r.facts.documentNames='Sample trade licence, tax certificate, bank letter';r.partnerStatus='Awaiting ATI review';break;
   case 'request-info':r.partnerStatus='Correction requested';r.facts.reviewMessage=v.reason;break;
   case 'correct':assert(v.documents,'Attach the corrected sample licence.');assert(/^\d{4}-\d{2}-\d{2}$/.test(String(v.expiry))&&Number.isFinite(Date.parse(String(v.expiry)))&&new Date(String(v.expiry)).toISOString().slice(0,10)===v.expiry&&Date.parse(String(v.expiry))>Date.parse(r.createdAt),'Choose a valid licence expiry after the date this journey started.');r.facts.documentVersion=2;r.facts.documentExpiry=v.expiry;r.partnerStatus='Resubmitted for review';break;
   case 'approve':assert(r.facts.documentVersion===2,'Review the corrected document first.');r.checks.documents=true;r.checks.erp=true;r.profile.access=v.access;r.facts.erpVendor=`DEMO-ERP-COACH-${r.id.slice(0,8)}`;r.partnerStatus='Approved — preparing for launch';r.facts.accessBoundary='Coach views Coach records only; ATI sees the full demonstration';break;
   case 'terms':r.terms={...v,version:1};r.checks.terms=true;break;
   case 'rights':r.checks.rights=true;r.facts.authorisation='Coach · UAE · Bags and Wallets';r.facts.authorisationEvidence=v.evidence;break;
   case 'locations':r.profile={...r.profile,...v};r.checks.locations=true;r.facts.locationReceipt=`DEMO-FYND-LOC-${r.id.slice(0,8)}`;break;
   case 'import':r.products=products();r.facts.catalogueSource=v.source;r.facts.assetSource=v.assets;r.facts.receivedRows=6;r.facts.fileIssues='One duplicate bag; one missing Arabic title';r.products[0].arabic='';break;
   case 'validate':assert(v.removeDuplicate,'Exclude the duplicate row before proceeding.');assert(v.colourMapping==='Colour','Supplier “shade” describes the colour. Map it to Colour.');r.products[0].price=count(v.price);r.products[0].paid=money(v.price as number);r.products[2].price=count(v.walletPrice);r.products[2].paid=money(v.walletPrice as number);r.facts.duplicateRowsRemoved=1;r.facts.mapping='shade → Colour; two bag colours and two wallet colours grouped under their styles';r.facts.validProducts=5;break;
   case 'images':assert(v.consent&&v.rejectPoorImage,'Confirm sample-asset use and reject the low-resolution example.');r.checks.images=true;r.facts.imageJob='Sample lifestyle illustration returned; no image-generation service called';r.facts.imageReview='Five sample product illustrations accepted; low-resolution example rejected';break;
   case 'translate':assert(/[\u0600-\u06ff]/.test(String(v.arabic)),'Enter an Arabic product name before approval.');r.products[0].title=String(v.english);r.products[0].arabic=String(v.arabic);r.checks.languages=true;break;
   case 'catalogue-review':assert(r.checks.images&&r.checks.languages,'Complete image and language review first.');assert(v.manualReview||r.products.every(p=>v.trusted&&p.price<=count(v.threshold)),'Approve the products above the automatic-review limit.');for(const p of r.products){p.approval=v.trusted&&p.price<=count(v.threshold)?'Automatic approval; ATI sample review retained':'ATI manual approval';p.approved=true;}r.checks.catalogue=true;r.facts.trustThreshold=v.threshold;break;
   case 'promotion':{const paid=new Decimal(r.products[0].price).mul(new Decimal(100).minus(count(v.discount))).div(100);assert(paid.gte(count(r.terms.floor))||v.override,'The discounted bag price is below the agreed minimum. Reduce the discount or approve an exception.');r.products[0].paid=money(paid);r.terms.discount=v.discount;r.facts.promotionFunding='Coach — illustrative partner-funded promotion';r.facts.priceException=paid.lt(count(r.terms.floor));break;}
   case 'publish':assert(r.products.length===5&&r.products.every(p=>p.approved&&p.arabic)&&r.checks.erp&&r.checks.rights&&r.checks.locations,'Finish the collection review, selling permission and business setup before publishing.');for(const p of r.products)p.published=true;r.checks.published=true;r.facts.publicationOrder='ERP accepted → Fynd accepted → storefront accepted';break;
   case 'stock':assert(count(v.stock)>count(v.safety),'Keep the safety buffer below physical stock.');for(const p of r.products){p.onHand=count(v.stock);p.safety=count(v.safety);}r.checks.stock=true;r.facts.stockShared='Fynd and storefront: zero until partner activation';break;
   case 'storefront':assert(v.checked,'Review the product previews before confirming.');assert(r.products.every(p=>p.published&&p.title&&p.arabic&&p.approved),'Some product content is not yet approved and published.');for(const p of r.products)p.visible=true;r.checks.visible=true;r.facts.customerSeller='Bloomingdale’s UAE · Al Tayer Insignia';break;
   case 'test':assert(['documents','erp','terms','rights','locations','catalogue','published','stock','visible'].every(k=>r.checks[k]),'Complete all launch preparation checks first.');assert(r.products.every(p=>coachAvailable(p)>0),'At least one available unit per product is needed for this demonstration.');r.checks.test=true;r.facts.launchChecks='8 of 8 passed: allocate, accept, pick, pack, ready, dispatch, deliver, storefront confirmation';r.facts.launchStockConsumed=0;break;
   case 'activate':assert(['documents','erp','terms','rights','locations','published','stock','visible','test'].every(k=>r.checks[k])&&r.products.every(p=>p.visible),'Complete the launch checklist before opening sales.');r.partnerStatus='Active';r.checks.active=true;break;
   case 'warehouse':r.products[1].onHand+=count(v.received);r.facts.purchaseOrder=`COACH-PO-${r.id.slice(0,8)}`;r.facts.originalDeliverySlot='09:00–10:00 — full; superseded';r.facts.deliverySlot=v.slot;r.facts.warehouseReceived=v.received;break;
   case 'order':{assert(r.partnerStatus==='Active','Coach must be active before receiving a new order.');const bag=r.products[0],wallet=r.products[2];assert(coachAvailable(bag)>=count(v.quantity)&&coachAvailable(wallet)>=1,'There is not enough available stock. Reduce the bag quantity or start a new journey with more stock.');bag.reserved+=count(v.quantity);wallet.reserved++;r.facts.orderId=`COACH-ORDER-${r.id.slice(0,8)}`;r.facts.routing=v.routing;r.facts.routingExplanation=`${v.routing}: consider the preferred location first; use the mapped in-stock location when preferred stock is unavailable.`;r.legs=[{id:'BAG',partner:'Coach UAE',product:bag.sku,quantity:count(v.quantity),location:String(r.profile.warehouse),state:'Assigned',tracking:''},{id:'WALLET',partner:'Coach UAE',product:wallet.sku,quantity:1,location:String(r.profile.store),state:'Assigned',tracking:''},{id:'OTHER',partner:'Other demonstration partner',product:'SAMPLE-BEAUTY-ITEM',quantity:1,location:'Other partner warehouse',state:'Assigned',tracking:''}];financialEntry(r,'bag-sale','Sale',bag,money(new Decimal(bag.paid).mul(count(v.quantity))),count(r.terms.shipping));financialEntry(r,'wallet-sale','Sale',wallet,wallet.paid);r.facts.invoice=`DEMO-SFCC-INVOICE-${r.id.slice(0,8)}`;break;}
   case 'pack':assert(count(v.packed)===r.legs[0].quantity&&count(v.walletPacked)===r.legs[1].quantity,'Packed quantities must match the assigned bag and wallet quantities.');for(const l of r.legs.filter(l=>l.partner==='Coach UAE'))l.state='Packed';r.facts.packingDocument='Bloomingdale’s packing slip and sample carrier label — not valid for shipping';break;
   case 'pause':r.partnerStatus='Paused';r.facts.pausedProduct=r.products[0].sku;r.facts.pauseReason=v.reason;r.facts.pausedAvailability=0;break;
   case 'deliver':for(const l of r.legs){if(l.partner==='Coach UAE'){assert(l.state==='Packed','Pack the Coach parcel before dispatch.');const p=r.products.find(p=>p.sku===l.product)!;p.onHand-=l.quantity;p.reserved-=l.quantity;}l.state='Delivered';l.tracking=`${v.tracking}-${l.id}`;}r.facts.deliverySequence='Coach bag delivered → Coach wallet delivered → other partner parcel delivered';break;
   case 'restore':r.partnerStatus='Active';r.facts.pausedProduct='None';r.facts.restoredAvailability=coachAvailable(r.products[0]);break;
   case 'collection':assert(v.code==='4826','That collection code does not match. The item has not been handed over. Use the sample code 4826.');assert(coachAvailable(r.products[4])>=1,'The cardholder is not available for collection.');r.products[4].onHand--;r.facts.collection='Collected once; separate cardholder order';financialEntry(r,'collection-sale','Store collection sale',r.products[4],r.products[4].paid);break;
   case 'delay':r.facts.delayHours=v.hours;r.facts.delayDeadline=v.deadline;r.facts.delayStatus=count(v.hours)>=count(v.deadline)?'Late':count(v.hours)>=count(v.deadline)*0.75?'Due soon':'On time';r.facts.alertRecipient=v.recipient;r.facts.alertPreview=count(v.hours)>=count(v.deadline)*0.75?'Private partner and ATI notice prepared; not emailed':'No warning needed';r.facts.escalation=count(v.hours)>=count(v.deadline)*2?'Second reminder and ATI escalation':'No repeat escalation';r.facts.delayResolution=v.reason;break;
   case 'return':assert(r.legs[0]?.state==='Delivered','A delivered bag is required before requesting a return.');assert(count(v.day)<=count(r.terms.window),`This request is outside the ${r.terms.window}-day customer return period. No pickup or refund was created.`);r.facts.returnId=`COACH-RETURN-${r.id.slice(0,8)}`;r.facts.returnRequestDay=v.day;r.facts.returnReason=v.reason;r.facts.returnPaidPrice=r.products[0].paid;r.facts.returnState='Eligible';break;
   case 'pickup':assert(r.facts.returnState==='Eligible','Check return eligibility before booking pickup.');r.facts.returnPickup=v.slot;r.facts.returnLabel=`DEMO-RETURN-LABEL-${r.id.slice(0,8)}`;r.facts.returnState='Pickup booked';break;
   case 'inspect':assert(count(v.receiptDay)>=count(r.facts.returnRequestDay),'Warehouse receipt cannot be before the return request.');assert(count(v.receiptDay)<=count(r.terms.window)+count(r.terms.grace),'Warehouse receipt is beyond the agreed operational period. Correct the sample receipt day before proceeding.');r.products[0].onHand++;if(v.condition==='Damaged')r.products[0].damaged++;r.facts.returnCondition=v.condition;r.facts.inspectionNote=v.reason;r.facts.returnState=v.condition==='Good'?'Restocked; awaiting refund':'Quarantined; refund on hold';break;
   case 'refund':assert(r.facts.returnCondition==='Good'||v.override,'The item is damaged. Approve a separate refund exception or leave it on hold.');financialEntry(r,'bag-refund','Return refund',r.products[0],money(new Decimal(String(r.facts.returnPaidPrice)).negated()),count(r.terms.handling));r.facts.refundAmount=r.facts.returnPaidPrice;r.facts.refundOverride=v.override;r.facts.returnState='Refund confirmed — simulated';r.facts.creditNote=`DEMO-CREDIT-${r.id.slice(0,8)}`;break;
   case 'exchange':{assert(r.legs[1]?.state==='Delivered','Deliver the wallet before exchanging it.');const original=r.products[2],replacement=r.products[3];assert(v.payment==='Declined'||coachAvailable(replacement)>=1,'The replacement wallet is not available.');original.onHand++;financialEntry(r,'wallet-refund','Exchange refund',original,money(new Decimal(original.paid).negated()));r.facts.exchangeRefund=original.paid;r.facts.replacementPrice=money(v.replacement as number);r.facts.exchangeDifference=money(new Decimal(count(v.replacement)).minus(original.paid));if(v.payment==='Approved'){replacement.onHand--;financialEntry(r,'replacement-sale','Replacement sale',replacement,money(v.replacement as number));r.facts.exchangeState='Replacement paid and delivered — simulated';}else r.facts.exchangeState='Replacement payment declined; no replacement shipped';r.facts.exchangeOriginalUnchanged=true;break;}
   case 'statement':assert(r.ledger.length>0,'There are no financial entries to include.');r.statement={...coachTotals(r),locked:true};r.facts.statementId=`COACH-STATEMENT-${r.id.slice(0,8)}`;r.facts.statementCadence=r.terms.cadence;break;
   case 'payout':assert(r.statement?.locked,'Review and lock the statement before sending it to Finance.');r.facts.financeReceived=r.statement!.payable;r.facts.payout='Simulated receipt only — no money moved';break;
   case 'reconcile':{assert(r.statement?.locked&&r.facts.financeReceived!==undefined,'Send the locked statement to Finance first.');const expected=new Decimal(r.statement!.payable).mul(count(v.fx)),received=new Decimal(r.statement!.payable).mul(count(v.actualFx));r.facts.expectedConverted=money(expected);r.facts.receivedConverted=money(received);r.facts.conversionDifference=money(received.minus(expected));r.facts.importTaxAdjustment=money(v.importTax as number);r.facts.reconciliationReason=v.reason;break;}
   case 'report':r.facts.reportRecipient=v.recipient;r.facts.reportDelivery='Private preview — not emailed';r.facts.deliveredParcels=r.legs.filter(l=>l.state==='Delivered').length;r.facts.parcelCompletion=`${r.legs.filter(l=>l.state==='Delivered').length}/${r.legs.length}`;r.facts.coachRefunds=r.ledger.filter(e=>new Decimal(e.gross).lt(0)).length;r.facts.netCoachSales=coachTotals(r).sales;r.facts.reportSource='This saved Coach journey';break;
   case 'expand':r.facts.expansionMarket=v.market;r.facts.expansionCurrency=v.market==='Kuwait'?'KWD (three decimal places)':'SAR (two decimal places)';r.facts.expansionTimeZone=v.market==='Kuwait'?'Asia/Kuwait':'Asia/Riyadh';r.facts.secondBusiness=v.business;r.facts.expansionStatus='Separate sample configuration; UAE records unchanged';r.facts.crossBusinessExample='Foreign business read denied in the simulation; real journey API separately enforces owner and company';r.facts.scaleLimit='No production volume or latency claim';break;
   default:throw new Error('This demonstration step is unavailable.');
  }
  r.cursor++;r.status=r.cursor===coachSteps.length?'complete':'in_progress';
 }
 r.version++;r.updatedAt=now;r.commands[c.commandId]=signature;
 r.history.push({id:c.commandId,step:step.id,title:step.title,owner:step.owner,at:now,result,system:step.system??'Saved in this demonstration',status:c.fail?'needs_attention':'done',key,values:v});
 return coachRun.parse(r);
}
export function coachStepDefaults(r:CoachRun){
 const step=coachSteps[r.cursor];if(!step)return {};
 const values=coachDefaults(step);
 if(step.id==='pack'&&r.legs[0])values.packed=r.legs[0].quantity;
 return values;
}
