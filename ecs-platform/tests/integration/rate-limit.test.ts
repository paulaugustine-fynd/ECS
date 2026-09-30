import {beforeAll,afterAll,it,expect} from 'vitest';
import {db} from '../../packages/db/client';
import {seedDemo} from '../../prisma/seed';
import {createServer} from '../../apps/api/src/server';

beforeAll(async()=>{
 const u=new URL(process.env.DATABASE_URL??'');
 if(!['localhost','127.0.0.1'].includes(u.hostname)||u.pathname!=='/ecs_test')throw Error('Isolated ecs_test required');
 if(!await db.partner.count())await seedDemo();
});
afterAll(()=>db.$disconnect());
it('keeps verified users independent behind one proxy but shares their sessions and IP changes',async()=>{
 const app=await createServer();
 try{
  async function login(email:string){const r=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password:'Demo123!'}});expect(r.statusCode).toBe(200);return `${r.cookies[0].name}=${r.cookies[0].value}`;}
  const first=await login('catalog@lumera.demo'),secondSession=await login('catalog@lumera.demo'),other=await login('admin@maisonazure.demo');
  for(let i=0;i<200;i++)expect((await app.inject({url:'/api/v1/auth/me',headers:{cookie:first}})).statusCode).toBe(200);
  const limited=await app.inject({url:'/api/v1/auth/me',remoteAddress:'192.0.2.10',headers:{cookie:secondSession}});
  expect(limited.statusCode).toBe(429);expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  expect((await app.inject({url:'/api/v1/auth/me',headers:{cookie:other}})).statusCode).toBe(200);
 }finally{await app.close();}
});
it('does not grant fresh buckets to forged cookies or untrusted forwarded addresses',async()=>{
 const app=await createServer();
 try{
  for(let i=0;i<200;i++)expect((await app.inject({url:'/api/v1/auth/me',headers:{cookie:`ecs_session=forged-${i}`,'x-forwarded-for':`192.0.2.${i%255}`}})).statusCode).toBe(401);
  expect((await app.inject({url:'/api/v1/auth/me',headers:{cookie:'ecs_session=another-forgery','x-forwarded-for':'198.51.100.1'}})).statusCode).toBe(429);
 }finally{await app.close();}
});
it('retains the 15-attempt login IP limit even with a valid session cookie',async()=>{
 const app=await createServer();
 try{
  const r=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:'catalog@lumera.demo',password:'Demo123!'}});expect(r.statusCode).toBe(200);
  const cookie=`${r.cookies[0].name}=${r.cookies[0].value}`;
  for(let i=1;i<15;i++)expect((await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{cookie},payload:{email:'unknown@ati.demo',password:'Wrong-password'}})).statusCode).toBe(401);
  expect((await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{cookie},payload:{email:'catalog@lumera.demo',password:'Demo123!'}})).statusCode).toBe(429);
 }finally{await app.close();}
});
