import {z} from 'zod';
const text=z.string(),date=text.datetime(),count=z.number().int().nonnegative(),money=text.regex(/^\d+\.\d{2,3}$/),rate=z.number().nonnegative().nullable();
const market=z.enum(['AE','SA','KW']),currency=z.enum(['AED','SAR','KWD']);
export const analyticsMetadataResponse=z.object({market,currency,demoNow:date,partners:z.array(z.object({id:text,displayName:text}).strict()),brands:z.array(text),canDrillFulfilment:z.boolean()}).strict();
const bucket=z.object({id:text,name:text,orders:count,shipments:count,deliveredShipments:count,units:count,deliveredUnits:count,receivedReturnUnits:count,gmv:money,deliveredSales:money,fulfilmentRate:rate,returnRate:rate}).strict();
export const performanceResponse=z.object({
 filters:z.object({market,from:text,to:text,partnerId:text.nullable(),brand:text.nullable()}).strict(),currency,generatedAt:date,demoNow:date,cohort:z.literal('ORDER_CREATED_UTC'),brandBasis:z.literal('CURRENT_CANONICAL_PRODUCT'),
 metrics:z.object({gmv:money,netOrdered:money,deliveredSales:money,orders:count,shipments:count,deliveredShipments:count,cancelledShipments:count,units:count,deliveredUnits:count,receivedReturnUnits:count,fulfilmentRate:rate,returnRate:rate,slaCompliance:rate,slaCompletedMeasured:count,slaCompletedOnTime:count,slaLegacyExcluded:count,slaWaived:count,activeBreaches:count}).strict(),
 inventory:z.object({basis:z.literal('CURRENT_WALL_CLOCK'),thresholdMinutes:z.literal(15),positions:count,fresh:count,pending:count,stale:count}).strict(),
 partners:z.array(bucket),brands:z.array(bucket),trend:z.array(z.object({date:text,gmv:money,orders:count}).strict()),canDrillFulfilment:z.boolean(),
 breaches:z.array(z.object({id:text,shipmentId:text,partnerId:text,partnerName:text,stage:text,deadline:date,orderReference:text}).strict()),breachListLimit:z.literal(50),
}).strict();
export type PerformanceReport=z.infer<typeof performanceResponse>;
export type AnalyticsMetadata=z.infer<typeof analyticsMetadataResponse>;
export const analyticsResponseSchemas={'GET /api/v1/analytics/metadata':analyticsMetadataResponse,'GET /api/v1/analytics/performance':performanceResponse};
