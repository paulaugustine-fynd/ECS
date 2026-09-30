import {z} from 'zod';
import {systems} from '../../../packages/config/env';
import {routingPolicies} from '../../../packages/domain/orders';
import {acceptedWebhook} from '../../../packages/events/envelope';

// Shared by the handlers and documentation. Domain schemas remain in their modules.
export const pagination=z.object({page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(100).default(25),market:z.string().length(2).optional(),q:z.string().max(100).optional()});
export const loginInput=z.object({email:z.string().email(),password:z.string().min(1).max(256)});
export const documentReviewInput=z.object({status:z.enum(['APPROVED','REJECTED']),reason:z.string().trim().min(5).max(1000)}).strict();
export const documentDownloadQuery=z.object({expires:z.string().regex(/^\d+$/),signature:z.string().regex(/^[a-f0-9]{64}$/)});
export const demoOrderInput=z.object({externalOrderId:z.string().regex(/^[A-Z0-9-]{4,80}$/),routingPolicy:z.enum(routingPolicies).default('HYBRID_WATERFALL')}).strict();
export const inboxReplayInput=z.object({reason:z.string().min(5).max(1000)});
export const jobReplayInput=z.object({reason:z.string().trim().min(5).max(1000)});
export const clockInput=z.object({minutes:z.number().int().min(1).max(60*24*30)});
export const faultInput=z.object({system:z.enum(systems),remaining:z.number().int().min(0).max(10),statusCode:z.enum(['422','503']).transform(Number)});
export const webhookInput=acceptedWebhook;
