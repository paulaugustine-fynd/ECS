/* eslint-disable @typescript-eslint/no-explicit-any -- acceptance transport validates server contracts; endpoint shapes differ. */
import {randomUUID} from 'node:crypto';
import {coachExample,coachCatalogue,coachCategory} from '../../seed/coach-native';
type Session=unknown;
export type NativeTransport={login:(email:string,password:string)=>Promise<Session>;call:(session:Session,path:string,body?:unknown)=>Promise<any>;flush:()=>Promise<void>;log:(message:string)=>void};
/** Acceptance runner: uses only the same API operations as the existing screens. */
export async function nativeCoachWorkflow(t:NativeTransport,admin:Session,options:{email?:string;password:string;suffix?:string}){
 const {call,flush,log}=t,email=options.email??coachExample.email,suffix=options.suffix??'';
 const invite=await call(admin,'/partners/invite',{email,legalName:coachExample.legalName,displayName:coachExample.displayName});
 const id=invite.partner.id;
 await call(null,'/invitations/accept',{token:invite.invitationUrl.split('#')[1],email,name:'Sara — Coach UAE demo',password:options.password});
 const vendor=await t.login(email,options.password);
 const partner=()=>call(admin,`/partners/${id}`);
 const command=async(action:string,who=admin)=>{const p=await partner();return call(who,`/partners/${id}/commands`,{action,expectedVersion:p.version,...(['request-info','pause'].includes(action)?{reason:'Fictional demo review: please confirm the business address.'}:{})});};
 let p=await partner();
 await call(vendor,`/partners/${id}/application`,{expectedVersion:p.version,legalName:p.legalName,displayName:p.displayName,application:{...coachExample.application,contactEmail:email,declaration:true}});
 for(const type of ['TRADE_LICENSE','VAT_CERTIFICATE','BANK_LETTER']){
  p=await partner();await call(vendor,`/partners/${id}/documents`,{expectedVersion:p.version,type,fileName:`COACH-DEMO-${type}.txt`,contentType:'text/plain',base64:Buffer.from(`FICTIONAL DEMONSTRATION DOCUMENT\nCoach UAE\n${type}\nNot a legal document.`).toString('base64'),expiresAt:type==='TRADE_LICENSE'?'2027-12-31T00:00:00.000Z':null});
 }
 await command('submit',vendor);await command('review');await command('request-info');
 p=await partner();await call(vendor,`/partners/${id}/application`,{expectedVersion:p.version,legalName:p.legalName,displayName:p.displayName,application:{...coachExample.application,contactEmail:email,address:'Fictional Coach demo office, Dubai, UAE — confirmed',declaration:true}});
 await command('submit',vendor);await command('review');p=await partner();
 for(const doc of p.documents)await call(admin,`/documents/${doc.id}/review`,{status:'APPROVED',reason:'Reviewed fictional Coach sample; not legal verification.'});
 await command('approve');await command('sync-erp');await flush();log('Coach registered, corrected and approved in Partners & brands.');
 const terms=await call(admin,`/partners/${id}/agreements`),now=terms.now;
 const agreement=await call(admin,`/partners/${id}/agreements`,{expectedVersion:0,rate:'0.20',currency:'AED',cadence:'MONTHLY',validFrom:now,validUntil:'2027-12-31T00:00:00.000Z',market:'AE',brand:null,categoryRates:[],returnDays:30,handlingCharge:'20.00',reason:'Fictional Coach demo terms; not a commercial agreement.'});
 await call(admin,`/agreements/${agreement.id}/approve`,{reason:'Approve fictional 20 percent demo commission.'});
 const right=await call(admin,`/partners/${id}/brand-rights`,{brand:'br_coach',market:'AE',categories:[coachCategory],validFrom:now,validUntil:'2027-12-31T00:00:00.000Z',evidence:'Fictional Coach UAE sample authorization',reason:'Demonstrate ordinary brand review.'});
 await call(admin,`/brand-rights/${right.id}/commands`,{action:'approve',expectedVersion:right.version,reason:'Fictional territorial permission reviewed for this demo.'});
 const location=await call(admin,'/locations',{requestId:randomUUID(),partnerId:id,market:'AE',name:'Coach UAE Demo Warehouse',type:'VENDOR_WAREHOUSE',deliveryCities:['Dubai','Abu Dhabi'],cutoffHour:23,dailyCapacity:500,status:'ACTIVE',reason:'Fictional Coach fulfilment location for the existing workflow.'});
 await command('map-fynd');await flush();
 p=await partner();const rows=coachCatalogue(p.code,location.id);
 if(suffix)rows.forEach((r,i)=>{r.vendor_sku+='-'+suffix;r.parent_sku+='-'+suffix;const body=('29'+suffix.replace(/\D/g,'').padEnd(9,'0').slice(0,9)+i);r.gtin=body+String((10-[...body].reduce((s,n,j)=>s+Number(n)*(j%2?3:1),0)%10)%10);});
 let batch=await call(vendor,'/catalog/imports',{source:'API',fileName:'API batch',requestKey:randomUUID(),rows});
 if(suffix)for(const row of batch.rows.filter((r:any)=>r.issues.some((i:any)=>i.code==='PROBABLE_DUPLICATE')))batch=await call(admin,`/catalog/imports/${batch.id}/duplicate-decision`,{expectedVersion:batch.version,rowNumber:row.number,reason:'Independent isolated acceptance-test assortment, distinct from previously retained test products.'});
 const issues=batch.rows.flatMap((r:any)=>r.issues);if(issues.length)throw Error('Coach import validation: '+JSON.stringify(issues));
 const submitted=await call(vendor,`/catalog/imports/${batch.id}/submit`,{expectedVersion:batch.version});
 const productIds:string[]=submitted.rows.map((r:any)=>r.productId);
 for(const productId of productIds)for(const action of ['approve-media','approve','publish']){const product=await call(admin,`/catalog/items/${productId}`);await call(admin,`/catalog/items/${productId}/commands`,{action,expectedVersion:product.version,reason:'Fictional Coach product and illustration reviewed.'});}
 await flush();await command('sync-inventory');await flush();p=await partner();
 const blockers=p.readiness.filter((g:any)=>g.key!=='test'&&!g.passed);if(blockers.length)throw Error('Coach preparation blocked: '+JSON.stringify(blockers));
 await call(admin,`/partners/${id}/launch-tests`,{expectedVersion:p.version,requestId:randomUUID(),reason:'Check the ordinary Coach setup before opening for sales.'});await flush();
 await command('activate');await flush();log('Three Coach products published, stock checked and partner opened for sales.');
 const reference='COACH-UAE-'+(suffix||Date.now());
 const received=await call(admin,'/demo/orders',{externalOrderId:reference,partnerId:id,routingPolicy:'HYBRID_WATERFALL'});await flush();
 const shipments=(await call(admin,'/shipments?limit=100')).items.filter((s:any)=>s.order.externalId===reference);
 if(!shipments.length)throw Error('Coach order has not allocated shipments. Receipt '+received.receiptId);
 for(const row of shipments){for(const next of ['ACCEPTED','PICKING','PACKED','READY_TO_DISPATCH','DISPATCHED','DELIVERED']){const s=await call(admin,`/shipments/${row.id}`);await call(next==='DELIVERED'?admin:vendor,`/shipments/${s.id}/commands`,{next,expectedVersion:s.version,...(next==='PACKED'?{confirmedQuantities:Object.fromEntries(s.lines.map((l:any)=>[l.id,l.quantity]))}:{}),...(next==='DISPATCHED'?{tracking:'COACH-DEMO-'+row.id.slice(-8)}:{})});await flush();}}
 const shipment=await call(admin,`/shipments/${shipments[0].id}`);
 await call(admin,'/demo/invoices',{shipmentId:shipment.id,invoiceNumber:'COACH-DEMO-'+Date.now()});await flush();log('Coach order delivered through the existing fulfilment screens.');
 const line=shipment.lines.find((l:any)=>l.sku.startsWith('COACH-TABBY'))??shipment.lines[0];
 let ret=await call(vendor,'/returns',{legId:shipment.id,lineId:line.id,quantity:1,reason:'Fictional customer returned one unused handbag.',requestId:randomUUID()});
 for(const action of ['approve','book-pickup','receive','qc-good']){ret=await call(admin,`/returns/${ret.id}`);await call(admin,`/returns/${ret.id}/commands`,{action,expectedVersion:ret.version,reason:'Fictional return checked; handbag unused and suitable for resale.'});await flush();}
 ret=await call(admin,`/returns/${ret.id}`);if(ret.refundStatus!=='REFUNDED'&&ret.status!=='REFUNDED'&&ret.status!=='CLOSED')throw Error('Refund not completed: '+JSON.stringify(ret));
 const from=new Date(new Date(now).getTime()-86400000).toISOString(),to=new Date(new Date(now).getTime()+86400000).toISOString();
 let statement=await call(admin,'/settlements',{partnerId:id,from,to});
 for(const action of ['calculate','review','lock','export','confirm-payment']){statement=await call(admin,`/settlements/${statement.id}`);await call(admin,`/settlements/${statement.id}/commands`,{action,expectedVersion:statement.version,reason:'Reviewed native Coach sale, return and commission records for demo.'});await flush();}
 statement=await call(admin,`/settlements/${statement.id}`);if(statement.status!=='PAID'||Number(statement.payable)!==2380)throw Error('Unexpected native statement: '+JSON.stringify(statement));
 const own=(await call(vendor,'/partners?limit=100')).items;if(own.length!==1||own[0].id!==id)throw Error('Coach partner scope failed');
 log('Coach return refunded and native statement paid in simulation: AED 2,380.');
 return {partnerId:id,email,locationId:location.id,productIds,importId:batch.id,orderReference:reference,shipmentId:shipment.id,returnId:ret.id,statementId:statement.id,payable:statement.payable};
}
