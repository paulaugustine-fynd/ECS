import {beforeAll,afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {db} from '../../packages/db/client';
import {seedDemo} from '../../prisma/seed';
import {createServer} from '../../apps/api/src/server';
import {performanceReport} from '../../packages/domain/analytics';
import type {Actor} from '../../packages/auth/policy';
const company=`analytics-${randomUUID()}`,actors=new Map<string,Actor>(),headers=new Map<string,Record<string,string>>(),partners:string[]=[],products:string[]=[],legs:string[]=[];
const q={market:'AE' as const,from:'2026-09-01',to:'2026-10-01'},path='/api/v1/analytics/performance?',params=new URLSearchParams(q).toString();
let app:FastifyInstance,orderId:string;
beforeAll(async()=>{
 const url=new URL(process.env.DATABASE_URL??'');if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/ecs_test')throw Error('Isolated local ecs_test required');if(!await db.partner.count())await seedDemo();
 const seed=await db.user.findUniqueOrThrow({where:{email:'admin@ati.demo'}});app=await createServer({verifyResponseContracts:true});
 for(const [i,name] of ['=HYPERLINK("private")','Vendor B','Foreign tenant'].entries()){const p=await db.partner.create({data:{companyId:i===2?'other-'+company:company,code:`${company}-${i}`,legalName:name,displayName:name,markets:['AE','SA']}});partners.push(p.id);}
 for(const [name,role,partnerId,markets] of [['admin','ATI_SUPER_ADMIN',null,['AE','SA','KW']],['vendor','VENDOR_ADMIN',partners[0],['AE']],['finance','VENDOR_FINANCE_VIEWER',partners[0],['AE']],['fulfil','VENDOR_FULFILMENT_OPERATOR',partners[0],['AE']],['foreign','VENDOR_ADMIN',partners[2],['AE']]] as const){const u=await db.user.create({data:{companyId:name==='foreign'?'other-'+company:company,name,email:`${name}-${company}@test.invalid`,role,partnerId,markets:[...markets],passwordHash:seed.passwordHash}});actors.set(name,u);const r=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:u.email,password:'Demo123!'}});expect(r.statusCode,r.body).toBe(200);headers.set(name,{cookie:`${r.cookies[0].name}=${r.cookies[0].value}`});}
 for(const [i,brand] of ['Alpha','Beta','Other'].entries()){const p=await db.product.create({data:{companyId:company,partnerId:partners[i===2?1:0],sku:`${company}-${i}`,titleEn:brand,titleAr:brand,category:'Beauty',brand,price:999,floor:0,data:{},market:'AE',currency:'AED'}});products.push(p.id);}
 const order=await db.order.create({data:{companyId:company,market:'AE',channel:'TEST',externalId:company,currency:'AED',total:'999999',correlationId:company,payloadHash:company,lines:[{private:'Full customer basket must not leak'}],deliveryCity:'Dubai',routingPolicy:'TEST',createdAt:new Date('2026-09-10T12:00Z')}});orderId=order.id;
 const second=await db.order.create({data:{companyId:company,market:'AE',channel:'TEST',externalId:company+'-2',currency:'AED',total:100,correlationId:company+'-2',payloadHash:company+'-2',lines:[],deliveryCity:'Dubai',routingPolicy:'TEST',createdAt:new Date('2026-09-11T00:00Z')}});
 const line=(id:string,product:number,quantity:number,unitGross:string,net:string)=>({id,sku:`${company}-${product}`,productId:products[product],quantity,unitGross,net});
 for(const [status,partnerId,oid,linesData] of [['DELIVERED',partners[0],order.id,[line('a',0,2,'100','180'),line('b',1,1,'50','45')]],['ASSIGNED',partners[1],order.id,[line('c',2,3,'200','540')]],['CANCELLED',partners[0],order.id,[line('d',0,1,'100','90')]],['ASSIGNED',partners[0],second.id,[line('e',0,1,'100','90')]]] as const){const l=await db.fulfilmentLeg.create({data:{companyId:company,partnerId,market:'AE',orderId:oid,locationId:'test',status,deadline:new Date('2026-09-12Z'),lines:[...linesData],routingTrace:[]}});legs.push(l.id);}
 for(const [stage,origin,status,completedAt,waivedAt,entityId] of [['CONFIRMATION','EVENT','RESOLVED','2026-09-10T12:30Z',null,legs[0]],['PICK','EVENT','RESOLVED','2026-09-10T14:00Z',null,legs[0]],['PACK','EVENT','WAIVED','2026-09-10T14:00Z','2026-09-10T13:30Z',legs[0]],['DISPATCH','LEGACY_OBSERVED','RESOLVED','2026-09-10T12:30Z',null,legs[0]],['CONFIRMATION','EVENT','RESOLVED','2026-09-10T12:30Z',null,legs[2]],['CONFIRMATION','EVENT','BREACHED',null,null,legs[1]]] as const){await db.slaMilestone.create({data:{companyId:company,partnerId:entityId===legs[1]?partners[1]:partners[0],market:'AE',entityType:'SHIPMENT',entityId,stage,origin,status,policyVersion:1,startedAt:new Date('2026-09-10T12:00Z'),atRiskAt:new Date('2026-09-10T12:45Z'),deadline:new Date('2026-09-10T13:00Z'),completedAt:completedAt?new Date(completedAt):null,waivedAt:waivedAt?new Date(waivedAt):null,breachedAt:status==='BREACHED'?new Date('2026-09-10T13:00Z'):null}});}
 for(const [lineId,product,status] of [['a',0,'CLOSED'],['b',1,'REQUESTED']] as const)await db.returnCase.create({data:{companyId:company,partnerId:partners[0],market:'AE',legId:legs[0],lineId,productId:products[product],requestKey:randomUUID(),quantity:1,status,reason:'private reason',policy:{},refund:90,payableReversal:70,chargeback:0,currency:'AED'}});
 for(const [i,productId] of products.entries()){const loc=await db.location.create({data:{id:randomUUID(),status:'ACTIVE',companyId:company,partnerId:partners[i===2?1:0],market:'AE',name:'Fixture',type:'WAREHOUSE'}});await db.inventory.create({data:{productId,locationId:loc.id,onHand:10,syncedAt:i===0?new Date():i===1?null:new Date(Date.now()-3600000)}});}
});
afterAll(async()=>{await app?.close();await db.user.deleteMany({where:{companyId:{in:[company,'other-'+company]}}});await db.$disconnect();});
it('reports exact snapshot-based metrics, non-additive distinct orders, returns and qualified SLA samples',async()=>{
 const before=[await db.outbox.count(),await db.auditEvent.count(),await db.financialEvent.count()];
 const r=await app.inject({url:path+params,headers:headers.get('admin')});expect(r.statusCode,r.body).toBe(200);const v=r.json();
 expect(v.metrics).toEqual({gmv:'950.00',netOrdered:'855.00',deliveredSales:'225.00',orders:2,shipments:4,deliveredShipments:1,cancelledShipments:1,units:7,deliveredUnits:3,receivedReturnUnits:1,fulfilmentRate:25,returnRate:33.33,slaCompliance:50,slaCompletedMeasured:2,slaCompletedOnTime:1,slaLegacyExcluded:1,slaWaived:1,activeBreaches:1});
 expect(v.partners.map((p:{gmv:string})=>p.gmv)).toEqual(['600.00','350.00']);expect(v.trend).toEqual([{date:'2026-09-10',orders:1,gmv:'850.00'},{date:'2026-09-11',orders:1,gmv:'100.00'}]);expect(v.inventory).toMatchObject({positions:3,fresh:1,pending:1,stale:1});expect(v.breaches[0]).toMatchObject({shipmentId:legs[1],partnerId:partners[1]});
 expect(r.body).not.toMatch(/999999|private reason|Full customer basket|passwordHash/);expect([await db.outbox.count(),await db.auditEvent.count(),await db.financialEvent.count()]).toEqual(before);
});
it('enforces vendor, market, company and report-role isolation for metadata, JSON, CSV and drill links',async()=>{
 const vendor=await app.inject({url:path+params,headers:headers.get('vendor')});expect(vendor.statusCode,vendor.body).toBe(200);expect(vendor.json().metrics).toMatchObject({gmv:'350.00',orders:2,shipments:3,activeBreaches:0});expect(vendor.body).not.toContain(partners[1]);expect(vendor.body).not.toContain('Vendor B');
 const meta=await app.inject({url:'/api/v1/analytics/metadata?market=AE',headers:headers.get('vendor')});expect(meta.statusCode,meta.body).toBe(200);expect(meta.json().partners.map((p:{id:string})=>p.id)).toEqual([partners[0]]);expect(meta.json().brands).toEqual(['Alpha','Beta']);
 const finance=await app.inject({url:path+params,headers:headers.get('finance')});expect(finance.statusCode,finance.body).toBe(200);expect(finance.json()).toMatchObject({canDrillFulfilment:false,breaches:[]});
 for(const suffix of ['performance','export']){const p=`/api/v1/analytics/${suffix}?${params}`;expect((await app.inject({url:p})).statusCode).toBe(401);expect((await app.inject({url:p,headers:headers.get('fulfil')})).statusCode).toBe(403);expect((await app.inject({url:p+`&partnerId=${partners[1]}`,headers:headers.get('vendor')})).statusCode).toBe(404);expect((await app.inject({url:p+`&partnerId=${partners[0]}`,headers:headers.get('foreign')})).statusCode).toBe(404);expect((await app.inject({url:p.replace('market=AE','market=SA'),headers:headers.get('vendor')})).statusCode).toBe(403);}
 const foreign=await app.inject({url:path+params,headers:headers.get('foreign')});expect(foreign.statusCode,foreign.body).toBe(200);expect(foreign.json().metrics.shipments).toBe(0);
});
it('applies partner, brand and UTC cohort boundaries consistently without inventing denominator values',async()=>{
 const a=actors.get('admin')!;
 expect((await performanceReport(a,{...q,brand:'Alpha'})).metrics).toMatchObject({gmv:'300.00',deliveredSales:'180.00',shipments:3,orders:2,returnRate:50});
 expect((await performanceReport(a,{...q,partnerId:partners[1]})).metrics).toMatchObject({gmv:'600.00',slaCompliance:null,returnRate:null});
 expect((await performanceReport(a,{...q,from:'2026-09-11',to:'2026-09-12'})).metrics).toMatchObject({gmv:'100.00',orders:1});
 const empty=await performanceReport(a,{...q,from:'2026-09-12',to:'2026-09-13'});expect(empty.metrics).toMatchObject({gmv:'0.00',orders:0,fulfilmentRate:null,returnRate:null,slaCompliance:null});expect(empty.inventory.positions).toBe(3);
 await expect(performanceReport(a,{...q,partnerId:partners[0],brand:'Other'})).rejects.toMatchObject({code:'NOT_FOUND'});
 const kw=await performanceReport(a,{...q,market:'KW'});expect(kw.currency).toBe('KWD');expect(kw.metrics.gmv).toBe('0.000');
});
it('exports the same scope with formula-safe cells, currency and reproducible filter definitions',async()=>{
 const r=await app.inject({url:`/api/v1/analytics/export?${params}&brand=Alpha`,headers:headers.get('vendor')});expect(r.statusCode,r.body).toBe(200);expect(r.headers['content-type']).toContain('text/csv');expect(r.headers['content-disposition']).toContain('ecs-performance-AE-2026-09-01.csv');expect(r.body).toContain('"gmv","300.00"');expect(r.body).toContain('"\'=HYPERLINK(""private"")"');expect(r.body).not.toMatch(/Vendor B|999999|private reason/);expect(r.body).toContain('To UTC exclusive');
});
it('fails closed for corrupt currency, missing line ownership and invalid query instead of partial totals',async()=>{
 const a=actors.get('admin')!;
 await db.order.update({where:{id:orderId},data:{currency:'USD'}});try{await expect(performanceReport(a,q)).rejects.toMatchObject({code:'REPORT_CURRENCY_MISMATCH'});}finally{await db.order.update({where:{id:orderId},data:{currency:'AED'}});}
 const leg=await db.fulfilmentLeg.findUniqueOrThrow({where:{id:legs[3]}});await db.fulfilmentLeg.update({where:{id:leg.id},data:{lines:[{id:'bad',sku:'bad',productId:products[2],quantity:1,unitGross:'1',net:'1'}]}});try{await expect(performanceReport(a,q)).rejects.toMatchObject({code:'REPORT_DATA_INVALID'});}finally{await db.fulfilmentLeg.update({where:{id:leg.id},data:{lines:leg.lines!}});}
 expect((await app.inject({url:path+params+'&companyId=other',headers:headers.get('admin')})).statusCode).toBe(400);
});
