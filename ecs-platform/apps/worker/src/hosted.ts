import {db} from '../../../packages/db/client';
import {readEnv} from '../../../packages/config/env';
import {hostedDemo} from '../../../packages/config/hosted-demo';
import {processOutbox} from './outbox';
import {processInbox} from './inbox';
import {processMediaJob} from './media-source';
import {expireExchangePaymentHolds} from '../../../packages/domain/exchange-cancellation';
import {transaction} from '../../../packages/db/transaction';
import {reconcileAvailability} from '../../../packages/domain/inventory';
import {reconcileSlas} from '../../../packages/domain/sla';
let pending:Promise<void>|undefined,lastReconcile=0;
export async function runHostedWorker(){
 readEnv();if(!hostedDemo())return;
 return pending??=(async()=>{
  const start=Date.now();
  await expireExchangePaymentHolds();
  if(start-lastReconcile>30000){await transaction(async tx=>{await reconcileAvailability(tx);await reconcileSlas(tx);});lastReconcile=Date.now();}
  for(let n=0;n<15&&Date.now()-start<12000;n++){
   const inbox=await db.inbox.findFirst({where:{status:{in:['PENDING','RETRY']},availableAt:{lte:new Date()}},orderBy:{createdAt:'asc'},select:{id:true}});
   if(inbox){await processInbox(inbox.id);continue;}
   const job=await db.outbox.findFirst({where:{availableAt:{lte:new Date()},OR:[{status:{in:['PENDING','RETRY']}},{status:'PROCESSING',leaseUntil:{lt:new Date()}}]},orderBy:{createdAt:'asc'},select:{id:true}});
   if(job){await processOutbox(job.id);continue;}
   const media=await db.mediaSourceJob.findFirst({where:{availableAt:{lte:new Date()},OR:[{status:{in:['PENDING','RETRY']}},{status:'PROCESSING',leaseUntil:{lt:new Date()}}]},orderBy:{createdAt:'asc'},select:{id:true}});
   if(media){await processMediaJob(media.id);continue;}
   break;
  }
 })().finally(()=>{pending=undefined;});
}
