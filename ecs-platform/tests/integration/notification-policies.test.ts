import {beforeAll,afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {db} from '../../packages/db/client';
import {transaction} from '../../packages/db/transaction';
import {seedDemo} from '../../prisma/seed';
import {createServer} from '../../apps/api/src/server';
import {listNotificationPolicies,saveNotificationPolicy} from '../../packages/domain/notification-policy';
import {notifyOperations,markNotification,listNotifications,notificationQuery,type OperationalNotice} from '../../packages/domain/notifications';
import type {Actor} from '../../packages/auth/policy';
const prefix=`routing-${randomUUID()}`,partnerId=`${prefix}-partner`,actors=new Map<string,Actor>();
let app:FastifyInstance,headers:Record<string,string>,opsHeaders:Record<string,string>,vendorHeaders:Record<string,string>;
const first={market:'AE',category:'SLA' as const,severity:'WARNING' as const,expectedVersion:0,atiRoles:['ATI_SUPER_ADMIN','ATI_OPERATIONS_MANAGER'] as ('ATI_SUPER_ADMIN'|'ATI_OPERATIONS_MANAGER')[],vendorRoles:['VENDOR_ADMIN'] as 'VENDOR_ADMIN'[],reason:'Route warning to ATI leadership and the partner administrator'};
async function login(email:string){const r=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password:'Demo123!'}});expect(r.statusCode,r.body).toBe(200);return {cookie:`${r.cookies[0].name}=${r.cookies[0].value}`,'x-csrf-token':r.json().csrfToken};}
beforeAll(async()=>{
 const u=new URL(process.env.DATABASE_URL??'');if(!['localhost','127.0.0.1'].includes(u.hostname)||u.pathname!=='/ecs_test')throw Error('Isolated local ecs_test required');if(!await db.partner.count())await seedDemo();
 const seed=await db.user.findUniqueOrThrow({where:{email:'admin@ati.demo'}});
 const fixtures=[['admin','ATI_SUPER_ADMIN',null,['AE','SA'],true,prefix],['ops','ATI_OPERATIONS_MANAGER',null,['AE'],true,prefix],['catalog','ATI_CATALOG_MODERATOR',null,['AE'],true,prefix],['vendor','VENDOR_ADMIN',partnerId,['AE'],true,prefix],['fulfilment','VENDOR_FULFILMENT_OPERATOR',partnerId,['AE'],true,prefix],['vendor-catalog','VENDOR_CATALOG_MANAGER',partnerId,['AE'],true,prefix],['other-partner','VENDOR_ADMIN','other-partner',['AE'],true,prefix],['inactive','VENDOR_ADMIN',partnerId,['AE'],false,prefix],['other-market','VENDOR_ADMIN',partnerId,['SA'],true,prefix],['other-company','VENDOR_ADMIN',partnerId,['AE'],true,`${prefix}-foreign`]] as const;
 for(const [name,role,partner,markets,active,companyId] of fixtures){const u=await db.user.create({data:{email:`${name}-${prefix}@test.invalid`,name,passwordHash:seed.passwordHash,role,partnerId:partner,markets:[...markets],active,companyId}});actors.set(name,u);}
 app=await createServer({verifyResponseContracts:true});headers=await login(`admin-${prefix}@test.invalid`);opsHeaders=await login(`ops-${prefix}@test.invalid`);vendorHeaders=await login(`vendor-${prefix}@test.invalid`);
});
afterAll(async()=>{await app?.close();await db.notificationPolicy.deleteMany({where:{companyId:prefix}});await db.user.deleteMany({where:{email:{endsWith:`-${prefix}@test.invalid`}}});await db.$disconnect();});
it('shows eight scoped defaults with active role coverage and rejects unauthorized policy inspection',async()=>{
 const response=await app.inject({url:'/api/v1/notification-policies?market=AE',headers});expect(response.statusCode,response.body).toBe(200);const data=response.json();expect(data.items).toHaveLength(8);expect(data).toMatchObject({market:'AE',deliveryMode:'IN_APP_ONLY',appliesTo:'NEXT_DELIVERY_EVALUATION'});
 const warning=data.items.find((p:{category:string;severity:string})=>p.category==='SLA'&&p.severity==='WARNING');expect(warning).toMatchObject({version:0,atiRoles:['ATI_OPERATIONS_MANAGER'],activeAtiRecipients:1,recipientCounts:{ATI_SUPER_ADMIN:1,ATI_OPERATIONS_MANAGER:1,VENDOR_ADMIN:2}});expect(response.body).not.toMatch(/passwordHash|@test.invalid|companyId/);
 for(const auth of [opsHeaders,vendorHeaders])expect((await app.inject({url:'/api/v1/notification-policies?market=AE',headers:auth})).statusCode).toBe(403);
 expect((await app.inject('/api/v1/notification-policies?market=AE')).statusCode).toBe(401);
 expect((await app.inject({url:'/api/v1/notification-policies?market=KW',headers})).statusCode).toBe(403);
 expect((await app.inject({url:'/api/v1/notification-policies?market=AE&companyId=foreign',headers})).statusCode).toBe(400);
 const other=await listNotificationPolicies({...actors.get('admin')!,companyId:'no-such-company'},'AE');expect(other.items.every(p=>p.activeAtiRecipients===0&&p.version===0)).toBe(true);
});
it('enforces CSRF, responsible role allowlists, critical escalation and an active ATI recipient',async()=>{
 for(const auth of [opsHeaders,vendorHeaders,{cookie:headers.cookie}])expect((await app.inject({method:'POST',url:'/api/v1/notification-policies',headers:auth,payload:first})).statusCode).toBe(403);
 const invalid=[{...first,reason:'short'},{...first,atiRoles:[]},{...first,atiRoles:['VENDOR_ADMIN']},{...first,atiRoles:['ATI_SUPER_ADMIN','ATI_SUPER_ADMIN']},{...first,vendorRoles:['VENDOR_CATALOG_MANAGER']},{...first,category:'INTEGRATION',vendorRoles:['VENDOR_ADMIN']},{...first,severity:'CRITICAL',atiRoles:['ATI_OPERATIONS_MANAGER']},{...first,companyId:'foreign'}];
 for(const payload of invalid){const r=await app.inject({method:'POST',url:'/api/v1/notification-policies',headers,payload});expect(r.statusCode,r.body).toBe(400);}
 const noUser=await app.inject({method:'POST',url:'/api/v1/notification-policies',headers,payload:{...first,market:'SA',atiRoles:['ATI_OPERATIONS_MANAGER'],vendorRoles:[]}});expect(noUser.statusCode,noUser.body).toBe(422);expect(noUser.json().error.code).toBe('NO_ATI_RECIPIENT');
 expect(await db.notificationPolicy.count({where:{companyId:prefix}})).toBe(0);expect(await db.auditEvent.count({where:{companyId:prefix,action:'notifications.policy-revised'}})).toBe(0);
});
it('saves an audited revision and applies it to actual delivery without widening tenant or partner access',async()=>{
 const response=await app.inject({method:'POST',url:'/api/v1/notification-policies',headers,payload:first});expect(response.statusCode,response.body).toBe(200);expect(response.json()).toMatchObject({version:1,source:'CONFIGURED',activeAtiRecipients:2,vendorRoles:['VENDOR_ADMIN']});
 const event:OperationalNotice={companyId:prefix,partnerId,market:'AE',category:'SLA',severity:'WARNING',entityType:'SHIPMENT',entityId:prefix,eventKey:`${prefix}-first`,title:'Controlled warning',message:'Test policy-driven routing',eventAt:new Date()};await transaction(tx=>notifyOperations(tx,event));
 const received=await db.notification.findMany({where:{eventKey:event.eventKey},include:{user:true}});expect(received.map(n=>n.user.name).sort()).toEqual(['admin','ops','vendor']);expect(received.every(n=>n.policyVersion===1)).toBe(true);
 const vendorNotice=received.find(n=>n.user.name==='vendor')!,read=await markNotification(actors.get('vendor')!,vendorNotice.id,true);
 const second=await saveNotificationPolicy(actors.get('admin')!,{...first,expectedVersion:1,atiRoles:['ATI_SUPER_ADMIN'],vendorRoles:[],reason:'ATI administrator takes ownership of this warning category'},prefix);expect(second.version).toBe(2);
 await transaction(tx=>notifyOperations(tx,{...event,eventKey:`${prefix}-second`}));const next=await db.notification.findMany({where:{eventKey:`${prefix}-second`},include:{user:true}});expect(next.map(n=>n.user.name)).toEqual(['admin']);expect(next[0].policyVersion).toBe(2);
 expect((await listNotifications(actors.get('vendor')!,notificationQuery.parse({state:'ALL'}))).items.find(n=>n.id===vendorNotice.id)?.readAt).toEqual(read.readAt);
 const third=await saveNotificationPolicy(actors.get('admin')!,{...first,expectedVersion:2,atiRoles:['ATI_SUPER_ADMIN'],vendorRoles:['VENDOR_ADMIN','VENDOR_FULFILMENT_OPERATOR'],reason:'Restore partner fulfilment involvement for active warnings'},prefix);expect(third.version).toBe(3);
 await transaction(tx=>notifyOperations(tx,event));const reeval=await db.notification.findMany({where:{eventKey:event.eventKey},include:{user:true}});expect(reeval.map(n=>n.user.name).sort()).toEqual(['admin','fulfilment','ops','vendor']);expect(reeval.find(n=>n.user.name==='fulfilment')!.policyVersion).toBe(3);expect(reeval.find(n=>n.user.name==='vendor')!.readAt).toEqual(read.readAt);
 const audit=await db.auditEvent.findMany({where:{companyId:prefix,action:'notifications.policy-revised'},orderBy:{createdAt:'asc'}});expect(audit).toHaveLength(3);expect(audit[0].before).toMatchObject({version:0,atiRoles:['ATI_OPERATIONS_MANAGER']});expect(audit[2].after).toMatchObject({version:3,vendorRoles:['VENDOR_ADMIN','VENDOR_FULFILMENT_OPERATOR']});
});
it('serializes concurrent edits, rejects stale/no-op changes and guards routing at database level',async()=>{
 const actor=actors.get('admin')!,input={...first,category:'CATALOG' as const,atiRoles:['ATI_SUPER_ADMIN'] as 'ATI_SUPER_ADMIN'[],vendorRoles:[]};
 const race=await Promise.allSettled([[],['VENDOR_ADMIN'] as 'VENDOR_ADMIN'[]].map(vendorRoles=>saveNotificationPolicy(actor,{...input,vendorRoles},prefix)));expect(race.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(race.find(r=>r.status==='rejected')).toMatchObject({reason:{code:'STALE_NOTIFICATION_POLICY'}});
 const winner=await db.notificationPolicy.findUniqueOrThrow({where:{companyId_market_category_severity:{companyId:prefix,market:'AE',category:'CATALOG',severity:'WARNING'}}});
 await expect(saveNotificationPolicy(actor,{...input,expectedVersion:1,vendorRoles:winner.vendorRoles as 'VENDOR_ADMIN'[]},prefix)).rejects.toMatchObject({code:'UNCHANGED_NOTIFICATION_POLICY'});
 const critical=await saveNotificationPolicy(actor,{...first,category:'INTEGRATION',severity:'CRITICAL',atiRoles:['ATI_SUPER_ADMIN'],vendorRoles:[]},prefix);expect(critical.version).toBe(1);
 const row=await db.notificationPolicy.findUniqueOrThrow({where:{companyId_market_category_severity:{companyId:prefix,market:'AE',category:'INTEGRATION',severity:'CRITICAL'}}});
 await expect(db.notificationPolicy.update({where:{id:row.id},data:{atiRoles:['ATI_OPERATIONS_MANAGER']}})).rejects.toThrow();
 await expect(db.notificationPolicy.update({where:{id:row.id},data:{vendorRoles:['VENDOR_ADMIN']}})).rejects.toThrow();
 await expect(db.notificationPolicy.update({where:{id:winner.id},data:{atiRoles:['ATI_OPERATIONS_MANAGER']}})).rejects.toThrow();
});
