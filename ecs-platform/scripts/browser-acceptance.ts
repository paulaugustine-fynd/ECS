import 'dotenv/config';
import {randomUUID} from 'node:crypto';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdir,rmdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {createServer} from 'node:net';
import {PrismaClient} from '@prisma/client';
const require=createRequire(import.meta.url);
const source=new URL(process.env.TEST_DATABASE_URL??process.env.DATABASE_URL??'');
if(!['127.0.0.1','localhost'].includes(source.hostname)||source.protocol!=='postgresql:'||process.env.NODE_ENV==='production')throw Error('Browser acceptance requires local PostgreSQL, never production');
const name=`ecs_e2e_${randomUUID().replaceAll('-','')}`;
source.pathname=`/${name}`;
const env:NodeJS.ProcessEnv={...process.env,NODE_ENV:'test',DATABASE_URL:source.toString(),ECS_E2E:'true',API_PORT:'4002',API_ORIGIN:'http://127.0.0.1:4002',WEB_ORIGIN:'http://127.0.0.1:3002',MOCK_ORIGIN:'http://127.0.0.1:4102',DEMO_MODE:'true',DOCUMENT_STORAGE:'local',DOCUMENT_SCAN_MODE:'mock',FYND_CONNECTION_ENABLED:'false',WEBHOOK_SECRET:'ecs-browser-test-only-webhook-secret',MOCK_SECRET:'ecs-browser-test-only-adapter-secret',PLAYWRIGHT_BROWSERS_PATH:resolve('.local/browsers')};
for(const target of ['FYND','SFCC','ERP','WMS','FINANCE','LOGISTICS'])env[`${target}_MODE`]='mock';
// Browser downloads and their executable path must use the same local cache.
process.env.PLAYWRIGHT_BROWSERS_PATH=env.PLAYWRIGHT_BROWSERS_PATH;
const {chromium}=await import('@playwright/test');
if(!existsSync(chromium.executablePath()))throw Error('Install first: PLAYWRIGHT_BROWSERS_PATH=.local/browsers pnpm exec playwright install chromium');
const lock=resolve('.local/e2e-run.lock');await mkdir(resolve('.local'),{recursive:true});
await mkdir(lock); // Exclusive lock; never remove a lock belonging to another invocation.
const children:ChildProcess[]=[];
function start(args:string[],overrides:Partial<NodeJS.ProcessEnv>={}){const child=spawn(process.execPath,args,{env:{...env,...overrides},stdio:'inherit',detached:true});children.push(child);return child;}
function finished(child:ChildProcess){return new Promise<void>((ok,fail)=>{child.once('error',fail);child.once('exit',(code,signal)=>code===0?ok():fail(Error(`Browser command failed (${code??signal})`)));});}
async function run(args:string[],overrides:Partial<NodeJS.ProcessEnv>={}){await finished(start(args,overrides));}
async function ready(url:string,child:ChildProcess){for(let i=0;i<120;i++){if(child.exitCode!==null||child.signalCode!==null)throw Error(`Service exited before readiness: ${url}`);try{const r=await fetch(url,{signal:AbortSignal.timeout(1000)});if(r.ok)return;}catch{/* Retry only while the owned child remains live. */}await new Promise(r=>setTimeout(r,500));}throw Error(`Service readiness timed out: ${url}`);}
async function portAvailable(port:number){await new Promise<void>((ok,fail)=>{const server=createServer();server.once('error',fail);server.listen(port,'127.0.0.1',()=>server.close(e=>e?fail(e):ok()));});}
let stopping:Promise<void>|undefined;
function stop(){return stopping??=(async()=>{for(const child of children.reverse()){if(child.exitCode!==null||child.signalCode!==null||!child.pid)continue;try{process.kill(-child.pid,'SIGTERM');}catch{/* Child may have exited between the check and signal. */}await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,5000))]);if(child.exitCode===null&&child.signalCode===null)try{process.kill(-child.pid,'SIGKILL');}catch{/* Already terminated. */}}await rmdir(lock);})();}
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void stop().finally(()=>process.exit(130));});
try{
 for(const port of [3002,4002,4102])await portAvailable(port);
 const adminUrl=new URL(source);adminUrl.pathname='/postgres';const admin=new PrismaClient({datasourceUrl:adminUrl.toString()});
 try{await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);}finally{await admin.$disconnect();}
 console.log(`Created isolated browser database ${name}. Existing databases are never reset or dropped.`);
 await run([require.resolve('prisma/build/index.js'),'migrate','deploy']);
 const services=start(['--import','tsx','scripts/browser-services.ts']);await ready('http://127.0.0.1:4002/health',services);
 start(['--import','tsx','apps/worker/src/local.ts']);
 await run([require.resolve('next/dist/bin/next'),'build','apps/web','--webpack'],{NODE_ENV:'production'});
 const web=start([require.resolve('next/dist/bin/next'),'start','apps/web','-H','127.0.0.1','-p','3002'],{NODE_ENV:'production'});await ready('http://127.0.0.1:3002',web);
 await run([require.resolve('@playwright/test/cli'),'test',...process.argv.slice(2)]);
}catch(error){console.error(error instanceof Error?error.message:'Browser acceptance failed');process.exitCode=1;}
finally{await stop();console.log(`Browser services stopped. Diagnostic fixtures retained only in ${name}; traces/reports stay local and ignored.`);}
