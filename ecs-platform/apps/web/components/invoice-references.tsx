'use client';
import {useEffect,useState} from 'react';
import {FileText,RefreshCw,Send} from 'lucide-react';
import {api} from '../lib/api';
type Invoice={id:string;invoiceNumber:string;status:string;version:number;url:string;issuedAt:string;receiptId:string};
export function InvoiceReferences({shipmentId,status}:{shipmentId:string;status:string}){
 const[items,setItems]=useState<Invoice[]>([]),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[number,setNumber]=useState(`DEMO-INV-${shipmentId.slice(-10)}`);
 async function load(){setError('');try{setItems((await api<{items:Invoice[]}>(`/shipments/${shipmentId}/invoices`)).items);}catch(e){setError((e as Error).message);}}
 useEffect(()=>{void load();},[shipmentId]);
 async function receive(){setBusy(true);setError('');setNotice('');try{const r=await api<{receiptId:string;duplicate?:boolean}>('/demo/invoices',{shipmentId,invoiceNumber:number});setNotice(`${r.duplicate?'Existing':'Signed SFCC'} receipt ${r.receiptId}. Refresh after inbox processing. Acceptance is not confirmation of an invoice.`);await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="panel invoice-references"><div className="operations-toolbar"><div><span className="eyebrow">ATI ONLY · SFCC OWNED</span><h3><FileText size={18}/> Customer invoice references</h3></div><button className="button" onClick={()=>{setNotice('');void load();}}><RefreshCw size={15}/> Refresh invoice references</button></div>
 <p>SFCC issues the customer invoice. ECS records its reference and status; the packing slip remains a separate operational document.</p>
 {error&&<p className="error" role="alert">{error}</p>}{notice&&<p className="success-note" role="status">{notice}</p>}
 {items.length?items.map(i=><div className="route-candidate" key={i.id}><b>{i.invoiceNumber}</b><span className={`badge ${i.status==='ISSUED'?'green':'red'}`}>{i.status} · revision {i.version}</span><small>Issued {new Date(i.issuedAt).toLocaleString('en-GB',{timeZone:'Asia/Dubai'})} GST</small><p style={{overflowWrap:'anywhere'}}>{i.url}</p><small>Processed SFCC receipt: {i.receiptId}</small><small>Reference only. The document is not downloaded or verified by ECS.</small></div>):<p className="muted">No processed SFCC invoice reference for this shipment yet.</p>}
 <div className="catalog-form"><label>Fictional invoice number<input value={number} onChange={e=>setNumber(e.target.value)} maxLength={100}/></label><button className="button" disabled={busy||!number||!['DISPATCHED','DELIVERED'].includes(status)} onClick={()=>void receive()}><Send size={15}/> Receive demo invoice reference</button></div>
 <p className="footnote">Local simulator only; available after dispatch. No tax invoice is generated, no URL is fetched and no customer message is sent. Invoice references are never shared with vendors.</p></section>;
}
