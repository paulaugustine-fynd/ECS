import {db} from '../packages/db/client';
import {transaction,audit} from '../packages/db/transaction';
import {seedBrandRights} from '../prisma/brand-right-fixtures';
import {reconcileAvailability} from '../packages/domain/inventory';
const url=new URL(process.env.DATABASE_URL??'');
if(process.env.DEMO_MODE!=='true'||process.env.NODE_ENV==='production'||!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/ecs_demo')throw new Error('Fictional rights materialization is local ecs_demo only');
try{const count=await transaction(async tx=>{const n=await seedBrandRights(tx);if(n){const actor=await tx.user.findUniqueOrThrow({where:{email:'admin@ati.demo'}});await audit(tx,actor,'fixture-rights','demo.materialize-rights','main',null,{count:n},'Fictional sample grants; existing reviewed rights were not modified');}await reconcileAvailability(tx);return n;});console.log(`Added ${count} fictional brand grants; existing records preserved.`);}finally{await db.$disconnect();}
