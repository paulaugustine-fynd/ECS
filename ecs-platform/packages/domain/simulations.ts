import {createHash} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import type {z} from 'zod';
import type {Actor} from '../auth/policy';
import {db} from '../db/client';
import {audit,transaction} from '../db/transaction';
import {readEnv} from '../config/env';
import {DomainError,requireCondition} from './errors';
import {advanceRun,newRun,simRun,type SimRun,type simStart,type simCommand} from '../simulation/engine';
import {scenarioById} from '../simulation/catalog';

export function simulationAccess(actor:Actor){
 requireCondition(readEnv().DEMO_MODE==='true','DEMO_DISABLED','Simulation Studio is available only in demo mode',403);
 requireCondition(['ATI_SUPER_ADMIN','ATI_PARTNER_MANAGER','ATI_OPERATIONS_MANAGER','ATI_CATALOG_MODERATOR','ATI_FINANCE_ANALYST','ATI_AUDITOR'].includes(actor.role),'FORBIDDEN','Simulation Studio requires an ATI demo operator account',403);
}
const where=(actor:Actor,id?:string)=>({companyId:actor.companyId,actorId:actor.id,action:{in:['simulation.created','simulation.advanced']},...(id?{entityId:`simulation:${id}`}:{})});
function latest(rows:{after:Prisma.JsonValue|null}[]):SimRun|null{
 const runs=rows.map(r=>simRun.parse(r.after));
 return runs.sort((a,b)=>b.version-a.version)[0]??null;
}
async function lockedRead(tx:Prisma.TransactionClient,actor:Actor,id:string){
 // Bound all updates to the creator and company; don't trust scenario actor labels.
 const lock=createHash('sha256').update(`${actor.companyId}:${actor.id}:${id}`).digest().readBigInt64BE();
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lock})`;
 return latest(await tx.auditEvent.findMany({where:where(actor,id),select:{after:true},take:151}));
}
export async function startSimulation(actor:Actor,input:z.infer<typeof simStart>,correlation:string){
 simulationAccess(actor);
 requireCondition(scenarioById(input.scenarioId),'UNKNOWN_SCENARIO','Unknown simulation scenario',400);
 return transaction(async tx=>{
  const current=await lockedRead(tx,actor,input.requestId);
  if(current){
   requireCondition(current.scenarioId===input.scenarioId&&JSON.stringify(current.config)===JSON.stringify(input.config),'IDEMPOTENCY_CONFLICT','Start key belongs to different scenario settings',409);
   return {run:current};
  }
  const run=newRun(input.requestId,input.scenarioId,input.config,new Date().toISOString());
  await audit(tx,actor,correlation,'simulation.created',`simulation:${run.id}`,null,run,`Fictional simulator run; actual role ${actor.role}`);
  return {run};
 });
}
export async function getSimulation(actor:Actor,id:string){
 simulationAccess(actor);
 const run=latest(await db.auditEvent.findMany({where:where(actor,id),select:{after:true},take:151}));
 requireCondition(run,'NOT_FOUND','Simulation run not found',404);
 return {run};
}
export async function listSimulations(actor:Actor){
 simulationAccess(actor);
 const starts=await db.auditEvent.findMany({where:{...where(actor),action:'simulation.created'},orderBy:{createdAt:'desc'},take:54,select:{entityId:true}});
 if(!starts.length)return {runs:[]};
 const events=await db.auditEvent.findMany({where:{...where(actor),entityId:{in:starts.map(r=>r.entityId)}},select:{entityId:true,after:true}});
 return {runs:starts.map(s=>latest(events.filter(e=>e.entityId===s.entityId))!).filter(Boolean)};
}
export async function commandSimulation(actor:Actor,id:string,input:z.infer<typeof simCommand>,correlation:string){
 simulationAccess(actor);
 return transaction(async tx=>{
  const current=await lockedRead(tx,actor,id);
  requireCondition(current,'NOT_FOUND','Simulation run not found',404);
  let run:SimRun;
  try {run=advanceRun(current,input,new Date().toISOString());}
  catch(error){throw new DomainError((error as Error).message,'The run changed or this action is unavailable. Refresh the run and try again.',409);}
  if(run===current)return {run};
  await audit(tx,actor,correlation,'simulation.advanced',`simulation:${id}`,{version:current.version,cursor:current.cursor,status:current.status},run,`Simulation ${input.action}; actual role ${actor.role}`);
  return {run};
 });
}
