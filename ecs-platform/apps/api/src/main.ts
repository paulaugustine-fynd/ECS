import { createServer } from './server';
import { readEnv } from '../../../packages/config/env';
import { db } from '../../../packages/db/client';
const app = await createServer();
await app.listen({host:'127.0.0.1',port:readEnv().API_PORT});
async function close() {await app.close();await db.$disconnect();}
process.on('SIGINT',close);process.on('SIGTERM',close);
