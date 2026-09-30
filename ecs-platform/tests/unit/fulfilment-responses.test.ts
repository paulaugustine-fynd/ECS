import {describe,it,expect} from 'vitest';
import {orderListResponse,shipmentDetailResponse,routingTraceResponse,fulfilmentResponseSchemas} from '../../packages/contracts/fulfilment-responses';

const date='2026-09-24T08:00:00.000Z';
const shipment={id:'leg',orderId:'order',companyId:'ati',partnerId:'vendor',market:'AE',locationId:'warehouse',status:'ASSIGNED',fyndId:'mock-1',tracking:null,version:2,requestedStatus:'ACCEPTED',createdAt:date,deadline:date,deliveredAt:null,lines:[],routingTrace:[],order:{externalId:'external',currency:'AED'}};
describe('serialized fulfilment contracts',()=>{
 it('does not allow full-order fields in vendor order references or shipment envelopes',()=>{
  expect(orderListResponse.safeParse({view:'shipments',items:[shipment]}).success).toBe(true);
  for(const field of [{total:'1000'},{legs:[]},{lines:[]},{payloadHash:'private'}]){
   expect(orderListResponse.safeParse({view:'shipments',items:[{...shipment,order:{...shipment.order,...field}}]}).success).toBe(false);
  }
  expect(shipmentDetailResponse.safeParse({...shipment,total:'1000'}).success).toBe(false);
  expect(orderListResponse.safeParse({view:'orders',items:[shipment]}).success).toBe(false);
 });
 it('keeps historical routing evidence explicit and rejects arbitrary routing objects',()=>{
  expect(routingTraceResponse.safeParse({fixture:true,explanation:'Historical, not a fresh allocation'}).success).toBe(true);
  expect(routingTraceResponse.safeParse({fixture:false,explanation:'Claimed live'}).success).toBe(false);
  expect(routingTraceResponse.safeParse({arbitrary:'unvalidated'}).success).toBe(false);
 });
 it('distinguishes durable intake from processing and duplicate acknowledgement',()=>{
  const schema=fulfilmentResponseSchemas['POST /api/v1/demo/orders'];
  expect(schema.safeParse({receiptId:'receipt',status:'PENDING',sourceMode:'signed-sfcc-simulator'}).success).toBe(true);
  expect(schema.safeParse({receiptId:'receipt',duplicate:true,sourceMode:'signed-sfcc-simulator'}).success).toBe(true);
  expect(schema.safeParse({receiptId:'receipt',status:'DELIVERED',sourceMode:'live-fynd'}).success).toBe(false);
 });
});
