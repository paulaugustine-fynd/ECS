'use client';
import {useEffect,useState} from 'react';
import {api} from '../lib/api';
type Evidence={passed:boolean;detail:string;version:number;externalId:string|null;notice:string;content:null|{sku:string;titleEn:string;titleAr:string;brand:string;price:string;currency:string;category:string;attributes:Record<string,string>;media:string[];merchant:string;merchantOfRecord:string}};
export function StorefrontPreview({id,refreshToken}:{id:string;refreshToken:number}){
 const[evidence,setEvidence]=useState<Evidence|null>(null),[error,setError]=useState(''),[ar,setAr]=useState(false);
 async function load(){try{setEvidence(await api<Evidence>(`/catalog/items/${id}/storefront`));setError('');}catch(e){setEvidence(null);setError((e as Error).message);}}
 useEffect(()=>{void load();},[id,refreshToken]);
 const content=evidence?.content;
 // Load only local illustrations or session-protected, partner-scoped pixels.
 const image=content?.media.find(url=>/^\/demo-assets\/[a-zA-Z0-9_-]+\.svg$/.test(url)||/^\/api\/v1\/catalog\/media\/[a-zA-Z0-9_-]+\/content$/.test(url));
 return <section className="panel storefront-evidence">
  <div className="panel-title"><div><h3>Storefront visibility evidence</h3><p>Read from the local SFCC simulator, not rendered from the catalogue editor.</p></div><button className="button" onClick={()=>void load()}>Check storefront</button></div>
  {error&&<p role="alert" className="error">{error}</p>}
  {evidence&&<><p className={evidence.passed?'quality-clear':'quality-issue'}>{evidence.passed?'Verified':'Pending'} · {evidence.detail}</p><p className="footnote">Version {evidence.version} · {evidence.externalId??'No SFCC identity'} · {evidence.notice}</p>
   {content&&<div className="storefront-preview" dir={ar?'rtl':'ltr'} lang={ar?'ar':'en'}>
    <header><img src="/brand/bloomingdales-wordmark.svg" alt="Bloomingdale’s"/><button className="text-button" onClick={()=>setAr(!ar)}>{ar?'English':'العربية'}</button></header>
    <div className="storefront-product"><div className="storefront-photo">{image?<img src={image} alt={ar?content.titleAr:content.titleEn}/>:<p>Media reference retained; external media is not loaded in this private preview.</p>}</div>
     <div><span className="eyebrow">{content.category.replaceAll('/',' / ')}</span><h2>{ar?content.titleAr:content.titleEn}</h2><p>{content.currency} {content.price}</p><dl>{Object.entries(content.attributes).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl><p className="muted">SKU: {content.sku}</p><button disabled className="primary">Preview only · checkout disabled</button><p className="footnote">Sold by {content.merchantOfRecord}</p></div>
    </div><p className="footnote">Uploaded imagery is visible only to authorized ECS users. This private preview is not public SFCC or Fynd asset hosting.</p>
   </div>}
  </>}{!evidence&&!error&&<p>Checking storefront record…</p>}
 </section>;
}
