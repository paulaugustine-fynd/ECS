import {beforeAll,afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {db} from '../../packages/db/client';
import {transaction} from '../../packages/db/transaction';
import {seedDemo} from '../../prisma/seed';
import {createServer} from '../../apps/api/src/server';
import {notifyOperations,listNotifications,markNotification,notificationQuery,type OperationalNotice} from '../../packages/domain/notifications';
import {commandCatalog} from '../../packages/domain/catalog';
const prefix=`notice-${randomUUID()}`,companyId=prefix,partnerId=`${prefix}-partner`;
const notice:OperationalNotice={companyId,partnerId,market:'AE',category:'SLA',severity:'WARNING',entityType:'SHIPMENT',entityId:prefix,eventKey:`${prefix}-warning`,title:'Test SLA warning',message:'Open the authorized workflow.',eventAt:new Date('2026-09-23T08:45:00Z')};
const actors=new Map<string,{id:string;companyId:string;partnerId:string|null;markets:string[];role:string}>();
let app:FastifyInstance,headers:Record<string,string>,foreignHeaders:Record<string,string>;
async function login(email:string){const r=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password:'Demo123!'}});expect(r.statusCode,r.body).toBe(200);return {cookie:`${r.cookies[0].name}=${r.cookies[0].value}`,'x-csrf-token':r.json().csrfToken};}
beforeAll(async()=>{
 const u=new URL(process.env.DATABASE_URL??'');if(!['localhost','127.0.0.1'].includes(u.hostname)||u.pathname!=='/ecs_test')throw Error('Isolated local ecs_test required');
 if(!await db.partner.count())await seedDemo();const sample=await db.user.findUniqueOrThrow({where:{email:'admin@ati.demo'}});
 const fixtures=[['ops','ATI_OPERATIONS_MANAGER',null,'AE',true,companyId],['admin','ATI_SUPER_ADMIN',null,'AE',true,companyId],['catalog','ATI_CATALOG_MODERATOR',null,'AE',true,companyId],['vendor','VENDOR_ADMIN',partnerId,'AE',true,companyId],['fulfilment','VENDOR_FULFILMENT_OPERATOR',partnerId,'AE',true,companyId],['vendor-catalog','VENDOR_CATALOG_MANAGER',partnerId,'AE',true,companyId],['finance','VENDOR_FINANCE_VIEWER',partnerId,'AE',true,companyId],['other-partner','VENDOR_ADMIN','other-partner','AE',true,companyId],['other-market','VENDOR_ADMIN',partnerId,'SA',true,companyId],['inactive','VENDOR_ADMIN',partnerId,'AE',false,companyId],['other-company','VENDOR_ADMIN',partnerId,'AE',true,'foreign-company']] as const;
 for(const [key,role,partner,market,active,company] of fixtures){const user=await db.user.create({data:{email:`${key}-${prefix}@test.invalid`,name:`Notification test ${key}`,passwordHash:sample.passwordHash,role,partnerId:partner,markets:[market],active,companyId:company}});actors.set(key,user);}
 app=await createServer({verifyResponseContracts:true});headers=await login(`vendor-${prefix}@test.invalid`);foreignHeaders=await login(`other-partner-${prefix}@test.invalid`);
});
afterAll(async()=>{await app?.close();await db.user.deleteMany({where:{email:{endsWith:`-${prefix}@test.invalid`}}});await db.$disconnect();});
async function recipients(eventKey:string){const rows=await db.notification.findMany({where:{eventKey},include:{user:true}});return rows.map(r=>r.user.email.split(`-${prefix}`)[0]).sort();}
it('routes warnings, critical escalation, catalogue decisions and integration failures by company/market/partner/role',async()=>{
 await transaction(tx=>notifyOperations(tx,notice));expect(await recipients(notice.eventKey)).toEqual(['fulfilment','ops','vendor']);
 await transaction(tx=>notifyOperations(tx,{...notice,eventKey:`${prefix}-critical`,severity:'CRITICAL'}));expect(await recipients(`${prefix}-critical`)).toEqual(['admin','fulfilment','ops','vendor']);
 await transaction(tx=>notifyOperations(tx,{...notice,eventKey:`${prefix}-catalog`,category:'CATALOG',entityType:'PRODUCT'}));expect(await recipients(`${prefix}-catalog`)).toEqual(['admin','catalog','vendor','vendor-catalog']);
 await transaction(tx=>notifyOperations(tx,{...notice,eventKey:`${prefix}-integration`,category:'INTEGRATION',entityType:'INTEGRATION_JOB',severity:'CRITICAL'}));expect(await recipients(`${prefix}-integration`)).toEqual(['admin','ops']);
});
it('deduplicates concurrent deliveries without resetting read state and rolls delivery back with its transaction',async()=>{
 const event={...notice,eventKey:`${prefix}-concurrent`};await Promise.all([transaction(tx=>notifyOperations(tx,event)),transaction(tx=>notifyOperations(tx,event))]);expect(await recipients(event.eventKey)).toEqual(['fulfilment','ops','vendor']);
 const n=await db.notification.findFirstOrThrow({where:{eventKey:event.eventKey,userId:actors.get('vendor')!.id}}),actor=actors.get('vendor')!;
 const first=await markNotification(actor,n.id,true);await transaction(tx=>notifyOperations(tx,event));expect((await markNotification(actor,n.id,true)).readAt).toEqual(first.readAt);
 await expect(transaction(async tx=>{await notifyOperations(tx,{...notice,eventKey:`prefix-rollback-${prefix}`});throw Error('Rollback fixture');})).rejects.toThrow('Rollback fixture');expect(await db.notification.count({where:{eventKey:`prefix-rollback-${prefix}`}})).toBe(0);
});
it('serves strict private paginated API contracts and requires CSRF for idempotent read/unread changes',async()=>{
 expect((await app.inject('/api/v1/notifications')).statusCode).toBe(401);
 const r=await app.inject({url:'/api/v1/notifications?state=ALL&limit=1',headers});expect(r.statusCode,r.body).toBe(200);expect(r.json()).toMatchObject({total:4,page:1,limit:1,unread:3,deliveryMode:'IN_APP_ONLY',categories:['SLA','CATALOG','FULFILMENT']});expect(r.json().items).toHaveLength(1);
 expect(r.body).not.toMatch(/eventKey|userId|companyId|passwordHash/);const n=r.json().items[0];
 const p2=await app.inject({url:'/api/v1/notifications?state=ALL&limit=1&page=2',headers});expect(p2.json().items[0].id).not.toBe(n.id);
 const url=`/api/v1/notifications/${n.id}/read`;
 expect((await app.inject({method:'POST',url,headers:{cookie:headers.cookie},payload:{read:true}})).statusCode).toBe(403);
 expect((await app.inject({method:'POST',url,headers:foreignHeaders,payload:{read:true}})).statusCode).toBe(404);
 for(const read of [true,true,false,false]){const changed=await app.inject({method:'POST',url,headers,payload:{read}});expect(changed.statusCode,changed.body).toBe(200);expect(changed.json().readAt===null).toBe(!read);}
 for(const query of ['limit=101','page=0','category=SECRET','state=UNKNOWN','partnerId=other-partner'])expect((await app.inject({url:`/api/v1/notifications?${query}`,headers})).statusCode).toBe(400);
 expect((await app.inject({url:'/api/v1/notifications?category=INTEGRATION',headers})).json().total).toBe(0);
 expect((await app.inject({method:'POST',url,headers,payload:{read:true,userId:actors.get('admin')!.id}})).statusCode).toBe(400);
});
it('rechecks current role and scope on old notices and denies inactive sessions',async()=>{
 const actor=actors.get('vendor')!,n=await db.notification.findFirstOrThrow({where:{userId:actor.id,category:'SLA'}});
 for(const changed of [{...actor,role:'VENDOR_FINANCE_VIEWER'},{...actor,companyId:'foreign'},{...actor,markets:['SA']},{...actor,partnerId:'foreign'},{...actor,id:actors.get('other-partner')!.id}]){
  expect((await listNotifications(changed,notificationQuery.parse({state:'ALL'}))).total).toBe(0);await expect(markNotification(changed,n.id,true)).rejects.toMatchObject({code:'NOT_FOUND'});
 }
 await db.user.update({where:{id:actor.id},data:{role:'VENDOR_FINANCE_VIEWER'}});expect((await app.inject({url:'/api/v1/notifications?state=ALL',headers})).json().items).toEqual([]);
 await db.user.update({where:{id:actor.id},data:{active:false}});expect((await app.inject({url:'/api/v1/notifications',headers})).statusCode).toBe(401);
 await db.user.update({where:{id:actor.id},data:{active:true,role:'VENDOR_ADMIN'}});
});
it('emits catalogue review notices atomically with the real decision without copying moderator feedback',async()=>{
 const sample=await db.product.findFirstOrThrow({where:{partnerId:'vnd_maz'}}),{id:_id,...fields}=sample;void _id;
 const actor=await db.user.findUniqueOrThrow({where:{email:'admin@ati.demo'}});
 for(const action of ['request-changes','reject'] as const){
  const p=await db.product.create({data:{...fields,id:`${prefix}-${action}`,sku:`${prefix}-${action}`,status:'IN_REVIEW',data:{}}});
  const result=await commandCatalog(actor,p.id,{action,expectedVersion:p.version,reason:'Private moderator review detail'},prefix);expect(result.status).toBe(action==='reject'?'REJECTED':'CHANGES_REQUESTED');
  const notices=await db.notification.findMany({where:{entityId:p.id},include:{user:true}});expect(notices.length).toBeGreaterThan(0);
  expect(notices.every(n=>n.category==='CATALOG'&&n.market===p.market)).toBe(true);expect(JSON.stringify(notices.map(n=>n.message))).not.toContain('Private moderator');
  expect(notices.some(n=>n.user.email==='admin@maisonazure.demo')).toBe(true);expect(notices.every(n=>!n.user.partnerId||n.user.partnerId==='vnd_maz')).toBe(true);
  await expect(commandCatalog(actor,p.id,{action,expectedVersion:p.version,reason:'Duplicate attempt rejected'},prefix)).rejects.toMatchObject({code:'INVALID_TRANSITION'});expect(await db.notification.count({where:{entityId:p.id}})).toBe(notices.length);
 }
});
