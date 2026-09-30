import {describe,it,expect} from 'vitest';
import {partnerSummaryResponse,partnerDetailResponse} from '../../packages/contracts/partner-responses';
const partner={id:'p',code:'TEST',companyId:'c',legalName:'Fictional LLC',displayName:'Fictional',status:'ACTIVE',markets:['AE'],erpVendorId:null,riskTier:'MEDIUM',trusted:false,brandApproved:false,fyndMapped:false,inventorySynced:false,testOrderPassed:false,version:1,submittedAt:null,createdAt:'2026-09-24T00:00:00.000Z',updatedAt:'2026-09-24T00:00:00.000Z'};
describe('role-specific partner response contracts',()=>{
 it('does not allow application or review data in partner summaries',()=>{
  expect(partnerSummaryResponse.safeParse(partner).success).toBe(true);
  expect(partnerSummaryResponse.safeParse({...partner,application:{bankLast4:'1234'}}).success).toBe(false);
  expect(partnerSummaryResponse.safeParse({...partner,reviewReason:'Internal feedback'}).success).toBe(false);
 });
 it('rejects unauthorized data even when a response says access is denied',()=>{
  const restricted={...partner,documents:[],readiness:[],access:{application:false,commercials:false,documentTypes:[]}};
  expect(partnerDetailResponse.safeParse(restricted).success).toBe(true);
  expect(partnerDetailResponse.safeParse({...restricted,application:{}}).success).toBe(false);
  expect(partnerDetailResponse.safeParse({...restricted,agreements:[]}).success).toBe(false);
  const finance={...restricted,access:{...restricted.access,commercials:true},agreements:[]};
  expect(partnerDetailResponse.safeParse(finance).success).toBe(true);
  expect(partnerDetailResponse.safeParse({...finance,application:{contactEmail:'private@example.test'}}).success).toBe(false);
 });
});
