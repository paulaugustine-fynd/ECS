import {z} from 'zod';
import {digest} from '../auth/security';
export function launchFingerprint(value:unknown):string{
 const sort=(input:unknown):unknown=>Array.isArray(input)?input.map(sort):input&&typeof input==='object'?Object.fromEntries(Object.entries(input).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,sort(v)])):input;
 return digest(JSON.stringify(sort(value)));
}
export const launchStates=['ASSIGNED','ACCEPTED','PICKING','PACKED','READY_TO_DISPATCH','DISPATCHED','DELIVERED','CONFIRMED'] as const;
export const launchPayload=z.object({runId:z.string().min(1),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),step:z.number().int().min(0).max(7),quantity:z.literal(1),tracking:z.string().min(5),scenario:z.object({companyId:z.string(),partnerId:z.string(),market:z.literal('AE'),inventoryId:z.string(),sku:z.string(),currency:z.literal('AED'),unitGross:z.string().regex(/^\d+\.\d{2}$/),productId:z.string(),productVersion:z.number().int(),locationId:z.string(),fyndLocationId:z.string(),sourceSequence:z.number().int(),configuration:z.unknown()}).strict()}).strict();
export const launchReceipt=z.object({runId:z.string(),fingerprint:z.string(),step:z.number().int(),state:z.enum(launchStates),virtualOnHand:z.number().int().nonnegative(),virtualReserved:z.number().int().nonnegative()}).strict();
