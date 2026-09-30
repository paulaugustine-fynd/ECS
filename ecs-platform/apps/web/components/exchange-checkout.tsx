'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import type {z} from 'zod';
import type {exchangeExecutionResponse} from '../../../packages/contracts/fulfilment-responses';
import {api} from '../lib/api';

type Execution=z.infer<typeof exchangeExecutionResponse>;
const labels={PENDING:'Payment acknowledgement pending',CAPTURED:'Simulated payment captured',REFUND_PENDING:'Replacement refund pending',REFUNDED:'Simulated replacement refunded',VOIDED:'Simulated payment prevented · no charge'};
export function ExchangeCheckout({id,version,executionId,operator,root,onStarted}:{id:string;version:number;executionId:string|null;operator:boolean;root:string;onStarted:(id:string)=>void}){
 const [execution,setExecution]=useState<Execution|null>(null),[reason,setReason]=useState(''),[cancelReason,setCancelReason]=useState(''),[accepted,setAccepted]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 useEffect(()=>{
  if(!executionId)return;let cancelled=false;let timer:ReturnType<typeof setTimeout>|undefined;
  async function load(){
   try{const value=await api<Execution>(`/exchanges/${id}/checkout`);if(cancelled)return;setExecution(value);setError('');
    if(value.cancellation?.status==='REQUESTED'||['PENDING','REFUND_PENDING'].includes(value.paymentStatus)||value.shipments.some(s=>['AWAITING_PAYMENT','AWAITING_FYND'].includes(s.status)))timer=setTimeout(()=>void load(),2500);
   }catch(e){if(!cancelled)setError((e as Error).message);}
  }
  void load();return()=>{cancelled=true;clearTimeout(timer);};
 },[id,executionId,refresh]);
 return <section className="workflow-form" aria-label="Replacement checkout">
  <h4>Replacement order · separate purchase</h4>
  <p className="footnote">Local demonstration only. SFCC payment and Fynd acknowledgements are simulated. No actual money moves.</p>
  {error&&<p role="alert" className="error">{error}</p>}
  {!executionId&&!execution&&(operator?<form className="catalog-form" onSubmit={async event=>{
   event.preventDefault();if(!accepted||busy)return;setBusy(true);setError('');
   try{const result=await api<{execution:Execution;replayed:boolean}>(`/exchanges/${id}/checkout`,{expectedVersion:version,reason,simulatedCustomerAcceptance:true});setExecution(result.execution);onStarted(result.execution.id);}
   catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }}>
   <p>Starting checkout rechecks the approved terms and reserves stock for a new order. Fulfilment stays on hold until the simulator acknowledges the full replacement charge.</p>
   <label>Replacement checkout reason<textarea required minLength={5} maxLength={1000} disabled={busy} value={reason} onChange={e=>setReason(e.target.value)}/></label>
   <label className="exchange-consent"><input type="checkbox" required disabled={busy} checked={accepted} onChange={e=>setAccepted(e.target.checked)}/> Simulate customer acceptance of this separate replacement purchase. This does not record real customer consent or payment.</label>
   <button className="primary" disabled={busy||!accepted||reason.trim().length<5}>{busy?'Starting replacement…':'Start simulated replacement checkout'}</button>
  </form>:<p>ATI operations can start the approved replacement checkout. Refresh exchange history to see the resulting order.</p>)}
  {executionId&&!execution&&<p role="status">Loading replacement execution…</p>}
  {(executionId||execution)&&<button className="button" onClick={()=>setRefresh(n=>n+1)}>Refresh replacement execution</button>}
  {execution&&<div aria-live="polite">
   <p className={`badge ${['CAPTURED','REFUNDED'].includes(execution.paymentStatus)?'green':'amber'}`}>{labels[execution.paymentStatus]}</p>
   <div className="evidence-row"><span>Replacement charge · full separate amount</span><b>{execution.currency} {Number(execution.amount).toLocaleString('en-AE',{minimumFractionDigits:2})}</b></div>
   <div className="evidence-row"><span>New order</span><code>{execution.externalOrderId}</code></div>
   <div className="evidence-row"><span>Order status</span><b>{execution.orderStatus.replaceAll('_',' ').toLowerCase()}</b></div>
   {execution.purchaseReceipt&&<div className="evidence-row"><span>Simulated purchase receipt</span><code>{execution.purchaseReceipt.reference}</code></div>}
   {execution.refundReceipt&&<div className="evidence-row"><span>Simulated cancellation refund</span><code>{execution.refundReceipt.reference}</code></div>}
   {execution.paymentStatus==='PENDING'&&!execution.cancellation&&<p className="footnote">Stock remains reserved while payment acknowledgement is pending. The provisional demo hold expires at {new Date(execution.holdExpiresAt).toLocaleString('en-GB',{timeZone:'Asia/Dubai'})} GST, measured against the demo clock. Expiry starts cancellation; stock is not released until both simulators acknowledge.</p>}
   {execution.cancellation&&<section aria-label="Replacement cancellation evidence">
    <h4>{execution.cancellation.status==='COMPLETED'?'Replacement cancellation completed':'Replacement cancellation in progress'}</h4>
    <p>{execution.cancellation.cause==='PAYMENT_HOLD_EXPIRED'?'The demo payment hold expired.':'ATI requested cancellation.'} {execution.cancellation.reason}</p>
    <div className="evidence-row"><span>SFCC payment outcome</span><b>{execution.cancellation.sfccReceipt?.outcome.resolution==='VOIDED'?'No purchase captured':execution.cancellation.sfccReceipt?'Capture confirmed; refund required':'Awaiting acknowledgement'}</b></div>
    <div className="evidence-row"><span>Fynd replacement fulfilment</span><b>{execution.cancellation.fyndReceipt?'Cancellation acknowledged':'Awaiting acknowledgement'}</b></div>
    <p className="footnote">{execution.cancellation.status==='REQUESTED'?'Stock stays reserved until both acknowledgements arrive. Late purchase or shipment responses cannot reopen this order.':execution.cancellation.status==='REFUND_PENDING'?'Stock released. The captured replacement charge still awaits a separate refund acknowledgement.':'Stock released. The purchase was prevented or its refund was acknowledged. Original delivery and refund history remain unchanged.'}</p>
   </section>}
   {operator&&!execution.cancellation&&['PENDING','CAPTURED'].includes(execution.paymentStatus)&&execution.shipments.every(s=>['AWAITING_PAYMENT','AWAITING_FYND','ASSIGNED'].includes(s.status))&&<form className="catalog-form" onSubmit={async event=>{
    event.preventDefault();if(busy)return;setBusy(true);setError('');
    try{const result=await api<{execution:Execution;replayed:boolean}>(`/exchanges/${id}/checkout/cancel`,{expectedVersion:execution.version,reason:cancelReason});setExecution(result.execution);setRefresh(n=>n+1);}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
   }}>
    <label>Replacement cancellation reason<textarea required minLength={5} maxLength={1000} disabled={busy} value={cancelReason} onChange={e=>setCancelReason(e.target.value)}/></label>
    <p className="footnote">This requests cancellation from both local simulators. If payment was captured, its refund is tracked separately. No real payment or shipment is affected.</p>
    <button className="button" disabled={busy||cancelReason.trim().length<5}>{busy?'Requesting cancellation…':'Cancel replacement checkout'}</button>
   </form>}
   {execution.paymentStatus==='REFUND_PENDING'&&<p className="footnote">The replacement shipment was cancelled and its stock released. The separate replacement refund is awaiting SFCC acknowledgement; it is not yet confirmed.</p>}
   {execution.shipments.map(s=><div className="evidence-row" key={s.id}><span>{s.locationId} · {s.status.replaceAll('_',' ').toLowerCase()}</span><Link className="text-button" href={`${root}/orders/${s.id}`}>Open replacement shipment →</Link></div>)}
   <p className="footnote">The original delivery and refund remain separate. Once assigned, cancel an eligible replacement from its shipment workspace; a cancellation refund is confirmed only after its own acknowledgement.</p>
   {operator&&<Link className="text-button" href={`${root}/integrations`}>Inspect integration jobs and replay failures →</Link>}
  </div>}
 </section>;
}
