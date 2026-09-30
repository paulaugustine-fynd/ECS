import {describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {scenarios} from '../../packages/simulation/catalog';
import {advanceRun,newRun,simConfig,simRun,financePreview,evaluateStep,type SimConfig,type SimRun} from '../../packages/simulation/engine';
const now='2030-01-15T10:00:00.000Z';
const config=simConfig.parse({});
const command=(r:SimRun,action:'next'|'fail'|'retry'|'duplicate'='next')=>({expectedVersion:r.version,commandId:randomUUID(),action});
function full(id:string,patch:Partial<SimConfig>={}){let r=newRun(randomUUID(),id,simConfig.parse(patch),now);while(r.status==='RUNNING')r=advanceRun(r,command(r),now);return r;}
it('covers every original requirement with executable steps and unique operation IDs',()=>{
 expect([...new Set(scenarios.flatMap(s=>s.steps.flatMap(s=>s.requirements)))].sort((a,b)=>a-b)).toEqual(Array.from({length:54},(_,i)=>i+1));
 const ids=scenarios.flatMap(s=>s.steps.map(s=>s.id));expect(new Set(ids).size).toBe(ids.length);
});
describe.each(scenarios)('$id',scenario=>{
 it('runs every step with strict response contracts and no external effects',()=>{
  const r=full(scenario.id);expect(r.status).toBe('COMPLETED');expect(r.cursor).toBe(scenario.steps.length);expect(r.events).toHaveLength(scenario.steps.length);expect(r.facts.externalCalls).toBe(0);expect(simRun.safeParse(r).success).toBe(true);
  expect(r.events.every(e=>e.idempotencyKey.startsWith(r.id)&&Object.keys(e.response).length>=2)).toBe(true);
 });
 it('fails, retries and deduplicates each handoff without duplicating business facts',()=>{
  let r=newRun(randomUUID(),scenario.id,config,now);
  for(const step of scenario.steps){
   const before=r.facts;const cursor=r.cursor;r=advanceRun(r,command(r,'fail'),now);expect(r.status).toBe('DEAD_LETTER');expect(r.facts).toEqual(before);expect(r.cursor).toBe(cursor);
   r=advanceRun(r,command(r,'retry'),now);expect(r.cursor).toBe(cursor+1);expect(r.events.at(-1)?.stepId).toBe(step.id);expect(r.events.at(-1)?.attempt).toBe(2);
   const success=r.facts;r=advanceRun(r,command(r,'duplicate'),now);expect(r.facts).toEqual(success);expect(r.cursor).toBe(cursor+1);expect(r.events.at(-1)?.response.effectsApplied).toBe(0);
  }
  expect(r.status).toBe('COMPLETED');expect(simRun.safeParse(r).success).toBe(true);
 });
});
it('repeated command is idempotent; stale revisions and invalid transitions are rejected',()=>{
 const r=newRun(randomUUID(),'partner-launch',config,now),c=command(r),next=advanceRun(r,c,now);
 expect(advanceRun(next,c,now)).toBe(next);
 expect(()=>advanceRun(next,command(r),now)).toThrow('STALE_SIMULATION');
 expect(()=>advanceRun(r,command(r,'retry'),now)).toThrow('INVALID_SIMULATION_TRANSITION');
 expect(()=>advanceRun(r,command(r,'duplicate'),now)).toThrow('NO_ACKNOWLEDGEMENT');
 expect(()=>advanceRun(full('partner-launch'),{expectedVersion:7,commandId:randomUUID(),action:'next'},now)).toThrow('RUN_COMPLETED');
});
it('evaluates trusted, restricted and high-value manual gates',()=>{
 expect(full('trusted-approval').facts.approvalPath).toBe('AUTO_APPROVED');
 for(const patch of [{trusted:false},{restricted:true},{price:2000}])expect(full('trusted-approval',patch).facts.approvalPath).toBe('MANUAL_REVIEW');
});
it('does not create or approve a creative output without consent',()=>{
 const r=full('media-studio',{consent:false});expect(r.facts.imageJobStatus).toBe('BLOCKED_NO_CONSENT');expect(r.facts.generatedAssetApproved).toBe(false);expect(r.facts.imageOutput).toBe('');
});
it('enforces return window, non-returnability and bad-QC stock/refund outcomes',()=>{
 expect(full('return-journey').facts).toMatchObject({returnStatus:'CLOSED',restockedUnits:1,refundStatus:'ACKNOWLEDGED'});
 for(const patch of [{returnDay:31},{nonReturnable:true}])expect(full('return-journey',patch).facts).toMatchObject({returnStatus:'REJECTED',refundAmount:0,restockedUnits:0,pickupState:'NOT_BOOKED'});
 expect(full('return-journey',{condition:'BAD'}).facts).toMatchObject({returnStatus:'QC_HOLD',refundAmount:0,restockedUnits:0,damagedUnits:1});
 expect(full('return-journey',{returnDay:30,grace:7}).facts.warehouseReceiptDeadlineDay).toBe(37);
});
it('protects inventory against oversell and stale messages',()=>{
 expect(full('stock-rules',{stock:2,safety:2,quantity:1}).facts).toMatchObject({reservationStatus:'REJECTED_INSUFFICIENT_STOCK',sellable:0,sfccSellable:0});
 expect(full('stock-rules',{stock:10,safety:2,quantity:3}).facts).toMatchObject({reservedQuantity:3,sellable:5,sfccSellable:5,staleUpdate:'IGNORED'});
});
it('rejects incorrect pickup code and declined exchange payment',()=>{
 expect(full('fulfilment',{collectionCode:'0000'}).facts).toMatchObject({pickupState:'READY_FOR_COLLECTION',collectionVerification:'REJECTED_WRONG_CODE',stockConsumed:0});
 expect(full('exchange',{paymentApproved:false}).facts).toMatchObject({replacementState:'CANCELLED',releasedUnits:1,replacementShipment:'NONE',originalSaleChanged:false});
});
it('uses exact decimal finance, three-decimal KWD and immutable FX snapshots',()=>{
 const input=simConfig.parse({price:1050,discount:0,taxRate:5,commission:28,handling:20,fxRate:1,actualFx:1.01});
 expect(financePreview(input)).toMatchObject({tax:'50.00',commissionBasis:'1000.00',commission:'280.00',netPayable:'700.00',agreedSettlement:'700.00',actualSettlement:'707.00',fxVariance:'7.00'});
 expect(financePreview({...input,market:'KW',price:1.111,taxRate:0,handling:0,commission:0})).toMatchObject({currency:'KWD',gross:'1.111',netPayable:'1.111'});
 const run=full('finance-cycle',input);expect(run.facts).toMatchObject({reconciliation:'VARIANCE_RESOLVED',originalLockedAmount:'700.00',actualMoneyMoved:false});
});
it('validates configuration bounds and preserves input objects',()=>{
 expect(simConfig.safeParse({...config,price:Infinity}).success).toBe(false);expect(simConfig.safeParse({...config,discount:200}).success).toBe(false);expect(simConfig.safeParse({...config,live:true}).success).toBe(false);
 const r=newRun(randomUUID(),'stock-rules',config,now);const serialized=JSON.stringify(r);advanceRun(r,command(r),now);expect(JSON.stringify(r)).toBe(serialized);
 expect(()=>evaluateStep('not-an-operation',config,{},'test')).toThrow('Missing simulator operation');
});
