import { randomBytes, scryptSync, timingSafeEqual, createHash, createHmac } from 'node:crypto';
import { DomainError } from '../domain/errors';

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password: string, encoded: string) {
  const [salt, hash] = encoded.split(':');
  if (!salt || !hash || !/^[a-f0-9]{128}$/.test(hash)) return false;
  return timingSafeEqual(Buffer.from(hash, 'hex'), scryptSync(password, salt, 64));
}
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('hex');
export const signWebhook = (raw: string, timestamp: string, secret: string) => createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
export function verifyWebhook(raw: string, timestamp: string, signature: string, secret: string, now = Date.now()) {
  if (!/^\d+$/.test(timestamp) || Math.abs(now - Number(timestamp) * 1000) > 300_000 || !/^[a-f0-9]{64}$/.test(signature)) {
    throw new DomainError('INVALID_SIGNATURE', 'Invalid signature or expired webhook timestamp', 401);
  }
  if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(signWebhook(raw, timestamp, secret), 'hex'))) {
    throw new DomainError('INVALID_SIGNATURE', 'Invalid webhook signature', 401);
  }
}
