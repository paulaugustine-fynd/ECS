import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {db} from '../../packages/db/client';
import {transaction,enqueue} from '../../packages/db/transaction';
import {processOutbox} from '../../apps/worker/src/outbox';
import {adapter} from '../../packages/integrations/adapter';
import {inlineMockRequest} from '../../packages/integrations/inline-mock';
import {systems} from '../../packages/config/env';
import {fetchDamAsset} from '../../packages/media/dam';
import {fetchImageSource} from '../../packages/media/url';
const id=`inline-${randomUUID()}`,actor={id,companyId:id,partnerId:null,markets:['AE'],role:'ATI_SUPER_ADMIN'};
const previousOrigin=process.env.MOCK_ORIGIN;
beforeAll(()=>{const url=new URL(process.env.DATABASE_URL??'');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/ecs_test')throw Error('Requires isolated local ecs_test');process.env.MOCK_ORIGIN='mock://ecs-inline';});
afterAll(async()=>{process.env.MOCK_ORIGIN=previousOrigin;vi.unstubAllGlobals();await db.$disconnect();});
it('dispatches all six adapters through the durable outbox with no HTTP service',async()=>{
 vi.stubGlobal('fetch',vi.fn(()=>{throw Error('HTTP must not be used by an inline simulator');}));
 for(const system of systems){
  const job=await transaction(tx=>enqueue(tx,actor,id,system,'contractProbe',id,{demoOnly:true},`${id}:${system}`));
  expect(job.destinationOrigin).toBe('mock://ecs-inline');await processOutbox(job.id);
  expect(await db.outbox.findUniqueOrThrow({where:{id:job.id}})).toMatchObject({status:'SUCCEEDED',attempts:1});
  expect(await db.integrationAttempt.count({where:{jobId:job.id,status:'SUCCEEDED'}})).toBe(1);
  await processOutbox(job.id);expect(await db.mockRecord.count({where:{system,idempotencyKey:job.idempotencyKey}})).toBe(1);
 }
 expect(await adapter('FYND').health()).toBe(true);expect(fetch).not.toHaveBeenCalled();
});
it('retains idempotency conflicts, secret checks and local mock evidence',async()=>{
 const port=adapter('ERP'),ctx={idempotencyKey:`${id}:identity`,correlationId:id};
 const first=await port.execute('contractProbe',{value:1},ctx);expect(await port.execute('contractProbe',{value:1},ctx)).toEqual(first);
 await expect(port.execute('contractProbe',{value:2},ctx)).rejects.toMatchObject({statusCode:409,retryable:false});
 const unauth=await inlineMockRequest('/systems/ERP/contractProbe',{method:'POST',headers:{'content-type':'application/json','x-idempotency-key':'forged'},body:'{}'});expect(unauth.status).toBe(401);
 await expect(inlineMockRequest('/admin/reset')).rejects.toThrow('Unknown');
});
it('serves validated DAM and supplier fixture images without localhost requests',async()=>{
 const asset=await fetchDamAsset('studio-front','mock://ecs-inline');expect(asset.bytes.length).toBeGreaterThan(0);
 const image=await fetchImageSource('demo://supplier/front.png','mock://ecs-inline');expect(image.mock).toBe(true);expect(image.bytes.subarray(0,4)).toEqual(Buffer.from([137,80,78,71]));expect(fetch).not.toHaveBeenCalled();
});
