'use client';
import {useEffect,useState} from 'react';
import {api,type Partner} from '../lib/api';
type Run={id:string;status:string;step:number;reason:string;createdAt:string;error:string|null;snapshot:{sku:string;unitGross:string;currency:string;fyndLocationId:string};jobs:{id:string;target:string;status:string;attempts:number;error:string|null;payload:{step:number}}[]};
const stages=['Assign stock','Accept order','Pick items','Pack items','Ready to send','Dispatch','Delivery','Storefront confirmation'];
export function LaunchTestPanel({partner,canRun,onChanged}:{partner:Partner;canRun:boolean;onChanged:()=>Promise<void>}){
 const[runs,setRuns]=useState<Run[]>([]),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const pending=partner.readiness?.filter(g=>g.key!=='test'&&!g.passed)??[];
 async function load(){try{setRuns((await api<{items:Run[]}>(`/partners/${partner.id}/launch-tests`)).items);setError('');}catch(e){setError((e as Error).message);}}
 useEffect(()=>{void load();},[partner.id,partner.version]);
 async function run(){setBusy(true);try{await api(`/partners/${partner.id}/launch-tests`,{expectedVersion:partner.version,requestId:crypto.randomUUID(),reason});setReason('');await load();await onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function refresh(){setBusy(true);await load();await onChanged();setBusy(false);}
 return <section className="launch-test-panel"><h3>Check an order before launch</h3><p>Follow one virtual item through the simulated order and storefront systems. This check does not use stock, book a courier or move money.</p>
  {canRun&&<><label>Reason for this check<input value={reason} onChange={e=>setReason(e.target.value)} placeholder="For example: checking the approved collection before launch"/></label><button className="button" disabled={busy||reason.trim().length<5||pending.length>0||!['APPROVED','ACTIVE','PAUSED'].includes(partner.status)||runs[0]?.status==='RUNNING'} onClick={()=>void run()}>Run safe launch check</button>{pending.length>0&&<p className="muted">Complete the unfinished preparation checks above first.</p>}</>}
  <button className="text-button" disabled={busy} onClick={()=>void refresh()}>Refresh test progress</button>
  {error&&<p className="error" role="alert">{error}</p>}
  {!runs.length&&<p>No test recorded for this partner.</p>}
  {runs.map((r,index)=><details key={r.id} open={index===0}><summary>{r.status} · {r.step}/8 steps · {new Date(r.createdAt).toLocaleString()}</summary><p><b>{r.snapshot.sku}</b> · {r.snapshot.currency} {r.snapshot.unitGross} · 1 virtual unit</p><p>{r.reason}</p><code>{r.id}</code><ol>{stages.map((stage,i)=>{const job=r.jobs.find(j=>j.payload.step===i);return <li key={stage}><span>{stage}</span><b>{job?.status.replaceAll('_',' ')??'NOT STARTED'}</b>{job&&<small>{job.target} · {job.attempts} attempts</small>}{job?.error&&<small className="error">{job.error}</small>}</li>;})}</ol>{r.error&&<p className="error">{r.error}. ATI operations can inspect and replay the failed job in System updates.</p>}<p className="muted">Historical result only. The readiness gate separately checks whether this configuration is still current.</p></details>)}
 </section>;
}
