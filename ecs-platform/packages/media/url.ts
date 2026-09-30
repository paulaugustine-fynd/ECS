import {z} from 'zod';
import {BlockList,isIPv4,isIP} from 'node:net';
import {Resolver} from 'node:dns/promises';
import {request as httpsRequest} from 'node:https';
import {request as httpRequest,type IncomingHttpHeaders,type ClientRequest} from 'node:http';
import {DomainError,requireCondition} from '../domain/errors';
import {maxImageBytes} from './image';
export const urlMediaInput=z.object({requestId:z.string().uuid(),expectedVersion:z.number().int().positive(),url:z.string().min(1).max(2048)}).strict();
const excluded=new BlockList();
// Conservative exclusions include the IANA IPv4 special-purpose blocks. IPv6
// is deliberately unsupported rather than allowed without equivalent checks.
for(const [address,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.31.196.0',24],['192.52.193.0',24],['192.88.99.0',24],['192.168.0.0',16],['192.175.48.0',24],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const)excluded.addSubnet(address,prefix,'ipv4');
export const publicMediaIPv4=(address:string)=>isIPv4(address)&&!excluded.check(address,'ipv4');
async function resolveIPv4(host:string){const resolver=new Resolver({timeout:2000,tries:1});try{return await resolver.resolve4(host);}catch{throw new DomainError('MEDIA_URL_DNS','Approved image host could not be resolved',400);}finally{resolver.cancel();}}
// Queue-time policy validation is deliberately network-free. DNS is checked and
// pinned afresh for each worker attempt, including after an operator replay.
export function validateImageSource(source:string,env:Record<string,string|undefined>=process.env){
 if(source==='demo://supplier/front.png'){
  requireCondition(env.DEMO_MODE==='true'&&env.NODE_ENV!=='production','MEDIA_URL_DISABLED','Demo source requires explicit local demo mode',403);
  const origin=new URL(env.MOCK_ORIGIN??'http://127.0.0.1:4100');
  requireCondition(origin.protocol==='http:'&&origin.hostname==='127.0.0.1'&&!!origin.port&&!origin.username&&!origin.password&&!origin.search&&!origin.hash&&origin.pathname==='/','MEDIA_URL_DISABLED','Demo image origin must be the configured IPv4 loopback mock service',503);
  return {url:new URL('/media-demo/front.png',origin),mock:true,fileName:'front.png'};
 }
 let url:URL;try{url=new URL(source);}catch{throw new DomainError('MEDIA_URL_INVALID','Provide an approved HTTPS image URL',400);}
 requireCondition(source===url.href&&url.protocol==='https:'&&!url.port&&!url.username&&!url.password&&!url.search&&!url.hash&&!isIP(url.hostname)&&/^[a-z0-9.-]+$/.test(url.hostname)&&!url.hostname.endsWith('.'),'MEDIA_URL_INVALID','Only canonical HTTPS URLs without credentials, query strings, IP literals or nonstandard ports are supported',400);
 const fileName=url.pathname.split('/').pop()??'';
 requireCondition(/^[A-Za-z0-9][A-Za-z0-9._ -]{0,100}\.(png|jpe?g|webp)$/i.test(fileName)&&!/%|\\/.test(url.pathname),'MEDIA_URL_INVALID','Use a direct raster image path without encoded characters',400);
 const allowed=(env.MEDIA_URL_ALLOWED_HOSTS??'').split(',').map(s=>s.trim()).filter(Boolean);
 requireCondition(allowed.includes(url.hostname),'MEDIA_URL_HOST','The image host is not approved by the ECS operator',403);
 return {url,mock:false,fileName};
}
export async function planImageRequest(source:string,env:Record<string,string|undefined>=process.env,resolve:(host:string)=>Promise<string[]>=resolveIPv4){
 const plan=validateImageSource(source,env);
 if(plan.mock)return {...plan,address:'127.0.0.1'};
 const addresses=await resolve(plan.url.hostname);
 requireCondition(addresses.length>0&&addresses.every(publicMediaIPv4),'MEDIA_URL_ADDRESS','Image host resolves to a private, special-purpose or unsupported address',403);
 return {...plan,address:addresses[0]};
}
export function validateImageResponse(status:number,headers:IncomingHttpHeaders,fileName:string){
 requireCondition(status!==429&&status<500,'MEDIA_URL_TRANSIENT','Image source is temporarily unavailable or rate limited',503);
 requireCondition(status===200,'MEDIA_URL_HTTP','Image source did not return HTTP 200; redirects are never followed',400);
 requireCondition(!headers['content-encoding']||headers['content-encoding']==='identity','MEDIA_URL_ENCODING','Compressed HTTP image responses are not supported',400);
 const extension=fileName.split('.').pop()!.toLowerCase(),expected=extension==='jpg'||extension==='jpeg'?'image/jpeg':`image/${extension}`;
 requireCondition(headers['content-type']?.split(';')[0].trim().toLowerCase()===expected,'MEDIA_URL_TYPE','Source Content-Type must match the raster filename',400);
 const length=headers['content-length'];if(length!==undefined)requireCondition(/^\d+$/.test(length)&&Number(length)>0&&Number(length)<=maxImageBytes,'MEDIA_URL_SIZE','Image source exceeds the 5 MB limit',400);
}
export async function fetchImageSource(source:string,expectedOrigin?:string){
 const env=source==='demo://supplier/front.png'&&expectedOrigin?{...process.env,MOCK_ORIGIN:expectedOrigin}:process.env;
 const destination=validateImageSource(source,env);
 requireCondition(!expectedOrigin||destination.url.origin===expectedOrigin,'MEDIA_URL_BINDING','Image source does not match its queued destination',403);
 const plan=await planImageRequest(source,env);
 const bytes=await new Promise<Buffer>((resolve,reject)=>{
  let done=false,req:ClientRequest|undefined;const timer=setTimeout(()=>finish(new DomainError('MEDIA_URL_TIMEOUT','Image download exceeded ten seconds',400)),10000);
  const finish=(error?:unknown,value?:Buffer)=>{if(done)return;done=true;clearTimeout(timer);if(error){req?.destroy();reject(error instanceof DomainError?error:new DomainError('MEDIA_URL_NETWORK','Image download failed; no source credentials or response body were logged',400));}else resolve(value!);};
  try{req=(plan.mock?httpRequest:httpsRequest)(plan.url,{method:'GET',agent:false,family:4,maxHeaderSize:16384,headers:{accept:'image/png,image/jpeg,image/webp','accept-encoding':'identity'},lookup:(_host,_options,callback)=>callback(null,plan.address,4)},response=>{
   try{validateImageResponse(response.statusCode??0,response.headers,plan.fileName);}catch(e){response.destroy();finish(e);return;}
   const chunks:Buffer[]=[];let size=0;
   response.on('error',finish);response.on('aborted',()=>finish(new DomainError('MEDIA_URL_TRUNCATED','Image source ended before completion',400)));
   response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>maxImageBytes){response.destroy();finish(new DomainError('MEDIA_URL_SIZE','Downloaded image exceeds 5 MB',400));return;}chunks.push(chunk);});
   response.on('end',()=>{if(!response.complete||size===0){finish(new DomainError('MEDIA_URL_TRUNCATED','Empty or incomplete image response',400));return;}finish(undefined,Buffer.concat(chunks));});
  });
  req.on('error',finish);req.end();}catch(e){finish(e);}
 });
 return {bytes,fileName:plan.fileName,mock:plan.mock};
}
