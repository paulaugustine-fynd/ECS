import {z} from 'zod';
import type {Prisma} from '@prisma/client';
import {type Actor,scope,isVendor} from '../auth/policy';
import {transaction} from '../db/transaction';
import {requireCondition} from './errors';
import {notificationCategories,atiNotificationRoles as atiRoles,vendorNotificationRoles as vendorRoles,defaultNotificationPolicy} from './notification-policy';
export {notificationCategories};
type Category=typeof notificationCategories[number];
export function notificationAccess(actor:Actor){return notificationCategories.filter(category=>(isVendor(actor)?vendorRoles:atiRoles)[category].includes(actor.role));}
export type OperationalNotice={companyId:string;partnerId?:string|null;market:string;category:Category;severity:'WARNING'|'CRITICAL';entityType:'SHIPMENT'|'RETURN'|'PRODUCT'|'INTEGRATION_JOB'|'INBOX_RECEIPT'|'EXCEPTION';entityId:string;eventKey:string;title:string;message:string;eventAt:Date};
/** Transactional in-app delivery only. Never sends email/customer communications. */
export async function notifyOperations(tx:Prisma.TransactionClient,event:OperationalNotice){
 const policy=await tx.notificationPolicy.findUnique({where:{companyId_market_category_severity:{companyId:event.companyId,market:event.market,category:event.category,severity:event.severity}}})??defaultNotificationPolicy(event.category,event.severity);
 const users=await tx.user.findMany({where:{active:true,companyId:event.companyId,markets:{has:event.market},OR:[{role:{in:policy.atiRoles},partnerId:null},...(event.partnerId?[{role:{in:policy.vendorRoles},partnerId:event.partnerId}]:[])]},select:{id:true}});
 if(!users.length)return 0;
 const result=await tx.notification.createMany({data:users.map(user=>({...event,partnerId:event.partnerId??null,userId:user.id,policyVersion:policy.version})),skipDuplicates:true});return result.count;
}
function owner(actor:Actor):Prisma.NotificationWhereInput{
 scope(actor);
 return {userId:actor.id,companyId:actor.companyId,market:{in:actor.markets},category:{in:notificationAccess(actor)},...(isVendor(actor)?{partnerId:actor.partnerId!}:{})};
}
export const notificationQuery=z.object({category:z.enum(notificationCategories).optional(),state:z.enum(['ALL','UNREAD','READ']).default('UNREAD'),page:z.coerce.number().int().positive().max(10000).default(1),limit:z.coerce.number().int().positive().max(100).default(25)}).strict();
// Explicit response projection: event keys, recipient identities and raw integration payloads stay private.
const select={id:true,category:true,severity:true,entityType:true,entityId:true,partnerId:true,market:true,title:true,message:true,eventAt:true,createdAt:true,readAt:true} as const;
export async function listNotifications(actor:Actor,input:z.infer<typeof notificationQuery>){
 return transaction(async tx=>{
  const base={...owner(actor),...(input.category?{AND:[{category:input.category}]}:{})};
  const where:Prisma.NotificationWhereInput={...base,...(input.state==='ALL'?{}:input.state==='UNREAD'?{readAt:null}:{readAt:{not:null}})};
  const [items,total,unread]=await Promise.all([tx.notification.findMany({where,select,orderBy:[{createdAt:'desc'},{id:'desc'}],take:input.limit,skip:(input.page-1)*input.limit}),tx.notification.count({where}),tx.notification.count({where:{...owner(actor),readAt:null}})]);
  return {items,total,unread,page:input.page,limit:input.limit,deliveryMode:'IN_APP_ONLY' as const,categories:notificationAccess(actor)};
 });
}
export const notificationRead=z.object({read:z.boolean()}).strict();
export async function markNotification(actor:Actor,id:string,read:boolean){
 return transaction(async tx=>{
  const n=await tx.notification.findFirst({where:{id,...owner(actor)}});requireCondition(n,'NOT_FOUND','Notification not found',404);
  // Read timestamps use delivery/wall clock, not the injectable business SLA clock.
  return tx.notification.update({where:{id:n.id},data:{readAt:read?n.readAt??new Date():null},select});
 });
}
