import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
export const db = new PrismaClient();
export type { Prisma } from '@prisma/client';
