import { describe,it,expect } from 'vitest';
import { sellable,payable,validGtin,transitionLeg } from '../../packages/domain/calculations';
import { permit,scope,partnerScope,type Actor } from '../../packages/auth/policy';
import { hashPassword,verifyPassword,signWebhook,verifyWebhook } from '../../packages/auth/security';
import {hasBrandRight,rightState} from '../../packages/domain/brand-policy';
const vendor:Actor={id:'u',companyId:'c',partnerId:'v1',markets:['AE'],role:'VENDOR_ADMIN'};
describe('domain invariants',()=>{
  it('matches exact market/brand, category boundaries and exclusive end dates',()=>{
    const now=new Date('2026-09-23T08:00:00Z'),r={brand:'br_demo',market:'AE',categories:['Women/Bags'],status:'APPROVED',validFrom:now,validUntil:new Date('2026-10-01T00:00:00Z')},p={brand:'br_demo',market:'AE',category:'Women/Bags/Shoulder'};
    expect(hasBrandRight([r],p,now)).toBe(true);
    for(const change of [{market:'SA'},{brand:'another'},{category:'Women/BagsOther'}])expect(hasBrandRight([r],{...p,...change},now)).toBe(false);
    expect(hasBrandRight([r],p,r.validUntil)).toBe(false);expect(rightState(r,r.validUntil)).toBe('EXPIRED');expect(rightState({...r,validFrom:new Date(now.getTime()+1)},now)).toBe('SCHEDULED');
    for(const status of ['DRAFT','PAUSED','SUSPENDED','REVOKED','REJECTED'])expect(hasBrandRight([{...r,status}],p,now)).toBe(false);
  });
  it('applies stock buckets and suspension without changing physical stock',()=>{
    const s={onHand:14,reserved:1,damaged:1,unavailable:2,safetyStock:2};
    expect(sellable(s,true)).toBe(8);expect(sellable(s,false)).toBe(0);expect(s.onHand).toBe(14);
    expect(()=>sellable({...s,onHand:-1},true)).toThrow();
  });
  it('calculates supplied Lumera payable and reversal exactly',()=>{
    expect(payable('640','64','0.32')).toEqual({base:'576.00',commission:'184.32',payable:'391.68'});
    expect(payable('320','32','0.32')).toEqual({base:'288.00',commission:'92.16',payable:'195.84'});
    expect(()=>payable('100','101','0.2')).toThrow();
  });
  it('checks identifiers and state transitions',()=>{
    expect(validGtin('4006381333931')).toBe(true);expect(validGtin('4006381333932')).toBe(false);
    expect(()=>transitionLeg('ASSIGNED','DISPATCHED')).toThrow();
    expect(()=>transitionLeg('READY_TO_DISPATCH','DISPATCHED')).toThrow();
    expect(()=>transitionLeg('READY_TO_DISPATCH','DISPATCHED','AWB123')).not.toThrow();
  });
});
describe('identity and isolation',()=>{
  it('constrains vendor queries and rejects missing scope',()=>{
    expect(scope(vendor)).toEqual({companyId:'c',partnerId:'v1',market:{in:['AE']}});
    expect(partnerScope(vendor).id).toBe('v1');
    expect(()=>scope({...vendor,partnerId:null})).toThrow();expect(()=>scope(vendor,'SA')).toThrow();
  });
  it('rejects finance and operator-only actions for vendors',()=>{
    expect(()=>permit(vendor,'finance')).toThrow();expect(()=>permit(vendor,'partners',true)).toThrow();
    expect(()=>permit({...vendor,role:'ATI_FINANCE_ANALYST',partnerId:null},'fulfilment')).toThrow();
  });
  it('hashes passwords and rejects incorrect credentials',()=>{
    const hash=hashPassword('Demo123!');expect(hash).not.toContain('Demo123!');
    expect(verifyPassword('Demo123!',hash)).toBe(true);expect(verifyPassword('wrong',hash)).toBe(false);
  });
  it('rejects forged, expired and altered webhook bodies',()=>{
    const raw='{"eventId":"one"}',ts='1800000000',secret='test-secret';
    const signature=signWebhook(raw,ts,secret);
    expect(()=>verifyWebhook(raw,ts,signature,secret,1800000000000)).not.toThrow();
    expect(()=>verifyWebhook(raw+' ',ts,signature,secret,1800000000000)).toThrow();
    expect(()=>verifyWebhook(raw,ts,signature,secret,1800000900000)).toThrow();
  });
});
