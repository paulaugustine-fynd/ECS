import { defineConfig } from 'vitest/config';
import 'dotenv/config';
const url=new URL(process.env.TEST_DATABASE_URL??process.env.DATABASE_URL??'postgresql://ecs:ecs_local_only@127.0.0.1:5432/ecs_test');
url.pathname='/ecs_test';
export default defineConfig({test:{environment:'node',testTimeout:20000,hookTimeout:30000,env:{
  NODE_ENV:'test',DATABASE_URL:url.toString(),MOCK_ORIGIN:'http://127.0.0.1:4101',DEMO_MODE:'true',
  WEBHOOK_SECRET:'ecs-test-webhook-secret-never-for-production',MOCK_SECRET:'ecs-test-adapter-secret-never-for-production',
}}});
