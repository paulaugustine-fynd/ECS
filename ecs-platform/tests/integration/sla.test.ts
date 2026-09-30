import {beforeAll,afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {db} from '../../packages/db/client';
import {seedDemo} from '../../prisma/seed';
import {transaction} from '../../packages/db/transaction';
import {syncSla,listSlas,waiveSla} from '../../packages/domain/sla';
import {commandLeg} from '../../packages/domain/orders';
import {createServer} from '../../apps/api/src/server';
const id=`sla-${randomUUID()}`,start=new Date('2026-09-24T06:00:00Z');
let app:FastifyInstance,headers:Record<string,string>,vendorHeaders:Record<string,string>,oldClock:Date;
const actor={id:'sla-test-operator',companyId:'cmp_ati_uae',partnerId:null,markets:['AE'],role:'ATI_OPERATIONS_MANAGER'};
const vendor={...actor,id:'sla-test-vendor',role:'VENDOR_ADMIN',partnerId:'vnd_maz'};
async function login(email:string){const r=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password:'Demo123!'}});expect(r.statusCode,r.body).toBe(200);return {cookie:`${r.cookies[0].name}=${r.cookies[0].value}`,'x-csrf-token':r.json().csrfToken};}
async function clock(minutes:number){await db.demoClock.update({where:{id:'main'},data:{now:new Date(start.getTime()+minutes*60000)}});}
async function observe(){return transaction(async tx=>syncSla(tx,'SHIPMENT',await tx.fulfilmentLeg.findUniqueOrThrow({where:{id}}),id));}
beforeAll(async()=>{
 const url=new URL(process.env.DATABASE_URL??'');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/ecs_test')throw Error('Isolated local ecs_test required');
 if(!(await db.partner.count()))await seedDemo();oldClock=(await db.demoClock.findUniqueOrThrow({where:{id:'main'}})).now;
 await clock(0);app=await createServer({verifyResponseContracts:true});headers=await login('ops@ati.demo');vendorHeaders=await login('admin@maisonazure.demo');
 await db.order.create({data:{id,companyId:actor.companyId,market:'AE',channel:'BLM-AE',externalId:id,currency:'AED',total:'0',correlationId:id,payloadHash:id,lines:[],deliveryCity:'Dubai',routingPolicy:'TEST',createdAt:start}});
 await db.fulfilmentLeg.create({data:{id,orderId:id,companyId:actor.companyId,partnerId:'vnd_maz',market:'AE',locationId:'fixture',status:'ASSIGNED',fyndId:'mock-sla-fixture',createdAt:start,deadline:new Date(start.getTime()+3600000),lines:[],routingTrace:[]}});
});
afterAll(async()=>{if(oldClock)await db.demoClock.update({where:{id:'main'},data:{now:oldClock}});await app?.close();await db.$disconnect();});
it('creates a pinned timer, emits warning/breach once, and exposes a strict partner-scoped contract',async()=>{
 let m=await observe();expect(m).toMatchObject({stage:'CONFIRMATION',status:'ON_TRACK',policyVersion:0});const deadline=m!.deadline;
 await clock(45);m=await observe();expect(m!.status).toBe('AT_RISK');const version=m!.version;
 await observe();expect((await db.slaMilestone.findUniqueOrThrow({where:{id:m!.id}})).version).toBe(version);
 const warning=await db.notification.findMany({where:{eventKey:`sla:${m!.id}:AT_RISK`},include:{user:true}});expect(warning.some(n=>n.user.email==='ops@ati.demo')).toBe(true);expect(warning.some(n=>n.user.email==='admin@ati.demo')).toBe(false);expect(warning.some(n=>n.user.email==='admin@maisonazure.demo')).toBe(true);
 const firstNotice=warning[0];await db.notification.update({where:{id:firstNotice.id},data:{readAt:start}});await observe();expect(await db.notification.count({where:{eventKey:`sla:${m!.id}:AT_RISK`}})).toBe(warning.length);expect((await db.notification.findUniqueOrThrow({where:{id:firstNotice.id}})).readAt).toEqual(start);
 await clock(61);m=await observe();expect(m).toMatchObject({status:'BREACHED',deadline,breachedAt:deadline});
 expect(await db.exception.count({where:{kind:'SLA',entityId:m!.id}})).toBe(1);
 expect(await db.auditEvent.count({where:{entityId:m!.id,action:'sla.breached'}})).toBe(1);
 expect(await db.notification.count({where:{eventKey:`sla:${m!.id}:BREACHED`,user:{email:'admin@ati.demo'}}})).toBe(1);
 for(const auth of [headers,vendorHeaders]){const r=await app.inject({url:`/api/v1/slas?entityType=SHIPMENT&entityId=${id}`,headers:auth});expect(r.statusCode,r.body).toBe(200);expect(r.json().items[0].status).toBe('BREACHED');}
 await expect(listSlas({...vendor,partnerId:'vnd_lum'},{entityType:'SHIPMENT',entityId:id})).rejects.toMatchObject({code:'NOT_FOUND'});
 await expect(listSlas({...actor,companyId:'other'},{entityType:'SHIPMENT',entityId:id})).rejects.toMatchObject({code:'NOT_FOUND'});
 await expect(listSlas({...actor,markets:['SA']},{entityType:'SHIPMENT',entityId:id})).rejects.toMatchObject({code:'NOT_FOUND'});
});
it('blocks late acceptance until operator waiver without bypassing auth, CSRF or concurrency',async()=>{
 await expect(commandLeg(vendor,id,{next:'ACCEPTED',expectedVersion:1},id)).rejects.toMatchObject({code:'CONFIRMATION_SLA_BREACHED'});
 const m=await db.slaMilestone.findFirstOrThrow({where:{entityId:id}}),payload={expectedVersion:m.version,reason:'Warehouse supervisor verified stock and approved late confirmation'};
 const url=`/api/v1/slas/${m.id}/waive`;
 expect((await app.inject({method:'POST',url,headers:vendorHeaders,payload})).statusCode).toBe(403);
 expect((await app.inject({method:'POST',url,headers:{cookie:headers.cookie},payload})).statusCode).toBe(403);
 expect((await app.inject({method:'POST',url,headers,payload:{...payload,reason:'ok'}})).statusCode).toBe(400);
 expect((await app.inject({method:'POST',url,headers,payload:{...payload,expectedVersion:m.version-1}})).statusCode).toBe(409);
 const r=await app.inject({method:'POST',url,headers,payload});expect(r.statusCode,r.body).toBe(200);expect(r.json()).toMatchObject({status:'WAIVED',reason:payload.reason,breachedAt:m.deadline.toISOString()});
 const leg=await commandLeg(vendor,id,{next:'ACCEPTED',expectedVersion:1},id);expect(leg).toMatchObject({status:'ASSIGNED',requestedStatus:'ACCEPTED'});
 await clock(90);await observe();expect((await db.slaMilestone.findUniqueOrThrow({where:{id:m.id}})).status).toBe('WAIVED');
 expect((await db.exception.findUniqueOrThrow({where:{kind_entityId:{kind:'SLA',entityId:m.id}}})).status).toBe('WAIVED');
});
it('advances stage only on status acknowledgement and never resets dispatch on ready-to-dispatch',async()=>{
 async function advance(status:string){return transaction(async tx=>{const leg=await tx.fulfilmentLeg.update({where:{id},data:{status,requestedStatus:null}});return syncSla(tx,'SHIPMENT',leg,id);});}
 const pick=await advance('ACCEPTED');expect(pick).toMatchObject({stage:'PICK',status:'ON_TRACK'});
 const confirmation=await db.slaMilestone.findFirstOrThrow({where:{entityId:id,stage:'CONFIRMATION'}});expect(confirmation.completedAt).not.toBeNull();expect(confirmation.status).toBe('WAIVED');expect(confirmation.breachedAt).not.toBeNull();
 await expect(waiveSla(actor,confirmation.id,{expectedVersion:confirmation.version,reason:'Cannot apply old stage waiver again'},id)).rejects.toMatchObject({code:'SLA_COMPLETED'});
 await clock(95);await advance('PICKING');await clock(100);const dispatch=await advance('PACKED');
 await clock(110);expect((await advance('READY_TO_DISPATCH'))!.deadline).toEqual(dispatch!.deadline);
 const delivery=await advance('DISPATCHED');expect(delivery!.deadline.getTime()-delivery!.startedAt.getTime()).toBe(2880*60000);
 await advance('DELIVERED');expect(await db.slaMilestone.count({where:{entityId:id,completedAt:null}})).toBe(0);
 expect((await db.slaMilestone.findUniqueOrThrow({where:{id:delivery!.id}})).status).toBe('RESOLVED');
});
it('tracks all reverse stages without shortening waits at intermediate acknowledgements',async()=>{
 const returnId=`return-${id}`;
 const r=await db.returnCase.create({data:{id:returnId,companyId:actor.companyId,partnerId:'vnd_maz',market:'AE',legId:id,lineId:'fixture',productId:'fixture',requestKey:returnId,quantity:1,reason:'Test SLA reverse lifecycle',refund:'0',payableReversal:'0',chargeback:'0',currency:'AED',policy:{},createdAt:new Date(start.getTime()+110*60000)}});
 async function advance(status:string){return transaction(async tx=>{const updated=await tx.returnCase.update({where:{id:r.id},data:{status}});return syncSla(tx,'RETURN',updated,id);});}
 const verification=await advance('REQUESTED');expect((await advance('APPROVAL_PENDING'))!.id).toBe(verification!.id);
 const pickup=await advance('APPROVED');expect((await advance('PICKUP_PENDING'))!.id).toBe(pickup!.id);expect((await advance('PICKUP_BOOKED'))!.id).toBe(pickup!.id);
 const qc=await advance('RECEIVED');expect((await advance('QC_FAILED'))!.id).toBe(qc!.id);
 await advance('REFUND_PENDING');await advance('CLOSED');
 expect((await db.slaMilestone.findMany({where:{entityId:r.id}})).map(m=>m.stage).sort()).toEqual(['QC','REFUND_ACK','RETURN_PICKUP','RETURN_VERIFICATION']);
 expect(await db.slaMilestone.count({where:{entityId:r.id,status:{not:'RESOLVED'}}})).toBe(0);
});
