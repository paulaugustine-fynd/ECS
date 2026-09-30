import {z} from 'zod';
import type {Prisma,NotificationPolicy} from '@prisma/client';
import {type Actor,permit,scope} from '../auth/policy';
import {audit,transaction} from '../db/transaction';
import {requireCondition} from './errors';
export const notificationCategories=['SLA','CATALOG','INTEGRATION','FULFILMENT'] as const;
export const notificationSeverities=['WARNING','CRITICAL'] as const;
export type NotificationCategory=typeof notificationCategories[number];
export type NotificationSeverity=typeof notificationSeverities[number];
export const notificationRoles=['ATI_SUPER_ADMIN','ATI_OPERATIONS_MANAGER','ATI_CATALOG_MODERATOR','VENDOR_ADMIN','VENDOR_FULFILMENT_OPERATOR','VENDOR_CATALOG_MANAGER'] as const;
export const atiNotificationRoles:Record<NotificationCategory,string[]>={SLA:['ATI_SUPER_ADMIN','ATI_OPERATIONS_MANAGER'],CATALOG:['ATI_SUPER_ADMIN','ATI_CATALOG_MODERATOR'],INTEGRATION:['ATI_SUPER_ADMIN','ATI_OPERATIONS_MANAGER'],FULFILMENT:['ATI_SUPER_ADMIN','ATI_OPERATIONS_MANAGER']};
export const vendorNotificationRoles:Record<NotificationCategory,string[]>={SLA:['VENDOR_ADMIN','VENDOR_FULFILMENT_OPERATOR'],CATALOG:['VENDOR_ADMIN','VENDOR_CATALOG_MANAGER'],INTEGRATION:[],FULFILMENT:['VENDOR_ADMIN','VENDOR_FULFILMENT_OPERATOR']};
export function defaultNotificationPolicy(category:NotificationCategory,severity:NotificationSeverity){return {atiRoles:category==='SLA'&&severity==='WARNING'?['ATI_OPERATIONS_MANAGER']:[...atiNotificationRoles[category]],vendorRoles:[...vendorNotificationRoles[category]],version:0};}
export const notificationPolicyQuery=z.object({market:z.string().regex(/^[A-Z]{2}$/)}).strict();
export const notificationPolicyInput=z.object({market:z.string().regex(/^[A-Z]{2}$/),category:z.enum(notificationCategories),severity:z.enum(notificationSeverities),expectedVersion:z.number().int().nonnegative(),atiRoles:z.array(z.enum(notificationRoles)).min(1).max(2),vendorRoles:z.array(z.enum(notificationRoles)).max(2),reason:z.string().trim().min(10).max(1000)}).strict().superRefine((p,ctx)=>{
 for(const field of ['atiRoles','vendorRoles'] as const){const allowed=(field==='atiRoles'?atiNotificationRoles:vendorNotificationRoles)[p.category];if(p[field].some(r=>!allowed.includes(r))||new Set(p[field]).size!==p[field].length)ctx.addIssue({code:'custom',path:[field],message:'Choose unique roles authorized for this category and audience'});}
 if(p.severity==='CRITICAL'&&!p.atiRoles.includes('ATI_SUPER_ADMIN'))ctx.addIssue({code:'custom',path:['atiRoles'],message:'Critical alerts must retain ATI super-admin escalation'});
});
async function coverage(tx:Prisma.TransactionClient,companyId:string,market:string){
 const users=await tx.user.findMany({where:{companyId,active:true,markets:{has:market},role:{in:[...notificationRoles]}},select:{role:true,partnerId:true}});
 return Object.fromEntries(notificationRoles.map(role=>[role,users.filter(u=>u.role===role&&(role.startsWith('VENDOR_')?!!u.partnerId:u.partnerId===null)).length]));
}
function view(category:NotificationCategory,severity:NotificationSeverity,p:NotificationPolicy|undefined,counts:Record<string,number>){
 const selected=p??defaultNotificationPolicy(category,severity);
 const defaults=defaultNotificationPolicy(category,severity);
 return {category,severity,version:selected.version,source:p?'CONFIGURED' as const:'DEMO_DEFAULT' as const,atiRoles:selected.atiRoles,vendorRoles:selected.vendorRoles,defaults:{atiRoles:defaults.atiRoles,vendorRoles:defaults.vendorRoles},roleOptions:{ati:atiNotificationRoles[category],vendor:vendorNotificationRoles[category]},recipientCounts:counts,activeAtiRecipients:selected.atiRoles.reduce((n,r)=>n+(counts[r]??0),0),updatedAt:p?.updatedAt??null};
}
export async function listNotificationPolicies(actor:Actor,market:string){
 permit(actor,'rules',true);scope(actor,market);
 return transaction(async tx=>{const [rows,counts]=await Promise.all([tx.notificationPolicy.findMany({where:{companyId:actor.companyId,market}}),coverage(tx,actor.companyId,market)]);return {market,deliveryMode:'IN_APP_ONLY' as const,appliesTo:'NEXT_DELIVERY_EVALUATION' as const,items:notificationCategories.flatMap(category=>notificationSeverities.map(severity=>view(category,severity,rows.find(r=>r.category===category&&r.severity===severity),counts)))};});
}
export async function saveNotificationPolicy(actor:Actor,raw:z.infer<typeof notificationPolicyInput>,correlationId:string){
 permit(actor,'rules',true);const input=notificationPolicyInput.parse(raw);scope(actor,input.market);
 return transaction(async tx=>{
  const key={companyId:actor.companyId,market:input.market,category:input.category,severity:input.severity};
  const existing=await tx.notificationPolicy.findUnique({where:{companyId_market_category_severity:key}}),before=existing??defaultNotificationPolicy(input.category,input.severity);
  requireCondition(before.version===input.expectedVersion,'STALE_NOTIFICATION_POLICY','Routing changed. Refresh before saving.',409);
  const sorted=(roles:readonly string[])=>[...roles].sort();const atiRoles=sorted(input.atiRoles),vendorRoles=sorted(input.vendorRoles);
  requireCondition(JSON.stringify([sorted(before.atiRoles),sorted(before.vendorRoles)])!==JSON.stringify([atiRoles,vendorRoles]),'UNCHANGED_NOTIFICATION_POLICY','Change the routing selection before saving');
  const counts=await coverage(tx,actor.companyId,input.market);
  requireCondition(atiRoles.some(r=>counts[r]>0),'NO_ATI_RECIPIENT','At least one selected ATI role must have an active user in this market');
  const policy=await tx.notificationPolicy.upsert({where:{companyId_market_category_severity:key},create:{...key,atiRoles,vendorRoles},update:{atiRoles,vendorRoles,version:{increment:1}}});
  await audit(tx,{...actor,markets:[input.market]},correlationId,'notifications.policy-revised',policy.id,{...key,version:before.version,atiRoles:before.atiRoles,vendorRoles:before.vendorRoles},policy,input.reason);
  return view(input.category,input.severity,policy,counts);
 });
}
