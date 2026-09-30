import {test,expect,type Page} from '@playwright/test';
import sharp from 'sharp';
import {signIn} from './auth';

type Leg={id:string;partnerId:string;locationId:string;status:string;requestedStatus:string|null;fyndId:string|null;order:{externalId:string};lines:{id:string;sku:string;quantity:number;inventoryId:string}[]};
const reference='BLOOM-E2E-CONNECTED-001';
let legs:Leg[]=[];
let returnId='';
let exchangeReturnId='';
let deliveredReplacement='';
async function login(page:Page,email:string){
 await signIn(page,email);
 await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeEnabled();
}
async function shipmentState(page:Page,state:string){
 await expect(page.locator('.detail-heading .badge')).toHaveText(state);await expect(page.getByText('Awaiting Fynd:',{exact:false})).toHaveCount(0);await expect(page.getByText('Transition queued.',{exact:false})).toHaveCount(0);
}
async function progress(page:Page,button:string,state:string){await page.getByRole('button',{name:button,exact:true}).click();await shipmentState(page,state);}
async function readLegs(page:Page){const res=await page.request.get('/api/v1/shipments?limit=100');expect(res.ok()).toBe(true);return (await res.json()).items.filter((l:Leg)=>l.order.externalId===reference) as Leg[];}
async function inspectionPhoto(page:Page,notes:string){
 const pixels=await sharp({create:{width:256,height:256,channels:3,background:'#cbbfa9'}}).png().toBuffer();
 await page.getByLabel('Inspection photo',{exact:true}).setInputFiles({name:'fictional-inspection.png',mimeType:'image/png',buffer:pixels});await page.getByLabel('Photo inspection notes',{exact:true}).fill(notes);await page.getByRole('button',{name:'Save inspection photo',exact:true}).click();
 await expect(page.locator('[aria-label="Return inspection photos"]').getByRole('status')).toContainText('retained privately');await expect(page.locator('[aria-label="Return inspection photos"] img')).toHaveJSProperty('naturalWidth',256);
}

test.describe.serial('connected order, return and settlement journey',()=>{
 test('signed order replay is idempotent and a vendor fulfils only its own leg',async({browser})=>{
  const op=await browser.newContext(),vendor=await browser.newContext();const a=await op.newPage(),v=await vendor.newPage();
  try{
   await login(a,'ops@ati.demo');await a.goto('/operator/orders');await a.getByLabel('SFCC order reference',{exact:true}).fill(reference);
   await a.getByRole('button',{name:'Receive sample order',exact:true}).click();await expect(a.getByRole('status')).toContainText('Signed SFCC receipt accepted');
   await expect(a.locator('.data-panel tbody tr').filter({hasText:reference}).locator('.badge')).toHaveText(['assigned','assigned','assigned']);
   legs=await readLegs(a);expect(legs.map(l=>[l.partnerId,l.locationId]).sort()).toEqual([['vnd_lum','loc_lum_wh1'],['vnd_maz','loc_maz_wh1'],['vnd_nrh','loc_ati_dc1']]);
   expect(legs.every(l=>l.fyndId&&!l.fyndId.startsWith('seed-'))).toBe(true);
   await a.getByRole('button',{name:'Receive sample order',exact:true}).click();await expect(a.getByRole('status')).toContainText('Existing receipt');expect((await readLegs(a)).map(l=>l.id).sort()).toEqual(legs.map(l=>l.id).sort());
   const own=legs.find(l=>l.partnerId==='vnd_maz')!,other=legs.find(l=>l.partnerId==='vnd_lum')!;
   await login(v,'fulfilment@maisonazure.demo');await v.goto('/vendor/orders');await expect(v.locator('.data-panel tbody tr')).toHaveCount(1);await expect(v.locator('.data-panel')).not.toContainText('vnd_lum');
   expect((await v.request.get(`/api/v1/shipments/${other.id}`)).status()).toBe(404);
   await v.getByRole('link',{name:'Open →',exact:true}).click();await expect(v.locator('.routing-panel .chosen')).toContainText('Maison Azure JAFZA Warehouse');
   await progress(v,'Accept shipment','accepted');await progress(v,'Start picking','picking');
   await v.getByRole('button',{name:'Confirm picked quantities',exact:true}).click();await expect(v.locator('.operations').getByRole('alert')).toContainText('Confirm all 1 units');await expect(v.locator('.detail-heading .badge')).toHaveText('picking');
   await v.getByLabel(`Picked ${own.lines[0].sku}`,{exact:true}).fill('1');await progress(v,'Confirm picked quantities','packed');
   const slip=await v.request.get(`/api/v1/shipments/${own.id}/packing-slip`);expect(slip.ok()).toBe(true);const html=await slip.text();expect(html).toContain('Bloomingdale');expect(html).toContain('This is not a VAT invoice');expect(html).not.toContain('LUM-SRM');
   await progress(v,'Ready for dispatch','ready to dispatch');await v.getByLabel('Carrier tracking reference',{exact:true}).fill('ATI-E2E-MAZ-001');await progress(v,'Confirm carrier handover','dispatched');await expect(v.getByRole('button',{name:'Confirm demo delivery',exact:true})).toHaveCount(0);
   await a.goto(`/operator/orders/${own.id}`);await progress(a,'Confirm demo delivery','delivered');
   const final=await readLegs(a);expect(final.find(l=>l.id===own.id)?.status).toBe('DELIVERED');expect(final.filter(l=>l.id!==own.id).every(l=>l.status==='ASSIGNED')).toBe(true);
   await a.screenshot({path:test.info().outputPath('delivered-independent-leg.png'),fullPage:true});
  }finally{await op.close();await vendor.close();}
 });

 test('ATI delivers Lumera then inspects one return with separate refund and payable reversal',async({page})=>{
  await login(page,'ops@ati.demo');const leg=legs.find(l=>l.partnerId==='vnd_lum')!;await page.goto(`/operator/orders/${leg.id}`);
  await progress(page,'Accept shipment','accepted');await progress(page,'Start picking','picking');await page.getByLabel(`Picked ${leg.lines[0].sku}`,{exact:true}).fill('2');await progress(page,'Confirm picked quantities','packed');await progress(page,'Ready for dispatch','ready to dispatch');await page.getByLabel('Carrier tracking reference',{exact:true}).fill('ATI-E2E-LUM-001');await progress(page,'Confirm carrier handover','dispatched');await progress(page,'Confirm demo delivery','delivered');
  const inventory=async()=>{const res=await page.request.get('/api/v1/inventory?limit=100');expect(res.ok()).toBe(true);return (await res.json()).items.find((i:{id:string})=>i.id===leg.lines[0].inventoryId);};
  const before=await inventory();expect(before).toBeTruthy();
  await page.goto('/operator/returns');await page.getByRole('button',{name:'Request a return',exact:true}).click();await page.getByRole('combobox',{name:'Delivered shipment',exact:true}).selectOption(leg.id);await page.getByRole('combobox',{name:'Item',exact:true}).selectOption(leg.lines[0].id);await page.getByLabel('Return quantity',{exact:true}).fill('1');await page.getByLabel('Reason',{exact:true}).fill('Customer requested return of one sealed serum');await page.getByRole('button',{name:'Validate & submit return',exact:true}).click();await expect(page).toHaveURL(/\/operator\/returns\/[^/]+$/);returnId=page.url().split('/').at(-1)!;
  await expect(page.locator('.metrics')).toContainText('AED 288.00');await expect(page.locator('.metrics')).toContainText('AED 195.84');await expect(page.locator('.metrics')).toContainText('AED 20.00');
  for(const [button,state] of [['Approve return','approved'],['Book mock pickup','pickup booked'],['Record receipt','received'],['QC passed · Restock','closed']]){
   if(button==='QC passed · Restock')await inspectionPhoto(page,'Synthetic demo photo: intact packaging and sealed item');
   await page.getByLabel('Decision reason / evidence',{exact:true}).fill('Inspected sealed fictional item and confirmed return evidence');await page.getByRole('button',{name:button,exact:true}).click();await expect(page.locator('.detail-heading>.badge')).toHaveText(state);
  }
  const after=await inventory();expect(after.onHand).toBe(before.onHand+1);expect(after.damaged).toBe(before.damaged);
  const returned=await (await page.request.get(`/api/v1/returns/${returnId}`)).json();expect(returned).toMatchObject({status:'CLOSED',qc:'GOOD',refundStatus:'ACKNOWLEDGED',refund:'288',payableReversal:'195.84',chargeback:'20'});expect([returned.fyndReturnId,returned.logisticsId,returned.refundId].every(Boolean)).toBe(true);
  expect((await readLegs(page)).find(l=>l.partnerId==='vnd_nrh')?.status).toBe('ASSIGNED');
  expect(returned.policy.qcDecision).toMatchObject({condition:'GOOD',disposition:'RESTOCK'});expect(returned.policy.qcDecision.evidenceIds).toHaveLength(1);await expect(page.getByRole('button',{name:'Save inspection photo',exact:true})).toHaveCount(0);
  await expect(page.getByText('No real refund or bank movement occurred.',{exact:false})).toBeVisible();await page.screenshot({path:test.info().outputPath('return-qc-refund.png'),fullPage:true});
 });

 test('Finance reconciles 175.84 AED, locks evidence and exports without paying real money',async({page,browser})=>{
  await login(page,'finance@ati.demo');await page.goto('/operator/settlements');await page.getByRole('button',{name:'New statement',exact:true}).click();await page.getByRole('combobox',{name:'Partner',exact:true}).selectOption('vnd_lum');await page.getByRole('button',{name:'Create draft statement',exact:true}).click();await expect(page).toHaveURL(/\/operator\/settlements\/[^/]+$/);const id=page.url().split('/').at(-1)!;
  for(const [button,state] of [['Calculate statement','calculated'],['Mark reviewed','reviewed'],['Lock statement','locked'],['Export to mock Finance','exported'],['Simulate payout confirmation','paid · simulated']]){
   await page.getByLabel('Decision / reconciliation evidence',{exact:true}).fill('Matched delivered serum sale, one return and handling charge');await page.getByRole('button',{name:button,exact:true}).click();await expect(page.locator('.detail-heading>.badge')).toHaveText(state);await expect(page.locator('.statement-total strong')).toHaveText('AED 175.84');
  }
  await expect(page.getByRole('button',{name:'Recalculate',exact:true})).toHaveCount(0);await expect(page.getByText('No real money moved.',{exact:false})).toBeVisible();
  const statement=await(await page.request.get(`/api/v1/settlements/${id}`)).json();expect(statement.status).toBe('PAID');expect(statement.exportedId).toBeTruthy();expect(statement.evidence.events).toHaveLength(6);expect(statement.evidence.events.filter((e:{sourceId:string})=>e.sourceId===returnId)).toHaveLength(2);
  const csv=await page.request.get(`/api/v1/settlements/${id}/export`);expect(csv.ok()).toBe(true);expect(await csv.text()).toContain('RETURN_REVERSAL');
  const foreign=await browser.newContext();try{const v=await foreign.newPage();await login(v,'finance@maisonazure.demo');expect((await v.request.get(`/api/v1/settlements/${id}`)).status()).toBe(404);}finally{await foreign.close();}
  await page.screenshot({path:test.info().outputPath('locked-settlement.png'),fullPage:true});
 });

 test('Bad QC retains photos, quarantines the second unit and requires a separate refund override',async({page,browser})=>{
  await login(page,'ops@ati.demo');const leg=legs.find(l=>l.partnerId==='vnd_lum')!;
  const inventory=async()=>{const r=await page.request.get('/api/v1/inventory?limit=100');expect(r.ok()).toBe(true);return (await r.json()).items.find((i:{id:string})=>i.id===leg.lines[0].inventoryId);};const before=await inventory();
  await page.goto('/operator/returns');await page.getByRole('button',{name:'Request a return',exact:true}).click();await page.getByRole('combobox',{name:'Delivered shipment',exact:true}).selectOption(leg.id);await page.getByRole('combobox',{name:'Item',exact:true}).selectOption(leg.lines[0].id);await page.getByLabel('Return quantity',{exact:true}).fill('1');await page.getByLabel('Reason',{exact:true}).fill('Second serum returned with broken seal for inspection');await page.getByRole('button',{name:'Validate & submit return',exact:true}).click();await expect(page).toHaveURL(/\/operator\/returns\/[^/]+$/);const id=page.url().split('/').at(-1)!;
  for(const [button,state] of [['Approve return','approved'],['Book mock pickup','pickup booked'],['Record receipt','received']]){await page.getByLabel('Decision reason / evidence',{exact:true}).fill('Recorded second returned unit and receipt evidence');await page.getByRole('button',{name:button,exact:true}).click();await expect(page.locator('.detail-heading>.badge')).toHaveText(state);}
  await inspectionPhoto(page,'Synthetic demo photo: broken seal, item not fit for resale');await page.getByLabel('Decision reason / evidence',{exact:true}).fill('Broken seal: quarantine this unit and hold the refund');await page.getByRole('button',{name:'QC failed · Quarantine',exact:true}).click();await expect(page.locator('.detail-heading>.badge')).toHaveText('qc failed');
  await expect(page.locator('[aria-label="Recorded QC decision"]')).toContainText('BAD · QUARANTINE');await expect(page.getByRole('button',{name:'Save inspection photo',exact:true})).toHaveCount(0);
  const after=await inventory();expect(after.onHand).toBe(before.onHand+1);expect(after.damaged).toBe(before.damaged+1);expect(after.onHand-after.damaged).toBe(before.onHand-before.damaged);
  const held=await(await page.request.get(`/api/v1/returns/${id}`)).json();expect(held).toMatchObject({qc:'BAD',refundStatus:'HELD',refundId:null});expect(held.policy.qcDecision.evidenceIds).toHaveLength(1);
  const content=`/api/v1/returns/evidence/${held.policy.qcDecision.evidenceIds[0]}/content`;
  const foreign=await browser.newContext();try{const v=await foreign.newPage();await login(v,'fulfilment@maisonazure.demo');expect((await v.request.get(content)).status()).toBe(404);}finally{await foreign.close();}
  await page.getByLabel('Decision reason / evidence',{exact:true}).fill('ATI goodwill approval; retain damaged disposition and inspection evidence');await page.getByRole('button',{name:'Approve refund override',exact:true}).click();await expect(page.locator('.detail-heading>.badge')).toHaveText('closed');
  const completed=await(await page.request.get(`/api/v1/returns/${id}`)).json();expect(completed.policy.qcDecision).toEqual(held.policy.qcDecision);expect(completed.refundStatus).toBe('ACKNOWLEDGED');expect(completed.policy.refundOverride.reason).toContain('goodwill');const finalStock=await inventory();expect(finalStock.onHand).toBe(after.onHand);expect(finalStock.damaged).toBe(after.damaged);
  await expect(page.getByText('Refund override does not change the original condition or release quarantined stock.',{exact:true})).toBeVisible();await page.screenshot({path:test.info().outputPath('bad-qc-photo-override.png'),fullPage:true});
 });
 test('exchange preview offers M to L, explains blocked gates and does not reserve or rewrite delivery',async({page})=>{
  await login(page,'ops@ati.demo');const leg=legs.find(l=>l.partnerId==='vnd_maz')!;
  const before=await(await page.request.get(`/api/v1/shipments/${leg.id}`)).json();
  await page.goto('/operator/returns');await page.getByRole('button',{name:'Request a return',exact:true}).click();
  await page.getByRole('combobox',{name:'Delivered shipment',exact:true}).selectOption(leg.id);await page.getByRole('combobox',{name:'Item',exact:true}).selectOption(leg.lines[0].id);await page.getByLabel('Reason',{exact:true}).fill('Customer requests the same dress in size L');await page.getByRole('button',{name:'Validate & submit return',exact:true}).click();await expect(page).toHaveURL(/\/operator\/returns\/[^/]+$/);const id=page.url().split('/').at(-1)!;
  exchangeReturnId=id;
  const originalReturn=await(await page.request.get(`/api/v1/returns/${id}`)).json(),stockBefore=await(await page.request.get('/api/v1/inventory?limit=100')).json();
  await page.getByRole('button',{name:'Explore exchange variants',exact:true}).click();await page.getByRole('combobox',{name:'Replacement variant',exact:true}).selectOption('prd_maz_dress_1001_l');await page.getByRole('button',{name:'Preview replacement',exact:true}).click();
  const panel=page.locator('[aria-label="Replacement preview result"]');await expect(panel).toContainText('M → L');await expect(panel).toContainText('Blocked — review requirements below');await expect(panel).toContainText('acknowledged original refund');await expect(panel).toContainText('unpublished');
  await expect(page.locator('[aria-label="Exchange preview"]')).toContainText('No replacement order or payment is submitted');await expect(page.getByRole('button',{name:'Save exchange request for review',exact:true})).toHaveCount(0);
  expect(await(await page.request.get(`/api/v1/shipments/${leg.id}`)).json()).toEqual(before);expect(await(await page.request.get(`/api/v1/returns/${id}`)).json()).toEqual(originalReturn);expect(await(await page.request.get('/api/v1/inventory?limit=100')).json()).toEqual(stockBefore);
  await page.locator('[aria-label="Exchange preview"]').screenshot({path:test.info().outputPath('exchange-blocked-preview.png')});
 });
 test('ATI publishes size L and refunds size M; partner saves and cancels a persistent review request',async({page,browser})=>{
  await login(page,'admin@ati.demo');await page.goto('/operator/catalog/items/prd_maz_dress_1001_l');
  await page.getByRole('button',{name:'Submit saved version for review',exact:true}).click();await expect(page.locator('.detail-heading')).toContainText('in review');
  await page.getByLabel('Review evidence / feedback').fill('Reviewed distinct size L identity, bilingual content, rights and approved image');await page.getByRole('button',{name:'Approve product',exact:true}).click();await page.getByRole('button',{name:'Publish through ERP',exact:true}).click();
  await expect.poll(async()=>{const refresh=page.getByRole('button',{name:'Refresh status',exact:true});await refresh.click();await expect(refresh).toBeEnabled();return page.locator('.detail-heading').textContent();},{timeout:30000}).toContain('published');
  await expect(page.locator('.publication-flow .badge')).toHaveText(['succeeded','succeeded','succeeded']);
  await page.goto(`/operator/returns/${exchangeReturnId}`);
  for(const [button,state] of [['Approve return','approved'],['Book mock pickup','pickup booked'],['Record receipt','received'],['QC passed · Restock','closed']]){
   await page.getByLabel('Decision reason / evidence',{exact:true}).fill('Fictional size M item inspected for exchange and original refund');await page.getByRole('button',{name:button,exact:true}).click();await expect(page.locator('.detail-heading>.badge')).toHaveText(state);
  }
  const original=await(await page.request.get(`/api/v1/returns/${exchangeReturnId}`)).json(),stockBefore=await(await page.request.get('/api/v1/inventory?limit=100')).json(),originalShip=await(await page.request.get(`/api/v1/shipments/${original.legId}`)).json();
  const vendor=await browser.newContext();try{
   const v=await vendor.newPage();await login(v,'fulfilment@maisonazure.demo');await v.goto(`/vendor/returns/${exchangeReturnId}`);await v.getByRole('button',{name:'Explore exchange variants',exact:true}).click();await v.getByRole('combobox',{name:'Replacement variant',exact:true}).selectOption('prd_maz_dress_1001_l');await v.getByRole('button',{name:'Preview replacement',exact:true}).click();
   await expect(v.locator('[aria-label="Replacement preview result"]')).toContainText('Eligible at preview — not reserved');await expect(v.getByRole('button',{name:'Save exchange request for review',exact:true})).toBeDisabled();
   await v.getByLabel('Exchange request reason',{exact:true}).fill('Customer accepts the size L replacement review');await v.getByRole('checkbox',{name:'I accept the demo refund-and-repurchase terms',exact:false}).check();await v.getByRole('button',{name:'Save exchange request for review',exact:true}).click();await expect(v.locator('[aria-label="Exchange preview"]').getByRole('status')).toContainText('Request retained for ATI review');
   await v.reload();await v.getByRole('button',{name:'Explore exchange variants',exact:true}).click();await expect(v.locator('[aria-label="Exchange request history"]')).toContainText('Awaiting ATI review');
   const request=(await(await v.request.get(`/api/v1/returns/${exchangeReturnId}/exchanges`)).json()).items[0];expect(request).toMatchObject({status:'REQUESTED',snapshot:{original:{size:'M'},replacement:{size:'L'},reserved:false,replacementCreated:false}});
   await v.getByLabel('Exchange cancellation reason',{exact:true}).fill('Customer withdrew before ATI review; retain the original evidence');await v.getByRole('button',{name:'Cancel pending exchange request',exact:true}).click();await expect(v.locator('[aria-label="Exchange request history"] .badge')).toHaveText('Cancelled');
   await expect(v.getByRole('button',{name:'Cancel pending exchange request',exact:true})).toHaveCount(0);await expect(v.locator('[aria-label="Exchange request history"]')).toContainText('Customer withdrew before ATI review');
   await page.reload();await page.getByRole('button',{name:'Explore exchange variants',exact:true}).click();await expect(page.locator('[aria-label="Exchange request history"]')).toContainText('Cancelled');
   expect(await(await page.request.get(`/api/v1/returns/${exchangeReturnId}`)).json()).toEqual(original);expect(await(await page.request.get(`/api/v1/shipments/${original.legId}`)).json()).toEqual(originalShip);
   const after=await(await page.request.get('/api/v1/inventory?limit=100')).json();expect(after.items.map((i:{id:string;onHand:number;reserved:number;damaged:number})=>[i.id,i.onHand,i.reserved,i.damaged])).toEqual(stockBefore.items.map((i:{id:string;onHand:number;reserved:number;damaged:number})=>[i.id,i.onHand,i.reserved,i.damaged]));
   await page.locator('[aria-label="Exchange request history"]').screenshot({path:test.info().outputPath('exchange-request-cancelled.png')});
  }finally{await vendor.close();}
 });
 test('ATI rejects and then approves a renewed exchange; partner sees immutable review history',async({page,browser})=>{
  await login(page,'ops@ati.demo');await page.goto(`/operator/returns/${exchangeReturnId}`);await page.getByRole('button',{name:'Explore exchange variants',exact:true}).click();
  const original=await(await page.request.get(`/api/v1/returns/${exchangeReturnId}`)).json(),ship=await(await page.request.get(`/api/v1/shipments/${original.legId}`)).json(),stockBefore=await(await page.request.get('/api/v1/inventory?limit=100')).json();
  const vendor=await browser.newContext();try{
   const v=await vendor.newPage();await login(v,'fulfilment@maisonazure.demo');await v.goto(`/vendor/returns/${exchangeReturnId}`);await v.getByRole('button',{name:'Explore exchange variants',exact:true}).click();
   async function request(reason:string){
    await v.getByRole('button',{name:'Preview replacement',exact:true}).click();await v.getByLabel('Exchange request reason',{exact:true}).fill(reason);await v.getByRole('checkbox',{name:'I accept the demo refund-and-repurchase terms',exact:false}).check();await v.getByRole('button',{name:'Save exchange request for review',exact:true}).click();await expect(v.locator('[aria-label="Exchange preview"]').getByRole('status')).toContainText('Request retained for ATI review');
    return (await(await v.request.get(`/api/v1/returns/${exchangeReturnId}/exchanges`)).json()).items.find((r:{status:string})=>r.status==='REQUESTED').id as string;
   }
   const rejectedId=await request('Partner submits size L for ATI decision');await expect(v.getByRole('button',{name:'Approve exchange request',exact:true})).toHaveCount(0);
   await page.getByRole('button',{name:'Refresh exchange history',exact:true}).click();await page.getByLabel('ATI exchange decision reason',{exact:true}).fill('ATI needs the partner to reconfirm the replacement terms');await page.getByRole('button',{name:'Reject exchange request',exact:true}).click();
   await expect(page.locator(`[aria-label="Exchange request ${rejectedId}"] .badge`)).toHaveText('Rejected by ATI');
   await v.getByRole('button',{name:'Refresh exchange history',exact:true}).click();await expect(v.locator(`[aria-label="Exchange request ${rejectedId}"]`)).toContainText('ATI needs the partner to reconfirm');
   const approvedId=await request('Partner reconfirms the separate replacement charge');await page.getByRole('button',{name:'Refresh exchange history',exact:true}).click();
   await expect(page.getByRole('button',{name:'Approve exchange request',exact:true})).toBeDisabled();await page.getByLabel('ATI exchange decision reason',{exact:true}).fill('ATI checked renewed terms and current eligibility');await page.getByRole('button',{name:'Approve exchange request',exact:true}).click();
   const card=page.locator(`[aria-label="Exchange request ${approvedId}"]`);await expect(card.locator('.badge')).toHaveText('Approved · awaiting replacement checkout');await expect(card).toContainText('Route at approval');
   await card.screenshot({path:test.info().outputPath('exchange-ati-approval.png')});
   await v.reload();await v.getByRole('button',{name:'Explore exchange variants',exact:true}).click();await expect(v.locator(`[aria-label="Exchange request ${approvedId}"]`)).toContainText('ATI checked renewed terms');
   await v.getByLabel('Exchange cancellation reason',{exact:true}).fill('Customer withdrew before replacement checkout');await v.getByRole('button',{name:'Cancel pending exchange request',exact:true}).click();
   await expect(v.locator(`[aria-label="Exchange request ${approvedId}"] .badge`)).toHaveText('Cancelled');await expect(v.locator(`[aria-label="Exchange request ${approvedId}"]`)).toContainText('ATI checked renewed terms');
   const records=(await(await v.request.get(`/api/v1/returns/${exchangeReturnId}/exchanges`)).json()).items;
   expect(records.find((r:{id:string})=>r.id===approvedId)).toMatchObject({status:'CANCELLED',version:3,reviewAction:'APPROVED',reviewSnapshot:{reserved:false,replacementCreated:false}});expect(records.find((r:{id:string})=>r.id===rejectedId)).toMatchObject({status:'REJECTED',reviewSnapshot:null});
   expect(await(await page.request.get(`/api/v1/returns/${exchangeReturnId}`)).json()).toEqual(original);expect(await(await page.request.get(`/api/v1/shipments/${original.legId}`)).json()).toEqual(ship);
   const after=await(await page.request.get('/api/v1/inventory?limit=100')).json();expect(after.items.map((i:{id:string;onHand:number;reserved:number;damaged:number})=>[i.id,i.onHand,i.reserved,i.damaged])).toEqual(stockBefore.items.map((i:{id:string;onHand:number;reserved:number;damaged:number})=>[i.id,i.onHand,i.reserved,i.damaged]));
  }finally{await vendor.close();}
 });
 test('approved size exchange becomes a separate paid mock order and is delivered without rewriting the original',async({page,browser})=>{
  await login(page,'ops@ati.demo');await page.goto(`/operator/returns/${exchangeReturnId}`);await page.getByRole('button',{name:'Explore exchange variants',exact:true}).click();
  const originalReturn=await(await page.request.get(`/api/v1/returns/${exchangeReturnId}`)).json(),originalShip=await(await page.request.get(`/api/v1/shipments/${originalReturn.legId}`)).json();
  const inventory=async()=>{const response=await page.request.get('/api/v1/inventory?limit=100');expect(response.ok()).toBe(true);return (await response.json()).items.find((i:{productId:string;locationId:string})=>i.productId==='prd_maz_dress_1001_l'&&i.locationId==='loc_maz_store1');};const before=await inventory();expect(before).toBeTruthy();
  await page.getByRole('button',{name:'Preview replacement',exact:true}).click();await page.getByLabel('Exchange request reason',{exact:true}).fill('Customer requests approved size L as a separate purchase');await page.getByRole('checkbox',{name:'I accept the demo refund-and-repurchase terms',exact:false}).check();await page.getByRole('button',{name:'Save exchange request for review',exact:true}).click();
  await page.getByLabel('ATI exchange decision reason',{exact:true}).fill('ATI reviewed the replacement price, original refund and current route');await page.getByRole('button',{name:'Approve exchange request',exact:true}).click();
  const checkout=page.locator('[aria-label="Replacement checkout"]');await expect(checkout.getByRole('button',{name:'Start simulated replacement checkout',exact:true})).toBeDisabled();await checkout.getByLabel('Replacement checkout reason',{exact:true}).fill('Demonstrate separate customer acceptance and simulated SFCC purchase');await checkout.getByRole('checkbox',{name:'Simulate customer acceptance',exact:false}).check();await checkout.getByRole('button',{name:'Start simulated replacement checkout',exact:true}).click();
  await expect(checkout).toContainText('Simulated payment captured');await expect(checkout).toContainText('loc_maz_store1 · assigned');await expect(checkout).toContainText('AED 1,850.00');await expect(page.getByRole('button',{name:'Cancel pending exchange request',exact:true})).toHaveCount(0);
  const request=(await(await page.request.get(`/api/v1/returns/${exchangeReturnId}/exchanges`)).json()).items.find((r:{executionId:string|null})=>r.executionId),e=(await(await page.request.get(`/api/v1/exchanges/${request.id}/checkout`)).json());expect(e).toMatchObject({paymentStatus:'CAPTURED',actualMoneyMoved:false,purchaseReceipt:{amount:'1850.00',status:'CAPTURED'},shipments:[{status:'ASSIGNED'}]});
  const linked=await(await page.request.get(`/api/v1/returns/${exchangeReturnId}`)).json();expect(linked.replacementOrderId).toBe(e.orderId);expect(linked.refundId).toBe(originalReturn.refundId);expect(linked.refund).toBe(originalReturn.refund);expect((await inventory()).reserved).toBe(before.reserved+1);
  await page.reload();await page.getByRole('button',{name:'Explore exchange variants',exact:true}).click();await expect(checkout).toContainText(e.externalOrderId);await expect(checkout).toContainText('Simulated payment captured');await checkout.screenshot({path:test.info().outputPath('exchange-replacement-checkout.png')});
  const vendor=await browser.newContext();try{
   const v=await vendor.newPage();await login(v,'fulfilment@maisonazure.demo');await v.goto(`/vendor/returns/${exchangeReturnId}`);await v.getByRole('button',{name:'Explore exchange variants',exact:true}).click();await expect(v.locator('[aria-label="Replacement checkout"]')).toContainText(e.externalOrderId);await v.getByRole('link',{name:'Open replacement shipment →',exact:true}).click();await expect(v).toHaveURL(new RegExp(`/vendor/orders/${e.shipments[0].id}$`));
   await progress(v,'Accept shipment','accepted');await progress(v,'Start picking','picking');await v.getByLabel('Picked MAZ-DRS-1001-BLK-L',{exact:true}).fill('1');await progress(v,'Confirm picked quantities','packed');await progress(v,'Ready for dispatch','ready to dispatch');await v.getByLabel('Carrier tracking reference',{exact:true}).fill('ATI-E2E-REPLACEMENT-L');await progress(v,'Confirm carrier handover','dispatched');
  }finally{await vendor.close();}
  await page.goto(`/operator/orders/${e.shipments[0].id}`);await progress(page,'Confirm demo delivery','delivered');expect((await inventory()).onHand).toBe(before.onHand-1);expect((await inventory()).reserved).toBe(before.reserved);expect(await(await page.request.get(`/api/v1/shipments/${originalReturn.legId}`)).json()).toEqual(originalShip);
  expect((await(await page.request.get(`/api/v1/exchanges/${request.id}/checkout`)).json())).toMatchObject({paymentStatus:'CAPTURED',orderStatus:'DELIVERED',shipments:[{status:'DELIVERED'}]});deliveredReplacement=e.shipments[0].id;await page.screenshot({path:test.info().outputPath('exchange-replacement-delivered.png'),fullPage:true});
 });
 test('ATI cancels a payment-held replacement and sees both acknowledgements before stock release',async({page})=>{
  await login(page,'ops@ati.demo');expect(deliveredReplacement).toBeTruthy();
  const original=await(await page.request.get(`/api/v1/shipments/${deliveredReplacement}`)).json();
  await page.goto('/operator/returns');await page.getByRole('button',{name:'Request a return',exact:true}).click();await page.getByRole('combobox',{name:'Delivered shipment',exact:true}).selectOption(deliveredReplacement);await page.getByRole('combobox',{name:'Item',exact:true}).selectOption('replacement');await page.getByLabel('Reason',{exact:true}).fill('Fictional second size request to demonstrate cancellation recovery');await page.getByRole('button',{name:'Validate & submit return',exact:true}).click();await expect(page).toHaveURL(/\/operator\/returns\/[^/]+$/);const id=page.url().split('/').at(-1)!;
  for(const [button,state] of [['Approve return','approved'],['Book mock pickup','pickup booked'],['Record receipt','received'],['QC passed · Restock','closed']]){
   if(button==='QC passed · Restock')await inspectionPhoto(page,'Synthetic demo inspection: replacement dress returned intact');
   await page.getByLabel('Decision reason / evidence',{exact:true}).fill('ATI records intact return and original replacement refund');await page.getByRole('button',{name:button,exact:true}).click();await expect(page.locator('.detail-heading>.badge')).toHaveText(state);
  }
  await page.getByRole('button',{name:'Explore exchange variants',exact:true}).click();await page.getByRole('button',{name:'Preview replacement',exact:true}).click();await page.getByLabel('Exchange request reason',{exact:true}).fill('Customer considers size M as another separate purchase');await page.getByRole('checkbox',{name:'I accept the demo refund-and-repurchase terms',exact:false}).check();await page.getByRole('button',{name:'Save exchange request for review',exact:true}).click();await page.getByLabel('ATI exchange decision reason',{exact:true}).fill('ATI checks the refunded L and proposed size M');await page.getByRole('button',{name:'Approve exchange request',exact:true}).click();
  const stock=await(await page.request.get('/api/v1/inventory?limit=100')).json();
  const me=await(await page.request.get('/api/v1/auth/me')).json(),headers={'x-csrf-token':me.csrfToken};
  // Use the real demo failure API, never fabricated payment flags or database edits.
  const fault=await page.request.post('/api/v1/demo/faults',{headers,data:{system:'SFCC',remaining:10,statusCode:'422'}});expect(fault.ok()).toBe(true);
  const checkout=page.locator('[aria-label="Replacement checkout"]');
  try{
   await checkout.getByLabel('Replacement checkout reason',{exact:true}).fill('Simulate customer purchase while payment acknowledgement is unavailable');await checkout.getByRole('checkbox',{name:'Simulate customer acceptance',exact:false}).check();await checkout.getByRole('button',{name:'Start simulated replacement checkout',exact:true}).click();await expect(checkout).toContainText('Payment acknowledgement pending');
   await checkout.getByLabel('Replacement cancellation reason',{exact:true}).fill('Customer withdraws before payment acknowledgement; reconcile before releasing stock');await checkout.getByRole('button',{name:'Cancel replacement checkout',exact:true}).click();await expect(checkout.locator('[aria-label="Replacement cancellation evidence"]')).toContainText('Stock stays reserved');
  }finally{expect((await page.request.post('/api/v1/demo/faults',{headers,data:{system:'SFCC',remaining:0,statusCode:'422'}})).ok()).toBe(true);}
  const req=(await(await page.request.get(`/api/v1/returns/${id}/exchanges`)).json()).items.find((r:{executionId:string|null})=>r.executionId);expect(req).toBeTruthy();
  // Restore deliberately rejected local jobs through the same audited replay API as the console.
  await expect.poll(async()=>{
   const jobs=await(await page.request.get('/api/v1/integrations/jobs?limit=100')).json();
   for(const j of jobs.items.filter((j:{target:string;status:string})=>j.target==='SFCC'&&j.status==='DEAD_LETTER'))expect((await page.request.post(`/api/v1/integrations/jobs/${j.id}/replay`,{headers,data:{reason:'Restore simulated SFCC after cancellation recovery demonstration'}})).ok()).toBe(true);
   return (await(await page.request.get(`/api/v1/exchanges/${req.id}/checkout`)).json()).cancellation?.status;
  }).toBe('COMPLETED');
  await expect(checkout).toContainText('Replacement cancellation completed');await expect(checkout).toContainText('No purchase captured');await expect(checkout).toContainText('Cancellation acknowledged');await expect(checkout.getByRole('button',{name:'Cancel replacement checkout',exact:true})).toHaveCount(0);
  const final=await(await page.request.get(`/api/v1/exchanges/${req.id}/checkout`)).json();expect(final).toMatchObject({paymentStatus:'VOIDED',orderStatus:'CANCELLED',purchaseReceipt:null,refundReceipt:null,cancellation:{status:'COMPLETED',sfccReceipt:{outcome:{resolution:'VOIDED'}},fyndReceipt:{outcome:{resolution:'FENCED'}}}});
  const after=await(await page.request.get('/api/v1/inventory?limit=100')).json();const positions=(rows:{id:string;onHand:number;reserved:number}[])=>rows.map(i=>[i.id,i.onHand,i.reserved]).sort();expect(positions(after.items)).toEqual(positions(stock.items));expect(await(await page.request.get(`/api/v1/shipments/${deliveredReplacement}`)).json()).toEqual(original);
  await page.reload();await page.getByRole('button',{name:'Explore exchange variants',exact:true}).click();await expect(checkout).toContainText('Replacement cancellation completed');await checkout.screenshot({path:test.info().outputPath('exchange-cancellation-acknowledged.png')});
 });
});
