import type {NativeTransport} from './native-coach-workflow';
type Session={cookie:string;csrf:string};
export function nativeHttp(origin:string,log:NativeTransport['log']=()=>{}):NativeTransport{
 let admin:Session|null=null,partnerId='not-created';const receipts=new Set<string>();
 async function request(path:string,options:RequestInit){
  for(let attempt=0;attempt<3;attempt++){
   const response=await fetch(origin+'/api/v1'+path,{...options,signal:AbortSignal.timeout(60000)});
   if(response.status!==429)return response;
   const seconds=Number(response.headers.get('retry-after'));if(!Number.isFinite(seconds)||seconds<1||seconds>60||attempt===2)throw Error('Demo request limit reached; retry later.');
   log('Respecting the demo request limit; waiting '+seconds+' seconds.');
   await new Promise(resolve=>setTimeout(resolve,seconds*1000+150));
  }throw Error('Request limit reached');
 }
 const t:NativeTransport={
  login:async(email,password)=>{const r=await request('/auth/login',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({email,password})});const data=await r.json();if(!r.ok)throw Error('Login failed: '+JSON.stringify(data));const session={cookie:r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),csrf:data.csrfToken};if(data.user.role.startsWith('ATI_'))admin=session;return session;},
  call:async(session,path,body)=>{const s=session as Session|null,r=await request(path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',origin,...(s?{cookie:s.cookie,'x-csrf-token':s.csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await r.json();if(!r.ok)throw Error(path+': '+JSON.stringify(data));if(path==='/partners/invite')partnerId=data.partner.id;if(data.receiptId)receipts.add(data.receiptId);return data;},
  flush:async()=>{for(let i=0;i<50;i++){const inbox=(await t.call(admin,'/integrations/inbox?limit=100')).items.filter((j:{id:string})=>receipts.has(j.id)),correlations=new Set(inbox.map((j:{correlationId:string})=>j.correlationId)),jobs=(await t.call(admin,'/integrations/jobs?limit=100')).items.filter((j:{partnerId:string;correlationId:string})=>j.partnerId===partnerId||correlations.has(j.correlationId));const failed=[...jobs,...inbox].filter(j=>['RETRY','DEAD_LETTER'].includes(j.status));if(failed.length)throw Error('Coach update failed: '+JSON.stringify(failed.map(j=>({operation:j.operation,error:j.error}))));if(![...jobs,...inbox].some(j=>['PENDING','PROCESSING'].includes(j.status)))return;await new Promise(resolve=>setTimeout(resolve,1500));}throw Error('Coach updates still processing; inspect System updates.');},log,
 };return t;
}
