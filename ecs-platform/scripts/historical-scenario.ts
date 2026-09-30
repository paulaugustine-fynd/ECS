import { pathToFileURL } from 'node:url';
import { db } from '../packages/db/client';
import { audit,json,transaction } from '../packages/db/transaction';
import { digest } from '../packages/auth/security';
import { recognizeDelivery } from '../packages/domain/finance';
import type { ReservedLine } from '../packages/domain/orders';

// Additive fixture only. Existing orders, stock and presentation progress are never reset.
export async function historicalScenario(){
  const url=new URL(process.env.DATABASE_URL??'');
  if(process.env.NODE_ENV==='production'||process.env.DEMO_MODE!=='true'||!['localhost','127.0.0.1'].includes(url.hostname)||!['/ecs_demo','/ecs_test'].includes(url.pathname))throw new Error('Historical fixtures are restricted to explicitly enabled local demo/test databases');
  return transaction(async tx=>{
    const old=await tx.order.findUnique({where:{id:'history_lumera_001'}});if(old)return old;
    const actor=await tx.user.findUniqueOrThrow({where:{email:'admin@ati.demo'}});
    const product=await tx.product.findUniqueOrThrow({where:{id:'prd_lum_serum_3001'}});
    const stock=await tx.inventory.findFirstOrThrow({where:{productId:product.id}});
    const line:ReservedLine={id:'history-serum',sku:product.sku,productId:product.id,inventoryId:stock.id,quantity:2,unitGross:'320.00',vendorDiscount:'64.00',operatorDiscount:'0.00',net:'576.00',commissionRate:'0.32',agreementId:'agreement_vnd_lum_1',agreementVersion:1,returnPolicy:{version:1,days:30,handlingCharge:'20.00'}};
    const order=await tx.order.create({data:{id:'history_lumera_001',companyId:actor.companyId,market:'AE',channel:'BLM-AE',externalId:'BLOOM-AE-HISTORY-0001',currency:'AED',total:'576.00',status:'DELIVERED',fyndId:'fixture-fynd-order-lumera',correlationId:'fixture-history-lumera',payloadHash:digest(JSON.stringify(line)),lines:json([line]),deliveryCity:'Dubai',routingPolicy:'HISTORICAL_FIXTURE',createdAt:new Date('2026-09-20T08:00:00Z')}});
    const leg=await tx.fulfilmentLeg.create({data:{id:'history_lumera_leg_001',orderId:order.id,companyId:actor.companyId,partnerId:'vnd_lum',market:'AE',locationId:stock.locationId,status:'DELIVERED',fyndId:'fixture-fynd-shipment-lumera',tracking:'HISTORICAL-DEMO-001',deadline:new Date('2026-09-22T08:00:00Z'),deliveredAt:new Date('2026-09-21T10:00:00Z'),createdAt:order.createdAt,lines:json([line]),routingTrace:{fixture:true,explanation:'Historical delivery; opening stock already reflects this shipment. No new stock deduction, carrier call or live Fynd acknowledgement is implied.'}}});
    await recognizeDelivery(tx,actor,leg);
    await audit(tx,actor,'fixture-history-lumera','demo.historical-delivery',order.id,null,{orderId:order.id,legId:leg.id,stockBasis:'Opening balances after this historical delivery'},'Additive fictional scenario; ledger booked at current demo clock','vnd_lum');return order;
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const result=await historicalScenario();console.log(`Historical demo ready: ${result.externalId}. Existing presentation state preserved.`);}finally{await db.$disconnect();}}
