import {db} from '../../packages/db/client';
import {transaction,enqueue} from '../../packages/db/transaction';
import {projectStorefront} from '../../packages/domain/storefront-contract';
import {processOutbox} from '../../apps/worker/src/outbox';
import {randomUUID} from 'node:crypto';
export async function storefrontFixture(productId:string){
 const p=await db.product.findUniqueOrThrow({where:{id:productId},include:{publications:true}});
 const externalId=p.publications.find(x=>x.target==='SFCC'&&x.version===p.version)!.externalId!;
 const job=await transaction(tx=>enqueue(tx,{id:'test-storefront',companyId:p.companyId,partnerId:null,markets:[p.market],role:'ATI_SUPER_ADMIN'},'test-storefront','SFCC','publishStorefront',p.id,projectStorefront(p,externalId),`fixture-storefront:${randomUUID()}`,p.partnerId));
 await processOutbox(job.id);return db.outbox.findUniqueOrThrow({where:{id:job.id}});
}
