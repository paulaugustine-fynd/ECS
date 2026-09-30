import {expect,it} from 'vitest';
import {hostedDefaults,databaseUrl,isDemoRuntime} from '../../packages/config/hosted-demo';
const ref='abcdefghijklmnopqrst';
const base={NODE_ENV:'production',VERCEL:'1',ECS_API_RUNTIME:'embedded',ECS_HOSTED_DEMO_PROJECT:ref,NEXT_PUBLIC_SUPABASE_URL:`https://${ref}.supabase.co`,SUPABASE_SERVICE_ROLE_KEY:'fictional-test-key-which-is-long-enough',POSTGRES_PRISMA_URL:`postgresql://postgres.${ref}:fictional@pooler.supabase.com:6543/postgres`,VERCEL_PROJECT_PRODUCTION_URL:'ecs.example'};
it('binds hosted defaults to the dedicated Supabase project and keeps secrets server-side',()=>{
 const env=hostedDefaults(base);expect(env.MOCK_ORIGIN).toBe('mock://ecs-inline');expect(env.DOCUMENT_STORAGE).toBe('supabase');expect(env.WEB_ORIGIN).toBe('https://ecs.example');expect(env.WEBHOOK_SECRET).toHaveLength(64);expect(env.MOCK_SECRET).not.toBe(env.WEBHOOK_SECRET);expect(isDemoRuntime(env)).toBe(true);
 const url=new URL(env.DATABASE_URL!);expect(url.searchParams.get('schema')).toBe('ecs');expect(url.searchParams.get('sslmode')).toBe('require');
 expect(databaseUrl({...base,DATABASE_URL:'postgresql://wrong:wrong@localhost/presenter'})).toBe(env.DATABASE_URL);
});
it('rejects wrong projects, live integrations, non-HTTPS origins and accidental production demo bypasses',()=>{
 for(const extra of [{NEXT_PUBLIC_SUPABASE_URL:'https://different.supabase.co'},{FYND_MODE:'live'},{FYND_CONNECTION_ENABLED:'true'},{WEB_ORIGIN:'http://ecs.example'},{ECS_API_RUNTIME:'proxy'},{VERCEL:'0'},{SUPABASE_SERVICE_ROLE_KEY:''}])expect(()=>hostedDefaults({...base,...extra})).toThrow();
 expect(isDemoRuntime({NODE_ENV:'production',DEMO_MODE:'true'})).toBe(false);
});
it('does not change standalone local configuration or require hosted credentials there',()=>{
 const env={NODE_ENV:'test',DEMO_MODE:'true',DATABASE_URL:'postgresql://local:local@127.0.0.1/ecs_test'};expect(hostedDefaults(env)).toBe(env);expect(databaseUrl(env)).toBe(env.DATABASE_URL);expect(isDemoRuntime(env)).toBe(true);
});
