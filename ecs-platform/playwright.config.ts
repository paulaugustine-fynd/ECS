import {defineConfig,devices} from '@playwright/test';
// The harness, not an arbitrary BASE_URL, owns the disposable environment.
if(process.env.ECS_E2E!=='true'||!/^ecs_e2e_[a-f0-9]{32}$/.test(new URL(process.env.DATABASE_URL??'invalid').pathname.slice(1)))throw Error('Run pnpm test:e2e; direct browser runs against the presenter demo are disabled.');
export default defineConfig({
 testDir:'./tests/e2e',fullyParallel:false,workers:1,retries:0,timeout:60000,
 expect:{timeout:15000},reporter:[['list'],['html',{open:'never'}]],
 use:{baseURL:'http://127.0.0.1:3002',trace:'retain-on-failure',screenshot:'only-on-failure',video:'off'},
 projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}],
});
