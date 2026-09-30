import {z} from 'zod';
import {type Actor,scope,isVendor,partnerScope} from '../auth/policy';
import {db} from '../db/client';
import {audit,transaction} from '../db/transaction';
import {requireCondition} from './errors';
import {reconcileAvailability} from './inventory';
const fields=z.object({name:z.string().trim().min(3).max(120),type:z.enum(['WAREHOUSE','VENDOR_WAREHOUSE','BRAND_STORE']),deliveryCities:z.array(z.string().trim().min(2).max(80)).min(1).max(30),cutoffHour:z.number().int().min(0).max(23),dailyCapacity:z.number().int().min(1).max(100000),status:z.enum(['ACTIVE','INACTIVE']),reason:z.string().trim().min(5).max(1000)}).strict();
export const locationCreate=fields.extend({requestId:z.string().uuid(),partnerId:z.string().nullable(),market:z.literal('AE')}).strict();
export const locationEdit=fields.extend({expectedVersion:z.number().int().positive()}).strict();
function write(actor:Actor){requireCondition(['ATI_SUPER_ADMIN','ATI_PARTNER_MANAGER','ATI_OPERATIONS_MANAGER'].includes(actor.role),'FORBIDDEN','Only ATI can configure fulfilment locations',403);}
function validate(type:string,partnerId:string|null,cities:string[]){requireCondition((partnerId===null)===(type==='WAREHOUSE'),'LOCATION_OWNER_TYPE','ATI warehouses need ATI ownership; partner warehouses/stores need a partner');requireCondition(new Set(cities.map(c=>c.toLowerCase())).size===cities.length,'DUPLICATE_CITY','Delivery cities must be unique');}
export async function listLocations(actor:Actor){scope(actor);return {items:await db.location.findMany({where:{companyId:actor.companyId,market:{in:actor.markets},...(isVendor(actor)?{partnerId:actor.partnerId!}:{})},orderBy:{name:'asc'}})};}
export async function createLocation(actor:Actor,input:z.infer<typeof locationCreate>,correlationId:string){write(actor);scope(actor,input.market);validate(input.type,input.partnerId,input.deliveryCities);return transaction(async tx=>{
 if(input.partnerId)requireCondition(await tx.partner.findFirst({where:{AND:[partnerScope(actor),{id:input.partnerId,markets:{has:input.market}}]}}),'NOT_FOUND','Partner is not assigned to this company/market',404);
 const {requestId,reason,...data}=input,id=`loc_${requestId}`;
 const existing=await tx.location.findUnique({where:{id}});
 if(existing){requireCondition(existing.companyId===actor.companyId&&existing.partnerId===data.partnerId&&existing.market===data.market&&existing.name===data.name&&existing.type===data.type&&existing.status===data.status&&existing.cutoffHour===data.cutoffHour&&existing.dailyCapacity===data.dailyCapacity&&JSON.stringify(existing.deliveryCities)===JSON.stringify(data.deliveryCities),'REQUEST_CONFLICT','Location request ID is already used',409);return existing;}
 const saved=await tx.location.create({data:{...data,id,companyId:actor.companyId}});
 if(saved.partnerId)await reconcileAvailability(tx,saved.partnerId,correlationId);
 await audit(tx,{...actor,markets:[saved.market]},correlationId,'location.created',id,null,saved,reason,saved.partnerId??undefined);return saved;
 });}
export async function editLocation(actor:Actor,id:string,input:z.infer<typeof locationEdit>,correlationId:string){write(actor);return transaction(async tx=>{
 const previous=await tx.location.findFirst({where:{id,companyId:actor.companyId,market:{in:actor.markets}}});requireCondition(previous,'NOT_FOUND','Location not found',404);
 requireCondition(previous.version===input.expectedVersion,'STALE_VERSION','Location changed; refresh before saving',409);validate(input.type,previous.partnerId,input.deliveryCities);
 const {expectedVersion:_,reason,...data}=input;void _;
 const updated=await tx.location.update({where:{id},data:{...data,version:{increment:1},fyndId:null}});
 // Clear mapping before reconciliation, keeping physical/reserved units intact.
 // Existing fulfilment legs are not moved or cancelled by location edits.
 const owners=await tx.product.findMany({where:{inventory:{some:{locationId:id}}},select:{partnerId:true},distinct:['partnerId']});
 for(const owner of owners)await reconcileAvailability(tx,owner.partnerId,correlationId);
 await audit(tx,{...actor,markets:[previous.market]},correlationId,'location.updated',id,previous,updated,reason,previous.partnerId??undefined);return updated;
 });}
