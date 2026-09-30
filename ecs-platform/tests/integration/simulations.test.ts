import {beforeAll,afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {db} from '../../packages/db/client';
import {hashPassword} from '../../packages/auth/security';
import {createServer} from '../../apps/api/src/server';
import {simConfig} from '../../packages/simulation/engine';
const id=`sim-${randomUUID()}`;let app:FastifyInstance;
const sessions:Record<string,Record<string,string>>={};let runId:string;
async function login(email:string){const r=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password:'Demo123!'}});expect(r.statusCode,r.body).toBe(200);return {cookie:`${r.cookies[0].name}=${r.cookies[0].value}`,'x-csrf-token':r.json().csrfToken};}
beforeAll(async()=>{
 const url=new URL(process.env.DATABASE_URL??'');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/ecs_test')throw Error('Isolated local ecs_test required');
 for(const [name,role,companyId] of [['admin','ATI_SUPER_ADMIN',id],['other','ATI_SUPER_ADMIN',id],['foreign','ATI_SUPER_ADMIN',`${id}-foreign`],['vendor','VENDOR_ADMIN',id]]){
  await db.user.create({data:{id:`${id}-${name}`,email:`${id}-${name}@example.test`,name,role,companyId,passwordHash:hashPassword('Demo123!'),partnerId:name==='vendor'?`${id}-partner`:null}});
 }
 app=await createServer({verifyResponseContracts:true});
 for(const name of ['admin','other','foreign','vendor'])sessions[name]=await login(`${id}-${name}@example.test`);
});
afterAll(async()=>{await app?.close();await db.$disconnect();});
it('requires authentication, ATI role and CSRF',async()=>{
 expect((await app.inject('/api/v1/simulations')).statusCode).toBe(401);
 expect((await app.inject({url:'/api/v1/simulations',headers:sessions.vendor})).statusCode).toBe(403);
 expect((await app.inject({method:'POST',url:'/api/v1/simulations',headers:{cookie:sessions.admin.cookie},payload:{}})).statusCode).toBe(403);
});
it('creates a persistent isolated run and enforces start idempotency',async()=>{
 runId=randomUUID();const payload={scenarioId:'warehouse',config:simConfig.parse({}),requestId:runId};
 for(let i=0;i<2;i++){const r=await app.inject({method:'POST',url:'/api/v1/simulations',headers:sessions.admin,payload});expect(r.statusCode,r.body).toBe(200);expect(r.json().run).toMatchObject({id:runId,version:1,cursor:0});}
 expect(await db.auditEvent.count({where:{entityId:`simulation:${runId}`,action:'simulation.created'}})).toBe(1);
 const conflict=await app.inject({method:'POST',url:'/api/v1/simulations',headers:sessions.admin,payload:{...payload,scenarioId:'finance-cycle'}});expect(conflict.statusCode).toBe(409);
 for(const name of ['other','foreign']){expect((await app.inject({url:`/api/v1/simulations/${runId}`,headers:sessions[name]})).statusCode).toBe(404);expect((await app.inject({url:'/api/v1/simulations',headers:sessions[name]})).json().runs).toEqual([]);}
});
it('persists a failed handoff, retries once and ignores repeated commands',async()=>{
 const send=async(payload:Record<string,unknown>)=>app.inject({method:'POST',url:`/api/v1/simulations/${runId}/commands`,headers:sessions.admin,payload});
 const failed=await send({expectedVersion:1,commandId:randomUUID(),action:'fail'});expect(failed.statusCode,failed.body).toBe(200);expect(failed.json().run).toMatchObject({status:'DEAD_LETTER',cursor:0});
 const payload={expectedVersion:2,commandId:randomUUID(),action:'retry'};
 for(let i=0;i<2;i++){const r=await send(payload);expect(r.statusCode,r.body).toBe(200);expect(r.json().run).toMatchObject({version:3,cursor:1,status:'RUNNING'});expect(r.json().run.facts.poState).toBe('CREATED');}
 expect(await db.auditEvent.count({where:{entityId:`simulation:${runId}`}})).toBe(3);
 const read=await app.inject({url:`/api/v1/simulations/${runId}`,headers:sessions.admin});expect(read.json().run.events).toHaveLength(2);
});
it('serializes concurrent steps and does not mutate business tables',async()=>{
 const before=await Promise.all([db.order.count(),db.partner.count(),db.outbox.count()]);
 const responses=await Promise.all([1,2].map(()=>app.inject({method:'POST',url:`/api/v1/simulations/${runId}/commands`,headers:sessions.admin,payload:{expectedVersion:3,commandId:randomUUID(),action:'next'}})));
 expect(responses.map(r=>r.statusCode).sort()).toEqual([200,409]);
 const read=await app.inject({url:`/api/v1/simulations/${runId}`,headers:sessions.admin});expect(read.json().run).toMatchObject({cursor:2,version:4});
 expect(await Promise.all([db.order.count(),db.partner.count(),db.outbox.count()])).toEqual(before);
 const foreign=await app.inject({method:'POST',url:`/api/v1/simulations/${runId}/commands`,headers:sessions.other,payload:{expectedVersion:4,commandId:randomUUID(),action:'next'}});expect(foreign.statusCode).toBe(404);
});
