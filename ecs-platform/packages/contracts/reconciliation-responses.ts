import {z} from 'zod';
const text=z.string(),date=text.datetime(),integer=z.number().int(),entityType=z.enum(['SHIPMENT','SETTLEMENT']);
export const reconciliationIssueResponse=z.object({id:text,companyId:text,partnerId:text,market:text,entityType,entityId:text,checkKey:text,source:text,status:z.enum(['OPEN','RESOLVED']),version:integer.positive(),firstExpected:text,firstActual:text,expected:text,actual:text,firstSeenAt:date,observedAt:date,resolvedAt:date.nullable()}).strict();
const check=z.object({key:text,source:z.enum(['SFCC','FYND','ECS_LEDGER','FINANCE']),label:text,status:z.enum(['MATCH','MISMATCH','MISSING','NOT_DUE']),expected:text,actual:text}).strict();
export const reconciliationDetailResponse=z.object({companyId:text,partnerId:text,market:text,entityType,id:text,reference:text,currency:text,entityStatus:text,entityVersion:integer.positive(),canRepairLedger:z.boolean(),checks:z.array(check),issues:z.array(reconciliationIssueResponse),history:z.array(z.object({id:text,action:text,reason:text.nullable(),createdAt:date}).strict()),evidenceMode:z.literal('RECORDED_LOCAL_MOCK_EXCHANGES'),historyLimit:z.literal(50)}).strict();
export const reconciliationListResponse=z.object({items:z.array(reconciliationIssueResponse),total:integer.nonnegative(),limit:z.literal(100),shipments:z.array(z.object({id:text,status:text,partnerId:text,reference:text}).strict()),statements:z.array(z.object({id:text,status:text,partnerId:text}).strict()),canManage:z.boolean()}).strict();
export type ReconciliationDetail=z.infer<typeof reconciliationDetailResponse>;
export type ReconciliationList=z.infer<typeof reconciliationListResponse>;
export const reconciliationResponseSchemas={
 'POST /api/v1/reconciliation/shipments/{id}/repair-ledger':z.object({shipmentId:text,createdEntries:integer.nonnegative(),actualMoneyMoved:z.literal(false)}).strict(),
 'GET /api/v1/reconciliation':reconciliationListResponse,
 'GET /api/v1/reconciliation/evidence':reconciliationDetailResponse,
 'POST /api/v1/reconciliation/scan':z.object({entityType,id:text,failedChecks:integer.nonnegative()}).strict(),
 'POST /api/v1/reconciliation/issues/{id}/resolve':reconciliationIssueResponse,
};
