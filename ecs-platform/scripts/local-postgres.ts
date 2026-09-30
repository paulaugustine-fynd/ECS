import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const databaseDir=resolve('.local/postgres');
const pg=new EmbeddedPostgres({databaseDir,port:55432,user:'ecs',password:'ecs_local_only',persistent:true,postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:message=>console.error(String(message))});
if(!existsSync(resolve(databaseDir,'PG_VERSION'))) await pg.initialise();
await pg.start();
const client=pg.getPgClient();
await client.connect();
for(const database of ['ecs_demo','ecs_test']) {
  const found=await client.query('SELECT 1 FROM pg_database WHERE datname=$1',[database]);
  if(!found.rowCount) await client.query(`CREATE DATABASE ${database}`);
}
await client.end();
console.log('Local PostgreSQL ready on 127.0.0.1:55432 (ecs_demo, ecs_test). Ctrl+C stops it; data is retained in .local/postgres.');
let closing=false;
async function close(){if(closing)return;closing=true;await pg.stop();process.exit(0);}
process.on('SIGINT',close);process.on('SIGTERM',close);
setInterval(()=>{},60000);
