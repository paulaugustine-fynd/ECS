/** Fictional, deterministic presentation scenarios. These are not vendor API contracts. */
export type SimStep = { id:string; title:string; actor:string; target:string; operation:string; requirements:number[]; description:string };
export type SimScenario = { id:string; title:string; chapter:string; summary:string; fields:string[]; steps:SimStep[]; workspace:string };
const step=(id:string,title:string,actor:string,target:string,requirements:number[],description:string):SimStep=>({id,title,actor,target,operation:id.replaceAll('-','.'),requirements,description});
export const scenarios:SimScenario[]=[
 {id:'partner-launch',title:'From invitation to first sale',chapter:'01 · Partners',summary:'Invite a fictional partner, request a document correction and activate only after downstream readiness.',fields:['market','locale'],workspace:'partners',steps:[
  step('invite','Send invitation & reminder','ATI partner manager','MAIL',[2],'Preview a private invitation, a resend and expiry reminder. Nothing is emailed.'),
  step('application','Submit and correct compliance documents','Vendor administrator','ECS',[2,4],'Review a fictional trade licence; request a correction before approval.'),
  step('erp-vendor','Approve and synchronise vendor master','ATI partner manager','ERP',[3],'ERP owns the legal vendor record; ECS stores its simulated reference.'),
  step('launch-publish','Approve brand and publish first SKU','ATI moderator','FYND',[19],'Capture agreement, brand, product and location readiness.'),
  step('launch-visibility','Verify storefront and test order','ATI operations','SFCC',[1,19],'The customer sees Bloomingdale’s only. Vendor identity remains operational metadata.'),
  step('launch-activate','Activate partner and scoped workspaces','ATI administrator','ECS',[4,19,43,44],'Readiness gates pass before activation. Show operator and vendor responsibilities separately.') ]},
 {id:'sales-governance',title:'Pause sales, preserve fulfilment',chapter:'01 · Partners',summary:'Show brand and SKU controls without disrupting an accepted shipment.',fields:['stock'],workspace:'brands',steps:[
  step('rights','Review brand evidence and expiry','ATI partner manager','ECS',[5],'Create a territorial authorisation with an evidence reference and expiry notice.'),
  step('pause','Pause brand and delist one SKU','ATI administrator','FYND',[5,6],'Send zero available-to-promise to Fynd and then the storefront.'),
  step('open-order','Deliver the already accepted order','Vendor fulfilment','LOGISTICS',[5,6],'The reserved order snapshot survives sales suspension.'),
  step('restore','Restore authorisation and availability','ATI administrator','SFCC',[5,6],'Restore remaining stock, not the quantity already consumed by the order.') ]},
 {id:'commercial-rules',title:'Pricing, promotions & policy controls',chapter:'02 · Catalogue',summary:'Simulate a rule change, approve a floor override and account for brand-funded discounts.',fields:['price','floor','discount','commission','handling'],workspace:'commercials',steps:[
  step('rules-draft','Draft versioned commercial rules','ATI finance','ECS',[7,50],'Set percentage commission, a handling fee and weekly settlement cadence.'),
  step('price-check','Simulate MAP and selling-price thresholds','ATI pricing','ECS',[8,50],'Calculate discounted price and decide whether an override is needed.'),
  step('price-override','Approve a reasoned override / compliant price','ATI administrator','ECS',[8,50],'A low price cannot publish until the operator records an override.'),
  step('pricebook','Publish PriceBook and funded promotion','ATI pricing','SFCC',[8,45],'Customer promotions remain in SFCC; ECS records funding and commission basis.'),
  step('chargeback','Post handling charge to next statement','ATI finance','FINANCE',[35],'Capture the effective rule version; future changes do not rewrite this charge.') ]},
 {id:'catalogue-intake',title:'Supplier files to canonical catalogue',chapter:'02 · Catalogue',summary:'A defective supplier feed becomes a corrected, mapped, deduplicated product family.',fields:['source'],workspace:'catalog/imports',steps:[
  step('source-read','Receive supplier catalogue','Vendor catalogue manager','SOURCE',[9,10],'Simulate CSV, XLSX, REST, SFTP or a commerce connector with a saved checkpoint.'),
  step('validate-file','Validate and quarantine defective rows','ECS validation','ECS',[9,14],'Expose missing Arabic content, an invalid price and duplicate GTIN before publication.'),
  step('map-fields','Save mapping profile and consolidate variants','Vendor catalogue manager','ERP',[12],'Map shade → colour, convert centimetres and group size variants beneath a parent.'),
  step('duplicate-review','Resolve duplicate candidates','ATI moderator','ECS',[13],'Reject the exact duplicate; keep the distinct colour with a recorded reason.'),
  step('submit-batch','Correct and submit valid catalogue rows','Vendor catalogue manager','ECS',[9,10,12,14],'Save a new source checkpoint and send valid rows into moderation, not straight to sales.') ]},
 {id:'media-studio',title:'Assets, image jobs & moderation',chapter:'02 · Catalogue',summary:'Follow upload, ZIP, URL and DAM lineage through a simulated creative job and human review.',fields:['consent'],workspace:'catalog/items',steps:[
  step('asset-ingest','Ingest four asset sources','Vendor catalogue manager','DAM',[11],'Use bundled fixture references only; there is no arbitrary external URL fetch.'),
  step('image-request','Queue lifestyle image simulation','Vendor catalogue manager','AI',[17],'Consent is required. A bundled sample represents the output; no AI service is called.'),
  step('image-complete','Complete fixture-based creative job','Creative simulator','AI',[17],'Preserve flat-lay input, output, provenance and review-required status.'),
  step('media-review','Reject poor image; bulk-approve valid assets','ATI moderator','ECS',[11,14,17],'Show dimension/background checks, a rejection reason and approval before publication.') ]},
 {id:'translation',title:'English → Arabic with human approval',chapter:'02 · Catalogue',summary:'A deterministic translation fixture, glossary correction and RTL review.',fields:['locale'],workspace:'catalog/items',steps:[
  step('translate','Request Arabic draft','Vendor catalogue manager','AI',[16],'Simulate translation with known bilingual fixture content; this is not a general translation engine.'),
  step('glossary','Review glossary and right-to-left copy','ATI Arabic reviewer','ECS',[16],'Keep brand names unchanged and correct the Arabic material description.'),
  step('locale-publish','Approve and publish both locales','ATI moderator','SFCC',[16,18],'Only reviewed English and Arabic content is included in the publication snapshot.') ]},
 {id:'trusted-approval',title:'Trusted partner, controlled automation',chapter:'02 · Catalogue',summary:'Compare low-risk automatic approval with restricted and high-value manual review.',fields:['trusted','restricted','price','threshold'],workspace:'catalog/items',steps:[
  step('trust-policy','Configure trust and value threshold','ATI administrator','ECS',[15,50],'Pin the trusted-vendor policy version and retain a manual override path.'),
  step('trust-evaluate','Evaluate the catalogue submission','Approval simulator','ECS',[15],'Only trusted, unrestricted, below-threshold content qualifies for automatic approval.'),
  step('trust-review','Sample / manually review the decision','ATI moderator','ECS',[15,14],'Record either a sampling check or mandatory manual approval.'),
  step('trust-publish','Use the common approved publish path','ECS orchestration','FYND',[15,18],'Automatic and manual approvals use the same downstream publication contract.') ]},
 {id:'connected-publishing',title:'Connected enterprise publication',chapter:'03 · Integrations',summary:'Inspect request, acknowledgement and simulated read-back across ERP, Fynd and SFCC.',fields:['market'],workspace:'integrations',steps:[
  step('publish-erp','Publish canonical product to ERP/PIM','ECS orchestration','ERP',[18,46],'ERP/PIM acknowledges the canonical product and variant identifiers first.'),
  step('publish-fynd','Create operational product and location mapping','ECS orchestration','FYND',[18,46],'Capture simulated Fynd product, variant and location IDs.'),
  step('publish-sfcc','Publish storefront product and PriceBook','ECS orchestration','SFCC',[18,45],'Retain ATI merchant identity and marketplace metadata hidden from customers.'),
  step('publish-readback','Read back product, price and availability','Reconciliation simulator','SFCC',[19,45,46],'Compare the simulated remote revision and acknowledge customer-channel visibility.') ]},
 {id:'stock-rules',title:'Stock feeds & oversell protection',chapter:'04 · Operations',summary:'Change stock buffers, reject stale updates and reserve only available inventory.',fields:['stock','safety','quantity'],workspace:'inventory',steps:[
  step('stock-feed','Receive vendor / WMS / store feeds','Inventory simulator','WMS',[20],'Receive three location positions with monotonically increasing source revisions.'),
  step('stock-policy','Apply safety stock and availability tags','ATI operations','ECS',[21,50],'Calculate available-to-promise from stock minus buffer; apply market and source tags.'),
  step('stock-reserve','Attempt an atomic reservation','Order simulator','FYND',[20,21],'Reject a quantity above sellable stock; successful reservations reduce availability.'),
  step('stock-stale','Replay an older stock message','Inventory simulator','ECS',[20,21,48],'Ignore stale sequence 1 after sequence 2; no stock is restored by an old callback.'),
  step('stock-publish','Converge inventory to storefront','ECS orchestration','SFCC',[20,21,45],'Publish the remaining sellable quantity with the same source revision.') ]},
 {id:'split-order',title:'One order, three fulfilment legs',chapter:'04 · Operations',summary:'Show idempotent ingress, configurable routing, split quantities and independent milestones.',fields:['routing','quantity'],workspace:'orders',steps:[
  step('order-ingest','Receive signed SFCC order fixture','SFCC simulator','ECS',[22,48],'The simulated event has a stable key. ATI remains merchant of record.'),
  step('order-route','Preview routing and source allocation','ATI operations','FYND',[23,50],'Choose warehouse-first, brand-first or hybrid; expose the reason for each source.'),
  step('order-split','Create independently tracked shipments','Fynd OMS simulator','FYND',[24],'Allocate one dress line across two locations when quantity exceeds one, plus a beauty leg.'),
  step('order-leg','Deliver first leg; retain the others','Vendor fulfilment','LOGISTICS',[24,25],'Each shipment has independent state and SLA; partial completion is not whole-order delivery.'),
  step('order-feedback','Send partial fulfilment feedback to SFCC','ECS orchestration','SFCC',[1,22,45],'Customer messages stay SFCC-owned; partner metadata is not exposed.') ]},
 {id:'fulfilment',title:'Branded dispatch & store collection',chapter:'04 · Operations',summary:'Pack an order, generate simulated shipping paperwork and demonstrate a BOPIS pickup.',fields:['collectionCode'],workspace:'orders',steps:[
  step('pick-pack','Accept, pick and verify packed quantities','Vendor fulfilment','FYND',[25],'Separate vendor-owned work from ATI operations and reject over-packing.'),
  step('shipping-label','Prepare ATI label, slip and manifest','Vendor fulfilment','LOGISTICS',[25,26],'Paperwork is explicitly void/demo and carries Bloomingdale’s branding only.'),
  step('carrier-handoff','Receive carrier dispatch and delivery callbacks','Carrier simulator','FYND',[26],'Track the simulated carrier reference and send customer-status facts to SFCC.'),
  step('pickup-ready','Mark store collection ready','Store associate','FYND',[27],'A separate BOPIS shipment becomes ready for collection.'),
  step('pickup-collect','Verify collection code and hand over','Store associate','ECS',[27],'Use fixture code 4826; an incorrect code must not mark the parcel collected.') ]},
 {id:'sla-notifications',title:'SLA breach → escalation → resolution',chapter:'04 · Operations',summary:'Advance a fictional clock and inspect scoped email previews, digests and exceptions.',fields:['elapsedHours'],workspace:'sla',steps:[
  step('sla-policy','Configure stage deadlines and recipients','ATI operations','ECS',[28,49,50],'Set confirmation, dispatch, delivery, return and refund deadlines.'),
  step('sla-clock','Advance simulated time','ATI operations','ECS',[28],'Evaluate dispatch against a 24-hour deadline and an 18-hour warning threshold.'),
  step('sla-notify','Deliver in-app and email previews','Notification simulator','MAIL',[49],'Only fictional operator/vendor recipients are used. No external email is sent.'),
  step('sla-escalate','Apply repeated escalation / digest policy','Notification simulator','MAIL',[28,49],'Show escalation after 48 hours and retain delivery receipt references.'),
  step('sla-resolve','Assign exception and record reasoned waiver','ATI operations','ECS',[28,49,51],'Close the exception without erasing the original breach history.') ]},
 {id:'return-journey',title:'Return policy, pickup, QC & refund',chapter:'05 · Post-purchase',summary:'Exercise eligibility, operational grace, collection, restock and refund/credit-note signals.',fields:['returnDay','window','grace','condition','nonReturnable','price','handling'],workspace:'returns',steps:[
  step('return-event','Receive customer return event','SFCC simulator','ECS',[29,45],'Customer return initiation remains in SFCC; use a deterministic event receipt.'),
  step('return-policy','Evaluate policy and operational grace','ATI operations','ECS',[30],'Customer eligibility and the later warehouse receipt deadline are separate decisions.'),
  step('return-pickup','Book pickup and generate void return label','Logistics simulator','LOGISTICS',[32],'Eligible cases receive a slot and mock label. Ineligible cases remain rejected.'),
  step('return-qc','Receive and inspect the returned item','Warehouse inspector','WMS',[29,31],'Good condition restocks; bad condition quarantines stock and holds the refund.'),
  step('return-refund','Send refund and vendor credit-note instruction','ECS orchestration','SFCC',[34],'Only eligible Good-QC returns receive a simulated refund acknowledgement.'),
  step('return-finance','Post reversal and handling deduction','ECS orchestration','FINANCE',[34,35],'A stable reversal key prevents duplicated financial effects; no money moves.') ]},
 {id:'exchange',title:'Exchange with a linked replacement',chapter:'05 · Post-purchase',summary:'Keep the original sale immutable while returning one size and buying the replacement.',fields:['price','replacementPrice','paymentApproved'],workspace:'returns',steps:[
  step('exchange-request','Request size M → L','Vendor support','ECS',[33],'Create linked return and replacement identities, not an edit to the delivered line.'),
  step('exchange-price','Preview refund and new purchase','ATI operations','SFCC',[33],'Show price difference and the refund-and-repurchase demonstration policy.'),
  step('exchange-payment','Simulate customer payment decision','SFCC simulator','SFCC',[33],'Declining payment cancels the replacement and releases its reserved stock.'),
  step('exchange-fulfil','Create replacement shipment / cancellation','ECS orchestration','FYND',[33],'Only captured payment releases the replacement to fulfilment; original history is unchanged.') ]},
 {id:'finance-cycle',title:'Tax, FX & settlement reconciliation',chapter:'06 · Finance',summary:'Calculate a fictional market-specific sale through statement lock, export and reconciliation.',fields:['market','price','discount','commission','handling','taxRate','fxRate','actualFx','importVat'],workspace:'settlements',steps:[
  step('finance-sale','Capture sale, tax and commission facts','ECS ledger simulator','ECS',[36,39],'Use editable fictional rates, tax-inclusive pricing and exact decimal calculations; not tax advice.'),
  step('finance-invoice','Receive SFCC invoice reference','SFCC simulator','SFCC',[40],'Customer tax invoice remains SFCC-owned; ECS stores the simulated reference only.'),
  step('finance-statement','Generate weekly statement and deductions','ATI finance','ECS',[7,35,37],'Show gross, funded discount, commission, handling, tax facts and net payable.'),
  step('finance-lock','Review, lock and export statement','ATI finance','FINANCE',[37,38],'Snapshot effective terms and FX rate; later settings cannot rewrite a locked run.'),
  step('finance-ack','Receive external payout acknowledgement','Finance simulator','FINANCE',[38],'Disbursement remains outside ECS. This is a simulated acknowledgement, not a payment.'),
  step('finance-reconcile','Reconcile FX and resolve a variance','ATI finance','FINANCE',[39,41],'Compare agreed versus actual settlement FX and record a reasoned variance adjustment.') ]},
 {id:'warehouse',title:'Warehouse appointments & purchase orders',chapter:'04 · Operations',summary:'Book delivery and return collection slots, create a PO and receive warehouse callbacks.',fields:['quantity'],workspace:'locations',steps:[
  step('wms-po','Create inbound purchase order','ATI buying','WMS',[47],'Create a fictional PO with SKU quantities and the ATI warehouse destination.'),
  step('wms-appointment','Book warehouse delivery appointment','Vendor logistics','WMS',[47],'Reserve a delivery slot tied to the PO and mock vehicle reference.'),
  step('wms-reschedule','Handle slot conflict and rebook','ATI warehouse','WMS',[47],'Preserve the superseded slot and select the next available slot.'),
  step('wms-receive','Receive goods and PO acknowledgement','Warehouse simulator','WMS',[47,20],'Record expected and received quantities, receipt ID and completed appointment.'),
  step('wms-return','Book return-collection appointment','ATI operations','LOGISTICS',[32,47],'Use a distinct reverse appointment; do not mistake the inbound PO for a return.') ]},
 {id:'reports-audit',title:'Reports, sharing & decision history',chapter:'06 · Finance',summary:'Filter fictional cross-brand metrics, preview a scheduled report and trace an override.',fields:['market'],workspace:'analytics',steps:[
  step('report-filter','Filter market and vendor metrics','ATI analyst','ECS',[42],'Calculate GMV, orders, fulfilment, return rate and SLA compliance from a small fixture.'),
  step('report-share','Preview scoped report and scheduled digest','ATI analyst','MAIL',[42,49],'Show a report intended for the authorised team, never a public data link.'),
  step('audit-trace','Inspect actor, reason and before/after values','ATI auditor','ECS',[51],'Download the run evidence with every step, request, response and correlation key.') ]},
 {id:'platform-expansion',title:'Isolation, resilience & market expansion',chapter:'03 · Integrations',summary:'Demonstrate standalone adapters and a fictional second business without touching real tenants.',fields:['market'],workspace:'integrations',steps:[
  step('platform-health','Inspect simulated service health','ATI administrator','ECS',[48,52],'Inspect adapter boundaries and durable run evidence. No external system is contacted.'),
  step('platform-company','Provision a second fictional operator','ATI administrator','ERP',[54],'Reuse the simulator under a new fictional company namespace, not a real account.'),
  step('platform-market','Activate a market-specific assortment','ATI administrator','FYND',[53],'Show UAE, KSA and Kuwait currency/time-zone configuration and selected-market activation.'),
  step('platform-isolation','Attempt cross-company / partner access','Security simulator','ECS',[43,48,54],'Demonstrate denial in a fictional policy evaluation; real API isolation is separately tested.'),
  step('platform-replay','Inspect duplicate and replay boundaries','ATI administrator','ECS',[46,48,51,52],'Use the failure and duplicate controls on any run to prove simulator replay semantics.') ]},
];
export const scenarioById=(id:string)=>scenarios.find(s=>s.id===id);
export const simulationNotice='SIMULATION ONLY · Fictional records and fixture responses. No live integration, email, shipment or payment. Isolated from operational demo records.';
