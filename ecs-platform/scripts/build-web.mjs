import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import process from 'node:process';
const require=createRequire(import.meta.url);
const env={...process.env,DATABASE_URL:process.env.DATABASE_URL??process.env.POSTGRES_PRISMA_URL};
for(const args of [[require.resolve('prisma/build/index.js'),'generate','--schema=../../prisma/schema.prisma'],[require.resolve('next/dist/bin/next'),'build','--webpack']]){
 const run=spawnSync(process.execPath,args,{stdio:'inherit',env});if(run.status!==0)process.exit(run.status??1);
}
