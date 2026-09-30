'use client';
import {useState} from 'react';
import {api} from '../lib/api';

export function CatalogMediaReplace({id,version,url,index,reason,disabled,onChanged}:{id:string;version:number;url:string;index:number;reason:string;disabled:boolean;onChanged:()=>Promise<void>}){
 const[file,setFile]=useState<{requestId:string;expectedVersion:number;fileName:string;base64:string;reason:string}|null>(null);
 const[busy,setBusy]=useState(false),[error,setError]=useState(''),[open,setOpen]=useState(false);
 return <div>
 <button className="button" disabled={disabled||busy} aria-expanded={open} onClick={()=>setOpen(!open)}>Replace image {index+1}</button>
 {open&&<div role="group" aria-label={`Replacement for image ${index+1}`}>
 <p className="footnote">The original stays attached until the new file passes validation. Its position is preserved; the replacement needs fresh ATI approval. Enter your reason above before choosing the file.</p>
 <label>Replacement file for image {index+1}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy||disabled} onChange={async e=>{
  const picked=e.target.files?.[0];setFile(null);setError('');if(!picked)return;
  if(picked.size>5*1024*1024){setError('Image exceeds the 5 MB limit.');return;}
  setBusy(true);try{
   const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Could not read image'));reader.readAsDataURL(picked);});
   setFile({requestId:crypto.randomUUID(),expectedVersion:version,fileName:picked.name,base64,reason});
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }}/></label>
 {file&&<p className="footnote">Replacement reason: {file.reason}</p>}
 <button className="button" disabled={busy||disabled||!file} onClick={async()=>{
  if(!file)return;setBusy(true);setError('');try{
   await api(`/catalog/items/${id}/media/replace`,{...file,replaceUrl:url});setFile(null);await onChanged();setOpen(false);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }}>{busy?'Validating replacement…':`Save replacement for image ${index+1}`}</button>
 {error&&<p className="error" role="alert">{error} The original remains attached unless this request already completed; retrying the same file request is safe.</p>}
 </div>}
 </div>;
}
