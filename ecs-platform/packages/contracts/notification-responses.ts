import {z} from 'zod';
const category=z.enum(['SLA','CATALOG','INTEGRATION','FULFILMENT']);
const role=z.enum(['ATI_SUPER_ADMIN','ATI_OPERATIONS_MANAGER','ATI_CATALOG_MODERATOR','VENDOR_ADMIN','VENDOR_FULFILMENT_OPERATOR','VENDOR_CATALOG_MANAGER']);
const policy=z.object({category,severity:z.enum(['WARNING','CRITICAL']),version:z.number().int().nonnegative(),source:z.enum(['CONFIGURED','DEMO_DEFAULT']),atiRoles:z.array(role),vendorRoles:z.array(role),defaults:z.object({atiRoles:z.array(role),vendorRoles:z.array(role)}).strict(),roleOptions:z.object({ati:z.array(role),vendor:z.array(role)}).strict(),recipientCounts:z.record(role,z.number().int().nonnegative()),activeAtiRecipients:z.number().int().nonnegative(),updatedAt:z.string().datetime().nullable()}).strict();
const notification=z.object({id:z.string(),category,severity:z.enum(['WARNING','CRITICAL']),entityType:z.enum(['SHIPMENT','RETURN','PRODUCT','INTEGRATION_JOB','INBOX_RECEIPT','EXCEPTION']),entityId:z.string(),partnerId:z.string().nullable(),market:z.string(),title:z.string(),message:z.string(),eventAt:z.string().datetime(),createdAt:z.string().datetime(),readAt:z.string().datetime().nullable()}).strict();
export const notificationResponseSchemas={
 'GET /api/v1/notification-policies':z.object({market:z.string(),deliveryMode:z.literal('IN_APP_ONLY'),appliesTo:z.literal('NEXT_DELIVERY_EVALUATION'),items:z.array(policy)}).strict(),
 'POST /api/v1/notification-policies':policy,
 'GET /api/v1/notifications':z.object({items:z.array(notification),total:z.number().int().nonnegative(),unread:z.number().int().nonnegative(),page:z.number().int().positive(),limit:z.number().int().positive(),deliveryMode:z.literal('IN_APP_ONLY'),categories:z.array(category)}).strict(),
 'POST /api/v1/notifications/{id}/read':notification,
};
