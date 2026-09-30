import {createHash} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import type {z} from 'zod';
import type {Actor} from '../auth/policy';
import {db} from '../db/client';
import {audit,transaction} from '../db/transaction';
import {simulationAccess} from './simulations';
import {DomainError,requireCondition} from './errors';
import {advanceCoach,startCoach,coachRun,type coachStart,type coachCommand} from '../simulation/coach-engine';

const scope=(a:Actor,id?:string)=>({companyId:a.companyId,actorId:a.id,action:{in:['coach.created','coach.advanced']},...(id?{entityId:`coach:${id}`}:{})});
const latest=(rows:{after:Prisma.JsonValue|null}[])=>rows.map(r=>coachRun.parse(r.after)).sort((a,b)=>b.version-a.version)[0];
async function lock(tx:Prisma.TransactionClient,a:Actor,id:string){const key=createHash('sha256').update(`coach:${a.companyId}:${a.id}:${id}`).digest().readBigInt64BE();await tx.$executeRaw`SELECT pg_advisory_xact_lock(${key})`;return latest(await tx.auditEvent.findMany({where:scope(a,id),select:{after:true},take:241}));}
export async function createCoach(a:Actor,input:z.infer<typeof coachStart>,correlation:string){simulationAccess(a);return transaction(async tx=>{const existing=await lock(tx,a,input.requestId);if(existing)return {run:existing};const run=startCoach(input.requestId,new Date().toISOString());await audit(tx,a,correlation,'coach.created',`coach:${run.id}`,null,run,'Start a fictional Coach UAE journey; no external writes');return {run};});}
export async function readCoach(a:Actor,id:string){simulationAccess(a);const run=latest(await db.auditEvent.findMany({where:scope(a,id),select:{after:true},take:241}));requireCondition(run,'NOT_FOUND','This saved journey is not available to your account.',404);return {run};}
export async function listCoach(a:Actor){simulationAccess(a);const starts=await db.auditEvent.findMany({where:{...scope(a),action:'coach.created'},select:{entityId:true},orderBy:{createdAt:'desc'},take:20});const rows=await db.auditEvent.findMany({where:{...scope(a),entityId:{in:starts.map(s=>s.entityId)}},select:{entityId:true,after:true}});return {runs:starts.map(s=>latest(rows.filter(r=>r.entityId===s.entityId))).filter(Boolean)};}
export async function updateCoach(a:Actor,id:string,input:z.infer<typeof coachCommand>,correlation:string){simulationAccess(a);return transaction(async tx=>{const current=await lock(tx,a,id);requireCondition(current,'NOT_FOUND','This saved journey is not available to your account.',404);let run;try{run=advanceCoach(current,input,new Date().toISOString());}catch(e){throw new DomainError('COACH_ACTION_BLOCKED',(e as Error).message,409);}if(run===current)return {run};await audit(tx,a,correlation,'coach.advanced',`coach:${id}`,{version:current.version},run,`Guided demo action by ${a.role}; role labels are presentation roles, not impersonation`);return {run};});}
