import {db} from '../../packages/db/client';
import {transaction} from '../../packages/db/transaction';
import {queueMappings} from '../../packages/domain/mappings';
import {processOutbox} from '../../apps/worker/src/outbox';
export async function provisionFixture(partnerId:string){
 const p=await db.partner.update({where:{id:partnerId},data:{version:{increment:1}}});
 await transaction(tx=>queueMappings(tx,{id:'test-provisioner',companyId:p.companyId,partnerId:null,markets:p.markets,role:'ATI_SUPER_ADMIN'},partnerId,'test-provisioning'));
 for(const job of await db.outbox.findMany({where:{partnerId,operation:'provisionMapping',status:'PENDING'}}))await processOutbox(job.id);
 for(const job of await db.outbox.findMany({where:{partnerId,operation:'syncInventory',status:'PENDING'}}))await processOutbox(job.id);
}
