import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import type {FastifyInstance} from 'fastify';
import {db} from '../../packages/db/client';
import {seedDemo} from '../../prisma/seed';
import {createServer} from '../../apps/api/src/server';
import {json} from '../../packages/db/transaction';
import * as transactions from '../../packages/db/transaction';
let app:FastifyInstance,ops:Record<string,string>,vendor:Record<string,string>,foreign:Record<string,string>,catalog:Record<string,string>,base64:string;
async function login(email:string){const r=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password:'Demo123!'}});expect(r.statusCode).toBe(200);return {cookie:`${r.cookies[0].name}=${r.cookies[0].value}`,'x-csrf-token':r.json().csrfToken};}
beforeAll(async()=>{const u=new URL(process.env.DATABASE_URL??'');if(u.pathname!=='/ecs_test'||!['localhost','127.0.0.1'].includes(u.hostname))throw Error('Requires isolated ecs_test');if(!await db.partner.count())await seedDemo();app=await createServer({verifyResponseContracts:true});ops=await login('ops@ati.demo');const template=await db.user.findUniqueOrThrow({where:{email:'admin@maisonazure.demo'}}),email=`qc-${randomUUID()}@lumera.demo`;await db.user.create({data:{email,name:'QC partner test user',passwordHash:template.passwordHash,role:template.role,companyId:template.companyId,partnerId:'vnd_lum',markets:['AE']}});vendor=await login(email);foreign=await login('admin@maisonazure.demo');catalog=await login('catalog@lumera.demo');base64=(await sharp({create:{width:256,height:256,channels:3,background:'#dbcbaa'}}).png().toBuffer()).toString('base64');});
afterAll(async()=>{await app?.close();await db.$disconnect();});
// Explicit historical receipt fixture, not a claim of fresh carrier/OMS delivery.
// The mutations under test are upload, QC and override, all through the real API.
async function received(){
 const product=await db.product.findUniqueOrThrow({where:{id:'prd_lum_serum_3001'}}),inventory=await db.inventory.findFirstOrThrow({where:{productId:product.id}}),agreement=await db.agreement.findFirstOrThrow({where:{partnerId:'vnd_lum'}}),now=(await db.demoClock.findUniqueOrThrow({where:{id:'main'}})).now;
 const line={id:randomUUID(),sku:product.sku,quantity:1,unitGross:'320',vendorDiscount:'32',operatorDiscount:'0',productId:product.id,inventoryId:inventory.id,net:'288',commissionRate:'0.32',agreementId:agreement.id,agreementVersion:agreement.version,returnPolicy:{version:agreement.version,days:30,handlingCharge:'20'}};
 const order=await db.order.create({data:{companyId:product.companyId,market:'AE',channel:'BLM-AE',externalId:randomUUID(),currency:'AED',total:'288',status:'DELIVERED',fyndId:'fixture-order',correlationId:randomUUID(),payloadHash:'fixture',lines:json([line]),deliveryCity:'Dubai',routingPolicy:'HISTORICAL_FIXTURE'}});
 const leg=await db.fulfilmentLeg.create({data:{companyId:product.companyId,partnerId:product.partnerId,market:'AE',orderId:order.id,locationId:inventory.locationId,status:'DELIVERED',fyndId:'fixture-leg',deliveredAt:now,deadline:now,lines:json([line]),routingTrace:{fixture:true,explanation:'Received QC test fixture'}}});
 const r=await app.inject({method:'POST',url:'/api/v1/returns',headers:ops,payload:{legId:leg.id,lineId:line.id,quantity:1,reason:'Inspect historical returned item',requestId:randomUUID()}});expect(r.statusCode,r.body).toBe(200);
 return db.returnCase.update({where:{id:r.json().id},data:{status:'RECEIVED'}});
}
const input=(version=1)=>({requestId:randomUUID(),expectedVersion:version,fileName:'seal.png',base64,notes:'Seal and packaging condition inspected'});
const upload=(id:string,payload:object,headers=ops)=>app.inject({method:'POST',url:`/api/v1/returns/${id}/evidence`,headers,payload});
const get=(path:string,headers=ops)=>app.inject({url:path,headers});
it('retains immutable private pixels, provenance and audit with idempotent recovery',async()=>{
 const r=await received(),body=input(),saved=await upload(r.id,body);expect(saved.statusCode,saved.body).toBe(200);const e=saved.json().evidence;
 expect(e).toMatchObject({returnId:r.id,returnVersion:2,notes:body.notes,scanStatus:'MOCK_CLEAN',width:256,height:256});expect(e).not.toHaveProperty('bytes');expect(e).not.toHaveProperty('requestHash');
 const content=await get(`/api/v1/returns/evidence/${e.id}/content`,vendor);expect(content.statusCode).toBe(200);expect(content.headers['cache-control']).toBe('private, no-store');expect((await sharp(content.rawPayload).metadata()).format).toBe('png');
 expect((await upload(r.id,body)).json()).toMatchObject({replayed:true,evidence:{id:e.id}});expect((await upload(r.id,{...body,notes:'Different explanation of the same photo'})).statusCode).toBe(409);
 expect((await db.returnCase.findUniqueOrThrow({where:{id:r.id}})).version).toBe(2);expect(await db.auditEvent.count({where:{entityId:r.id,action:'return.evidence-upload'}})).toBe(1);
 await expect(db.returnEvidence.update({where:{id:e.id},data:{notes:'Rewrite original findings'}})).rejects.toThrow();await expect(db.returnEvidence.delete({where:{id:e.id}})).rejects.toThrow();
});
it('enforces role, partner, session, CSRF, version and received-only boundaries',async()=>{
 const r=await received();expect((await upload(r.id,input(),vendor)).statusCode).toBe(403);expect((await upload(r.id,input(),{cookie:ops.cookie})).statusCode).toBe(403);
 expect((await upload(r.id,input(99))).statusCode).toBe(409);expect((await get(`/api/v1/returns/${r.id}/evidence`,foreign)).statusCode).toBe(404);expect((await get(`/api/v1/returns/${r.id}/evidence`,catalog)).statusCode).toBe(403);
 const saved=await upload(r.id,input());expect(saved.statusCode).toBe(200);const path=`/api/v1/returns/evidence/${saved.json().evidence.id}/content`;
 expect((await get(path,foreign)).statusCode).toBe(404);expect((await get(path,catalog)).statusCode).toBe(403);expect((await get(path,{})).statusCode).toBe(401);
 for(const status of ['REQUESTED','APPROVED','PICKUP_BOOKED','QC_FAILED','REFUND_PENDING','CLOSED']){await db.returnCase.update({where:{id:r.id},data:{status}});expect((await upload(r.id,input(2))).statusCode).toBe(409);}
 expect(await db.returnEvidence.count({where:{returnId:r.id}})).toBe(1);
});
it('rejects invalid pixels and rolls back evidence, version and audit together',async()=>{
 const r=await received();expect((await upload(r.id,{...input(),base64:Buffer.from('corrupt').toString('base64')})).statusCode).toBe(400);
 const spy=vi.spyOn(transactions,'audit').mockRejectedValueOnce(Error('Injected QC evidence audit failure'));
 try{expect((await upload(r.id,input())).statusCode).toBe(500);}finally{spy.mockRestore();}
 expect(await db.returnEvidence.count({where:{returnId:r.id}})).toBe(0);expect((await db.returnCase.findUniqueOrThrow({where:{id:r.id}})).version).toBe(1);
});
it('serializes identical retries and rejects competing stale uploads and duplicate pixels',async()=>{
 const r=await received(),body=input(),same=await Promise.all([upload(r.id,body),upload(r.id,body)]);same.forEach(x=>expect(x.statusCode,x.body).toBe(200));expect(same[0].json().evidence.id).toBe(same[1].json().evidence.id);
 expect((await upload(r.id,input(2))).json()).toMatchObject({error:{code:'EVIDENCE_DUPLICATE'}});
 const fresh=await received(),competing=await Promise.all([upload(fresh.id,input()),upload(fresh.id,input())]);expect(competing.map(x=>x.statusCode).sort()).toEqual([200,409]);expect(await db.returnEvidence.count({where:{returnId:fresh.id}})).toBe(1);
});
it('snapshots photos with Good QC, links ledger evidence and locks further uploads',async()=>{
 const r=await received(),body=input(),photo=(await upload(r.id,body)).json().evidence,invId=(r.policy as {inventoryId:string}).inventoryId,before=await db.inventory.findUniqueOrThrow({where:{id:invId}});
 const q=await app.inject({method:'POST',url:`/api/v1/returns/${r.id}/commands`,headers:ops,payload:{expectedVersion:2,action:'qc-good',reason:'Sealed item suitable for restock'}});expect(q.statusCode,q.body).toBe(200);expect(q.json().policy.qcDecision).toMatchObject({condition:'GOOD',disposition:'RESTOCK',evidenceIds:[photo.id]});
 const after=await db.inventory.findUniqueOrThrow({where:{id:invId}});expect(after.onHand).toBe(before.onHand+1);expect(after.damaged).toBe(before.damaged);
 const reversal=await db.financialEvent.findFirstOrThrow({where:{sourceId:r.id,kind:'RETURN_REVERSAL'}});expect(reversal.snapshot).toMatchObject({policy:{qcDecision:{evidenceIds:[photo.id]}}});
 expect((await upload(r.id,input(3))).statusCode).toBe(409);expect((await upload(r.id,body)).json().replayed).toBe(true);
});
it('bounds retained evidence to six distinct photos without partial writes',async()=>{
 const r=await received();
 for(let i=0;i<6;i++){const pixels=(await sharp({create:{width:128,height:128,channels:3,background:{r:20+i*20,g:80,b:120}}}).png().toBuffer()).toString('base64');const saved=await upload(r.id,{...input(i+1),base64:pixels});expect(saved.statusCode,saved.body).toBe(200);}
 expect((await upload(r.id,input(7))).json()).toMatchObject({error:{code:'EVIDENCE_LIMIT'}});expect(await db.returnEvidence.count({where:{returnId:r.id}})).toBe(6);expect((await db.returnCase.findUniqueOrThrow({where:{id:r.id}})).version).toBe(7);
});
it('serializes QC against photo upload so the recorded decision cannot omit a committed photo',async()=>{
 const r=await received();const results=await Promise.all([upload(r.id,input()),app.inject({method:'POST',url:`/api/v1/returns/${r.id}/commands`,headers:ops,payload:{action:'qc-bad',expectedVersion:1,reason:'Damaged packaging requires quarantine'}})]);
 expect(results.map(x=>x.statusCode).sort()).toEqual([200,409]);const current=await db.returnCase.findUniqueOrThrow({where:{id:r.id}}),photos=await db.returnEvidence.findMany({where:{returnId:r.id}});
 if(current.status==='QC_FAILED'){expect(photos).toHaveLength(0);expect(current.policy).toMatchObject({qcDecision:{evidenceIds:[]}});}else{expect(current.status).toBe('RECEIVED');expect(photos).toHaveLength(1);expect(current.version).toBe(2);}
});
it('quarantines Bad QC, holds refund and retains photo disposition through audited override',async()=>{
 const r=await received(),photo=(await upload(r.id,input())).json().evidence,invId=(r.policy as {inventoryId:string}).inventoryId,before=await db.inventory.findUniqueOrThrow({where:{id:invId}});
 const command=(action:string,expectedVersion:number)=>app.inject({method:'POST',url:`/api/v1/returns/${r.id}/commands`,headers:ops,payload:{action,expectedVersion,reason:'Broken seal recorded; goodwill decision'}});
 const bad=await command('qc-bad',2);expect(bad.statusCode,bad.body).toBe(200);expect(bad.json()).toMatchObject({status:'QC_FAILED',refundStatus:'HELD',policy:{qcDecision:{condition:'BAD',disposition:'QUARANTINE',evidenceIds:[photo.id]}}});
 const quarantined=await db.inventory.findUniqueOrThrow({where:{id:invId}});expect(quarantined.onHand).toBe(before.onHand+1);expect(quarantined.damaged).toBe(before.damaged+1);expect(await db.financialEvent.count({where:{sourceId:r.id}})).toBe(0);expect(await db.outbox.count({where:{aggregateId:r.id,operation:'requestRefund'}})).toBe(0);
 const override=await command('approve-refund',3);expect(override.statusCode,override.body).toBe(200);expect(override.json().policy).toMatchObject({qcDecision:{disposition:'QUARANTINE',evidenceIds:[photo.id]},refundOverride:{reason:'Broken seal recorded; goodwill decision'}});
 expect(await db.inventory.findUniqueOrThrow({where:{id:invId}})).toEqual(quarantined);expect(await db.financialEvent.count({where:{sourceId:r.id}})).toBe(2);expect((await command('approve-refund',3)).statusCode).toBe(409);
});
