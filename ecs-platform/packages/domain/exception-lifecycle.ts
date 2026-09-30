import type {Prisma} from '@prisma/client';
type Input={companyId:string;partnerId?:string|null;market:string;kind:string;entityId:string;message:string;createdAt?:Date};
/** Use the originating business transaction; keep ownership on escalation/reopen. */
export async function openException(tx:Prisma.TransactionClient,input:Input){
 const key={kind:input.kind,entityId:input.entityId};
 const existing=await tx.exception.findUnique({where:{kind_entityId:key}});
 if(existing?.status==='OPEN'&&existing.message===input.message)return existing;
 return tx.exception.upsert({where:{kind_entityId:key},create:input,update:{status:'OPEN',message:input.message,reason:null,resolvedAt:null,version:{increment:1}}});
}
export async function transitionException(tx:Prisma.TransactionClient,kind:string,entityId:string,status:'RESOLVED'|'WAIVED'|'REPLAY_REQUESTED',reason?:string){
 return tx.exception.updateMany({where:{kind,entityId,status:{not:status}},data:{status,version:{increment:1},resolvedAt:status==='REPLAY_REQUESTED'?null:new Date(),...(reason?{reason}:{})}});
}
