import {db} from '../../../packages/db/client';
import {readEnv} from '../../../packages/config/env';
import {hostedDemo} from '../../../packages/config/hosted-demo';
import {seedDemo} from '../../../prisma/seed';
export async function bootstrapHostedDemo(){
 readEnv();if(!hostedDemo())return;
 await db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(91426, 1)`;
  if(await tx.partner.count())return; // Never reset, replace or reseed a used demo.
  await seedDemo(tx);
 },{timeout:120000,maxWait:15000});
}
