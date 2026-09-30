import {z} from 'zod';
const text=z.string(),positive=z.number().int().positive();
export const mediaAssetResponse=z.object({id:text,companyId:text,partnerId:text,market:text,checksum:text.regex(/^[a-f0-9]{64}$/),contentType:z.literal('image/png'),byteSize:positive.max(5242880),width:positive.max(4096),height:positive.max(4096),scanStatus:z.literal('MOCK_CLEAN'),quality:z.object({edgeWhitePercent:z.number().int().min(0).max(100),backgroundAssessment:z.literal('HUMAN_REVIEW_REQUIRED'),scanner:text,metadataStripped:z.literal(true)}).strict(),createdAt:text.datetime()}).strict();
export const mediaReceiptResponse=z.object({id:text,assetId:text,productId:text,sourceType:z.enum(['UPLOAD','ZIP','URL','DAM']),sourceRef:text,originalChecksum:text.regex(/^[a-f0-9]{64}$/),productVersion:positive,duplicate:z.boolean(),createdAt:text.datetime(),asset:mediaAssetResponse}).strict();
export const mediaJobResponse=z.object({id:text,productId:text,sourceType:z.enum(['DAM','URL','ZIP']),sourceRef:text.min(1).max(2048),expectedVersion:positive,demoFailures:z.number().int().min(0).max(3),status:z.enum(['PENDING','PROCESSING','RETRY','SUCCEEDED','DLQ']),version:positive,attempts:z.number().int().nonnegative(),cycleAttempts:z.number().int().nonnegative(),replayCount:z.number().int().nonnegative(),availableAt:text.datetime(),receiptId:text.nullable(),receiptIds:z.array(text).max(10),lastError:text.nullable(),createdAt:text.datetime(),updatedAt:text.datetime()}).strict();
export const mediaResponseSchemas={
 'POST /api/v1/catalog/items/{id}/media/zip/jobs':mediaJobResponse,
 'POST /api/v1/catalog/items/{id}/media/url/jobs':mediaJobResponse,
 'POST /api/v1/catalog/items/{id}/media/replace':z.object({receipt:mediaReceiptResponse,replayed:z.boolean()}).strict(),
 'GET /api/v1/catalog/items/{id}/media/jobs':z.object({items:z.array(mediaJobResponse)}).strict(),
 'POST /api/v1/catalog/items/{id}/media/jobs':mediaJobResponse,
 'POST /api/v1/catalog/media/jobs/{id}/replay':mediaJobResponse,
 'POST /api/v1/catalog/items/{id}/media/url':z.object({receipt:mediaReceiptResponse,replayed:z.boolean()}).strict(),
 'POST /api/v1/catalog/items/{id}/media/zip':z.object({receipts:z.array(mediaReceiptResponse).min(1).max(10),replayed:z.boolean(),archiveChecksum:text.regex(/^[a-f0-9]{64}$/)}).strict(),
 'POST /api/v1/catalog/items/{id}/media/commands':z.object({id:text,version:positive,status:z.enum(['DRAFT','CHANGES_REQUESTED','IN_REVIEW'])}).strict(),
 'GET /api/v1/catalog/items/{id}/media':z.object({items:z.array(mediaReceiptResponse)}).strict(),
 'POST /api/v1/catalog/items/{id}/media':z.object({receipt:mediaReceiptResponse,replayed:z.boolean()}).strict(),
};
