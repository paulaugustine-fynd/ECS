import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {db} from '../../packages/db/client';
import {hashPassword} from '../../packages/auth/security';
import {createServer} from '../../apps/api/src/server';
import {createMockServer} from '../../apps/mock-systems/src/server';
import {processOutbox} from '../../apps/worker/src/outbox';
import {processInbox} from '../../apps/worker/src/inbox';
import {nativeCoachWorkflow,type NativeTransport} from '../helpers/native-coach-workflow';
it('onboards Coach through normal records and completes product, order, return and settlement operations',async()=>{
 const url=new URL(process.env.DATABASE_URL??'');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/ecs_test')throw Error('Isolated ecs_test required');
 const run=randomUUID(),companyId='cmp_ati_uae',email=run+'@example.test';
 await db.demoClock.upsert({where:{id:'main'},update:{},create:{id:'main',now:new Date('2026-09-23T10:00:00Z')}});
 await db.user.create({data:{name:'Native Coach test',email,companyId,role:'ATI_SUPER_ADMIN',markets:['AE'],passwordHash:hashPassword('TestDemo123!')}});
 const app=await createServer({verifyResponseContracts:true}),mocks=createMockServer();await mocks.listen({host:'127.0.0.1',port:4101});
 let partnerId='not-created';const receipts:string[]=[];
 const t:NativeTransport={
  login:async(email,password)=>{const r=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password}});expect(r.statusCode,r.body).toBe(200);return {cookie:r.cookies.map(c=>`${c.name}=${c.value}`).join('; '),'x-csrf-token':r.json().csrfToken};},
  call:async(s,path,body)=>{const r=await app.inject({method:body===undefined?'GET':'POST',url:'/api/v1'+path,headers:s as Record<string,string>??{},...(body===undefined?{}:{payload:body as object})});expect(r.statusCode,path+' '+r.body).toBeLessThan(300);const data=r.json();if(path==='/partners/invite')partnerId=data.partner.id;if(data.receiptId)receipts.push(data.receiptId);return data;},
  flush:async()=>{for(let i=0;i<20;i++){const incoming=await db.inbox.findMany({where:{id:{in:receipts},status:'PENDING'}});for(const j of incoming)await processInbox(j.id);const correlations=(await db.inbox.findMany({where:{id:{in:receipts}},select:{correlationId:true}})).map(r=>r.correlationId);const outgoing=await db.outbox.findMany({where:{OR:[{partnerId},{correlationId:{in:correlations}}],status:'PENDING'}});for(const j of outgoing)await processOutbox(j.id);if(!incoming.length&&!outgoing.length)break;}const failed=await db.outbox.findMany({where:{partnerId,status:{in:['RETRY','DEAD_LETTER']}}});expect(failed.map(j=>[j.operation,j.error])).toEqual([]);},log:()=>{},
 };
 try{const result=await nativeCoachWorkflow(t,await t.login(email,'TestDemo123!'),{email:'coach-'+run+'@example.test',password:'CoachDemo123!',suffix:Date.now().toString().slice(-9)});expect(await db.partner.count({where:{id:result.partnerId,status:'ACTIVE'}})).toBe(1);expect(await db.product.count({where:{partnerId:result.partnerId,status:'PUBLISHED'}})).toBe(3);expect(await db.order.count({where:{externalId:result.orderReference}})).toBe(1);expect(await db.auditEvent.count({where:{partnerId:result.partnerId}})).toBeGreaterThan(30);
 const auth=await t.login(email,'TestDemo123!');const other=await db.partner.create({data:{companyId:'foreign-'+run,code:run,legalName:'Foreign company test',displayName:'Foreign company test',markets:['AE'],status:'ACTIVE'}});const foreign=await app.inject({method:'POST',url:'/api/v1/demo/orders',headers:auth as Record<string,string>,payload:{externalOrderId:'FOREIGN-TEST',partnerId:other.id}});expect(foreign.statusCode).toBe(404);
 }finally{await app.close();await mocks.close();await db.$disconnect();}
},120000);
