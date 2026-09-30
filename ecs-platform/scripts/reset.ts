import { createInterface } from 'node:readline/promises';
import { db } from '../packages/db/client';
import { seedDemo } from '../prisma/seed';
const url=new URL(process.env.DATABASE_URL??'');
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/ecs_demo'||process.env.NODE_ENV==='production')throw new Error('Reset is restricted to the local ecs_demo database');
const rl=createInterface({input:process.stdin,output:process.stdout});
const answer=await rl.question('This removes ALL fictional ECS demo records, audit history and sessions from local ecs_demo. Type RESET ECS DEMO to continue: ');rl.close();
if(answer!=='RESET ECS DEMO'){console.log('Reset cancelled.');await db.$disconnect();process.exit(0);}
try{
  await db.mockStorefrontProduct.deleteMany();
  await db.mockInventory.deleteMany();
  await db.invitation.deleteMany();
  await db.slaMilestone.deleteMany();await db.slaPolicy.deleteMany();
  await db.notificationPolicy.deleteMany();
  await db.$executeRawUnsafe('TRUNCATE TABLE "ReconciliationIssue", "MockMapping", "LaunchTest", "MockLaunchOrder", "MockExchangeState", "CatalogImport", "Session", "User", "Document", "Agreement", "Publication", "Inventory", "Location", "Product", "Partner", "FulfilmentLeg", "Order", "ReturnCase", "FinancialEvent", "Settlement", "Outbox", "Inbox", "IntegrationAttempt", "AuditEvent", "Exception", "MockRecord", "AdapterFault", "DemoClock" CASCADE');
  await seedDemo();console.log('Fictional local demo reset. Prior demo records are not recoverable unless backed up.');
}finally{await db.$disconnect();}
