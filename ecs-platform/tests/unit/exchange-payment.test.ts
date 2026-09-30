import {it,expect} from 'vitest';
import {exchangePaymentPayload,exchangePaymentResult,exchangeCancellationPayload,exchangeCancellationResult} from '../../packages/contracts/exchange-payment';
const intent={schemaVersion:'1.0',exchangeId:'exchange',orderId:'replacement-order',externalOrderId:'ECS-EX-exchange',companyId:'ati',partnerId:'maison',market:'AE',currency:'AED',amount:'1850.00',policy:'REFUND_AND_REPURCHASE_DEMO_V1',simulatedCustomerAcceptance:true,actualMoneyMoved:false};
it('defines a strict local payment contract with explicit simulated customer acceptance',()=>{
 expect(exchangePaymentPayload.parse(intent)).toEqual(intent);
 for(const invalid of [{...intent,actualMoneyMoved:true},{...intent,simulatedCustomerAcceptance:false},{...intent,amount:1850},{...intent,amount:'1850.001'},{...intent,currency:'USD'},{...intent,cardNumber:'not-collected'},{...intent,schemaVersion:'2.0'}])expect(exchangePaymentPayload.safeParse(invalid).success).toBe(false);
});
it('requires typed payment evidence, not just a generic mock success',()=>{
 const base={externalId:'receipt',mode:'mock',system:'SFCC',operation:'purchaseExchange'},payment={...intent,status:'CAPTURED',reference:'receipt'};
 expect(exchangePaymentResult.safeParse({...base,payment}).success).toBe(true);
 for(const invalid of [base,{...base,system:'FYND',payment},{...base,mode:'live',payment},{...base,payment:{...payment,status:'SUCCESS'}},{...base,payment:{...payment,actualMoneyMoved:true}}])expect(exchangePaymentResult.safeParse(invalid).success).toBe(false);
});
it('requires distinct typed cancellation outcomes and a bounded unique shipment list',()=>{
 const payload={...intent,shipmentIds:['shipment']};expect(exchangeCancellationPayload.safeParse(payload).success).toBe(true);
 for(const shipmentIds of [[],['s','s'],Array.from({length:21},(_,i)=>String(i))])expect(exchangeCancellationPayload.safeParse({...payload,shipmentIds}).success).toBe(false);
 const base={externalId:'receipt',mode:'mock',intent:payload,system:'SFCC',operation:'cancelExchangePurchase'};
 expect(exchangeCancellationResult.safeParse({...base,outcome:{resolution:'VOIDED',purchase:null}}).success).toBe(true);
 expect(exchangeCancellationResult.safeParse({...base,outcome:{resolution:'CAPTURED',purchase:{...intent,status:'CAPTURED',reference:'purchase'}}}).success).toBe(true);
 expect(exchangeCancellationResult.safeParse({...base,system:'FYND',operation:'cancelExchangeOrder',outcome:{resolution:'FENCED',orderExisted:true}}).success).toBe(true);
 for(const outcome of [{resolution:'CAPTURED',purchase:null},{resolution:'VOIDED',purchase:{...intent,status:'CAPTURED',reference:'p'}},{resolution:'REFUNDED',purchase:null},{resolution:'FENCED',orderExisted:false}])expect(exchangeCancellationResult.safeParse({...base,outcome}).success).toBe(false);
});
it('rejects swapped purchase and refund statuses at the contract boundary',()=>{
 const base={externalId:'receipt',mode:'mock',system:'SFCC'};
 for(const [operation,status] of [['purchaseExchange','CAPTURED'],['refundExchangePurchase','REFUNDED']]){
  const payment={...intent,status,reference:'receipt'};
  expect(exchangePaymentResult.safeParse({...base,operation,payment}).success).toBe(true);
  expect(exchangePaymentResult.safeParse({...base,operation,payment:{...payment,status:status==='CAPTURED'?'REFUNDED':'CAPTURED'}}).success).toBe(false);
 }
});
