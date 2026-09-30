import {it,expect} from 'vitest';
import {productResponse,importDetailResponse,settlementResponse,operationsResponseSchemas,inventoryResponse} from '../../packages/contracts/operations-responses';
const now='2026-09-25T00:00:00.000Z';
const product={id:'p',companyId:'c',partnerId:'v',sku:'S',gtin:null,titleEn:'Item',titleAr:'منتج',category:'Beauty',brand:'b',market:'AE',currency:'AED',price:'1.25',floor:'1',status:'DRAFT',version:1,saleStatus:'ENABLED',saleVersion:1,saleChangedAt:null,saleReason:null,data:{attributes:{colour:'blue'}}};
const statement={id:'s',companyId:'c',partnerId:'v',market:'AE',currency:'AED',status:'DRAFT',version:1,from:now,to:now,payable:'0',evidence:{eventIds:[]},exportedId:null,createdAt:now};
it('requires product monetary strings, revisions and nullable state without permitting new root fields',()=>{
 expect(productResponse.safeParse(product).success).toBe(true);
 for(const invalid of [{price:1.25},{saleVersion:0},{saleStatus:'LIVE'},{saleChangedAt:'yesterday'},{passwordHash:'secret'}])expect(productResponse.safeParse({...product,...invalid}).success).toBe(false);
});
it('distinguishes staged validation rows from immutable submitted import evidence and excludes raw candidates',()=>{
 const row={number:2,input:{vendor_sku:'S'},issues:[],warnings:[],floor:'1.00',duplicateCandidates:[]};
 const batch={id:'b',companyId:'c',partnerId:'v',market:'AE',actorId:'a',requestKey:'key',source:'CSV',fileName:'test.csv',checksum:'hash',mapping:null,status:'STAGED',version:1,createdAt:now,updatedAt:now,rows:[row]};
 expect(importDetailResponse.safeParse(batch).success).toBe(true);
 for(const extra of [{candidate:product},{locationId:'hidden'},{duplicateFingerprint:'internal'}])expect(importDetailResponse.safeParse({...batch,rows:[{...row,...extra}]}).success).toBe(false);
 expect(importDetailResponse.safeParse({...batch,originalRows:[]}).success).toBe(false);
 expect(importDetailResponse.safeParse({...batch,status:'SUBMITTED',rows:[{number:2,input:{vendor_sku:'S'},issues:[],warnings:[],floor:null,productId:'p'}]}).success).toBe(true);
 expect(importDetailResponse.safeParse({...batch,status:'SUBMITTED'}).success).toBe(false);
});
it('validates inventory physical quantities and excludes full partner/legal records from nested DTOs',()=>{
 const inventory={id:'i',productId:'p',locationId:'l',onHand:3,reserved:1,damaged:0,unavailable:0,safetyStock:1,sequence:1,revision:1,syncedAt:null,lastEligible:false};
 expect(inventoryResponse.safeParse(inventory).success).toBe(true);
 expect(inventoryResponse.safeParse({...inventory,reserved:-1}).success).toBe(false);
 const location={id:'l',companyId:'c',partnerId:'v',name:'Location',type:'VENDOR_WAREHOUSE',market:'AE',status:'ACTIVE',fyndId:null,version:1,deliveryCities:['Dubai'],cutoffHour:18,dailyCapacity:100};
 const nested={...inventory,sellable:0,location,product:{...product,publications:[],partner:{id:'v',status:'ACTIVE'}}};
 const schema=operationsResponseSchemas['GET /api/v1/inventory'];
 expect(schema.safeParse({items:[nested]}).success).toBe(true);
 expect(schema.safeParse({items:[{...nested,product:{...nested.product,partner:{...nested.product.partner,application:{bank:'private'}}}}]}).success).toBe(false);
});
it('keeps normal and explicitly labelled historical statement shapes and rejects undocumented evidence',()=>{
 expect(settlementResponse.safeParse(statement).success).toBe(true);
 expect(settlementResponse.safeParse({...statement,evidence:{eventIds:[],fixture:'reconciliation-held-export-v1',run:'01'}}).success).toBe(true);
 for(const patch of [{payable:1},{evidence:{eventIds:[],paid:true}},{evidence:{eventIds:[],fixture:'real-payment',run:'01'}}])expect(settlementResponse.safeParse({...statement,...patch}).success).toBe(false);
});
it('rejects raw launch commercial snapshots in projected operational history',()=>{
 const run={id:'run',status:'PASSED',step:8,reason:'Test',createdAt:now,completedAt:now,error:null,fingerprint:'hash',snapshot:{sku:'S',unitGross:'1.00',currency:'AED',fyndLocationId:'l'},jobs:[{id:'j',target:'FYND',status:'SUCCEEDED',attempts:1,error:null,payload:{step:7}}]};
 const schema=operationsResponseSchemas['GET /api/v1/partners/{id}/launch-tests'];
 expect(schema.safeParse({items:[run]}).success).toBe(true);
 expect(schema.safeParse({items:[{...run,snapshot:{...run.snapshot,configuration:{commission:'secret'}}}]}).success).toBe(false);
 expect(schema.safeParse({items:[{...run,step:9}]}).success).toBe(false);
});
it('requires explicit audit before/after values while preserving heterogeneous original JSON',()=>{
 const event={id:'a',companyId:'c',partnerId:null,market:'AE',actorId:'actor',action:'example',entityId:'e',reason:null,before:null,after:['original',1],correlationId:'corr',createdAt:now};
 const schema=operationsResponseSchemas['GET /api/v1/audit'];
 expect(schema.safeParse({items:[event]}).success).toBe(true);
 expect(schema.safeParse({items:[{...event,before:undefined}]}).success).toBe(false);
 expect(schema.safeParse({items:[{...event,privateActor:{password:'secret'}}]}).success).toBe(false);
});
