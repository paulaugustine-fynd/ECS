'use client';
import {useEffect,useState} from 'react';
import type {z} from 'zod';
import type {exchangePreviewResponse,exchangeRequestResponse} from '../../../packages/contracts/fulfilment-responses';
import {api} from '../lib/api';
import {ExchangeCheckout} from './exchange-checkout';

type Preview=z.infer<typeof exchangePreviewResponse>;
type Exchange=z.infer<typeof exchangeRequestResponse>;
type Options={returnVersion:number;hasMore:boolean;items:{id:string;sku:string;title:string;size:string|null;unitPrice:string;currency:string;status:string;saleStatus:string}[];notice:string};
const money=(s:string)=>`AED ${Number(s).toLocaleString('en-AE',{minimumFractionDigits:2,maximumFractionDigits:2})}`;

export function ExchangePreview({id,version,operator=false,root}:{id:string;version:number;operator?:boolean;root:string}){
 const [expanded,setExpanded]=useState(false),[options,setOptions]=useState<Options|null>(null),[product,setProduct]=useState(''),[routing,setRouting]=useState('HYBRID_WATERFALL'),[preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [requests,setRequests]=useState<Exchange[]>([]),[hasMore,setHasMore]=useState(false),[reason,setReason]=useState(''),[accepted,setAccepted]=useState(false),[requestId,setRequestId]=useState(''),[cancelReason,setCancelReason]=useState(''),[message,setMessage]=useState(''),[reload,setReload]=useState(0);
 const [reviewReason,setReviewReason]=useState('');
 async function decide(r:Exchange,action:'approve'|'reject'){
  setBusy(true);setError('');setMessage('');
  try{const result=await api<{request:Exchange;replayed:boolean}>(`/exchanges/${r.id}/review`,{expectedVersion:r.version,action,reason:reviewReason});setRequests(items=>items.map(item=>item.id===r.id?result.request:item));setReviewReason('');setPreview(null);setMessage(result.request.status==='APPROVED'?'ATI approval retained. Replacement checkout, payment and stock reservation have not started.':result.request.status==='REJECTED'?'ATI rejection retained. A new quote and request may now be submitted.':'The original review was already recorded; current request history is shown.');}
  catch(err){setError((err as Error).message);}finally{setBusy(false);}
 }
 useEffect(()=>{
  if(!expanded)return;let cancelled=false;setBusy(true);setError('');
  void Promise.all([api<Options>(`/returns/${id}/exchange-options`),api<{items:Exchange[];hasMore:boolean}>(`/returns/${id}/exchanges`)]).then(([r,history])=>{if(!cancelled){setOptions(r);setProduct(r.items[0]?.id??'');setRequests(history.items);setHasMore(history.hasMore);setPreview(null);}}).catch(e=>{if(!cancelled)setError((e as Error).message);}).finally(()=>{if(!cancelled)setBusy(false);});
  return()=>{cancelled=true;};
 },[expanded,id,version,reload]);
 return <section className="panel workflow-form exchange-panel" aria-label="Exchange preview">
  <h3>Exchange · find a replacement size</h3>
  <p className="muted">Keep the original delivery intact. Compare a sibling variant, its current price and an eligible fulfilment location.</p>
  {!expanded?<button className="button" onClick={()=>setExpanded(true)}>Explore exchange variants</button>:<>
   <button className="button" disabled={busy} onClick={()=>{setMessage('');setReload(n=>n+1);}}>Refresh exchange history</button>
   {error&&<div className="error" role="alert"><p>{error}</p>{!options&&<button className="button" disabled={busy} onClick={()=>setReload(n=>n+1)}>Retry loading exchanges</button>}</div>}
   {message&&<p className="success-note" role="status">{message}</p>}
   {!options&&busy&&<p role="status">Loading your authorized variants…</p>}
   {options?.items.length===0&&<p>No other variants of this partner’s style are available in the catalogue.</p>}
   {options&&options.items.length>0&&!requests.some(r=>r.executionId)&&<form className="catalog-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');setMessage('');setAccepted(false);setPreview(null);try{setPreview(await api<Preview>(`/returns/${id}/exchange-preview`,{expectedReturnVersion:version,replacementProductId:product,routingPolicy:routing}));setRequestId(crypto.randomUUID());}catch(err){setError((err as Error).message);}finally{setBusy(false);}}}>
    <div className="form-pair"><label>Replacement variant<select disabled={busy} value={product} onChange={e=>{setProduct(e.target.value);setPreview(null);}}>{options.items.map(p=><option key={p.id} value={p.id}>{p.size?`Size ${p.size} · `:''}{p.sku} · {p.currency} {p.unitPrice}</option>)}</select></label>
    <label>Replacement routing<select disabled={busy} value={routing} onChange={e=>{setRouting(e.target.value);setPreview(null);}}><option value="HYBRID_WATERFALL">Hybrid waterfall</option><option value="WAREHOUSE_FIRST">Warehouse first</option><option value="STORE_FIRST">Store first</option><option value="BRAND_FIRST">Brand first</option></select></label></div>
    <p className="footnote">{options.notice}{options.hasMore?' Showing the first 50 variants.':''}</p>
    <button className="primary" disabled={busy||!product}>{busy?'Checking eligibility…':'Preview replacement'}</button>
   </form>}
   {preview&&<div aria-live="polite" aria-label="Replacement preview result">
    <h4>{preview.original.size??preview.original.sku} → {preview.replacement.size??preview.replacement.sku} · {preview.quantity} unit{preview.quantity===1?'':'s'}</h4>
    <p className={`badge ${preview.eligibility==='BLOCKED'?'red':'amber'}`}>{preview.eligibility==='BLOCKED'?'Blocked — review requirements below':'Eligible at preview — not reserved'}</p>
    <div className="evidence-row"><span>Original refund · separate SFCC instruction</span><b>{money(preview.pricing.originalRefund)}</b></div>
    <div className="evidence-row"><span>New replacement charge · SFCC ownership</span><b>{money(preview.pricing.replacementCharge)}</b></div>
    <div className="evidence-row"><span>Price difference · informational only</span><b>{money(preview.pricing.difference)}</b></div>
    {preview.route&&<p>Proposed fulfilment: <b>{preview.route.name}</b> · {preview.route.available} units locally available · {preview.deliveryCity}</p>}
    {preview.blockers.length>0&&<ul>{preview.blockers.map((b,i)=><li key={`${b.code}:${i}`}>{b.message}</li>)}</ul>}
    <p className="footnote">{preview.notice}</p>
    {preview.eligibility==='ELIGIBLE_AT_PREVIEW'&&<form className="catalog-form" onSubmit={async e=>{
     e.preventDefault();if(!accepted||!requestId)return;setBusy(true);setError('');setMessage('');
     try{const result=await api<{request:Exchange;replayed:boolean}>(`/returns/${id}/exchanges`,{requestId,reason,replacementProductId:preview.replacement.productId,expectedReturnVersion:preview.returnVersion,routingPolicy:preview.routingPolicy,expectedProductVersion:preview.replacement.version,expectedSaleVersion:preview.replacement.saleVersion,acceptedReplacementTotal:preview.pricing.replacementCharge,acceptedPolicy:preview.policy});setRequests(items=>[result.request,...items.filter(r=>r.id!==result.request.id)]);setPreview(null);setReason('');setAccepted(false);setMessage(result.request.status==='CANCELLED'?'The original request was already cancelled; it was not recreated.':'Request retained for ATI review. No stock reserved, payment collected or replacement order created.');}
     catch(err){setError((err as Error).message);}finally{setBusy(false);}
    }}>
     <label>Exchange request reason<textarea required minLength={5} maxLength={1000} disabled={busy} value={reason} onChange={e=>setReason(e.target.value)}/></label>
     <label className="exchange-consent"><input type="checkbox" required disabled={busy} checked={accepted} onChange={e=>setAccepted(e.target.checked)}/> I accept the demo refund-and-repurchase terms and the separate replacement price shown above.</label>
     <button className="primary" disabled={busy||!accepted||reason.trim().length<5}>Save exchange request for review</button>
    </form>}
   </div>}
   {requests.length>0&&<section aria-label="Exchange request history"><h4>Exchange request history</h4>{hasMore&&<p className="footnote">Showing the latest 100 requests.</p>}{requests.map(r=><article key={r.id} className="panel workflow-form" aria-label={`Exchange request ${r.id}`}>
    <p><b>{r.snapshot.original.size??r.snapshot.original.sku} → {r.snapshot.replacement.size??r.snapshot.replacement.sku}</b> · {r.quantity} unit{r.quantity===1?'':'s'} <span className={`badge ${r.status==='REQUESTED'||r.status==='APPROVED'?'amber':r.status==='REJECTED'?'red':''}`}>{r.executionId?'Replacement order created':({REQUESTED:'Awaiting ATI review',APPROVED:'Approved · awaiting replacement checkout',REJECTED:'Rejected by ATI',CANCELLED:'Cancelled'})[r.status]}</span></p>
    <p>{r.reason}</p><div className="evidence-row"><span>Accepted replacement price · recorded snapshot</span><b>{money(r.replacementTotal)}</b></div><p className="footnote">Request {r.id} · Demo time {new Date(r.createdAt).toLocaleString('en-GB',{timeZone:'Asia/Dubai'})} GST. This request does not reserve inventory or initiate payment.</p>
    {r.reviewAction&&<section aria-label="ATI exchange decision"><h4>ATI decision · {r.reviewAction==='APPROVED'?'approved':'rejected'}</h4><p>{r.reviewReason}</p><p className="footnote">Recorded by {r.reviewedBy} · {r.reviewedAt?new Date(r.reviewedAt).toLocaleString('en-GB',{timeZone:'Asia/Dubai'}):''} GST. Decision evidence is retained after cancellation.</p>{r.reviewSnapshot?.route&&<p>Route at approval: {r.reviewSnapshot.route.name}. Eligibility must be checked again when reserving.</p>}</section>}
    {operator&&r.status==='REQUESTED'&&<section aria-label="ATI exchange review"><h4>Review replacement request</h4><p className="footnote">Approval rechecks the accepted price, catalogue, refund and current routing gates. It does not reserve stock, create an order or collect payment.</p><label>ATI exchange decision reason<textarea minLength={5} maxLength={1000} disabled={busy} value={reviewReason} onChange={e=>setReviewReason(e.target.value)}/></label><div className="decision-actions"><button className="primary" disabled={busy||reviewReason.trim().length<5} onClick={()=>void decide(r,'approve')}>Approve exchange request</button><button className="button" disabled={busy||reviewReason.trim().length<5} onClick={()=>void decide(r,'reject')}>Reject exchange request</button></div></section>}
    {!operator&&r.status==='REQUESTED'&&<p className="footnote">ATI operations owns the review decision. You can refresh to see their response or cancel this request.</p>}
    {r.status==='CANCELLED'&&<p>Cancellation: {r.cancellationReason}</p>}
    {(r.status==='APPROVED'||r.executionId)&&<ExchangeCheckout id={r.id} version={r.version} executionId={r.executionId} operator={operator} root={root} onStarted={executionId=>{setPreview(null);setRequests(items=>items.map(item=>item.id===r.id?{...item,executionId}:item));}}/>}
    {!r.executionId&&['REQUESTED','APPROVED'].includes(r.status)&&<form className="catalog-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');setMessage('');try{const result=await api<{request:Exchange;replayed:boolean}>(`/exchanges/${r.id}/cancel`,{expectedVersion:r.version,reason:cancelReason});setRequests(items=>items.map(item=>item.id===r.id?result.request:item));setCancelReason('');setPreview(null);setMessage('Pending request cancelled. History retained; preview again to choose a replacement.');}catch(err){setError((err as Error).message);}finally{setBusy(false);}}}>
     <label>Exchange cancellation reason<textarea required minLength={5} maxLength={1000} disabled={busy} value={cancelReason} onChange={e=>setCancelReason(e.target.value)}/></label><button className="button" disabled={busy||cancelReason.trim().length<5}>Cancel pending exchange request</button>
    </form>}
   </article>)}</section>}
  </>}
  <p className="footnote">No replacement order or payment is submitted by previewing or approving a request. ATI must separately start the simulated checkout. Requests, decisions, replacement execution and acknowledged cancellation refunds are retained locally.</p>
 </section>;
}
