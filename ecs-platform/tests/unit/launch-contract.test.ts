import {describe,it,expect} from 'vitest';
import {launchFingerprint,launchPayload} from '../../packages/domain/launch-contract';
describe('isolated launch contract',()=>{
 it('fingerprints survive PostgreSQL JSON key ordering but bind business values',()=>{
  expect(launchFingerprint({b:2,a:{y:2,x:1}})).toBe(launchFingerprint({a:{x:1,y:2},b:2}));
  expect(launchFingerprint({a:[1,2]})).not.toBe(launchFingerprint({a:[2,1]}));
 });
 it('does not accept operational quantities or user-controlled extra fields',()=>{
  expect(launchPayload.safeParse({quantity:100,live:true}).success).toBe(false);
 });
});
