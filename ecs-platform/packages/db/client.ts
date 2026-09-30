import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {databaseUrl} from '../config/hosted-demo';
export const db = new PrismaClient({datasourceUrl:databaseUrl()});
export type { Prisma } from '@prisma/client';
