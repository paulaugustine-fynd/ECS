import {z} from 'zod';
const integer=z.number().int().nonnegative();
export const productSalesResponse=z.object({
 id:z.string(),sku:z.string(),market:z.string(),status:z.enum(['ENABLED','PAUSED','DELISTED']),version:integer.positive(),effectiveAt:z.string().datetime().nullable(),reason:z.string().nullable(),openShipments:integer,mode:z.literal('mock'),notice:z.string(),
 positions:z.array(z.object({id:z.string(),location:z.string(),onHand:integer,reserved:integer,revision:integer.positive(),sellable:integer,targets:z.array(z.object({target:z.enum(['FYND','SFCC']),status:z.string(),verified:z.boolean(),observedSellable:integer.nullable(),observedRevision:integer.nullable()}).strict())}).strict()),
 history:z.array(z.object({id:z.string(),action:z.string(),actorId:z.string(),reason:z.string().nullable(),at:z.string().datetime()}).strict()),
}).strict();
export type ProductSalesResponse=z.infer<typeof productSalesResponse>;
