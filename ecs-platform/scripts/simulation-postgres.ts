// Isolated simulator acceptance server. Never opens or resets the presenter database.
import EmbeddedPostgres from 'embedded-postgres';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
const databaseDir=resolve('.local/simulation-postgres');
const pg=new EmbeddedPostgres({databaseDir,port:55433,user:'ecs',password:'ecs_local_only',persistent:true,postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:message=>console.error(String(message))});
if(!existsSync(resolve(databaseDir,'PG_VERSION')))await pg.initialise();
await pg.start();
const client=pg.getPgClient();await client.connect();
const found=await client.query("SELECT 1 FROM pg_database WHERE datname='ecs_test'");
if(!found.rowCount)await client.query('CREATE DATABASE ecs_test');
await client.end();
console.log('Isolated simulator PostgreSQL ready on 127.0.0.1:55433. Test data retained; no presenter data touched.');
let closing=false;async function close(){if(closing)return;closing=true;await pg.stop();process.exit(0);}
process.on('SIGINT',close);process.on('SIGTERM',close);setInterval(()=>{},60000);
