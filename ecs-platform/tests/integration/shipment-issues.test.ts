import {beforeAll,afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import {db} from '../../packages/db/client';
import {seedDemo} from '../../prisma/seed';
import {createServer} from '../../apps/api/src/server';
import {reportShipmentIssue,listShipmentIssues} from '../../packages/domain/shipment-issues';
import {getException,commandException} from '../../packages/domain/exceptions';
import type {Actor} from '../../packages/auth/policy';
const company=`issues-${randomUUID()}`,partner='issue-partner',actors=new Map<string,Actor>(),auth=new Map<string,Record<string,string>>(),legs=new Map<string,string>();
let app:FastifyInstance,exceptionId:string,issueId:string;
const input={requestKey:randomUUID(),expectedShipmentVersion:1,code:'DAMAGED_ITEM' as const,severity:'CRITICAL' as const,details:'A seal is damaged. Please investigate a replacement before packing.'};
beforeAll(async()=>{
 const u=new URL(process.env.DATABASE_URL??'');if(!['localhost','127.0.0.1'].includes(u.hostname)||u.pathname!=='/ecs_test')throw Error('Isolated local ecs_test required');if(!await db.partner.count())await seedDemo();
 const seed=await db.user.findUniqueOrThrow({where:{email:'admin@ati.demo'}});
 app=await createServer({verifyResponseContracts:true});
 for(const [name,role,partnerId,markets,active] of [['admin','ATI_SUPER_ADMIN',null,['AE'],true],['ops','ATI_OPERATIONS_MANAGER',null,['AE'],true],['vendor','VENDOR_ADMIN',partner,['AE'],true],['fulfil','VENDOR_FULFILMENT_OPERATOR',partner,['AE'],true],['catalog','ATI_CATALOG_MODERATOR',null,['AE'],true],['foreign','VENDOR_ADMIN','other-partner',['AE'],true],['sa','VENDOR_ADMIN',partner,['SA'],true],['inactive','VENDOR_ADMIN',partner,['AE'],false]] as const){
  const user=await db.user.create({data:{companyId:company,name,email:`${name}-${company}@test.invalid`,passwordHash:seed.passwordHash,role,partnerId,markets:[...markets],active}});actors.set(name,user);
  if(active){const r=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:user.email,password:'Demo123!'}});expect(r.statusCode,r.body).toBe(200);auth.set(name,{cookie:`${r.cookies[0].name}=${r.cookies[0].value}`,'x-csrf-token':r.json().csrfToken});}
 }
 const order=await db.order.create({data:{companyId:company,market:'AE',channel:'TEST',externalId:company,currency:'AED',total:'100',correlationId:company,payloadHash:company,lines:[],deliveryCity:'Dubai',routingPolicy:'HYBRID_WATERFALL'}});
 for(const [name,status,companyId,partnerId,market] of [['own','PICKING',company,partner,'AE'],['delivered','DELIVERED',company,partner,'AE'],['cancelled','CANCELLED',company,partner,'AE'],['foreign','ASSIGNED',company,'other-partner','AE'],['sa','ASSIGNED',company,partner,'SA'],['tenant','ASSIGNED','foreign-company',partner,'AE']] as const){const l=await db.fulfilmentLeg.create({data:{orderId:order.id,companyId,partnerId,market,locationId:'test-location',status,deadline:new Date('2027-01-01Z'),lines:[],routingTrace:[]}});legs.set(name,l.id);}
});
afterAll(async()=>{await app?.close();await db.user.deleteMany({where:{companyId:company}});await db.$disconnect();});
it('reports with scoped transactional alerts and immutable shipment-stage evidence without business side effects',async()=>{
 const id=legs.get('own')!,before=await db.fulfilmentLeg.findUniqueOrThrow({where:{id}}),counts=[await db.outbox.count(),await db.financialEvent.count(),await db.slaMilestone.count(),await db.inventory.count()];
 const r=await app.inject({method:'POST',url:`/api/v1/shipments/${id}/issues`,headers:auth.get('fulfil'),payload:input});expect(r.statusCode,r.body).toBe(200);({issueId,exceptionId}=r.json());expect(r.json().duplicate).toBe(false);
 const issue=await db.shipmentIssue.findUniqueOrThrow({where:{id:issueId}});expect(issue).toMatchObject({companyId:company,partnerId:partner,market:'AE',reportedStatus:'PICKING',reportedVersion:1,details:input.details});
 const notifications=await db.notification.findMany({where:{entityId:exceptionId},include:{user:true}});expect(notifications.map(n=>n.user.name).sort()).toEqual(['admin','fulfil','ops','vendor']);expect(notifications.every(n=>n.category==='FULFILMENT'&&n.entityType==='EXCEPTION'&&n.severity==='CRITICAL')).toBe(true);expect(notifications.map(n=>n.message).join()).not.toContain(input.details);
 const detail=await app.inject({url:`/api/v1/exceptions/${exceptionId}`,headers:auth.get('vendor')});expect(detail.statusCode,detail.body).toBe(200);expect(detail.json().item).toMatchObject({kind:'FULFILMENT',source:{type:'SHIPMENT',id,status:'PICKING'},summary:input.details});expect(detail.json().item.actions).not.toContain('RESOLVE_REPORT');expect(detail.json().activity[0]).toMatchObject({action:'exception.report',actorName:'fulfil',reason:input.details});
 const list=await app.inject({url:`/api/v1/shipments/${id}/issues`,headers:auth.get('vendor')});expect(list.statusCode,list.body).toBe(200);expect(list.json().items).toHaveLength(1);expect(list.body).not.toMatch(/requestKey|reporterId|passwordHash/);
 expect(await db.fulfilmentLeg.findUniqueOrThrow({where:{id}})).toEqual(before);expect([await db.outbox.count(),await db.financialEvent.count(),await db.slaMilestone.count(),await db.inventory.count()]).toEqual(counts);
 await expect(db.shipmentIssue.update({where:{id:issueId},data:{details:'Rewrite historical report evidence'}})).rejects.toThrow();
 await expect(db.shipmentIssue.delete({where:{id:issueId}})).rejects.toThrow();
});
it('rejects unauthorized, foreign, invalid, stale and CSRF-free reports without creating records',async()=>{
 const path=`/api/v1/shipments/${legs.get('own')}/issues`,payload={...input,requestKey:randomUUID()},count=await db.shipmentIssue.count();
 expect((await app.inject({method:'POST',url:path,payload})).statusCode).toBe(401);
 expect((await app.inject({method:'POST',url:path,headers:{cookie:auth.get('vendor')!.cookie},payload})).statusCode).toBe(403);
 expect((await app.inject({method:'POST',url:path,headers:auth.get('catalog'),payload})).statusCode).toBe(403);
 for(const name of ['foreign','sa','tenant'])expect((await app.inject({method:'POST',url:`/api/v1/shipments/${legs.get(name)}/issues`,headers:auth.get('vendor'),payload})).statusCode).toBe(404);
 for(const invalid of [{details:'short'},{code:'SLA_WAIVER'},{severity:'LOW'},{requestKey:'not-a-uuid'},{partnerId:'foreign'},{expectedShipmentVersion:0}])expect((await app.inject({method:'POST',url:path,headers:auth.get('vendor'),payload:{...payload,...invalid}})).statusCode).toBe(400);
 expect((await app.inject({method:'POST',url:path,headers:auth.get('vendor'),payload:{...payload,expectedShipmentVersion:2}})).statusCode).toBe(409);
 for(const name of ['foreign','sa']){expect((await app.inject({url:path,headers:auth.get(name)})).statusCode).toBe(404);expect((await app.inject({url:`/api/v1/exceptions/${exceptionId}`,headers:auth.get(name)})).statusCode).toBe(404);}
 expect(await db.shipmentIssue.count()).toBe(count);
 const report=await db.shipmentIssue.findUniqueOrThrow({where:{id:issueId}});await expect(db.shipmentIssue.create({data:{...report,id:randomUUID(),requestKey:randomUUID(),partnerId:'foreign'}})).rejects.toThrow();
});
it('deduplicates concurrent retries and rejects changed payloads while allowing later independent reports',async()=>{
 const id=legs.get('own')!,count=await db.notification.count({where:{companyId:company}}),actor=actors.get('fulfil')!;
 const duplicate=await reportShipmentIssue(actor,id,input,company);expect(duplicate).toEqual({issueId,exceptionId,duplicate:true});expect(await db.notification.count({where:{companyId:company}})).toBe(count);
 await expect(reportShipmentIssue(actor,id,{...input,details:'Different evidence on the same request key'},company)).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
 const fresh={...input,requestKey:randomUUID(),code:'CARRIER_DELAY' as const,details:'Pickup is delayed; investigate an alternative collection slot.'};
 const race=await Promise.all([1,2].map(()=>reportShipmentIssue(actor,id,fresh,company)));expect(new Set(race.map(r=>r.issueId)).size).toBe(1);expect(race.map(r=>r.duplicate).sort()).toEqual([false,true]);expect(await db.auditEvent.count({where:{entityId:race[0].exceptionId,action:'exception.report'}})).toBe(1);
 await db.fulfilmentLeg.update({where:{id},data:{version:{increment:1},status:'PACKED'}});
 expect(await reportShipmentIssue(actor,id,input,company)).toEqual({issueId,exceptionId,duplicate:true});
 expect((await db.shipmentIssue.findUniqueOrThrow({where:{id:issueId}})).reportedStatus).toBe('PICKING');
});
it('lets ATI resolve an investigation with audit and deduplicated notices without resolving other failure types',async()=>{
 const id=legs.get('own')!,before=await db.fulfilmentLeg.findUniqueOrThrow({where:{id}}),url=`/api/v1/exceptions/${exceptionId}/commands`,payload={action:'RESOLVE_REPORT',expectedVersion:1,reason:'ATI verified replacement stock and arranged a new packing check.'};
 expect((await app.inject({method:'POST',url,headers:auth.get('vendor'),payload})).statusCode).toBe(403);
 expect((await app.inject({method:'POST',url,headers:{cookie:auth.get('ops')!.cookie},payload})).statusCode).toBe(403);
 const claimed=await commandException(actors.get('ops')!,exceptionId,{action:'CLAIM',expectedVersion:1,reason:'ATI takes ownership of the damaged-seal investigation'},company);expect(claimed.version).toBe(2);
 expect((await app.inject({method:'POST',url,headers:auth.get('ops'),payload})).statusCode).toBe(409);
 const r=await app.inject({method:'POST',url,headers:auth.get('ops'),payload:{...payload,expectedVersion:2}});expect(r.statusCode,r.body).toBe(200);expect(r.json()).toMatchObject({status:'RESOLVED',version:3,actions:[],reason:payload.reason});expect(r.json().resolvedAt).not.toBeNull();
 expect((await listShipmentIssues(actors.get('vendor')!,id)).items.find(i=>i.id===issueId)?.status).toBe('RESOLVED');expect((await getException(actors.get('vendor')!,exceptionId)).activity[0].action).toBe('exception.resolve_report');
 const count=await db.notification.count({where:{eventKey:`shipment-issue:${issueId}:resolved`}});expect(count).toBe(4);
 expect((await app.inject({method:'POST',url,headers:auth.get('ops'),payload:{...payload,expectedVersion:3}})).statusCode).toBe(409);expect(await db.notification.count({where:{eventKey:`shipment-issue:${issueId}:resolved`}})).toBe(count);
 for(const kind of ['SLA','INTEGRATION_DLQ','CATALOG_REVIEW']){const e=await db.exception.create({data:{companyId:company,partnerId:partner,market:'AE',kind,entityId:randomUUID(),message:'Do not hide authoritative failure'}});await expect(commandException(actors.get('admin')!,e.id,{...payload,action:'RESOLVE_REPORT'},company)).rejects.toMatchObject({code:'SOURCE_RESOLUTION_REQUIRED'});expect((await db.exception.findUniqueOrThrow({where:{id:e.id}})).status).toBe('OPEN');}
 expect(await db.fulfilmentLeg.findUniqueOrThrow({where:{id}})).toEqual(before);
});
it('supports post-delivery/cancellation reports and rolls back report, audit and alert when delivery fails',async()=>{
 for(const name of ['delivered','cancelled']){const id=legs.get(name)!;const result=await reportShipmentIssue(actors.get('vendor')!,id,{...input,requestKey:randomUUID()},company);expect((await getException(actors.get('admin')!,result.exceptionId)).item.source?.status).toBe(name.toUpperCase());}
 // Force delivery to fail after the report, exception and audit inserts; all must roll back together.
 const {vi}=await import('vitest');const notices=await import('../../packages/domain/notifications');const mock=vi.spyOn(notices,'notifyOperations').mockRejectedValueOnce(Error('Delivery insert failed'));
 const key=randomUUID(),before=[await db.shipmentIssue.count(),await db.exception.count(),await db.auditEvent.count(),await db.notification.count()];
 try{await expect(reportShipmentIssue(actors.get('vendor')!,legs.get('own')!,{...input,expectedShipmentVersion:2,requestKey:key},company)).rejects.toThrow('Delivery insert failed');expect([await db.shipmentIssue.count(),await db.exception.count(),await db.auditEvent.count(),await db.notification.count()]).toEqual(before);}finally{mock.mockRestore();}
});
