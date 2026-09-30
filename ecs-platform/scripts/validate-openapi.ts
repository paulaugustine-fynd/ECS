import {writeFile,mkdir} from 'node:fs/promises';
import type {OpenAPIV3_1} from 'openapi-types';
import {createServer} from '../apps/api/src/server';
import {db} from '../packages/db/client';
import {validateOpenApi} from '../packages/contracts/validate-openapi';

// Boot the route registry, not a listener. No endpoint, DB query or adapter is called.
// Defaults make this check runnable on a clean checkout without database credentials.
process.env.DATABASE_URL??='postgresql://unused:unused@127.0.0.1:1/ecs_contract_check';
process.env.WEBHOOK_SECRET??='offline-contract-validation-secret-not-for-runtime';
process.env.MOCK_SECRET??='offline-contract-validation-mock-secret-not-for-runtime';
Object.assign(process.env,{NODE_ENV:'test'});
const args=new Set(process.argv.slice(2));
if([...args].some(arg=>!['--complete','--export'].includes(arg)))throw new Error('Usage: pnpm openapi:validate [--complete] [--export]');
const app=await createServer();
try{
 const document=app.swagger() as OpenAPIV3_1.Document;
 const report=await validateOpenApi(document,{complete:args.has('--complete')});
 console.log(`OpenAPI 3.1 structure and request coverage: PASS (${report.operations} operations).`);
 console.log(`Success response contracts: ${report.operations-report.missingResponses.length}/${report.operations}.`);
 if(report.missingResponses.length)console.log(`INCOMPLETE: ${report.missingResponses.length} success payload schemas remain pending. Use --complete for the full acceptance gate.\n${report.missingResponses.join('\n')}`);
 if(args.has('--export')){
  await mkdir('.local/contracts',{recursive:true});
  await writeFile('.local/contracts/ecs-openapi.json',JSON.stringify(document,null,2)+'\n');
  console.log('Exported .local/contracts/ecs-openapi.json (local, ignored by Git).');
 }
}catch(error){
 console.error(error instanceof Error?error.message:'OpenAPI validation failed');process.exitCode=1;
}finally{await app.close();await db.$disconnect();}
