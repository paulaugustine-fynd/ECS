import {z} from 'zod';
import {type Actor,partnerScope,permit} from '../auth/policy';
import {db} from '../db/client';
import {audit,transaction} from '../db/transaction';
import {requireCondition} from './errors';
import {hasBrandRight,rightState} from './brand-policy';
import {reconcileAvailability} from './inventory';
const reason=z.string().trim().min(5).max(1000);
const category=z.string().trim().min(1).max(120).refine(s=>s.split('/').every(v=>v.trim()===v&&v.length>0)&&!s.includes('*'),'Use a category path, not a wildcard');
export const brandRightInput=z.object({brand:z.string().trim().regex(/^[a-zA-Z0-9_-]{2,100}$/),market:z.enum(['AE','SA','KW']),categories:z.array(category).min(1).max(30),validFrom:z.string().datetime(),validUntil:z.string().datetime(),evidence:z.string().trim().min(5).max(1000),reason}).strict();
export const brandRightCommand=z.object({action:z.enum(['approve','reject','pause','suspend','resume','revoke']),expectedVersion:z.number().int().positive(),reason}).strict();
function read(actor:Actor){requireCondition(['ATI_SUPER_ADMIN','ATI_PARTNER_MANAGER','ATI_CATALOG_MODERATOR','ATI_OPERATIONS_MANAGER','ATI_AUDITOR','VENDOR_ADMIN','VENDOR_CATALOG_MANAGER'].includes(actor.role),'FORBIDDEN','Your role cannot read brand rights',403);}
export async function listBrandRights(actor:Actor,id:string){
 read(actor);requireCondition(await db.partner.findFirst({where:{AND:[{id},partnerScope(actor)]}}),'NOT_FOUND','Partner not found',404);
 const now=(await db.demoClock.findUniqueOrThrow({where:{id:'main'}})).now;
 const items=await db.brandRight.findMany({where:{partnerId:id,market:{in:actor.markets}},orderBy:{createdAt:'desc'}});
 const products=await db.product.findMany({where:{partnerId:id,market:{in:actor.markets}},select:{id:true,sku:true,brand:true,category:true,market:true,status:true}});
 return {now,items:items.map(r=>({...r,effectiveState:rightState(r,now)})),products:products.map(p=>({...p,authorized:hasBrandRight(items,p,now)}))};
}
export async function createBrandRight(actor:Actor,id:string,input:z.infer<typeof brandRightInput>,correlationId:string){
 permit(actor,'partners',true);return transaction(async tx=>{
  const p=await tx.partner.findFirst({where:{AND:[{id},partnerScope(actor)]}});requireCondition(p,'NOT_FOUND','Partner not found',404);
  requireCondition(actor.markets.includes(input.market)&&p.markets.includes(input.market),'MARKET_FORBIDDEN','This market is not assigned to both the partner and the reviewer',403);
  requireCondition(new Date(input.validUntil)>new Date(input.validFrom),'INVALID_PERIOD','End must be after start');
  const now=(await tx.demoClock.findUniqueOrThrow({where:{id:'main'}})).now;
  requireCondition(new Date(input.validUntil)>now,'EXPIRED_PERIOD','Cannot create an already expired authorization');
  requireCondition(new Set(input.categories).size===input.categories.length,'DUPLICATE_CATEGORY','Category paths must be unique');
  const saved=await tx.brandRight.create({data:{...input,partnerId:id,validFrom:new Date(input.validFrom),validUntil:new Date(input.validUntil)}});
  await audit(tx,{...actor,markets:[input.market]},correlationId,'brand-right.draft',saved.id,null,saved,input.reason,id);return saved;
 });
}
export async function commandBrandRight(actor:Actor,id:string,input:z.infer<typeof brandRightCommand>,correlationId:string){
 permit(actor,'partners',true);return transaction(async tx=>{
  const r=await tx.brandRight.findFirst({where:{id,market:{in:actor.markets},partner:partnerScope(actor)}});requireCondition(r,'NOT_FOUND','Brand authorization not found',404);
  requireCondition(r.version===input.expectedVersion,'STALE_VERSION','Authorization changed; refresh before reviewing',409);
  const allowed:Record<string,string[]>={approve:['DRAFT'],reject:['DRAFT'],pause:['APPROVED'],suspend:['APPROVED','PAUSED'],resume:['PAUSED','SUSPENDED'],revoke:['APPROVED','PAUSED','SUSPENDED']};
  requireCondition(allowed[input.action].includes(r.status),'INVALID_TRANSITION',`Cannot ${input.action} a ${r.status} authorization`,409);
  const next:Record<string,string>={approve:'APPROVED',reject:'REJECTED',pause:'PAUSED',suspend:'SUSPENDED',resume:'APPROVED',revoke:'REVOKED'};
  if(next[input.action]==='APPROVED'){
   const now=(await tx.demoClock.findUniqueOrThrow({where:{id:'main'}})).now;requireCondition(r.validUntil>now,'AUTHORIZATION_EXPIRED','Create a renewal instead of approving expired rights');
   const overlap=await tx.brandRight.findFirst({where:{id:{not:id},partnerId:r.partnerId,brand:r.brand,market:r.market,status:{in:['APPROVED','PAUSED','SUSPENDED']},validFrom:{lt:r.validUntil},validUntil:{gt:r.validFrom}}});
   requireCondition(!overlap,'OVERLAPPING_AUTHORIZATION','Another reviewed authorization covers this brand/market period. Revoke it or schedule a non-overlapping renewal.',409);
  }
  const updated=await tx.brandRight.update({where:{id},data:{status:next[input.action],reason:input.reason,version:{increment:1}}});
  await audit(tx,{...actor,markets:[r.market]},correlationId,`brand-right.${input.action}`,id,r,updated,input.reason,r.partnerId);
  await reconcileAvailability(tx,r.partnerId,correlationId);
  return updated;
 });
}
