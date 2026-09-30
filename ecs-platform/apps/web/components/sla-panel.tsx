'use client';
import {useEffect,useState} from 'react';
import {Clock3,RefreshCw} from 'lucide-react';
import {api} from '../lib/api';
type Milestone={id:string;stage:string;status:string;version:number;origin:string;policyVersion:number;startedAt:string;deadline:string;breachedAt:string|null;completedAt:string|null;waivedAt:string|null;reason:string|null};
type Evidence={now:string;items:Milestone[]};
const label=(v:string)=>v.replaceAll('_',' ').toLowerCase();
const date=(v:string)=>new Date(v).toLocaleString('en-GB',{timeZone:'Asia/Dubai'});
export function SlaPanel({entityType,entityId,revision,operator,onChanged}:{entityType:'SHIPMENT'|'RETURN';entityId:string;revision:number|string;operator:boolean;onChanged?:()=>Promise<void>}){
 const[data,setData]=useState<Evidence|null>(null),[error,setError]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 async function load(){try{setData(await api<Evidence>(`/slas?entityType=${entityType}&entityId=${encodeURIComponent(entityId)}`));setError('');}catch(e){setError((e as Error).message);}}
 useEffect(()=>{void load();},[entityId,revision]);
 const active=data?.items.find(m=>!m.completedAt);
 async function waive(){if(!active)return;setBusy(true);setError('');try{await api(`/slas/${active.id}/waive`,{expectedVersion:active.version,reason});setReason('');setNotice('Waiver recorded. The deadline and any breach remain in the audit history.');await load();await onChanged?.();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="panel sla-panel" aria-label="SLA evidence"><header><div><span className="eyebrow">OPERATIONAL SERVICE LEVELS</span><h3><Clock3 size={20}/> Stage deadlines & exceptions</h3></div><button className="button" onClick={()=>void load()}><RefreshCw size={15}/> Refresh SLA</button></header>
 {error&&<p className="error" role="alert">{error}</p>}{notice&&<p className="success-note" role="status">{notice}</p>}
 <p className="muted">{data?`Evaluated against demo time: ${date(data.now)} GST.`:'Loading stage evidence…'} Timers advance on acknowledged milestones. These are demonstration policies, not contracted SLAs.</p>
 {!data?.items.length&&<p>No recorded milestones yet. The monitor discovers existing active records; completed historical fixtures are not assigned invented compliance results.</p>}
 <div className="sla-history">{data?.items.map(m=><article key={m.id}><div className="sla-stage"><b>{label(m.stage)}</b><span className={`badge ${m.status==='BREACHED'?'red':m.status==='AT_RISK'?'amber':m.status==='RESOLVED'?'green':''}`}>{label(m.status)}</span></div><p>Due {date(m.deadline)} GST</p><small>{m.origin==='LEGACY_OBSERVED'?'Legacy record observed by monitor':'Event-based timer'} · Policy {m.policyVersion===0?'demo default':`v${m.policyVersion}`}</small>{m.breachedAt&&<p className="sla-breach">Breach retained · {date(m.breachedAt)} GST</p>}{m.completedAt&&<small>Completed {date(m.completedAt)} GST</small>}{m.reason&&<p>Waiver: {m.reason}</p>}</article>)}</div>
 {operator&&active&&['AT_RISK','BREACHED'].includes(active.status)&&<form onSubmit={e=>{e.preventDefault();void waive();}} className="sla-waiver"><div><h4>Review this exception</h4><p>A waiver permits a late confirmation to continue. It does not erase the breach, extend the deadline or waive later stages.</p></div><label>Operational justification<textarea required minLength={10} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Explain the exception and agreed follow-up"/></label><button className="primary" disabled={busy||reason.trim().length<10}>Record reasoned waiver</button></form>}
 {!operator&&active&&['AT_RISK','BREACHED'].includes(active.status)&&<p className="footnote">This exception is visible to ATI operations. Only an authorized operator can record a waiver.</p>}
 </section>;
}
