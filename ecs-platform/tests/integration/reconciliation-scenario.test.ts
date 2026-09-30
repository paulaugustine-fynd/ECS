import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {db} from '../../packages/db/client';
import {seedDemo} from '../../prisma/seed';
import {createMockServer} from '../../apps/mock-systems/src/server';
import {processOutbox} from '../../apps/worker/src/outbox';
import {prepareReconciliationScenario,releaseReconciliationScenario} from '../../scripts/reconciliation-scenario';
import {reconciliationDetail,scanReconciliation,resolveReconciliation} from '../../packages/domain/reconciliation';

const run=`test-${randomUUID().slice(0,8)}`;
let mock:FastifyInstance;
beforeAll(async()=>{
 const url=new URL(process.env.DATABASE_URL??'');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/ecs_test')throw Error('Isolated ecs_test required');
 if(!await db.partner.count())await seedDemo();
 mock=createMockServer();await mock.listen({host:'127.0.0.1',port:4101});
});
afterAll(async()=>{await mock?.close();await db.$disconnect();});

it('prepares one additive held export atomically and does not claim other partners’ events or change stock/orders',async()=>{
 const before={orders:await db.order.count(),legs:await db.fulfilmentLeg.count(),stock:await db.inventory.findMany({orderBy:{id:'asc'}}),ledger:await db.financialEvent.findMany({orderBy:{id:'asc'}})};
 const [first,second]=await Promise.all([prepareReconciliationScenario(run),prepareReconciliationScenario(run)]);
 expect([first.created,second.created].sort()).toEqual([false,true]);expect(first.statementId).toBe(second.statementId);
 const statement=await db.settlement.findUniqueOrThrow({where:{id:first.statementId}}),job=await db.outbox.findUniqueOrThrow({where:{id:first.jobId}});
 expect(statement.status).toBe('EXPORT_PENDING');expect(statement.payable.toFixed(2)).toBe('152.00');expect(job).toMatchObject({status:'PENDING',attempts:0,response:null});expect(job.availableAt.toISOString()).toBe('2100-01-01T00:00:00.000Z');
 expect(await processOutbox(job.id)).toBe(false);expect(await db.mockRecord.count({where:{idempotencyKey:job.idempotencyKey}})).toBe(0);
 expect(await db.order.count()).toBe(before.orders);expect(await db.fulfilmentLeg.count()).toBe(before.legs);expect(await db.inventory.findMany({orderBy:{id:'asc'}})).toEqual(before.stock);
 expect(await db.financialEvent.findMany({where:{id:{in:before.ledger.map(e=>e.id)}},orderBy:{id:'asc'}})).toEqual(before.ledger);
 expect(await db.financialEvent.count({where:{sourceId:`${first.statementId}:historical-sale`,settlementId:first.statementId}})).toBe(4);
 expect(await db.auditEvent.count({where:{entityId:first.statementId,action:'demo.reconciliation-prepared'}})).toBe(1);
});

it('demonstrates detect → release → actual mock worker acknowledgement → verified resolution with retained evidence',async()=>{
 const scenario=await prepareReconciliationScenario(run),actor=await db.user.findUniqueOrThrow({where:{email:'admin@ati.demo'}}),target={entityType:'SETTLEMENT' as const,id:scenario.statementId};
 const before=await reconciliationDetail(actor,target);expect(before.checks.map(c=>c.status)).toEqual(['MATCH','MATCH','MISSING']);
 await scanReconciliation(actor,{...target,reason:'Record the intentionally held Finance export in the training scenario'},run);
 const issue=await db.reconciliationIssue.findFirstOrThrow({where:{entityId:target.id}});
 await expect(resolveReconciliation(actor,issue.id,{expectedVersion:issue.version,reason:'Attempt premature closure while the export remains held'},run)).rejects.toMatchObject({code:'MISMATCH_UNRESOLVED'});
 expect((await releaseReconciliationScenario(run)).released).toBe(true);expect((await releaseReconciliationScenario(run)).released).toBe(false);
 expect(await processOutbox(scenario.jobId)).toBe(true);
 const job=await db.outbox.findUniqueOrThrow({where:{id:scenario.jobId}});expect(job.status).toBe('SUCCEEDED');expect(job.attempts).toBe(1);expect(await db.integrationAttempt.count({where:{jobId:job.id,status:'SUCCEEDED'}})).toBe(1);
 const after=await reconciliationDetail(actor,target);expect(after.checks.every(c=>c.status==='MATCH')).toBe(true);expect(after.issues[0].status).toBe('OPEN');
 const resolved=await resolveReconciliation(actor,issue.id,{expectedVersion:issue.version,reason:'Worker Finance acknowledgement now matches the locked training statement'},run);expect(resolved.status).toBe('RESOLVED');expect(resolved.firstActual).toBe('No eligible evidence recorded');
 expect((await prepareReconciliationScenario(run)).status).toBe('EXPORTED');expect((await db.reconciliationIssue.findUniqueOrThrow({where:{id:issue.id}})).version).toBe(resolved.version);
 expect(await db.financialEvent.count({where:{sourceId:scenario.statementId,kind:'PAYOUT_CONFIRMED'}})).toBe(0);
 expect(await db.auditEvent.count({where:{entityId:scenario.statementId,action:'demo.reconciliation-export-released'}})).toBe(1);
});

it('rejects remote databases, production, disabled demo and live Finance before creating fixture records',async()=>{
 const before=await db.settlement.count();
 for(const [key,value] of [['DATABASE_URL','postgresql://user:pass@example.invalid/ecs_demo'],['DATABASE_URL','postgresql://user:pass@127.0.0.1/production'],['NODE_ENV','production'],['DEMO_MODE','false'],['FINANCE_MODE','live'],['MOCK_ORIGIN','https://example.invalid']]){
  const original=process.env[key];vi.stubEnv(key,value);
  try{await expect(prepareReconciliationScenario('guarded')).rejects.toThrow();await expect(releaseReconciliationScenario('guarded')).rejects.toThrow();}finally{if(original===undefined)delete process.env[key];else process.env[key]=original;}
 }
 await expect(prepareReconciliationScenario('../bad')).rejects.toThrow();expect(await db.settlement.count()).toBe(before);
});

it('refuses identifier collisions and audit failures without partial ledger or fixture writes',async()=>{
 const collision=`collision-${randomUUID().slice(0,8)}`,id=`demo_reconciliation_${collision}`;
 await db.settlement.create({data:{id,companyId:'other-company',partnerId:'other-partner',market:'AE',currency:'AED',from:new Date(),to:new Date(),payable:'0',status:'DRAFT',evidence:{eventIds:[]}}});
 const before=await db.financialEvent.count();await expect(prepareReconciliationScenario(collision)).rejects.toMatchObject({code:'FIXTURE_CONFLICT'});expect(await db.financialEvent.count()).toBe(before);
 const failed=`rollback-${randomUUID().slice(0,8)}`,helpers=await import('../../packages/db/transaction'),spy=vi.spyOn(helpers,'audit').mockRejectedValueOnce(Error('Audit unavailable'));
 try{await expect(prepareReconciliationScenario(failed)).rejects.toThrow('Audit unavailable');}finally{spy.mockRestore();}
 expect(await db.settlement.findUnique({where:{id:`demo_reconciliation_${failed}`}})).toBeNull();expect(await db.financialEvent.count()).toBe(before);expect(await db.outbox.count({where:{aggregateId:`demo_reconciliation_${failed}`}})).toBe(0);
});

it('does not adopt a foreign ledger event whose idempotency key collides with the fixture',async()=>{
 const collision=`key-${randomUUID().slice(0,8)}`,source=`demo_reconciliation_${collision}:historical-sale`;
 const foreign=await db.financialEvent.create({data:{companyId:'other-company',partnerId:'other-partner',market:'AE',kind:'SALE_RECOGNISED',amount:'999',currency:'AED',sourceId:'foreign-source',idempotencyKey:`${source}:SALE_RECOGNISED`,snapshot:{test:true}}});
 await expect(prepareReconciliationScenario(collision)).rejects.toMatchObject({code:'FIXTURE_CONFLICT'});
 expect(await db.financialEvent.findUnique({where:{id:foreign.id}})).toEqual(foreign);expect(await db.settlement.findUnique({where:{id:`demo_reconciliation_${collision}`}})).toBeNull();
});
