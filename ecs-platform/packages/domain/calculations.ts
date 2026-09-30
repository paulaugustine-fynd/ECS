import Decimal from 'decimal.js';
import { requireCondition } from './errors';

export function sellable(stock: {onHand: number; reserved: number; damaged: number; unavailable: number; safetyStock: number}, eligible: boolean) {
  for (const key of ['onHand','reserved','damaged','unavailable','safetyStock'] as const) requireCondition(Number.isSafeInteger(stock[key]) && stock[key] >= 0, 'INVALID_STOCK', 'Stock buckets must be non-negative integers');
  return eligible ? Math.max(0, stock.onHand - stock.reserved - stock.damaged - stock.unavailable - stock.safetyStock) : 0;
}
export function payable(gross: string, vendorDiscount: string, rate: string, shipping = '0', chargeback = '0') {
  const values = [gross, vendorDiscount, rate, shipping, chargeback].map(v => new Decimal(v));
  values.forEach(v => requireCondition(v.isFinite() && v.gte(0), 'INVALID_MONEY', 'Amounts must be finite and non-negative'));
  requireCondition(values[1].lte(values[0]) && values[2].lte(1), 'INVALID_COMMERCIALS', 'Discount or commission exceeds allowed range');
  const base = values[0].minus(values[1]);
  const commission = base.mul(values[2]).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return { base: base.toFixed(2), commission: commission.toFixed(2), payable: base.minus(commission).minus(values[3]).minus(values[4]).toFixed(2) };
}
export function validGtin(gtin: string) {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(gtin)) return false;
  const digits = [...gtin].map(Number); const check = digits.pop()!;
  return (10 - digits.reverse().reduce((sum, n, i) => sum + n * (i % 2 === 0 ? 3 : 1), 0) % 10) % 10 === check;
}
export const nextLegState: Record<string, string> = {ASSIGNED:'ACCEPTED', ACCEPTED:'PICKING', PICKING:'PACKED', PACKED:'READY_TO_DISPATCH', READY_TO_DISPATCH:'DISPATCHED', DISPATCHED:'DELIVERED'};
export function transitionLeg(current: string, next: string, tracking?: string) {
  requireCondition(nextLegState[current] === next, 'INVALID_TRANSITION', `Cannot move from ${current} to ${next}`, 409);
  if (next === 'DISPATCHED') requireCondition(tracking?.trim(), 'TRACKING_REQUIRED', 'Tracking reference required');
}
