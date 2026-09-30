import type {FastifyInstance} from 'fastify';
import {isDemoRuntime} from '../config/hosted-demo';
let pending:Promise<FastifyInstance>|undefined;
export async function inlineMockRequest(path:string,init:{method?:'GET'|'POST';headers?:Record<string,string>;body?:string}={}){
 if(!isDemoRuntime())throw Error('Inline simulator requires explicit demo mode');
 if(!/^\/(health|systems\/(FYND|SFCC|ERP|WMS|FINANCE|LOGISTICS)\/[a-zA-Z]+|dam\/assets\/(studio-front|studio-back)|media-demo\/front[.]png)$/.test(path))throw Error('Unknown inline simulator path');
 const app=await(pending??=import('../../apps/mock-systems/src/server').then(async({createMockServer})=>{const value=createMockServer();await value.ready();return value;}).catch(error=>{pending=undefined;throw error;}));
 const result=await app.inject({method:init.method??'GET',url:path,headers:init.headers,payload:init.body});
 const headers=new Headers();for(const [key,value]of Object.entries(result.headers))if(value!==undefined)headers.set(key,String(value));
 return new Response(new Uint8Array(result.rawPayload),{status:result.statusCode,headers});
}
