import {createHmac} from 'node:crypto';
type Env=Record<string,string|undefined>;
export const inlineMockOrigin='mock://ecs-inline';
export function hostedDemo(env:Env=process.env){return !!env.ECS_HOSTED_DEMO_PROJECT;}
export function databaseUrl(env:Env=process.env){
 const value=hostedDemo(env)?env.POSTGRES_PRISMA_URL:(env.DATABASE_URL??env.POSTGRES_PRISMA_URL);
 if(!value)return undefined;
 if(!hostedDemo(env))return value;
 const url=new URL(value);url.searchParams.set('schema','ecs');url.searchParams.set('connection_limit','3');url.searchParams.set('pool_timeout','20');url.searchParams.set('sslmode','require');return url.toString();
}
export function hostedDefaults(env:Env=process.env):Env{
 if(!hostedDemo(env))return env;
 const ref=env.ECS_HOSTED_DEMO_PROJECT!,url=env.SUPABASE_URL??env.NEXT_PUBLIC_SUPABASE_URL;
 const secret=env.SUPABASE_SERVICE_ROLE_KEY;
 if(!/^[a-z]{20}$/.test(ref)||url!==`https://${ref}.supabase.co`||!secret||secret.length<32||!env.POSTGRES_PRISMA_URL?.includes(ref))throw Error('Hosted demo database binding is incomplete');
 if(env.VERCEL!=='1'||env.ECS_API_RUNTIME!=='embedded')throw Error('Hosted demo requires the explicit Vercel embedded runtime');
 for(const system of ['FYND','SFCC','ERP','WMS','FINANCE','LOGISTICS'])if(env[`${system}_MODE`]&&env[`${system}_MODE`]!=='mock')throw Error('Hosted demo cannot enable live adapters');
 if(env.FYND_CONNECTION_ENABLED==='true')throw Error('Live Fynd is disabled in the hosted demo');
 const origin=env.WEB_ORIGIN??`https://${env.VERCEL_PROJECT_PRODUCTION_URL??env.VERCEL_URL}`;
 const parsed=new URL(origin);if(parsed.protocol!=='https:'||parsed.origin!==origin)throw Error('Hosted demo requires an exact HTTPS origin');
 return {...env,DATABASE_URL:databaseUrl(env),DEMO_MODE:'true',MOCK_ORIGIN:inlineMockOrigin,DOCUMENT_STORAGE:'supabase',DOCUMENT_SCAN_MODE:'mock',SUPABASE_URL:url,WEB_ORIGIN:origin,
  WEBHOOK_SECRET:createHmac('sha256',secret).update('ecs-demo-webhook-v1').digest('hex'),MOCK_SECRET:createHmac('sha256',secret).update('ecs-demo-mock-v1').digest('hex')};
}
// Initialize server-only defaults before modules inspect process.env. Never exported to the browser.
export function configureHostedDemo(){if(hostedDemo())Object.assign(process.env,hostedDefaults());}
export function isDemoRuntime(env:Env=process.env){return env.DEMO_MODE==='true'&&(env.NODE_ENV!=='production'||(hostedDemo(env)&&!!hostedDefaults(env)));}
