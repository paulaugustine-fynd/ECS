import { createMockServer } from './server';
import { db } from '../../../packages/db/client';
const app = createMockServer();
await app.listen({host:'127.0.0.1',port:4100});
async function close() {await app.close();await db.$disconnect();}
process.on('SIGTERM',close);process.on('SIGINT',close);
