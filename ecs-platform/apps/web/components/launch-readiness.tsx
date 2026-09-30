import {CheckCircle2,Circle} from 'lucide-react';
import type {Partner} from '../lib/api';
const wording:Record<string,{title:string;next:string;done:string}>={
 documents:{title:'Required documents reviewed',next:'ATI partner team: review the latest trade licence, tax certificate and bank letter.',done:'ATI approved'},
 erp:{title:'Business registered for finance',next:'ATI partner team: send the approved business details to the finance-system simulator.',done:'Demo record found'},
 agreement:{title:'Commercial terms agreed',next:'ATI finance: approve an agreement whose start and end dates include the demo date.',done:'Agreement in effect'},
 brand:{title:'Permission to sell this brand',next:'ATI partner team: approve the brand, product categories and market under Brand rights.',done:'Selling permission approved'},
 mapping:{title:'Brand and locations registered',next:'ATI partner team: register the current brand and fulfilment locations using Prepare brand and locations.',done:'Simulator records match'},
 catalogue:{title:'Products published',next:'ATI catalogue team: approve the products and publish them through ERP. Wait for all three simulated systems.',done:'Publishing records found'},
 inventory:{title:'Stock checked in both systems',next:'ATI operations: check the locations and quantities, then send the latest stock update.',done:'Stock quantities match'},
 storefront:{title:'Customer product previews checked',next:'ATI catalogue team: open each published product, choose Refresh SFCC simulator content, then Check storefront.',done:'Product previews match'},
 test:{title:'Safe launch order checked',next:'ATI partner team: complete the checks above, then Run safe launch check. The virtual order does not consume business stock.',done:'Launch test passed'},
};

export function LaunchReadiness({gates}:{gates:NonNullable<Partner['readiness']>}){
 return <div className="launch-readiness"><p>These checks use saved demo records and simulated external systems. They do not certify a live launch.</p>{gates.map(g=><section key={g.key} className="launch-gate">
  <div className="launch-gate-title">{g.passed?<CheckCircle2 size={18} className="ok"/>:<Circle size={18}/>}<b>{wording[g.key]?.title??g.label}</b><span>{g.passed?(wording[g.key]?.done??'Complete'):'Action needed'}</span></div>
  {!g.passed&&<p>{wording[g.key]?.next??g.detail}</p>}
  {g.detail&&<details><summary>Why this result?</summary><p>{g.detail}</p></details>}
  {g.mappings&&<details><summary>View registered brand and locations ({g.mappings.length})</summary>{g.mappings.map(m=><div className="launch-position" key={`${m.kind}:${m.market}:${m.canonicalId}`}><b>{m.kind==='BRAND'?'Brand':'Location'} · {m.canonicalId} · {m.market}</b><small>{m.externalId??'Waiting for registration'}</small><span className={m.passed?'ok':''}>{m.passed?'Current simulator record matches':'Register the current details and check again'}</span></div>)}</details>}
  {g.positions&&g.positions.length>0&&<details><summary>View stock by product and location ({g.positions.length})</summary>{g.positions.map(p=><div className="launch-position" key={p.inventoryId}><b>{p.sku}</b><small>{p.locationName} · available to sell: {p.expectedSellable}</small>{p.passed?<span className="ok">Both simulated systems have this quantity</span>:<ul>{p.issues.map(issue=><li key={issue}>{issue}</li>)}</ul>}<small>Stock update number {p.revision}</small></div>)}</details>}
 </section>)}</div>;
}
