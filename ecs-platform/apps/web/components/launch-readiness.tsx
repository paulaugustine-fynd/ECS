import {CheckCircle2,Circle} from 'lucide-react';
import type {Partner} from '../lib/api';

export function LaunchReadiness({gates}:{gates:NonNullable<Partner['readiness']>}){
 return <div className="launch-readiness">{gates.map(g=><section key={g.key} className="launch-gate">
  <div className="launch-gate-title">{g.passed?<CheckCircle2 size={18} className="ok"/>:<Circle size={18}/>}<b>{g.label}</b><span>{g.passed?'Verified':'Pending'}</span></div>
  {g.detail&&<p>{g.detail}</p>}
  {g.mappings&&<details><summary>Inspect mapping evidence ({g.mappings.length})</summary>{g.mappings.map(m=><div className="launch-position" key={`${m.kind}:${m.market}:${m.canonicalId}`}><b>{m.kind} · {m.canonicalId} · {m.market}</b><small>{m.externalId??'Not acknowledged'}</small><span className={m.passed?'ok':''}>{m.detail}</span></div>)}</details>}
  {g.positions&&g.positions.length>0&&<details><summary>Inspect stock evidence ({g.positions.length})</summary>{g.positions.map(p=><div className="launch-position" key={p.inventoryId}><b>{p.sku}</b><small>{p.locationName} · revision {p.revision} · expected availability {p.expectedSellable}</small>{p.passed?<span className="ok">Both mock destinations match</span>:<ul>{p.issues.map(issue=><li key={issue}>{issue}</li>)}</ul>}</div>)}</details>}
 </section>)}</div>;
}
