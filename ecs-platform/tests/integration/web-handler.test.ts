import {beforeAll,afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {createServer} from '../../apps/api/src/server';
import {createWebHandler} from '../../apps/api/src/web-handler';
import {db} from '../../packages/db/client';
import {hashPassword} from '../../packages/auth/security';

const id=`web-transport-${randomUUID()}`,companyId=`company-${id}`;
const origin=process.env.WEB_ORIGIN??'http://localhost:3000';
let app:FastifyInstance,handle:ReturnType<typeof createWebHandler>,cookie:string,csrf:string;
function request(path:string,init:RequestInit={}){return handle(new Request(`${origin}/api/v1${path}`,init));}
beforeAll(async()=>{
 const url=new URL(process.env.DATABASE_URL??'');
 if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/ecs_test')throw Error('Requires isolated local ecs_test');
 for(const partnerId of [id,`${id}-other`])await db.partner.create({data:{id:partnerId,code:partnerId,companyId,legalName:'Fictional bridge test',displayName:partnerId}});
 await db.user.create({data:{id,email:`${id}@example.test`,name:'Transport fixture',passwordHash:hashPassword('Demo123!'),companyId,partnerId:id,role:'VENDOR_ADMIN'}});
 app=await createServer({verifyResponseContracts:true});handle=createWebHandler(async()=>app);
});
afterAll(async()=>{await app?.close();await db.$disconnect();});

it('authenticates through Web Request/Response and persists the real session in PostgreSQL',async()=>{
 expect((await request('/auth/me')).status).toBe(401);
 const response=await request('/auth/login',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({email:`${id}@example.test`,password:'Demo123!'})});
 expect(response.status).toBe(200);
 const cookies=response.headers.getSetCookie();expect(cookies).toHaveLength(1);expect(cookies[0]).toContain('HttpOnly');
 cookie=cookies[0].split(';')[0];const body=await response.json();csrf=body.csrfToken;expect(body.user.id).toBe(id);expect(body.user.passwordHash).toBeUndefined();
 expect(await db.session.count({where:{userId:id}})).toBe(1);
 expect((await (await request('/auth/me',{headers:{cookie}})).json()).user.id).toBe(id);
});

it('preserves partner isolation, query filtering and uncached authenticated responses',async()=>{
 const response=await request(`/partners?q=${encodeURIComponent(id)}`,{headers:{cookie}});
 expect(response.headers.get('cache-control')).toBe('no-store');
 expect((await response.json()).items.map((p:{id:string})=>p.id)).toEqual([id]);
 expect((await request(`/partners/${id}-other`,{headers:{cookie}})).status).toBe(404);
});

it('retains origin and CSRF checks and invalidates a logged-out session',async()=>{
 expect((await request('/auth/logout',{method:'POST',headers:{cookie,origin}})).status).toBe(403);
 expect((await request('/auth/logout',{method:'POST',headers:{cookie,'x-csrf-token':csrf,origin:'https://foreign.example'}})).status).toBe(403);
 const response=await request('/auth/logout',{method:'POST',headers:{cookie,'x-csrf-token':csrf,origin}});
 expect(response.status).toBe(200);expect(response.headers.getSetCookie()[0]).toContain('ecs_session=;');
 expect((await request('/auth/me',{headers:{cookie}})).status).toBe(401);
 expect(await db.session.count({where:{userId:id}})).toBe(0);
});
