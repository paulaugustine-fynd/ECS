import {z} from 'zod';
import Decimal from 'decimal.js';
import {scenarioById,simulationNotice} from './catalog';

const value=z.union([z.string(),z.number(),z.boolean()]);
export const simFacts=z.record(value);
export const simConfig=z.object({
 market:z.enum(['AE','SA','KW']).default('AE'),locale:z.enum(['en','ar']).default('en'),
 source:z.enum(['CSV','XLSX','API','SFTP','Shopify','WooCommerce']).default('SFTP'),
 price:z.number().finite().min(1).max(100000).default(1000),floor:z.number().finite().min(0).max(100000).default(900),
 discount:z.number().finite().min(0).max(90).default(10),commission:z.number().finite().min(0).max(100).default(28),
 handling:z.number().finite().min(0).max(1000).default(20),stock:z.number().int().min(0).max(10000).default(12),
 safety:z.number().int().min(0).max(10000).default(2),quantity:z.number().int().min(1).max(100).default(3),
 trusted:z.boolean().default(true),restricted:z.boolean().default(false),threshold:z.number().finite().min(1).max(100000).default(1500),
 consent:z.boolean().default(true),collectionCode:z.string().regex(/^\d{4}$/).default('4826'),
 routing:z.enum(['warehouse-first','brand-first','hybrid']).default('hybrid'),elapsedHours:z.number().int().min(0).max(240).default(52),
 returnDay:z.number().int().min(0).max(120).default(20),window:z.number().int().min(1).max(90).default(30),grace:z.number().int().min(0).max(30).default(7),
 nonReturnable:z.boolean().default(false),condition:z.enum(['GOOD','BAD']).default('GOOD'),replacementPrice:z.number().finite().min(1).max(100000).default(1100),paymentApproved:z.boolean().default(true),
 taxRate:z.number().finite().min(0).max(30).default(5),fxRate:z.number().finite().min(0.001).max(100).default(1),actualFx:z.number().finite().min(0.001).max(100).default(1),importVat:z.number().finite().min(0).max(10000).default(0),
}).strict();
export type SimConfig=z.infer<typeof simConfig>;
export const simStart=z.object({scenarioId:z.string().min(1).max(60),config:simConfig,requestId:z.string().uuid()}).strict();
export const simCommand=z.object({expectedVersion:z.number().int().positive(),commandId:z.string().uuid(),action:z.enum(['next','fail','retry','duplicate'])}).strict();
export const simEvent=z.object({id:z.string(),stepId:z.string(),at:z.string().datetime(),actor:z.string(),target:z.string(),operation:z.string(),status:z.enum(['ACKNOWLEDGED','DEAD_LETTER','DUPLICATE_IGNORED']),attempt:z.number().int().positive(),idempotencyKey:z.string(),request:simFacts,response:simFacts}).strict();
export const simRun=z.object({id:z.string(),scenarioId:z.string(),mode:z.literal('SIMULATION'),notice:z.string(),createdAt:z.string().datetime(),updatedAt:z.string().datetime(),version:z.number().int().positive(),cursor:z.number().int().nonnegative(),status:z.enum(['RUNNING','DEAD_LETTER','COMPLETED']),config:simConfig,facts:simFacts,events:z.array(simEvent).max(150),commandIds:z.array(z.string()).max(150)}).strict();
export type SimRun=z.infer<typeof simRun>;
export type Facts=z.infer<typeof simFacts>;
export const simRunResponse=z.object({run:simRun}).strict();
export const simRunsResponse=z.object({runs:z.array(simRun)}).strict();

export const marketInfo={AE:{currency:'AED',zone:'Asia/Dubai',decimals:2},SA:{currency:'SAR',zone:'Asia/Riyadh',decimals:2},KW:{currency:'KWD',zone:'Asia/Kuwait',decimals:3}};
export function financePreview(c:SimConfig){
 const money=(d:Decimal)=>d.toDecimalPlaces(marketInfo[c.market].decimals,Decimal.ROUND_HALF_UP);
 const gross=money(new Decimal(c.price)),discount=money(gross.mul(c.discount).div(100)),net=money(gross.minus(discount));
 const tax=money(net.minus(net.div(new Decimal(1).plus(new Decimal(c.taxRate).div(100)))));
 const basis=net.minus(tax),commission=money(basis.mul(c.commission).div(100));
 const payable=money(basis.minus(commission).minus(c.handling));
 const converted=payable.mul(c.fxRate).toDecimalPlaces(2),actual=payable.mul(c.actualFx).toDecimalPlaces(2);
 return {currency:marketInfo[c.market].currency,gross:gross.toFixed(marketInfo[c.market].decimals),fundedDiscount:discount.toFixed(marketInfo[c.market].decimals),customerTotal:net.toFixed(marketInfo[c.market].decimals),tax:tax.toFixed(marketInfo[c.market].decimals),commissionBasis:basis.toFixed(marketInfo[c.market].decimals),commission:commission.toFixed(marketInfo[c.market].decimals),handling:c.handling.toFixed(marketInfo[c.market].decimals),netPayable:payable.toFixed(marketInfo[c.market].decimals),settlementCurrency:'AED',agreedSettlement:converted.toFixed(2),actualSettlement:actual.toFixed(2),fxVariance:actual.minus(converted).toFixed(2),importVat:c.importVat.toFixed(marketInfo[c.market].decimals),taxPolicy:'FICTIONAL tax-inclusive fixture; import VAT disclosed separately, not deducted',fxSource:'Presenter-defined fixture, not a market quote'};
}
export function newRun(id:string,scenarioId:string,config:SimConfig,now:string):SimRun{
 if(!scenarioById(scenarioId))throw new Error('Unknown simulation scenario');
 return {id,scenarioId,config:simConfig.parse(config),mode:'SIMULATION',notice:simulationNotice,createdAt:now,updatedAt:now,version:1,cursor:0,status:'RUNNING',facts:{merchant:'Bloomingdale’s / ATI',market:config.market,currency:marketInfo[config.market].currency,externalCalls:0},events:[],commandIds:[]};
}

/** Every output is a sandbox fact, never a write to commerce/finance tables. */
export function evaluateStep(step:string,c:SimConfig,previous:Facts,runId:string):Facts{
 const ref=(kind:string)=>`SIM-${kind}-${runId.slice(-8)}`;
 const eligible=!c.nonReturnable&&c.returnDay<=c.window;
 const refundable=eligible&&c.condition==='GOOD';
 const atp=Math.max(0,c.stock-c.safety),reserved=c.quantity<=atp?c.quantity:0;
 const finance=financePreview(c);
 switch(step){
 case 'invite':return {invitation:ref('INV'),recipient:'onboarding@atelier.example',delivery:'PREVIEW_ONLY',resendCount:1,expiresAfterHours:72,reminderAfterHours:48,locale:c.locale};
 case 'application':return {applicationStatus:'APPROVED',originalDocument:'trade-licence-v1.pdf',originalDecision:'CHANGES_REQUESTED',reason:'Expiry date missing',replacementDocument:'trade-licence-v2.pdf',documentStatus:'VERIFIED_FIXTURE',permissionProfile:'Vendor administrator: own partner only'};
 case 'erp-vendor':return {erpVendorId:ref('ERP-VENDOR'),vendorMasterOwner:'ATI ERP',vendorStatus:'APPROVED'};
 case 'launch-publish':return {agreement:'v1 · 28% · weekly',brand:'Atelier Noor',brandApproved:true,productStatus:'PUBLISHED',fyndProductId:ref('FYND-PRODUCT'),fyndLocationId:ref('FYND-LOCATION'),inventorySync:'ACKNOWLEDGED'};
 case 'launch-visibility':return {storefrontVisible:true,testOrder:ref('TEST-ORDER'),testOrderPassed:true,customerMerchant:'Bloomingdale’s',customerVendorVisible:false,checkoutOwner:'SFCC',communicationsOwner:'SFCC'};
 case 'launch-activate':return {partnerStatus:previous.erpVendorId&&previous.testOrderPassed&&previous.brandApproved?'ACTIVE':'BLOCKED',readiness:'Documents → terms → ERP → brand → mappings → stock → visibility → test order',vendorWorkspace:'Catalogue / inventory / assigned orders / returns / statements',operatorWorkspace:'Approvals / commercials / moderation / exceptions'};
 case 'rights':return {brand:'Maison Azure',market:c.market,evidence:ref('AUTHORISATION'),validUntil:'2027-09-30',expiryReminderDays:30,authorisation:'ACTIVE'};
 case 'pause':return {authorisation:'PAUSED',skuSaleStatus:'DELISTED',sellable:0,openShipment:'ACCEPTED',reason:'Scheduled assortment review',scheduledEffectiveAt:'2030-01-15T09:00:00Z'};
 case 'open-order':return {openShipment:'DELIVERED',reservedOrderChanged:false,consumedQuantity:Math.min(c.stock,1),customerVendorVisible:false};
 case 'restore':return {authorisation:'ACTIVE',skuSaleStatus:'ENABLED',sellable:Math.max(0,c.stock-Number(previous.consumedQuantity??0)),restorationReason:'Authorisation evidence renewed'};
 case 'rules-draft':return {policyVersion:1,commissionPercent:c.commission,returnHandling:c.handling,cadence:'WEEKLY',ruleStatus:'DRAFT'};
 case 'price-check':return {sellingPrice:finance.customerTotal,priceFloor:c.floor,priceDecision:new Decimal(finance.customerTotal).lt(c.floor)?'OVERRIDE_REQUIRED':'COMPLIANT',ruleStatus:'SIMULATED'};
 case 'price-override':return {ruleStatus:'APPROVED',priceOverride:previous.priceDecision==='OVERRIDE_REQUIRED',overrideReason:previous.priceDecision==='OVERRIDE_REQUIRED'?'ATI-funded launch exception approved by demo operator':'Price within configured floor',approvalActor:'ATI administrator'};
 case 'pricebook':return {priceBookId:ref('PRICEBOOK'),ruleStatus:'ACTIVE',price:finance.customerTotal,promotionCode:'BEAUTY10-DEMO',promotionFunding:'BRAND',brandFundedAmount:finance.fundedDiscount,customerPricingOwner:'SFCC'};
 case 'chargeback':return {chargebackKey:ref('HANDLING'),chargebackAmount:c.handling,chargebackType:'RETURN_HANDLING',statement:'NEXT_OPEN',capturedRuleVersion:1};
 case 'source-read':return {source:c.source,sourceJob:ref(c.source.toUpperCase()),sourceCheckpoint:'batch-0001',receivedRows:7,connectorMode:'DETERMINISTIC_SIMULATOR',rawColumns:'vendor_sku,shade,length_cm,parent_style,gtin,price'};
 case 'validate-file':return {validRows:4,quarantinedRows:3,validationErrors:'Row 2: missing Arabic; row 4: negative price; row 7: duplicate GTIN',publishedRows:0};
 case 'map-fields':return {mappingProfile:'ATI Apparel v1',fieldMapping:'shade → colour; vendor_sku → sku; length_cm → length_mm',unitConversion:'60 cm → 600 mm',parentProduct:ref('PARENT'),variants:'Black / M; Black / L; Navy / M',mappingReusable:true};
 case 'duplicate-review':return {exactDuplicateDecision:'REJECT',fuzzyCandidateDecision:'KEEP_DISTINCT',duplicateReason:'Different colour and source image checksum',imageHashCandidate:'fixture-hash-003',retainedRows:6};
 case 'submit-batch':return {correctedRows:2,rejectedDuplicates:1,submittedRows:6,catalogueStatus:'IN_REVIEW',sourceCheckpoint:'batch-0002',publishedRows:0};
 case 'asset-ingest':return {assetSources:'Upload / URL / ZIP / DAM',inputAsset:'/demo-assets/maz-dress-black.svg',lineage:'supplier-upload → checksum → normalized asset',scan:'SIMULATED_CLEAN',quality:'3 accepted candidates; 1 low-resolution fixture',externalFetch:false};
 case 'image-request':return {imageJob:c.consent?ref('IMAGE'):'NOT_CREATED',imageJobStatus:c.consent?'QUEUED':'BLOCKED_NO_CONSENT',consent:c.consent,generationMode:'BUNDLED_SAMPLE_NOT_ACTUAL_AI'};
 case 'image-complete':return {imageJobStatus:c.consent?'COMPLETED_REVIEW_REQUIRED':'BLOCKED_NO_CONSENT',imageOutput:c.consent?'/demo-assets/maz-dress-black.svg':'',outputDisclosure:'Bundled illustration stands in for generated lifestyle imagery; no image was generated',provenance:ref('ASSET-LINEAGE')};
 case 'media-review':return {assetReview:'Low-resolution fixture rejected; three valid source assets approved',generatedAssetApproved:c.consent,moderationReason:'Source quality checks passed; generated output is a labelled fixture',bulkApproved:3,rejectedAssets:1};
 case 'translate':return {englishTitle:'Maison Azure silk evening dress',arabicDraft:'فستان سهرة من الحرير من ميزون أزور',translationJob:ref('TRANSLATE'),translationStatus:'DRAFT',translationMode:'DETERMINISTIC_BILINGUAL_FIXTURE'};
 case 'glossary':return {arabicApprovedCopy:'فستان سهرة حريري من Maison Azure',glossaryRule:'Preserve brand spelling; silk → حريري',reviewDirection:'RTL',translationStatus:'HUMAN_APPROVED',translationVersion:2};
 case 'locale-publish':return {locales:'en, ar',localePublication:'ACKNOWLEDGED',customerArabicTitle:previous.arabicApprovedCopy??'',localeVersion:2};
 case 'trust-policy':return {trustPolicyVersion:1,trustedVendor:c.trusted,valueThreshold:c.threshold,restrictedCategory:c.restricted,samplingPercent:10};
 case 'trust-evaluate':return {approvalPath:c.trusted&&!c.restricted&&c.price<=c.threshold?'AUTO_APPROVED':'MANUAL_REVIEW',decisionReason:!c.trusted?'Vendor not trusted':c.restricted?'Restricted category':c.price>c.threshold?'Value exceeds threshold':'Trusted / unrestricted / within threshold'};
 case 'trust-review':return {moderationStatus:'APPROVED',humanControl:previous.approvalPath==='AUTO_APPROVED'?'Sample reviewed by ATI':'Mandatory manual approval recorded',approvalPolicyVersion:1};
 case 'trust-publish':return {publishPath:'COMMON_APPROVED_PRODUCT_PIPELINE',fyndProductId:ref('PRODUCT'),publication:'ACKNOWLEDGED',originalApprovalPath:previous.approvalPath??''};
 case 'publish-erp':return {erpProductId:ref('ERP-PRODUCT'),canonicalRevision:1,erpPublication:'ACKNOWLEDGED',variantCount:2};
 case 'publish-fynd':return {fyndProductId:ref('FYND-PRODUCT'),fyndVariantId:ref('FYND-VARIANT'),fyndLocationId:ref('FYND-LOCATION'),fyndPublication:previous.erpPublication==='ACKNOWLEDGED'?'ACKNOWLEDGED':'BLOCKED'};
 case 'publish-sfcc':return {sfccProductId:ref('SFCC-PRODUCT'),priceBookId:ref('PRICEBOOK'),sfccPublication:previous.fyndPublication==='ACKNOWLEDGED'?'ACKNOWLEDGED':'BLOCKED',vendorMetadataVisible:false};
 case 'publish-readback':return {remoteRevision:1,readbackMode:'SIMULATED_REMOTE_FIXTURE',productMatches:true,priceMatches:true,inventoryMatches:true,storefrontVisible:true};
 case 'stock-feed':return {stockOnHand:c.stock,sourceRevision:2,locations:'Brand store / vendor warehouse / ATI DC',incomingSource:'WMS fixture',receivedSequence:2};
 case 'stock-policy':return {safetyStock:c.safety,sellable:atp,stockTags:`${c.market}:enabled; damaged:excluded`,displayThreshold:c.safety,stockRuleVersion:1};
 case 'stock-reserve':return {requestedQuantity:c.quantity,reservedQuantity:reserved,reservationStatus:reserved?'ACCEPTED':'REJECTED_INSUFFICIENT_STOCK',sellable:atp-reserved};
 case 'stock-stale':return {incomingSequence:1,storedSequence:2,staleUpdate:'IGNORED',sellable:previous.sellable??0};
 case 'stock-publish':return {sfccSellable:previous.sellable??0,fyndSellable:previous.sellable??0,inventoryRevision:2,convergence:'SIMULATED_MATCH'};
 case 'order-ingest':return {orderId:ref('ORDER'),eventId:ref('SFCC-EVENT'),eventSignature:'SIMULATED_VALID',orderCreatedCount:1,merchantOfRecord:'ATI',currency:marketInfo[c.market].currency};
 case 'order-route':return {routingPolicy:c.routing,firstSource:c.routing==='brand-first'?'Maison Azure store':'ATI warehouse',routingReason:c.routing==='hybrid'?'Dress: brand store + ATI overflow; serum: vendor warehouse':`${c.routing}: available stock then overflow`,routingVersion:1};
 case 'order-split':return {leg1:ref('LEG-A'),leg2:ref('LEG-B'),leg3:ref('LEG-C'),leg1Quantity:Math.min(1,c.quantity),leg2Quantity:Math.max(0,c.quantity-1),leg3Quantity:1,totalAllocated:c.quantity+1,splitLineQuantity:c.quantity>1,leg1State:'ASSIGNED',leg2State:c.quantity>1?'ASSIGNED':'NOT_REQUIRED',leg3State:'ASSIGNED',stageSlaHours:24};
 case 'order-leg':return {leg1State:'DELIVERED',leg2State:c.quantity>1?'ASSIGNED':'NOT_REQUIRED',leg3State:'ASSIGNED',orderStatus:'PARTIALLY_FULFILLED'};
 case 'order-feedback':return {sfccStatus:'PARTIALLY_FULFILLED',customerVisiblePartner:false,communications:'SFCC owns customer notification',sfccAcknowledgement:ref('ORDER-STATUS')};
 case 'pick-pack':return {shipmentState:'PACKED',assignedQuantity:3,packedQuantity:3,overpackAttempt:4,overpackDecision:'REJECTED',visiblePartner:'Maison Azure only'};
 case 'shipping-label':return {labelId:ref('VOID-LABEL'),manifestId:ref('MANIFEST'),documentTitle:'Bloomingdale’s — SIMULATION / NOT VALID FOR SHIPPING',packingSlip:'3 units · ATI merchant · partner branding hidden',carrierReference:ref('AWB'),vendorBranding:false};
 case 'carrier-handoff':return {shipmentState:'DELIVERED',carrierEvents:'DISPATCHED → IN_TRANSIT → DELIVERED',callbackMode:'SIMULATED',sfccFeedback:'DELIVERED'};
 case 'pickup-ready':return {pickupShipment:ref('BOPIS'),pickupState:'READY_FOR_COLLECTION',collectionLocation:'Bloomingdale’s Dubai Mall',identityCheck:'Four-digit fixture code required'};
 case 'pickup-collect':return {pickupState:c.collectionCode==='4826'?'COLLECTED':'READY_FOR_COLLECTION',collectionVerification:c.collectionCode==='4826'?'MATCHED':'REJECTED_WRONG_CODE',stockConsumed:c.collectionCode==='4826'?1:0};
 case 'sla-policy':return {confirmationHours:4,dispatchHours:24,deliveryHours:72,returnHours:168,refundHours:48,policyVersion:1};
 case 'sla-clock':return {elapsedHours:c.elapsedHours,dispatchSla:c.elapsedHours>=24?'BREACHED':c.elapsedHours>=18?'AT_RISK':'ON_TRACK',breachHours:Math.max(0,c.elapsedHours-24),clockScope:'THIS_RUN_ONLY'};
 case 'sla-notify':return {notice:c.elapsedHours>=18?'CREATED':'NOT_REQUIRED',recipient:'ops@ati.example; fulfilment@maison.example',emailDelivery:c.elapsedHours>=18?'PREVIEW_DELIVERED':'NOT_REQUIRED',emailSubject:`[DEMO] Dispatch ${previous.dispatchSla}`,inAppNotice:c.elapsedHours>=18};
 case 'sla-escalate':return {escalationLevel:c.elapsedHours>=48?2:c.elapsedHours>=24?1:0,digest:'Daily vendor SLA summary preview',deliveryAttempts:c.elapsedHours>=48?2:c.elapsedHours>=18?1:0,customerEmailSent:false};
 case 'sla-resolve':return {exceptionStatus:c.elapsedHours>=24?'WAIVED':'NO_BREACH',assignee:'ATI operations',waiverReason:c.elapsedHours>=24?'Fictional weather disruption confirmed by operator':'No waiver required',historicalBreachRetained:c.elapsedHours>=24};
 case 'return-event':return {returnId:ref('RETURN'),returnSource:'SFCC',deliveredOrder:ref('DELIVERED-ORDER'),requestedDay:c.returnDay};
 case 'return-policy':return {returnEligible:eligible,returnDecision:eligible?'APPROVED':c.nonReturnable?'REJECTED_NON_RETURNABLE':'REJECTED_OUTSIDE_WINDOW',customerWindowDays:c.window,warehouseReceiptDeadlineDay:c.window+c.grace,policyVersion:1};
 case 'return-pickup':return {pickupState:eligible?'BOOKED':'NOT_BOOKED',returnLabel:eligible?ref('VOID-RETURN-LABEL'):'NONE',pickupSlot:eligible?'2030-01-17 10:00–12:00':'NONE',logisticsMode:'SIMULATED_CARRIER'};
 case 'return-qc':return {qcStatus:eligible?c.condition:'NOT_APPLICABLE',photoEvidence:eligible?'/demo-assets/maz-dress-black.svg':'NONE',stockDisposition:!eligible?'UNCHANGED':c.condition==='GOOD'?'RESTOCKED':'QUARANTINED',restockedUnits:refundable?1:0,damagedUnits:eligible&&c.condition==='BAD'?1:0,refundHold:eligible&&c.condition==='BAD'};
 case 'return-refund':return {refundStatus:refundable?'ACKNOWLEDGED':eligible?'HELD_QC':'NOT_REQUESTED',refundAmount:refundable?c.price:0,refundReference:refundable?ref('REFUND'):'NONE',creditNote:refundable?ref('CREDIT'):'NONE',actualMoneyMoved:false};
 case 'return-finance':return {reversalKey:refundable?ref('REVERSAL'):'NONE',vendorReversal:refundable?new Decimal(c.price).mul(new Decimal(1).minus(new Decimal(c.commission).div(100))).toFixed(2):'0.00',handlingDeduction:refundable?c.handling:0,returnStatus:refundable?'CLOSED':eligible?'QC_HOLD':'REJECTED'};
 case 'exchange-request':return {originalOrder:ref('ORIGINAL'),exchangeId:ref('EXCHANGE'),linkedReturn:ref('RETURN'),replacementOrder:ref('REPLACEMENT'),fromSize:'M',toSize:'L',originalSaleChanged:false};
 case 'exchange-price':return {originalRefund:c.price,replacementPurchase:c.replacementPrice,priceDifference:new Decimal(c.replacementPrice).minus(c.price).toFixed(2),exchangePolicy:'DEMO_REFUND_AND_REPURCHASE',replacementReserved:1};
 case 'exchange-payment':return {paymentState:c.paymentApproved?'CAPTURED':'DECLINED',replacementReserved:c.paymentApproved?1:0,releasedUnits:c.paymentApproved?0:1,paymentMode:'SIMULATION_NO_MONEY'};
 case 'exchange-fulfil':return {replacementState:c.paymentApproved?'READY_FOR_FULFILMENT':'CANCELLED',replacementShipment:c.paymentApproved?ref('REPLACEMENT-LEG'):'NONE',originalSaleChanged:false,originalReturnStatus:'APPROVED'};
 case 'finance-sale':return {...finance,ledgerEvent:ref('SALE'),taxRate:c.taxRate,transactionMarket:c.market,fxSourceDate:'2030-01-15',agreedFx:c.fxRate};
 case 'finance-invoice':return {invoiceNumber:ref('SFCC-INVOICE'),invoiceOwner:'SFCC',duplicateEcsInvoice:false,invoiceLabel:'SIMULATED REFERENCE · NOT A TAX INVOICE'};
 case 'finance-statement':return {statementId:ref('STATEMENT'),statementStatus:'DRAFT',cadence:'WEEKLY',...finance,statementPeriod:'2030-01-08 / 2030-01-15',disputePreview:'Handling fee queried → supporting agreement v1 accepted'};
 case 'finance-lock':return {statementStatus:'LOCKED',exportId:ref('FINANCE-EXPORT'),capturedAgreementVersion:1,capturedFx:c.fxRate,exportAmount:finance.agreedSettlement,exportCurrency:'AED',historicalSnapshotImmutable:true};
 case 'finance-ack':return {payoutStatus:'SIMULATED_ACKNOWLEDGEMENT',payoutReference:ref('PAYOUT'),actualMoneyMoved:false,disbursementOwner:'ATI Finance / bank'};
 case 'finance-reconcile':return {reconciliation:finance.fxVariance==='0.00'?'MATCHED':'VARIANCE_RESOLVED',fxVariance:finance.fxVariance,varianceAdjustment:finance.fxVariance,resolutionReason:finance.fxVariance==='0.00'?'Agreed and received amounts match':'Record fixture FX variance in a separate adjustment; do not rewrite statement',originalLockedAmount:finance.agreedSettlement};
 case 'wms-po':return {purchaseOrder:ref('PO'),sku:'MAZ-DRESS-BLACK-M',expectedUnits:c.quantity,destination:'ATI distribution centre',poState:'CREATED'};
 case 'wms-appointment':return {deliveryAppointment:ref('DELIVERY-SLOT'),slot:'2030-01-16 09:00–10:00',vehicleReference:'DEMO-VEHICLE',appointmentState:'BOOKED',linkedPurchaseOrder:previous.purchaseOrder??''};
 case 'wms-reschedule':return {originalSlot:'2030-01-16 09:00–10:00',originalSlotState:'CANCELLED_CAPACITY_CONFLICT',slot:'2030-01-16 11:00–12:00',appointmentState:'REBOOKED',reason:'Warehouse capacity fixture reached'};
 case 'wms-receive':return {receiptId:ref('GRN'),receivedUnits:c.quantity,poState:'RECEIVED',appointmentState:'COMPLETED',quantityVariance:0};
 case 'wms-return':return {returnAppointment:ref('RETURN-SLOT'),returnCollectionSlot:'2030-01-18 14:00–16:00',reverseState:'BOOKED',appointmentType:'RETURN_COLLECTION'};
 case 'report-filter':return {reportMarket:c.market,fixtureOrders:12,fixtureGrossSales:12000,deliveredOrders:9,fulfilmentPercent:75,returnedOrders:2,returnRatePercent:16.67,slaCompliantOrders:10,slaCompliancePercent:83.33,vendorFilter:'Maison Azure / Lumera / Northline',dataset:'FICTIONAL_REPORT_FIXTURE'};
 case 'report-share':return {reportDelivery:'PRIVATE_PREVIEW',reportRecipient:'ati-operations@example.test',schedule:'Mondays 09:00 market time',publicLinkCreated:false,exportFormat:'JSON evidence / printable statement'};
 case 'audit-trace':return {auditEntity:runId,auditFields:'Actor / role / time / operation / request / response / idempotency key',auditExport:'Download evidence in Simulation Studio',auditStorage:'Append-only server-side run snapshots'};
 case 'platform-health':return {systemModes:'Fynd / SFCC / ERP-PIM / WMS / Finance / Logistics: SIMULATED',workerMode:'Explicit presenter step execution',runtimeBoundary:'No network calls from simulator',standalone:true};
 case 'platform-company':return {fictionalCompany:'ATI Range Extension — sandbox',fictionalCompanyId:ref('COMPANY-B'),provisioning:'SIMULATION_NAMESPACE_ONLY',modulesReused:'Onboarding / catalogue / inventory / order / return / finance'};
 case 'platform-market':return {activeMarket:c.market,currency:marketInfo[c.market].currency,timeZone:marketInfo[c.market].zone,assortmentStatus:'ACTIVE_IN_SELECTED_MARKET_ONLY',otherMarkets:'INACTIVE',volumeFixture:'No load or scale claim'};
 case 'platform-isolation':return {foreignCompanyAttempt:'DENIED',foreignPartnerAttempt:'DENIED',ownRecordAttempt:'ALLOWED',policyScope:'Fictional company + partner + market',realRunScope:'Authenticated company AND run creator'};
 case 'platform-replay':return {idempotency:'One successful effect per step key',failureHandling:'Inject failure → DEAD_LETTER → retry same key',duplicateHandling:'Repeated receipt ignored',liveAdapterSwitch:'NOT_AVAILABLE'};
 default:throw new Error(`Missing simulator operation: ${step}`);
 }
}

export function advanceRun(current:SimRun,command:z.infer<typeof simCommand>,now:string):SimRun{
 if(current.commandIds.includes(command.commandId))return current;
 if(command.expectedVersion!==current.version)throw new Error('STALE_SIMULATION');
 if(current.events.length>=140)throw new Error('RUN_LIMIT');
 const scenario=scenarioById(current.scenarioId)!;
 if(command.action==='duplicate'){
  const prior=[...current.events].reverse().find(e=>e.status==='ACKNOWLEDGED');
  if(!prior)throw new Error('NO_ACKNOWLEDGEMENT');
  return {...current,updatedAt:now,version:current.version+1,commandIds:[...current.commandIds,command.commandId],events:[...current.events,{...prior,id:command.commandId,at:now,status:'DUPLICATE_IGNORED',request:{...prior.request,duplicate:true},response:{decision:'IGNORED',effectsApplied:0,originalReceipt:prior.id}}]};
 }
 if(current.status==='COMPLETED')throw new Error('RUN_COMPLETED');
 if((command.action==='retry')!==(current.status==='DEAD_LETTER'))throw new Error('INVALID_SIMULATION_TRANSITION');
 const step=scenario.steps[current.cursor];
 const target=step.target==='SOURCE'?current.config.source:step.target;
 const failed=command.action==='fail';
 const response=failed?{error:'SIMULATED_503',message:`${target} unavailable — no business effect applied`,retryable:true}:evaluateStep(step.id,current.config,current.facts,current.id);
 const nextCursor=current.cursor+(failed?0:1);
 const attempt=current.events.filter(e=>e.stepId===step.id&&e.status!=='DUPLICATE_IGNORED').length+1;
 const request:Facts={simulation:true,runId:current.id,operation:step.operation,market:current.config.market,actor:step.actor,requirements:step.requirements.map(n=>`REQ-${String(n).padStart(2,'0')}`).join(', ')};
 for(const field of scenario.fields)request[field]=current.config[field as keyof SimConfig];
 return {...current,updatedAt:now,version:current.version+1,cursor:nextCursor,status:failed?'DEAD_LETTER':nextCursor===scenario.steps.length?'COMPLETED':'RUNNING',facts:failed?current.facts:{...current.facts,...response},commandIds:[...current.commandIds,command.commandId],events:[...current.events,{id:command.commandId,stepId:step.id,at:now,actor:step.actor,target,operation:step.operation,status:failed?'DEAD_LETTER':'ACKNOWLEDGED',attempt,idempotencyKey:`${current.id}:${step.id}`,request,response}]};
}
