'use client';
import { useEffect,useState,useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft,CheckCircle2,AlertCircle,Send,Save,RefreshCw } from 'lucide-react';
import { api,type User } from '../lib/api';
import {StorefrontPreview} from './storefront-preview';
import {ProductSales} from './product-sales';
import {CatalogMedia} from './catalog-media';
import {CatalogMediaReview} from './catalog-media-review';
import {CatalogDamJobs} from './catalog-dam-jobs';
import {singleFlight,type MediaJob} from '../lib/single-flight';
type Item={id:string;sku:string;titleEn:string;titleAr:string;gtin:string;price:string;floor:string;currency:string;category:string;status:string;version:number;data:{attributes:Record<string,string>;media?:{url:string;status:string}[];reviewReason?:string};issues:{code:string;field:string;message:string}[];publications:{target:string;version:number;status:string;externalId:string|null;error:string|null}[]};
export function CatalogDetail({id,user,root}:{id:string;user:User;root:string}){
  const jobsReader=useMemo(()=>singleFlight(key=>api<{items:MediaJob[]}>(`/catalog/items/${key}/media/jobs`)),[user.id]);
  const readJobs=()=>jobsReader(id);
  const[previewRevision,setPreviewRevision]=useState(0);
  const[item,setItem]=useState<Item|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[reason,setReason]=useState('');
  const canEdit=['ATI_SUPER_ADMIN','ATI_CATALOG_MODERATOR','VENDOR_ADMIN','VENDOR_CATALOG_MANAGER'].includes(user.role);
  const moderator=['ATI_SUPER_ADMIN','ATI_CATALOG_MODERATOR'].includes(user.role);
  const editable=canEdit&&!!item&&['DRAFT','CHANGES_REQUESTED','REJECTED'].includes(item.status);
  async function load(){try{setItem(await api<Item>(`/catalog/items/${id}`));setError('');setPreviewRevision(v=>v+1);}catch(e){setItem(null);setError((e as Error).message);}}
  useEffect(()=>{void load();},[id]);
  async function act(action:string){if(!item)return;setBusy(true);setError('');setNotice('');try{await api(`/catalog/items/${id}/commands`,{expectedVersion:item.version,action,...(reason?{reason}:{})});await load();setNotice(action==='refresh-storefront'?'Storefront refresh queued. Use Check storefront after the worker acknowledges it.':action==='publish'?'Queued for ERP. Fynd and SFCC wait for its acknowledgement.':'Decision saved with audit evidence.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function save(){if(!item)return;setBusy(true);setError('');setNotice('');try{await api(`/catalog/items/${id}/draft`,{expectedVersion:item.version,titleEn:item.titleEn,titleAr:item.titleAr,gtin:item.gtin??'',price:item.price,attributes:item.data.attributes});await load();setNotice('Draft saved. Validation refreshed; nothing has been published.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <div className="catalog-detail"><Link className="back-link" href={`${root}/catalog/items`}><ArrowLeft size={16}/> All products</Link>{error&&<div role="alert" className="error">{error}</div>}{notice&&<div role="status" className="success-note">{notice}</div>}{!item?(!error&&<p>Loading product…</p>):<>
    <div className="detail-heading"><div><span className="eyebrow">{item.sku} · VERSION {item.version}</span><h2>{item.titleEn||'Untitled draft'}</h2><span className="badge amber">{item.status.replaceAll('_',' ').toLowerCase()}</span></div><button className="button" onClick={()=>void load()} disabled={busy}><RefreshCw size={15}/> Refresh status</button></div>
    <ProductSales id={id} moderator={moderator} refreshToken={previewRevision}/>
    <div className="catalog-columns"><section className="panel"><h3>Product information</h3><p className="muted">{item.category} · AE · {item.currency}</p><div className="catalog-form">
      <label>English title<input value={item.titleEn} disabled={!editable||busy} onChange={e=>setItem({...item,titleEn:e.target.value})}/></label>
      <label>Arabic title<input dir="rtl" lang="ar" value={item.titleAr} disabled={!editable||busy} onChange={e=>setItem({...item,titleAr:e.target.value})}/></label>
      <div className="form-pair"><label>GTIN<input value={item.gtin??''} disabled={!editable||busy} onChange={e=>setItem({...item,gtin:e.target.value})}/></label><label>Selling price ({item.currency})<input inputMode="decimal" value={item.price} disabled={!editable||busy} onChange={e=>setItem({...item,price:e.target.value})}/><small>Operator floor: {item.currency} {item.floor}</small></label></div>
      <h3>Category attributes</h3>{Object.entries(item.data.attributes??{}).map(([key,value])=><label key={key}>{key.replace(/([A-Z])/g,' $1')}<input value={value} disabled={!editable||busy} onChange={e=>setItem({...item,data:{...item.data,attributes:{...item.data.attributes,[key]:e.target.value}}})}/></label>)}
      {editable&&<button className="primary" disabled={busy} onClick={()=>void save()}><Save size={16}/> Save and validate draft</button>}
    </div></section>
    <div><section className="panel"><h3>Quality checklist</h3><p className="muted">Based on the last saved version</p>{item.issues.length?item.issues.map((i,n)=><div className="quality-issue" key={`${i.code}-${n}`}><AlertCircle size={17}/><div><b>{i.code.replaceAll('_',' ')}</b><p>{i.message}</p></div></div>):<div className="quality-clear"><CheckCircle2 size={18}/> All configured checks passed</div>}{item.data.reviewReason&&<div className="review-feedback"><b>Latest review feedback</b><p>{item.data.reviewReason}</p></div>}</section>
    <CatalogMediaReview id={id} version={item.version} status={item.status} media={item.data.media??[]} moderator={moderator} editable={editable} onChanged={load}/></div></div>
    {canEdit&&<section className="panel"><CatalogMedia readJobs={readJobs} id={id} version={item.version} editable={editable} moderator={moderator} onUploaded={load}/></section>}
    {canEdit&&<CatalogDamJobs readJobs={readJobs} id={id} version={item.version} editable={editable} moderator={moderator} onChanged={load}/>}
    <section className="panel"><h3>Review & publication</h3><div className="publication-flow">{['ERP','FYND','SFCC'].map(target=>{const pub=item.publications.find(p=>p.target===target&&p.version===item.version);return <div key={target}><b>{target==='ERP'?'1. ATI ERP / PIM':target==='FYND'?'2. Fynd operations':'2. SFCC storefront'}</b><span className={`badge ${pub?.status==='SUCCEEDED'?'green':pub?.status==='FAILED'?'red':'amber'}`}>{(pub?.status??'NOT_REQUESTED').replaceAll('_',' ').toLowerCase()}</span><small>{pub?.externalId??(target==='ERP'?'Approval required':'Waits for ERP acknowledgement')}</small>{pub?.error&&<p className="error">{pub.error}</p>}</div>;})}</div>
      {moderator&&<label className="review-reason">Review evidence / feedback<textarea value={reason} onChange={e=>setReason(e.target.value)} placeholder="Record what you checked, or explain the changes required…"/></label>}
      <div className="drawer-actions">{canEdit&&['DRAFT','CHANGES_REQUESTED'].includes(item.status)&&<button className="primary" disabled={busy} onClick={()=>void act('submit')}><Send size={15}/> Submit saved version for review</button>}{moderator&&['DRAFT','CHANGES_REQUESTED','IN_REVIEW'].includes(item.status)&&item.data.media?.some(m=>m.status!=='APPROVED')&&<button className="button" disabled={busy||reason.trim().length<5} onClick={()=>void act('approve-media')}>Approve sample media</button>}{moderator&&item.status==='IN_REVIEW'&&<><button className="primary" disabled={busy||reason.trim().length<5} onClick={()=>void act('approve')}>Approve product</button><button className="button" disabled={busy||reason.trim().length<5} onClick={()=>void act('request-changes')}>Request changes</button><button className="button" disabled={busy||reason.trim().length<5} onClick={()=>void act('reject')}>Reject</button></>}{moderator&&item.status==='APPROVED'&&<button className="primary" disabled={busy} onClick={()=>void act('publish')}><Send size={16}/> Publish through ERP</button>}</div>
      {moderator&&item.status==='PUBLISHED'&&<button className="button" disabled={busy} onClick={()=>void act('refresh-storefront')}>Refresh SFCC simulator content</button>}
      <p className="footnote">Only all three successful acknowledgements mark the product published. Visibility is checked separately below. Failed jobs can be replayed by an ATI integration operator.</p>
    </section><StorefrontPreview id={id} refreshToken={previewRevision}/></>}
  </div>;
}
