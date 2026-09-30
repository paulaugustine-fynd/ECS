import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://127.0.0.1:6379'),
  API_PORT: z.coerce.number().int().default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  MOCK_ORIGIN: z.string().url().default('http://127.0.0.1:4100'),
  WEBHOOK_SECRET: z.string().min(32),
  MOCK_SECRET: z.string().min(32),
  DEMO_MODE: z.enum(['true', 'false']).default('true'),
});
export function readEnv() {
  const env = schema.parse(process.env);
  if (env.NODE_ENV === 'production' && env.DEMO_MODE === 'true') {
    throw new Error('Demo seed accounts and controls must not run in production. Use a restricted development deployment.');
  }
  return env;
}
export const systems = ['FYND', 'SFCC', 'ERP', 'WMS', 'FINANCE', 'LOGISTICS'] as const;
export type System = typeof systems[number];
