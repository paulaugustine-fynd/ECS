import type { User } from '@prisma/client';
import { DomainError } from '../domain/errors';
export type Actor = Pick<User, 'id' | 'companyId' | 'partnerId' | 'markets' | 'role'>;
export type Capability = 'partners' | 'catalog' | 'fulfilment' | 'finance' | 'integrations' | 'rules' | 'audit';
const grants: Record<string, Capability[]> = {
  ATI_SUPER_ADMIN: ['partners', 'catalog', 'fulfilment', 'finance', 'integrations', 'rules', 'audit'],
  ATI_PARTNER_MANAGER: ['partners'], ATI_CATALOG_MODERATOR: ['catalog'],
  ATI_OPERATIONS_MANAGER: ['fulfilment', 'integrations'], ATI_FINANCE_ANALYST: ['finance'], ATI_AUDITOR: ['audit'],
  VENDOR_ADMIN: ['partners', 'catalog', 'fulfilment'], VENDOR_CATALOG_MANAGER: ['catalog'],
  VENDOR_FULFILMENT_OPERATOR: ['fulfilment'], VENDOR_FINANCE_VIEWER: [],
};
export function permit(actor: Actor, capability: Capability, operatorOnly = false) {
  if (!grants[actor.role]?.includes(capability) || (operatorOnly && isVendor(actor))) {
    throw new DomainError('FORBIDDEN', 'Your role cannot perform this action', 403);
  }
}
export const isVendor = (actor: Actor) => actor.role.startsWith('VENDOR_');
export function scope(actor: Actor, requestedMarket?: string) {
  if (isVendor(actor) && !actor.partnerId) throw new DomainError('INVALID_MEMBERSHIP', 'Partner membership required', 403);
  if (requestedMarket && !actor.markets.includes(requestedMarket)) throw new DomainError('MARKET_FORBIDDEN', 'Market not permitted', 403);
  return {
    companyId: actor.companyId,
    market: requestedMarket ?? { in: actor.markets },
    ...(isVendor(actor) ? { partnerId: actor.partnerId! } : {}),
  };
}
export function partnerScope(actor: Actor) {
  scope(actor);
  return { companyId: actor.companyId, markets: { hasSome: actor.markets }, ...(isVendor(actor) ? { id: actor.partnerId! } : {}) };
}
