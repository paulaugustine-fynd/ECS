import { Prisma } from '@prisma/client';
import { db } from './client';
import type { Actor } from '../auth/policy';
import type { System } from '../config/env';
import { captureDestination } from '../integrations/destination';
export const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

export async function transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await db.$transaction(work, { isolationLevel: 'Serializable', timeout: 15000 }); }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || attempt >= 3) throw error;
    }
  }
}
export function audit(tx: Prisma.TransactionClient, actor: Actor, correlationId: string, action: string, entityId: string, before: unknown, after: unknown, reason?: string, partnerId?: string) {
  return tx.auditEvent.create({data: {companyId: actor.companyId, partnerId: partnerId ?? actor.partnerId, market: actor.markets[0], actorId: actor.id, action, entityId, before: json(before), after: json(after), reason, correlationId}});
}
export async function enqueue(tx: Prisma.TransactionClient, actor: Actor, correlationId: string, target: System, operation: string, aggregateId: string, payload: unknown, idempotencyKey: string, partnerId?: string) {
  const destination = captureDestination(target);
  const job = await tx.outbox.upsert({where: {idempotencyKey}, update: {}, create: {companyId: actor.companyId, partnerId: partnerId ?? actor.partnerId, market: actor.markets[0], target, ...destination, operation, aggregateId, payload: json(payload), correlationId, idempotencyKey}});
  if (job.destinationMode !== destination.destinationMode || job.destinationOrigin !== destination.destinationOrigin ||
      job.companyId !== actor.companyId || job.partnerId !== (partnerId ?? actor.partnerId ?? null) ||
      job.market !== actor.markets[0] || job.target !== target || job.operation !== operation || job.aggregateId !== aggregateId) {
    throw new Error('Idempotency key is already bound to a different integration destination or owner');
  }
  return job;
}
