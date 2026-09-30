import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { db } from '../../../packages/db/client';
import { readEnv } from '../../../packages/config/env';
import { processOutbox } from './outbox';
import { pollInbox } from './inbox';
import {pollMediaJobs} from './media-source';
import {transaction} from '../../../packages/db/transaction';
import {reconcileAvailability} from '../../../packages/domain/inventory';
import {reconcileSlas} from '../../../packages/domain/sla';
import {expireExchangePaymentHolds} from '../../../packages/domain/exchange-cancellation';
const env = readEnv();
const connection = new Redis(env.REDIS_URL,{maxRetriesPerRequest:null});
const queue = new Queue('ecs-outbox',{connection});
const worker = new Worker('ecs-outbox',async job => processOutbox(String(job.data.id)),{connection,concurrency:4});
worker.on('error',error => console.error('Queue error:',error.message));
let polling = false;
let eligibilityCheck=0;
const timer = setInterval(async () => {
  if (polling) return;
  polling = true;
  try {
    if(env.DEMO_MODE==='true'&&env.NODE_ENV!=='production')await expireExchangePaymentHolds();
    if(Date.now()-eligibilityCheck>10000){await transaction(async tx=>{await reconcileAvailability(tx);await reconcileSlas(tx);});eligibilityCheck=Date.now();}
    await pollInbox();
    await pollMediaJobs();
    const jobs = await db.outbox.findMany({where:{availableAt:{lte:new Date()},OR:[{status:{in:['PENDING','RETRY']}},{status:'PROCESSING',leaseUntil:{lt:new Date()}}]},select:{id:true},take:50,orderBy:{createdAt:'asc'}});
    await queue.addBulk(jobs.map(j => ({name:'dispatch',data:{id:j.id},opts:{jobId:j.id,removeOnComplete:true,removeOnFail:true}})));
  } catch(error) {console.error('Outbox polling error:',error instanceof Error ? error.message : 'unknown');}
  finally {polling=false;}
},1000);
async function close() {clearInterval(timer);await worker.close();await queue.close();await connection.quit();await db.$disconnect();}
process.on('SIGTERM',close);process.on('SIGINT',close);
