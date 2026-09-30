// Explicit local-demo transport, not a silent Redis fallback. Uses the same durable
// PostgreSQL outbox and atomic lease/acknowledgement handler as the BullMQ worker.
import { db } from '../../../packages/db/client';
import { readEnv } from '../../../packages/config/env';
import { processOutbox } from './outbox';
import { pollInbox } from './inbox';
import {pollMediaJobs} from './media-source';
import {transaction} from '../../../packages/db/transaction';
import {reconcileAvailability} from '../../../packages/domain/inventory';
import {reconcileSlas} from '../../../packages/domain/sla';
import {expireExchangePaymentHolds} from '../../../packages/domain/exchange-cancellation';
const env=readEnv();
if(env.DEMO_MODE!=='true'||env.NODE_ENV==='production')throw new Error('Local polling transport is restricted to the local demo');
let closing=false;
let eligibilityCheck=0;
console.log('Local demo outbox worker: PostgreSQL polling (Redis transport not enabled).');
process.on('SIGTERM',()=>{closing=true;});process.on('SIGINT',()=>{closing=true;});
while(!closing){
  try{
    await expireExchangePaymentHolds();
    if(Date.now()-eligibilityCheck>10000){await transaction(async tx=>{await reconcileAvailability(tx);await reconcileSlas(tx);});eligibilityCheck=Date.now();}
    await pollInbox();
    await pollMediaJobs();
    const jobs=await db.outbox.findMany({where:{availableAt:{lte:new Date()},OR:[{status:{in:['PENDING','RETRY']}},{status:'PROCESSING',leaseUntil:{lt:new Date()}}]},select:{id:true},take:20,orderBy:{createdAt:'asc'}});
    for(const job of jobs){if(closing)break;await processOutbox(job.id);}
  }catch(error){console.error('Local outbox dispatch failed:',error instanceof Error?error.message:'unknown');}
  if(!closing)await new Promise(resolve=>setTimeout(resolve,1000));
}
await db.$disconnect();
