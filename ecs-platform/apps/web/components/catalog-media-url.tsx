'use client';
import {useEffect,useState} from 'react';
import {api} from '../lib/api';
import type {MediaJob} from '../lib/single-flight';
type Job={id:string;sourceType:string;sourceRef:string;status:string;attempts:number;replayCount:number;version:number;lastError:string|null;receiptId:string|null};
export function CatalogMediaUrl({id,version,editable,moderator,onImported,readJobs}:{readJobs:()=>Promise<{items:MediaJob[]}>;id:string;version:number;editable:boolean;moderator:boolean;onImported:()=>Promise<void>}){
 const[url,setUrl]=useState(''),[request,setRequest]=useState<{requestId:string;expectedVersion:number}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const[jobs,setJobs]=useState<Job[]>([]),[failures,setFailures]=useState(0),[reason,setReason]=useState('');
 function choose(value:string){setUrl(value);setRequest({requestId:crypto.randomUUID(),expectedVersion:version});setNotice('');setError('');}
 async function load(){setJobs((await readJobs()).items.filter(j=>j.sourceType==='URL'));}
 useEffect(()=>{void load().catch(e=>setError((e as Error).message));},[id,version]);
 async function submit(queued:boolean){
  if(!request)return;setBusy(true);setError('');
  try{
   await api(`/catalog/items/${id}/media/url${queued?'/jobs':''}`,{...request,url,...(queued?{demoFailures:failures}:{})});
   setNotice(queued?'URL import queued. Refresh job status to see worker progress; avoid editing this product until it finishes.':'Source image retained privately; new imagery requires ATI review.');setRequest(null);await load();await onImported();
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <div className="catalog-form" aria-label="URL image import"><h3>Import imagery from a source URL</h3><p className="footnote">Approved HTTPS hosts only. Direct PNG/JPEG/WebP URLs, no login credentials or signed query strings. Redirects and private-network targets are blocked. Maximum 5 MB; imported pixels still require ATI review.</p>
 {editable&&<><label>Image source URL<input value={url} disabled={busy} onChange={e=>choose(e.target.value)} placeholder="https://approved-supplier.example/front.png"/></label>
 <label>URL demo failure scenario<select aria-label="URL demo failure scenario" value={failures} disabled={busy} onChange={e=>{setFailures(Number(e.target.value));choose(url);}}><option value={0}>No injected failure</option><option value={1}>Fail first attempt, then retry</option><option value={3}>Exhaust retries, then ATI replay</option></select></label>
 <div className="drawer-actions"><button className="button" disabled={busy} onClick={()=>choose('demo://supplier/front.png')}>Use local supplier sample</button><button className="primary" disabled={busy||!url||!request} onClick={()=>void submit(true)}>Queue URL import</button></div>
 <details><summary>Direct synchronous import</summary><p className="footnote">Runs in this request without a durable job. The failure scenario above applies only to queued imports.</p><button className="button" disabled={busy||!url||!request} onClick={()=>void submit(false)}>Import URL for review</button></details></>}
 <button className="button" disabled={busy} onClick={async()=>{setBusy(true);try{await load();await onImported();setError('');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>Refresh URL jobs</button>
 {moderator&&jobs.some(j=>j.status==='DLQ')&&<label>URL replay reason<textarea value={reason} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>}
 {jobs.map(j=><div className="evidence-row" role="group" aria-label={`URL job ${j.sourceRef}`} key={j.id}><div><b>{j.sourceRef}</b> <span className={`badge ${j.status==='SUCCEEDED'?'green':j.status==='DLQ'?'red':'amber'}`}>{j.status}</span><p>{j.attempts} attempts · {j.replayCount} replays</p>{j.lastError&&<p>{j.lastError} · Resolve the cause before replay. Changed products need a new job at their current version.</p>}{j.receiptId&&<small>Private ingestion receipt: {j.receiptId}</small>}{moderator&&j.status==='DLQ'&&<button className="button" disabled={busy||reason.trim().length<5} onClick={async()=>{setBusy(true);try{await api(`/catalog/media/jobs/${j.id}/replay`,{expectedVersion:j.version,reason});await load();setError('');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>Replay URL job</button>}</div></div>)}
 {!jobs.length&&<p className="footnote">No queued URL imports yet.</p>}
 <p className="footnote">The supplier sample is synthetic and served locally. No external hosts are enabled by default. Queued imports retain destination and product version, retry transient failures up to three attempts per cycle and require ATI permission for dead-letter replay. Revoked sources fail closed. ZIP imports also offer a durable queue.</p>{error&&<p className="error" role="alert">{error}</p>}{notice&&<p className="success-note" role="status">{notice}</p>}</div>;
}
