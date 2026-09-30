import {beforeAll,afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {db} from '../../packages/db/client';
import {seedDemo} from '../../prisma/seed';
import {transaction} from '../../packages/db/transaction';
import {createServer} from '../../apps/api/src/server';
import {listExceptions,getException,commandException,exceptionQuery} from '../../packages/domain/exceptions';
import {openException,transitionException} from '../../packages/domain/exception-lifecycle';
import type {Actor} from '../../packages/auth/policy';
const prefix=`exceptions-${randomUUID()}`,partner='queue-partner';
let app:FastifyInstance,admin:Actor,vendor:Actor,fulfilment:Actor,adminHeaders:Record<string,string>,vendorHeaders:Record<string,string>;
const records=new Map<string,string>();
async function login(email:string){const r=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password:'Demo123!'}});expect(r.statusCode,r.body).toBe(200);return {cookie:`${r.cookies[0].name}=${r.cookies[0].value}`,'x-csrf-token':r.json().csrfToken};}
beforeAll(async()=>{
 const u=new URL(process.env.DATABASE_URL??'');if(!['localhost','127.0.0.1'].includes(u.hostname)||u.pathname!=='/ecs_test')throw Error('Isolated local ecs_test required');if(!await db.partner.count())await seedDemo();
 const seed=await db.user.findUniqueOrThrow({where:{email:'admin@ati.demo'}});
 const user=async(name:string,role:string,partnerId:string|null)=>db.user.create({data:{email:`${name}-${prefix}@test.invalid`,name,passwordHash:seed.passwordHash,companyId:prefix,markets:['AE'],role,partnerId}});
 admin=await user('admin','ATI_SUPER_ADMIN',null);vendor=await user('vendor','VENDOR_ADMIN',partner);fulfilment=await user('fulfilment','VENDOR_FULFILMENT_OPERATOR',partner);
 app=await createServer({verifyResponseContracts:true});adminHeaders=await login(`admin-${prefix}@test.invalid`);vendorHeaders=await login(`vendor-${prefix}@test.invalid`);
 for(const [name,kind,partnerId,market,companyId,status] of [['sla','SLA',partner,'AE',prefix,'OPEN'],['catalog','CATALOG_REVIEW',partner,'AE',prefix,'OPEN'],['outbox','INTEGRATION_DLQ',partner,'AE',prefix,'OPEN'],['inbox','INBOX_DLQ',null,'AE',prefix,'REPLAY_REQUESTED'],['foreign-partner','SLA','other-partner','AE',prefix,'OPEN'],['foreign-market','SLA',partner,'SA',prefix,'OPEN'],['foreign-company','SLA',partner,'AE','other-company','OPEN'],['closed','SLA',partner,'AE',prefix,'RESOLVED']] as const){
  const e=await db.exception.create({data:{companyId,partnerId,market,kind,entityId:`${prefix}-${name}`,status,message:kind.includes('DLQ')?'RAW_SENSITIVE_PAYLOAD_NOT_FOR_QUEUE':`Operational ${name}`}});records.set(name,e.id);
 }
});
afterAll(async()=>{await app?.close();await db.user.deleteMany({where:{companyId:prefix}});await db.$disconnect();});
it('filters kinds and counts inside role, company, market and partner scope; omits raw failure data',async()=>{
 const a=await app.inject({url:'/api/v1/exceptions?limit=2',headers:adminHeaders});expect(a.statusCode,a.body).toBe(200);expect(a.json()).toMatchObject({total:5,metrics:{open:4,replayRequested:1,resolved:1,waived:0,unassigned:5}});expect(a.json().items).toHaveLength(2);
 const r=await app.inject({url:'/api/v1/exceptions?status=ALL',headers:vendorHeaders});expect(r.statusCode,r.body).toBe(200);expect(r.json()).toMatchObject({total:3,kinds:['SLA','CATALOG_REVIEW','FULFILMENT'],metrics:{open:2,replayRequested:0,resolved:1,unassigned:2}});expect(r.body).not.toMatch(/RAW_SENSITIVE|INTEGRATION_DLQ|INBOX_DLQ/);
 const integration=await app.inject({url:`/api/v1/exceptions/${records.get('outbox')}`,headers:adminHeaders});expect(integration.statusCode,integration.body).toBe(200);expect(integration.body).not.toContain('RAW_SENSITIVE');expect(integration.json().item.summary).toContain('restricted integration trace');
 expect((await app.inject({url:'/api/v1/exceptions?kind=INTEGRATION_DLQ',headers:vendorHeaders})).json().items).toEqual([]);
 for(const name of ['outbox','inbox','foreign-partner','foreign-market','foreign-company'])expect((await app.inject({url:`/api/v1/exceptions/${records.get(name)}`,headers:vendorHeaders})).statusCode).toBe(404);
 expect((await listExceptions(fulfilment,exceptionQuery.parse({status:'ALL'}))).total).toBe(2);
 await expect(listExceptions({...vendor,role:'VENDOR_FINANCE_VIEWER'},exceptionQuery.parse({}))).rejects.toMatchObject({statusCode:403});
 expect((await app.inject({url:'/api/v1/exceptions?market=SA',headers:vendorHeaders})).statusCode).toBe(403);
 for(const q of ['limit=101','status=HIDDEN','ownership=OTHERS','partnerId=other-partner','page=0'])expect((await app.inject({url:`/api/v1/exceptions?${q}`,headers:vendorHeaders})).statusCode).toBe(400);
});
it('claims, comments and hands off with optimistic concurrency, CSRF and a shared scoped audit trail',async()=>{
 const id=records.get('sla')!,url=`/api/v1/exceptions/${id}/commands`,payload={action:'CLAIM',expectedVersion:1,reason:'Warehouse lead investigating confirmation delay'};
 expect((await app.inject({method:'POST',url,headers:{cookie:vendorHeaders.cookie},payload})).statusCode).toBe(403);
 const claimed=await app.inject({method:'POST',url,headers:vendorHeaders,payload});expect(claimed.statusCode,claimed.body).toBe(200);expect(claimed.json()).toMatchObject({version:2,assignee:{id:vendor.id,name:'vendor'},status:'OPEN'});
 expect((await listExceptions(vendor,exceptionQuery.parse({ownership:'MINE'}))).total).toBe(1);
 expect((await app.inject({method:'POST',url,headers:adminHeaders,payload})).statusCode).toBe(409);
 await expect(commandException(fulfilment,id,{action:'RELEASE',expectedVersion:2,reason:'Another vendor user cannot release this'},prefix)).rejects.toMatchObject({code:'NOT_ASSIGNEE'});
 await expect(commandException(admin,id,{action:'CLAIM',expectedVersion:2,reason:'Must release before taking over ownership'},prefix)).rejects.toMatchObject({code:'ALREADY_ASSIGNED'});
 const note=await commandException(vendor,id,{action:'COMMENT',expectedVersion:2,reason:'Confirmed stock; awaiting ATI late confirmation waiver'},prefix);expect(note.version).toBe(3);expect(note.status).toBe('OPEN');
 const released=await commandException(admin,id,{action:'RELEASE',expectedVersion:3,reason:'ATI operations takes responsibility for the next action'},prefix);expect(released.assignee).toBeNull();
 const detail=await app.inject({url:`/api/v1/exceptions/${id}`,headers:vendorHeaders});expect(detail.statusCode,detail.body).toBe(200);expect(detail.json().activity.map((e:{action:string})=>e.action)).toEqual(['exception.release','exception.comment','exception.claim']);expect(detail.body).not.toMatch(/passwordHash|correlationId|before|after/);
 const race=await Promise.allSettled([admin,vendor].map(actor=>commandException(actor,id,{action:'CLAIM',expectedVersion:4,reason:'Concurrent safe claim by authorized responsible user'},prefix)));expect(race.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(race.find(r=>r.status==='rejected')).toMatchObject({reason:{code:'STALE_EXCEPTION'}});
});
it('does not allow a queue action to hide failure and makes source-closed records immutable',async()=>{
 const id=records.get('outbox')!;
 for(const action of ['RESOLVE','WAIVE','DELETE'])expect((await app.inject({method:'POST',url:`/api/v1/exceptions/${id}/commands`,headers:adminHeaders,payload:{action,expectedVersion:1,reason:'Cannot mark an unacknowledged failure successful'}})).statusCode).toBe(400);
 const closed=records.get('closed')!;await expect(commandException(vendor,closed,{action:'COMMENT',expectedVersion:1,reason:'Cannot edit completed source evidence'},prefix)).rejects.toMatchObject({code:'EXCEPTION_CLOSED'});
 const e=await db.exception.findUniqueOrThrow({where:{id}});await transaction(tx=>transitionException(tx,e.kind,e.entityId,'REPLAY_REQUESTED','Retry authorized after correcting source'));
 let result=await getException(admin,id);expect(result.item).toMatchObject({status:'REPLAY_REQUESTED',version:2,resolvedAt:null});
 await transaction(tx=>transitionException(tx,e.kind,e.entityId,'RESOLVED','Acknowledgement verified'));result=await getException(admin,id);expect(result.item).toMatchObject({status:'RESOLVED',version:3,actions:[]});expect(result.item.resolvedAt).not.toBeNull();
 await transaction(tx=>transitionException(tx,e.kind,e.entityId,'RESOLVED'));expect((await getException(admin,id)).item.version).toBe(3);
 const reopened=await transaction(tx=>openException(tx,{companyId:e.companyId,partnerId:e.partnerId,market:e.market,kind:e.kind,entityId:e.entityId,message:'A later failure reopened the same case'}));expect(reopened).toMatchObject({status:'OPEN',version:4,resolvedAt:null,reason:null});
 const same=await transaction(tx=>openException(tx,{companyId:e.companyId,partnerId:e.partnerId,market:e.market,kind:e.kind,entityId:e.entityId,message:reopened.message}));expect(same.version).toBe(4);
});
it('rolls back queue commands with their audit and rejects anonymous access',async()=>{
 expect((await app.inject('/api/v1/exceptions')).statusCode).toBe(401);
 const e=await db.exception.findUniqueOrThrow({where:{id:records.get('catalog')}});
 await expect(transaction(async tx=>{await transitionException(tx,e.kind,e.entityId,'RESOLVED');throw Error('Fixture rollback');})).rejects.toThrow('Fixture rollback');expect((await db.exception.findUniqueOrThrow({where:{id:e.id}})).status).toBe('OPEN');
 const count=await db.auditEvent.count({where:{entityId:e.id}});await expect(commandException({...vendor,partnerId:'wrong-partner'},e.id,{action:'CLAIM',expectedVersion:1,reason:'Foreign partner must not gain ownership'},prefix)).rejects.toMatchObject({code:'NOT_FOUND'});expect(await db.auditEvent.count({where:{entityId:e.id}})).toBe(count);
});
