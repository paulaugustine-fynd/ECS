import {readEnv} from '../config/env';
const bucket='ecs-demo-documents';
let ready:Promise<void>|undefined;
async function request(path:string,init:RequestInit={}){
 readEnv();const url=process.env.SUPABASE_URL!,key=process.env.SUPABASE_SERVICE_ROLE_KEY!;
 if(!url||!key)throw Error('Private Supabase storage is not configured');
 return fetch(`${url}/storage/v1${path}`,{...init,redirect:'error',signal:AbortSignal.timeout(15000),headers:{apikey:key,authorization:`Bearer ${key}`,...init.headers}});
}
export async function supabaseStorageHealth(){
 await(ready??=(async()=>{
  const current=await request(`/bucket/${bucket}`);
  if(current.ok){const info=await current.json();if(info.public!==false)throw Error('Demo document bucket must be private');return;}
  if(current.status!==404&&current.status!==400)throw Error('Private bucket is unavailable');
  const created=await request('/bucket',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:bucket,name:bucket,public:false,file_size_limit:5242880})});
  if(!created.ok){const repeated=await request(`/bucket/${bucket}`);if(!repeated.ok||(await repeated.json()).public!==false)throw Error('Private bucket creation failed');}
 })().catch(error=>{ready=undefined;throw error;}));
}
export async function putSupabaseObject(key:string,bytes:Buffer,contentType:string){
 await supabaseStorageHealth();const response=await request(`/object/${bucket}/${key}`,{method:'POST',headers:{'content-type':contentType,'x-upsert':'false'},body:new Uint8Array(bytes)});
 if(!response.ok)throw Error('Private document upload failed');
}
export async function getSupabaseObject(key:string){const response=await request(`/object/${bucket}/${key}`);if(!response.ok)throw Error('Private document is unavailable');return Buffer.from(await response.arrayBuffer());}
