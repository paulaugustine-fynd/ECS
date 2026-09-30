import type {Prisma} from '@prisma/client';
import {sellable} from './calculations';
import {stockEligible} from './inventory';
import {mappingReadiness} from './mappings';

// Evidence is read from the current revision, not Partner.inventorySynced or a
// timestamp. Mock read-back is deliberately not presented as real Fynd proof.
export async function inventoryReadiness(tx:Prisma.TransactionClient,partnerId:string){
 const partner=await tx.partner.findUniqueOrThrow({where:{id:partnerId}});
 const now=(await tx.demoClock.findUniqueOrThrow({where:{id:'main'}})).now;
 const mapped=(await mappingReadiness(tx,partnerId)).passed;
 const rows=await tx.inventory.findMany({where:{product:{partnerId,companyId:partner.companyId,status:'PUBLISHED'}},include:{product:{include:{publications:true,partner:{include:{brandRights:true}}}},location:true}});
 const ids=rows.map(row=>row.id);
 const [jobs,downstream]=await Promise.all([
  tx.outbox.findMany({where:{companyId:partner.companyId,partnerId,operation:'syncInventory',aggregateId:{in:ids},target:{in:['FYND','SFCC']},status:'SUCCEEDED',destinationMode:'mock'}}),
  tx.mockInventory.findMany({where:{inventoryId:{in:ids},system:{in:['FYND','SFCC']}}}),
 ]);
 const positions=rows.map(row=>{
  const issues:string[]=[];
  if(!partner.markets.includes(row.product.market))issues.push('Product market is not enabled for this partner');
  if(row.location.companyId!==partner.companyId||row.location.market!==row.product.market||(row.location.partnerId!==null&&row.location.partnerId!==partnerId)||row.location.status!=='ACTIVE'||!row.location.fyndId)issues.push('Active company/market/owner location mapping is missing');
  if(!['ERP','FYND','SFCC'].every(target=>row.product.publications.some(p=>p.target===target&&p.version===row.product.version&&p.status==='SUCCEEDED'&&p.externalId)))issues.push('Current catalogue version has not been acknowledged by all three systems');
  const expectedSellable=sellable(row,stockEligible(row,now)&&mapped);
  for(const target of ['FYND','SFCC']){
   const job=jobs.find(j=>{
    const p=j.payload as Record<string,unknown>;
    return j.target===target&&j.aggregateId===row.id&&j.market===row.product.market&&p.inventoryId===row.id&&p.revision===row.revision&&p.sequence===row.sequence&&p.sellable===expectedSellable&&p.fyndLocationId===row.location.fyndId;
   });
   if(!job)issues.push(`${target}: current stock revision is not acknowledged`);
   const value=downstream.find(d=>d.system===target&&d.inventoryId===row.id);
   if(!value||value.revision!==row.revision||value.sellable!==expectedSellable)issues.push(`${target}: mock read-back differs from current stock`);
  }
  return {inventoryId:row.id,sku:row.product.sku,locationName:row.location.name,revision:row.revision,expectedSellable,passed:issues.length===0,issues};
 });
 const verified=positions.filter(p=>p.passed).length;
 const missing=await tx.product.count({where:{partnerId,companyId:partner.companyId,status:'PUBLISHED',inventory:{none:{}}}});
 return {key:'inventory',label:'Current inventory acknowledged and reconciled (mock)',passed:positions.length>0&&verified===positions.length&&missing===0,detail:(positions.length?`${verified}/${positions.length} published stock positions verified against FYND and SFCC. Before activation, expected availability is zero.`:'No published stock positions to verify.')+(missing?` ${missing} published products have no stock position.`:''),positions};
}
