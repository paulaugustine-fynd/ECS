import {z} from 'zod';
import Decimal from 'decimal.js';
import type {Agreement,Prisma} from '@prisma/client';
import {type Actor,partnerScope} from '../auth/policy';
import {db} from '../db/client';
import {audit,json,transaction} from '../db/transaction';
import {requireCondition} from './errors';
const rate=z.string().regex(/^(0(?:\.\d{1,4})?|1(?:\.0{1,4})?)$/);
const amount=z.string().regex(/^\d{1,8}(?:\.\d{1,3})?$/);
export const commercialTerms=z.object({rate,currency:z.enum(['AED','SAR','KWD']),cadence:z.enum(['WEEKLY','BIWEEKLY','MONTHLY']),validFrom:z.string().datetime(),validUntil:z.string().datetime(),market:z.enum(['AE','SA','KW']),brand:z.string().trim().min(2).max(100).nullable(),categoryRates:z.array(z.object({category:z.string().trim().min(1).max(120),rate}).strict()).max(30),returnDays:z.number().int().min(0).max(365),handlingCharge:amount}).strict();
export const agreementDraft=commercialTerms.extend({expectedVersion:z.number().int().nonnegative(),reason:z.string().trim().min(5).max(1000)});
export const agreementApproval=z.object({reason:z.string().trim().min(5).max(1000)}).strict();
type Terms=z.infer<typeof commercialTerms>;
type Rules={market?:string;brand?:string|null;categoryRates?:Record<string,string>;returnDays?:number;handlingCharge?:string};
export const canReadCommercials=(actor:Actor)=>['ATI_SUPER_ADMIN','ATI_PARTNER_MANAGER','ATI_FINANCE_ANALYST','ATI_AUDITOR','VENDOR_ADMIN','VENDOR_FINANCE_VIEWER'].includes(actor.role);
export function commercialRead(actor:Actor){requireCondition(canReadCommercials(actor),'FORBIDDEN','Your role cannot read commercial agreements',403);}
function commercialWrite(actor:Actor){requireCondition(['ATI_SUPER_ADMIN','ATI_PARTNER_MANAGER','ATI_FINANCE_ANALYST'].includes(actor.role),'FORBIDDEN','Only ATI commercial administrators can configure agreements',403);}
async function partner(tx:Prisma.TransactionClient,actor:Actor,id:string){const p=await tx.partner.findFirst({where:{AND:[{id},partnerScope(actor)]}});requireCondition(p,'NOT_FOUND','Partner not found',404);return p;}
function validateTerms(input:Terms,markets:string[]){
 requireCondition(new Date(input.validUntil)>new Date(input.validFrom),'INVALID_PERIOD','The end must be later than the start');
 requireCondition(markets.includes(input.market),'MARKET_FORBIDDEN','Partner is not approved for this market',403);
 requireCondition(({AE:'AED',SA:'SAR',KW:'KWD'} as Record<string,string>)[input.market]===input.currency,'CURRENCY_MISMATCH','Currency must match the agreement market');
 requireCondition(new Set(input.categoryRates.map(r=>r.category.toLowerCase())).size===input.categoryRates.length,'DUPLICATE_CATEGORY','Category override names must be unique');
 requireCondition(input.categoryRates.every(r=>!['__proto__','constructor','prototype'].includes(r.category.toLowerCase())),'INVALID_CATEGORY','Reserved category key');
 const places=input.currency==='KWD'?3:2;requireCondition(new Decimal(input.handlingCharge).decimalPlaces()<=places,'CURRENCY_PRECISION','Handling charge exceeds the currency precision');
}
export function selectAgreement(agreements:Agreement[],at:Date,market:string,currency:string,brand:string){
 return agreements.filter(a=>{const r=a.rules as Rules;return a.status==='APPROVED'&&a.validFrom<=at&&a.validUntil>at&&a.currency===currency&&(r.market??'AE')===market&&(!r.brand||r.brand===brand);}).sort((a,b)=>Number(Boolean((b.rules as Rules).brand))-Number(Boolean((a.rules as Rules).brand))||b.version-a.version)[0];
}
export function commercialRate(agreement:Pick<Agreement,'rate'|'rules'>,category:string){const rates=(agreement.rules as Rules).categoryRates??{};const path=category.split('/').map(s=>s.trim());if(Object.hasOwn(rates,category))return rates[category];for(let i=path.length-1;i>=0;i--)if(Object.hasOwn(rates,path[i]))return rates[path[i]];return agreement.rate.toString();}
export async function listAgreements(actor:Actor,id:string){commercialRead(actor);await partner(db,actor,id);return {items:(await db.agreement.findMany({where:{partnerId:id},orderBy:{version:'desc'}})).filter(a=>actor.markets.includes((a.rules as Rules).market??'AE')),latestVersion:(await db.agreement.aggregate({where:{partnerId:id},_max:{version:true}}))._max.version??0,brands:(await db.product.findMany({where:{partnerId:id,market:{in:actor.markets}},select:{brand:true},distinct:['brand']})).map(p=>p.brand),now:(await db.demoClock.findUniqueOrThrow({where:{id:'main'}})).now};}
export async function createAgreement(actor:Actor,id:string,input:z.infer<typeof agreementDraft>,correlationId:string){commercialWrite(actor);return transaction(async tx=>{
 const p=await partner(tx,actor,id);requireCondition(actor.markets.includes(input.market),'MARKET_FORBIDDEN','Market not permitted',403);validateTerms(input,p.markets);
 if(input.brand)requireCondition(await tx.product.findFirst({where:{partnerId:id,market:input.market,brand:input.brand}}),'UNKNOWN_BRAND','Choose a canonical brand from this partner’s catalogue; use partner-default terms before catalogue setup');
 const latest=await tx.agreement.findFirst({where:{partnerId:id},orderBy:{version:'desc'}});requireCondition((latest?.version??0)===input.expectedVersion,'STALE_VERSION','Another agreement version was created. Refresh before saving.',409);
 const now=(await tx.demoClock.findUniqueOrThrow({where:{id:'main'}})).now;requireCondition(new Date(input.validFrom)>=now,'RETROACTIVE_TERMS','New terms cannot take effect before the demo clock');
 const saved=await tx.agreement.create({data:{partnerId:id,version:input.expectedVersion+1,rate:input.rate,currency:input.currency,cadence:input.cadence,validFrom:new Date(input.validFrom),validUntil:new Date(input.validUntil),rules:json({market:input.market,brand:input.brand,categoryRates:Object.fromEntries(input.categoryRates.map(r=>[r.category,r.rate])),returnDays:input.returnDays,handlingCharge:input.handlingCharge})}});
 await audit(tx,actor,correlationId,'agreement.draft',saved.id,null,saved,input.reason,id);return saved;
 });}
export async function approveAgreement(actor:Actor,id:string,reason:string,correlationId:string){commercialWrite(actor);return transaction(async tx=>{
 const a=await tx.agreement.findFirst({where:{id,partner:partnerScope(actor)}});requireCondition(a,'NOT_FOUND','Agreement not found',404);const rules=a.rules as Rules;requireCondition(actor.markets.includes(rules.market??'AE'),'MARKET_FORBIDDEN','Market not permitted',403);
 requireCondition(a.status==='DRAFT','AGREEMENT_IMMUTABLE','Approved terms cannot be changed; create a new version.',409);
 const now=(await tx.demoClock.findUniqueOrThrow({where:{id:'main'}})).now;requireCondition(a.validFrom>=now&&a.validUntil>now,'RETROACTIVE_TERMS','The proposed effective date has passed. Create a new version.');
 const updated=await tx.agreement.update({where:{id},data:{status:'APPROVED'}});await audit(tx,actor,correlationId,'agreement.approve',id,a,updated,reason,a.partnerId);return updated;
 });}
export const previewInput=commercialTerms.extend({category:z.string().trim().min(1).max(120),productBrand:z.string().trim().min(1).max(100),gross:amount,vendorDiscount:amount,operatorDiscount:amount});
export async function rejectAgreement(actor:Actor,id:string,reason:string,correlationId:string){commercialWrite(actor);return transaction(async tx=>{
 const a=await tx.agreement.findFirst({where:{id,partner:partnerScope(actor)}});requireCondition(a,'NOT_FOUND','Agreement not found',404);requireCondition(actor.markets.includes((a.rules as Rules).market??'AE'),'MARKET_FORBIDDEN','Market not permitted',403);requireCondition(a.status==='DRAFT','AGREEMENT_IMMUTABLE','Only a draft can be rejected',409);
 const updated=await tx.agreement.update({where:{id},data:{status:'REJECTED'}});await audit(tx,actor,correlationId,'agreement.reject',id,a,updated,reason,a.partnerId);return updated;
 });}
export async function previewAgreement(actor:Actor,id:string,input:z.infer<typeof previewInput>){commercialRead(actor);const p=await partner(db,actor,id);validateTerms(input,p.markets);requireCondition(actor.markets.includes(input.market),'MARKET_FORBIDDEN','Market not permitted',403);requireCondition(!input.brand||input.brand===input.productBrand,'BRAND_MISMATCH','Preview product brand does not match the scoped agreement');
 const gross=new Decimal(input.gross),discount=new Decimal(input.vendorDiscount);requireCondition(discount.plus(input.operatorDiscount).lte(gross),'INVALID_DISCOUNT','Combined discounts cannot exceed gross');const decimals=input.currency==='KWD'?3:2;const basis=gross.minus(discount);
 const proposed={rate:new Decimal(input.rate),rules:{categoryRates:Object.fromEntries(input.categoryRates.map(r=>[r.category,r.rate]))}} as Pick<Agreement,'rate'|'rules'>;
 const current=selectAgreement(await db.agreement.findMany({where:{partnerId:id}}),new Date(input.validFrom),input.market,input.currency,input.productBrand);
 const calculate=(a:Pick<Agreement,'rate'|'rules'>)=>{const r=commercialRate(a,input.category),commission=basis.mul(r).toDecimalPlaces(decimals);return {rate:r,commission:commission.toFixed(decimals),payable:basis.minus(commission).toFixed(decimals)};};
 return {currency:input.currency,basis:basis.toFixed(decimals),customerNet:gross.minus(discount).minus(input.operatorDiscount).toFixed(decimals),current:current?{id:current.id,version:current.version,...calculate(current)}:null,proposed:calculate(proposed),returnHandling:input.handlingCharge,note:'Illustrative payable before returns and chargebacks. Operator-funded discounts do not reduce the vendor basis. No ledger entry or payment is created.'};
}
