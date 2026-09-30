import {z} from 'zod';

// Deliberately separate from the outbox port. A successful probe does NOT enable writes.
// Sources verified 2026-09-23:
// https://docs.fynd.com/partners/commerce/headless/authentication/
// https://docs.fynd.com/partners/commerce/sdk/latest/platform/company/companyprofile
const connectionSchema=z.object({
 FYND_CONNECTION_ENABLED:z.literal('true'),
 FYND_TARGET_ENVIRONMENT:z.literal('test'),
 FYND_API_ORIGIN:z.literal('https://api.fynd.com'),
 FYND_COMPANY_ID:z.string().regex(/^[1-9]\d{0,14}$/),
 FYND_CLIENT_ID:z.string().trim().min(1).max(512).refine(s=>!s.includes(':')),
 FYND_CLIENT_SECRET:z.string().min(1).max(4096),
});
export function readFyndConnection(env:Record<string,string|undefined>){
 const result=connectionSchema.safeParse(env);
 if(!result.success)throw new Error(`Fynd connection is not ready. Configure ${[...new Set(result.error.issues.map(i=>i.path[0]))].join(', ')} in .env.fynd.local. No request was sent.`);
 return result.data;
}
type Config=z.infer<typeof connectionSchema>;
async function safeRequest(transport:typeof fetch,url:string,options:RequestInit,step:string){
 let response:Response;
 try{response=await transport(url,{...options,redirect:'error',signal:AbortSignal.timeout(10000)});}
 catch{throw new Error(`Fynd ${step} failed: network, timeout or redirect. Credentials and response bodies were not logged.`);}
 if(!response.ok){await response.body?.cancel();throw new Error(`Fynd ${step} returned HTTP ${response.status}. Check the company, environment and client permissions.`);}
 try{return await response.json() as unknown;}catch{throw new Error(`Fynd ${step} returned an invalid JSON response.`);}
}
export async function checkFyndConnection(input:Config,transport:typeof fetch=fetch){
 // Revalidate at the boundary, including when called from another server module.
 const config=readFyndConnection(input),origin=config.FYND_API_ORIGIN,companyId=config.FYND_COMPANY_ID;
 const tokenResult=await safeRequest(transport,`${origin}/service/panel/authentication/v1.0/company/${companyId}/oauth/token`,{
  method:'POST',headers:{authorization:`Basic ${Buffer.from(`${config.FYND_CLIENT_ID}:${config.FYND_CLIENT_SECRET}`).toString('base64')}`,'content-type':'application/json',accept:'application/json'},body:JSON.stringify({grant_type:'client_credentials'}),
 },'authentication');
 const parsedToken=z.object({access_token:z.string().min(1),token_type:z.string().refine(s=>s.toLowerCase()==='bearer'),expires_in:z.number().positive()}).safeParse(tokenResult);
 if(!parsedToken.success)throw new Error('Fynd returned an invalid token response. No token was stored or displayed.');
 const profileResult=await safeRequest(transport,`${origin}/service/platform/company-profile/v2.0/company/${companyId}`,{
  method:'GET',headers:{authorization:`Bearer ${parsedToken.data.access_token}`,accept:'application/json'},
 },'company-profile read');
 const profile=z.object({uid:z.number().int().positive(),name:z.string().min(1).max(500)}).safeParse(profileResult);
 if(!profile.success||String(profile.data.uid)!==companyId)throw new Error('Fynd profile identity could not be verified against the configured company. Integration remains disabled.');
 return {status:'authenticated-read-verified',companyId,companyName:profile.data.name,apiOrigin:origin,declaredEnvironment:'test',environmentVerification:'User-declared test company; API profile does not prove sandbox isolation',tokenExpiresInSeconds:parsedToken.data.expires_in,businessWritesEnabled:false,outboxConnected:false};
}
