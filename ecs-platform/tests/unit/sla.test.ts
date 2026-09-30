import {it,expect} from 'vitest';
import {slaStage,slaState,slaWaiver} from '../../packages/domain/sla';
it('maps acknowledgement waits into the same stage and terminal records into no active stage',()=>{
 for(const [type,status,stage] of [['SHIPMENT','AWAITING_FYND','CONFIRMATION'],['SHIPMENT','ASSIGNED','CONFIRMATION'],['SHIPMENT','ACCEPTED','PICK'],['SHIPMENT','PICKING','PACK'],['SHIPMENT','PACKED','DISPATCH'],['SHIPMENT','READY_TO_DISPATCH','DISPATCH'],['SHIPMENT','DISPATCHED','DELIVERY'],['RETURN','APPROVAL_PENDING','RETURN_VERIFICATION'],['RETURN','PICKUP_PENDING','RETURN_PICKUP'],['RETURN','PICKUP_BOOKED','RETURN_PICKUP'],['RETURN','QC_FAILED','QC'],['RETURN','REFUND_PENDING','REFUND_ACK']])expect(slaStage(type,status)).toBe(stage);
 for(const status of ['CANCELLED','DELIVERED'])expect(slaStage('SHIPMENT',status)).toBeNull();
 for(const status of ['CLOSED','REJECTED'])expect(slaStage('RETURN',status)).toBeNull();
});
it('uses exact demo-clock warning/deadline boundaries and requires meaningful waiver reasons',()=>{
 const m={atRiskAt:new Date(45000),deadline:new Date(60000)};
 expect(slaState(m,new Date(44999))).toBe('ON_TRACK');expect(slaState(m,new Date(45000))).toBe('AT_RISK');expect(slaState(m,new Date(60000))).toBe('AT_RISK');expect(slaState(m,new Date(60001))).toBe('BREACHED');
 expect(slaWaiver.safeParse({expectedVersion:1,reason:'  okay  '}).success).toBe(false);
});
