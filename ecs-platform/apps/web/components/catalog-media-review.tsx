'use client';
import {useState} from 'react';
import {api} from '../lib/api';
import {CatalogMediaReplace} from './catalog-media-replace';
export type ReviewImage={url:string;status:string;reason?:string};
export function CatalogMediaReview({id,version,status,media,moderator,editable,onChanged}:{id:string;version:number;status:string;media:ReviewImage[];moderator:boolean;editable:boolean;onChanged:()=>Promise<void>}){
 const[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const canReview=moderator&&['DRAFT','CHANGES_REQUESTED','IN_REVIEW'].includes(status);
 async function decide(action:string,url:string,position?:number){setBusy(true);setError('');try{await api(`/catalog/items/${id}/media/commands`,{expectedVersion:version,action,url,reason,...(position===undefined?{}:{position})});await onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const disabled=busy||reason.trim().length<5;
 return <section className="panel" aria-label="Image review"><h3>Media moderation</h3><p className="footnote">First image is the primary image. Approval requires human inspection; no AI quality verdict is claimed. Save other draft changes before making an image decision.</p>
 {(editable||canReview)&&<label className="review-reason">Image decision / correction reason<textarea value={reason} disabled={busy} onChange={e=>setReason(e.target.value)} placeholder="Explain the image review or correction (at least 5 characters)…"/></label>}
 {error&&<p role="alert" className="error">{error}</p>}
 <div className="media-review">{media.map((m,index)=><div key={m.url} role="group" aria-label={`Image ${index+1}`}><img src={m.url} alt={`Product image ${index+1} for human review`}/><span className={`badge ${m.status==='APPROVED'?'green':m.status==='REJECTED'?'red':'amber'}`}>{m.status.toLowerCase()}</span>{index===0&&<small> · Primary</small>}{m.reason&&<p>{m.reason}</p>}
 <div className="drawer-actions">{canReview&&<><button className="button" disabled={disabled||m.status==='APPROVED'} onClick={()=>void decide('approve',m.url)}>Approve image {index+1}</button><button className="button" disabled={disabled||m.status==='REJECTED'} onClick={()=>void decide('reject',m.url)}>Reject image {index+1}</button></>}{editable&&<><button className="button" disabled={disabled||index===0} onClick={()=>void decide('move',m.url,index-1)}>Move image {index+1} earlier</button><button className="button" disabled={disabled||index===media.length-1} onClick={()=>void decide('move',m.url,index+1)}>Move image {index+1} later</button><button className="button" disabled={disabled} onClick={()=>void decide('remove',m.url)}>Remove image {index+1}</button></>}</div>
 {editable&&<CatalogMediaReplace key={`${m.url}:${version}`} id={id} version={version} url={m.url} index={index} reason={reason} disabled={disabled} onChanged={onChanged}/>}
 </div>)}</div>
 {!media.length&&<p>No images attached. Upload an image below before submitting.</p>}<p className="footnote">Replace validates and swaps the image in one transaction, retaining its position and original history. Removing only unlinks it from this draft; private pixels and upload history are retained. Rejection returns the product to the vendor for changes.</p></section>;
}
