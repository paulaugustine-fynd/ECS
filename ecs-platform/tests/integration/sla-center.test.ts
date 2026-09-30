import {beforeAll,afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {db} from '../../packages/db/client';
import {transaction} from '../../packages/db/transaction';
import {seedDemo} from '../../prisma/seed';
import {createServer} from '../../apps/api/src/server';
import {saveSlaPolicy,listSlaPolicies,slaQueue,slaQueueQuery,syncSla} from '../../packages/domain/sla';
const id=`sla-center-${randomUUID()}`,policyCompany=`policy-${id}`;
const actor={id:'policy-test',companyId:policyCompany,partnerId:null,markets:['AE'],role:'ATI_SUPER_ADMIN'};
let app:FastifyInstance,admin:Record<string,string>,ops:Record<string,string>,vendor:Record<string,string>;
async function login(email:string){const r=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password:'Demo123!'}});expect(r.statusCode,r.body).toBe(200);return {cookie:`${r.cookies[0].name}=${r.cookies[0].value}`,'x-csrf-token':r.json().csrfToken};}
beforeAll(async()=>{
 const u=new URL(process.env.DATABASE_URL??'');if(!['localhost','127.0.0.1'].includes(u.hostname)||u.pathname!=='/ecs_test')throw Error('Isolated local ecs_test required');
 if(!await db.partner.count())await seedDemo();app=await createServer({verifyResponseContracts:true});admin=await login('admin@ati.demo');ops=await login('ops@ati.demo');vendor=await login('admin@maisonazure.demo');
 const now=(await db.demoClock.findUniqueOrThrow({where:{id:'main'}})).now;
 for(const [suffix,company,partner,market,status,breached] of [['one','cmp_ati_uae','vnd_maz','AE','BREACHED',true],['two','cmp_ati_uae','vnd_maz','AE','AT_RISK',false],['three','cmp_ati_uae','vnd_lum','AE','BREACHED',true],['four','cmp_ati_uae','vnd_lum','AE','WAIVED',true],['foreign','foreign-company','vnd_maz','AE','BREACHED',true],['sa','cmp_ati_uae','vnd_maz','SA','BREACHED',true]] as const){
  await db.slaMilestone.create({data:{companyId:company,partnerId:partner,market,entityType:'SHIPMENT',entityId:`${id}-${suffix}`,stage:'CONFIRMATION',status,origin:'TEST',policyVersion:0,startedAt:new Date(now.getTime()-7200000),atRiskAt:new Date(now.getTime()-4500000),deadline:new Date(now.getTime()-3600000),breachedAt:breached?new Date(now.getTime()-3600000):null}});
 }
});
afterAll(async()=>{await app?.close();await db.$disconnect();});
it('scopes queue pages and metrics before filtering and preserves historic breaches in metrics',async()=>{
 const url=`/api/v1/slas/queue?q=${id}&market=AE&limit=1`;
 const a=await app.inject({url,headers:admin});expect(a.statusCode,a.body).toBe(200);expect(a.json()).toMatchObject({total:3,limit:1,page:1,metrics:{atRisk:1,breached:2,waived:1,breachedEver:3}});expect(a.json().items).toHaveLength(1);
 const b=await app.inject({url:`${url}&page=2`,headers:admin});expect(b.json().items[0].id).not.toBe(a.json().items[0].id);
 const v=await app.inject({url,headers:vendor});expect(v.statusCode,v.body).toBe(200);expect(v.json()).toMatchObject({total:2,metrics:{atRisk:1,breached:1,waived:0,breachedEver:1}});expect(v.json().items[0].partnerId).toBe('vnd_maz');expect(v.body).not.toContain('vnd_lum');
 const waived=await app.inject({url:`/api/v1/slas/queue?q=${id}&status=WAIVED`,headers:admin});expect(waived.json().total).toBe(1);expect(waived.json().metrics.breachedEver).toBe(3);
 expect((await app.inject({url:`/api/v1/slas/queue?q=${id}&market=SA`,headers:vendor})).statusCode).toBe(403);
 const other=await slaQueue({...actor,companyId:'empty-company'},slaQueueQuery.parse({q:id}));expect(other.total).toBe(0);expect(other.metrics.breachedEver).toBe(0);
});
it('validates queue filters and policy inputs and restricts editing to administrators with CSRF',async()=>{
 for(const query of ['limit=101','page=0','stage=UNKNOWN','status=untrusted','partnerId=vnd_lum'])expect((await app.inject({url:`/api/v1/slas/queue?${query}`,headers:vendor})).statusCode).toBe(400);
 const get=await app.inject({url:'/api/v1/slas/policies?market=AE',headers:vendor});expect(get.statusCode,get.body).toBe(200);expect(get.json().items).toHaveLength(9);expect(get.json().appliesTo).toBe('NEW_MILESTONES_ONLY');
 const payload={market:'AE',stage:'PICK',expectedVersion:0,durationMinutes:150,warningMinutes:35,reason:'Test-only baseline validation'};
 for(const auth of [ops,vendor,{cookie:admin.cookie}])expect((await app.inject({method:'POST',url:'/api/v1/slas/policies',headers:auth,payload})).statusCode).toBe(403);
 for(const invalid of [{...payload,warningMinutes:150},{...payload,warningMinutes:0},{...payload,durationMinutes:43201},{...payload,durationMinutes:3.5},{...payload,reason:'bad'},{...payload,companyId:'foreign-company'}])expect((await app.inject({method:'POST',url:'/api/v1/slas/policies',headers:admin,payload:invalid})).statusCode).toBe(400);
 expect((await app.inject({method:'POST',url:'/api/v1/slas/policies',headers:admin,payload:{...payload,market:'SA'}})).statusCode).toBe(403);
 const current=get.json().items.find((p:{stage:string})=>p.stage==='PICK');
 const saved=await app.inject({method:'POST',url:'/api/v1/slas/policies',headers:admin,payload:{...payload,expectedVersion:current.version,durationMinutes:current.durationMinutes+1}});expect(saved.statusCode,saved.body).toBe(200);expect(saved.json()).toMatchObject({stage:'PICK',version:current.version+1,source:'CONFIGURED'});
 const restored=await app.inject({method:'POST',url:'/api/v1/slas/policies',headers:admin,payload:{...payload,expectedVersion:saved.json().version,durationMinutes:current.durationMinutes,warningMinutes:current.warningMinutes,reason:'Restore test baseline after API contract verification'}});expect(restored.statusCode,restored.body).toBe(200);
});
it('pins existing deadlines while new milestones use the new audited policy revision',async()=>{
 const input={market:'AE',stage:'CONFIRMATION' as const,expectedVersion:0,durationMinutes:80,warningMinutes:20,reason:'Controlled test of market baseline'};
 expect((await listSlaPolicies(actor,'AE')).items[0]).toMatchObject({version:0,durationMinutes:60,source:'DEMO_DEFAULT'});
 const p1=await saveSlaPolicy(actor,input,id);expect(p1).toMatchObject({version:1,durationMinutes:80});
 const now=(await db.demoClock.findUniqueOrThrow({where:{id:'main'}})).now;
 async function create(suffix:string){const entityId=`${id}-${suffix}`;await db.order.create({data:{id:entityId,companyId:policyCompany,market:'AE',channel:'BLM-AE',externalId:entityId,currency:'AED',total:'0',correlationId:id,payloadHash:id,lines:[],deliveryCity:'Dubai',routingPolicy:'TEST',createdAt:now}});return db.fulfilmentLeg.create({data:{id:entityId,orderId:entityId,companyId:policyCompany,partnerId:'policy-partner',market:'AE',locationId:'test',status:'ASSIGNED',deadline:new Date(now.getTime()+3600000),createdAt:now,lines:[],routingTrace:[]}});}
 const first=await create('policy-first'),m1=await transaction(tx=>syncSla(tx,'SHIPMENT',first,id));expect(m1!.deadline.getTime()-now.getTime()).toBe(80*60000);expect(m1!.policyVersion).toBe(1);
 const p2=await saveSlaPolicy(actor,{...input,expectedVersion:1,durationMinutes:120,warningMinutes:30},id);expect(p2.version).toBe(2);
 const pinned=await transaction(tx=>syncSla(tx,'SHIPMENT',first,id));expect(pinned!.deadline).toEqual(m1!.deadline);expect(pinned!.policyVersion).toBe(1);
 const second=await create('policy-second'),m2=await transaction(tx=>syncSla(tx,'SHIPMENT',second,id));expect(m2!.deadline.getTime()-now.getTime()).toBe(120*60000);expect(m2!.policyVersion).toBe(2);
 const events=await db.auditEvent.findMany({where:{companyId:policyCompany,action:'sla.policy-revised'},orderBy:{createdAt:'asc'}});expect(events).toHaveLength(2);expect(events[1].before).toMatchObject({version:1,durationMinutes:80});expect(events[1].after).toMatchObject({version:2,durationMinutes:120});expect(events[1].reason).toBe(input.reason);
 await expect(saveSlaPolicy(actor,{...input,expectedVersion:1,durationMinutes:90},id)).rejects.toMatchObject({code:'STALE_SLA_POLICY'});
 await expect(saveSlaPolicy(actor,{...input,expectedVersion:2,durationMinutes:120,warningMinutes:30},id)).rejects.toMatchObject({code:'UNCHANGED_SLA_POLICY'});
 const race=await Promise.allSettled([150,180].map(durationMinutes=>saveSlaPolicy(actor,{...input,expectedVersion:2,durationMinutes},id)));expect(race.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(race.find(r=>r.status==='rejected')).toMatchObject({reason:{code:'STALE_SLA_POLICY'}});
});
