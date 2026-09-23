# ATI requirements — post-implementation evidence

22 September 2026. Source: the 54 IDs in `Vendor Response!A5:H58` of the supplied workbook. This supersedes the **demo-state findings**, not the original observations, in `REQUIREMENTS_AUDIT.md`.

## Read this correctly

**No: the production requirements are not all fulfilled merely because the demo works.** The demo now contains connected operating behavior rather than only counters and toast messages. Below, **Local** means executable browser-local behavior; **Simulated** means an explicit external-system/AI stand-in; **Partial** names an intentional demo boundary; **Design** identifies production work that cannot be certified by a browser prototype. These are not the workbook’s formal Fynd support classifications.

All business data is fictional. All integrations are simulated. Secure identity, real product entitlement/API availability, durable persistence, country financial treatment and scale must be proven in a separately authorized pilot. No source workbook cells were edited.

## All 54 requirements

| ID | Requirement | Current demo evidence | Remaining before production / fuller pilot |
|---|---|---|---|
| 1 | 1P concession model | Local: separate personas; customer order view hides vendor; ATI-branded packing and SFCC invoice events | Confirm legal/invoice ownership and customer communication templates |
| 2 | Bilingual onboarding | Local: EN/AR guided form, RTL, saved fields, sample uploads, review/reject/info/resubmit, review reminders | Real invitation delivery, identity, secure document store, full Arabic copy QA |
| 3 | ERP vendor master | Simulated: request payload, failure/retry and authoritative response ID | ERP vendor-match/create API and duplicate-master policy |
| 4 | Vendor administration | Local: registry, versioned documents, reasons and demo permission profiles | Server RBAC, multi-user lifecycle and document retention/expiry enforcement |
| 5 | Brand rights, pause/delist | Local: territorial rights, suspend/delist/pause, zero sellable stock; open legs continue | Multi-brand authorization agreements and live channel acknowledgement |
| 6 | SKU controls | Local: reasoned pause/resume, availability zeroing and event | Separate permanent SKU retirement/relist policy and channel reconciliation |
| 7 | Commercial terms | Local: commission/cadence/return-window/trust editors; historical sale rate retained; audit effective time | Negotiated contracts, future-effective versions, category/brand precedence |
| 8 | Prices and promotions | Local: price floor, discounts, operator override, brand-funded ledger deduction | ATI promotion rules, campaign approvals and margin/tax basis |
| 9 | SKU CRUD/templates/API | Local editor, real downloadable CSV template, row import; API feed simulator | Authenticated bulk APIs and production job orchestration |
| 10 | CSV/Excel/API/SFTP/connectors | CSV/XLSX parser, mapping/preview/job errors; sample API/SFTP/Shopify/WooCommerce feeds | Actual connector provisioning, compatibility and SLAs |
| 11 | Asset ingestion | Local image/ZIP upload, dimensions, stored preview; URL/DAM reference metadata | Live DAM/URL retrieval, malware scan, object storage, full archive matching |
| 12 | Taxonomy/variants | Local source mapping, category/parent/colour/size fields | Full ATI taxonomy, attribute transforms and variant-specific validation |
| 13 | Duplicates | Local SKU comparison, within-file duplicate rejection, corrective editing | Fuzzy/content/GTIN duplicate policy and merge/link workflow |
| 14 | Quality/moderation | Local checks, approve/corrections/resubmit and valid submitted bulk approval | Production image/content rules, selected-row jobs and human QA operations |
| 15 | Trusted auto-approval | Local saved trust toggle, quality threshold, validation prerequisite and manual fallback | Agreed trust scoring inputs, re-evaluation and policy precedence |
| 16 | EN/AR enrichment | Local editable bilingual titles and reviewed dictionary suggestion | Live translation service and Arabic linguistic/catalogue review |
| 17 | Image generation (Should) | Partial: creative brief, source/layout comparison, approval record; explicitly not generated imagery | Snap/creative service entitlement, actual on-model output and human quality approval |
| 18 | ERP → commerce publication | Simulated staged ERP/SFCC events, metadata, revision checks and response-dependent visibility | Production schemas, batch limits, rejections and reconciliation |
| 19 | Controlled activation | Local gates: approval, ERP ID, approved/visible SKU, stock validation and isolated test-order execution | ATI-approved complete test pack and real SFCC visibility proof |
| 20 | SKU-location inventory | Local physical/reserved/buffer/available quantities, timestamps and sync events | Authoritative stock source versions and event delivery latency |
| 21 | Oversell prevention | Local atomic allocation, reservations, SKU-location buffers, stock tags | Distributed reservations, tag-policy precedence and concurrency/load proof |
| 22 | SFCC → OMS orders | Local normalized order with simulated source; external order key deduplication in domain | Signed live webhooks, durable dedupe, replay windows and payment-state contract |
| 23 | Routing | Local brand/warehouse/store-first waterfall and allocation preview | ATI ownership rules, capacity/promise/cost constraints |
| 24 | Split legs | Local independent IDs, quantities, source, stages, tracking and SLAs | Complex line splitting/reallocation, cancellations and carrier constraints |
| 25 | Vendor fulfilment | Local accept → pick/pack → dispatch → delivery, AWB, downloadable document | Carrier booking, scanning, partial cancellations and warehouse execution |
| 26 | Operator-branded docs | Local packing/reverse-label print HTML; no vendor exposure in customer view | Carrier-valid labels and approved invoice/packing templates |
| 27 | Fulfilment models/BOPIS | Local brand/warehouse sources and store-only BOPIS → collection | WMS/store integrations, collection identity and real availability promises |
| 28 | Stage SLAs | Local configurable timers, UTC business-day toggle, clock advance, deduplicated exceptions | Market holiday/business-hour calendars and escalation ladders |
| 29 | Returns lifecycle | Local eligibility → pickup → receipt → QC → refund event/ack | Customer-originated SFCC returns, partial-unit cases, carrier exception detail |
| 30 | Brand return windows | Local vendor eligibility days plus separate processing-buffer exception | ATI policy approval, country/customer exceptions |
| 31 | QC/restock | Local resaleable/damaged/inspection branches, notes, reasoned restock override | Photos/evidence capture, warehouse grading and approval permissions |
| 32 | Reverse logistics | Simulated pickup time, collection/transit/receipt, reverse event and demo label | Carrier selection, missed-pickup/rebook and live reverse tracking |
| 33 | Exchanges | Local linked replacement order/reservation, original reversal and price difference | Agreed exchange integration, customer top-up/refund settlement and partial quantities |
| 34 | Refund/credit data | Simulated QC-triggered refund/credit payload, pending/confirmed, retries | SFCC/payment reconciliation, actual credit-note conventions |
| 35 | Chargebacks | Local return chargeback financial event appears in period statement | Negotiated reason/rate policy and automatic next-cycle allocation |
| 36 | Financial events | Local order-leg ledger, original commission rate, funding, returns and net | Full ATI tax/shipping/fee events and accounting precision sign-off |
| 37 | Statements | Local date selection, captured ledger snapshot, totals, actual CSV | Approved statement template, dispute approvals and scheduled distribution |
| 38 | Cadence/currency/handoff | Saved cadence; market currency; manual period generation and simulated finance acceptance | Scheduled generation, cutoff/timezone rules, real finance interface; no payouts in demo |
| 39 | Tax/FX/import VAT | Partial: explicit zero-default tax, supplied import VAT, conversion rate/source/date metadata | Country tax engines, conversion/base currency policy and true FX variance reconciliation |
| 40 | SFCC invoices | Simulated operator-branded data event after all legs complete; returned invoice reference | Tax invoice generation/signature remains in SFCC/ATI-approved system |
| 41 | Reconciliation | Local statement-vs-finance total variance and reason; overlap handoff prevention | Line-level OMS/ERP/vendor matching, tolerances, disputes and close controls |
| 42 | Reporting/sharing | Local derived KPIs, vendor breakdown, market/date filters and CSV/HTML export | Authenticated public links, scheduled reports and business intelligence definitions |
| 43 | Vendor portal | Separate route, shared records, own-vendor actions and readiness | Real login, tenant isolation and full localization/accessibility review |
| 44 | Operator console | 16 functional sections in Fynd-style shell; central governance and events | Product integration, SSO, delegated operational responsibilities |
| 45 | SFCC bidirectional | Simulated catalogue, RPM PriceBook, stock, order, status, invoice, refund chains | Actual SFCC adapter/cartridge contracts and sandbox proof |
| 46 | Enterprise integrations/RPM | Explicit ERP master/catalogue, RPM pricing, WMS appointment, finance and SFCC payloads | ATI system versions, authoritative object ownership and adapter implementation |
| 47 | WMS appointments/PO | Local appointment/PO object and simulated WMS confirmation | Real PO lines, capacity calendars and WMS scheduling rules |
| 48 | Secure scalable APIs/events | Design + local failure/retry/deduplication behavior; no authenticated application API | Server APIs, OAuth/mTLS, outbox/queue, database, observability, performance/security testing |
| 49 | Notifications/exceptions | Local review/info/SLA/event-failure notifications, assignment and resolution | Email/in-app delivery, recipient policies and escalation routing |
| 50 | Configurable rules | Local saved rules affect routing, timers, approval, buffers; audit retains changes | Scoped inheritance, version scheduling, rollback and approval controls |
| 51 | Audit | Local actor/time/reason/before-after history, JSON export, no 20-event cap | Immutable server storage, identity attestation, retention and permissions |
| 52 | Standalone extension | Separate static routes and pure domain boundary; framework canonical launch | Deployable authenticated service, production database and plug-in contract validation |
| 53 | UAE/KSA/Kuwait/scale | Local market isolation, AED/SAR/KWD, mapped locations; cross-market order rejection | Country policy/localization/currency treatment and load/resilience certification |
| 54 | Additional businesses (Should) | Local business switch/add, scoped vendor onboarding and cross-business order guard | Secure multi-tenant deployment, channel configuration and onboarding playbook |

## Correct workflow

Invitation → bilingual application/documents → ATI review/info loop → approval → ERP vendor identity → catalogue correction/moderation → ERP publish → SFCC visibility acknowledgement → inventory readiness → successful test order → activation.

Trading then runs SFCC order → OMS normalized order/reservation → routed independent legs → operator-branded fulfilment → SFCC status/invoice. Returns run eligibility → reverse pickup → receipt/QC → stock disposition + refund/credit event → ledger adjustment → statement/reconciliation → ATI finance handoff. ATI finance, not this portal, disburses money.

## Priority for the next phase

1. Agree the contracts and acceptance scenarios in `PILOT_CONTRACTS.md`; get named ATI and Fynd owners.
2. Implement real identity, server persistence and durable events before using real documents/customer data.
3. Connect one UAE vendor through ERP, SFCC, OMS, carrier/WMS and finance using authorized sandboxes.
4. Resolve financial rules, scoped policy precedence and detailed exception/partial-quantity cases.
5. Certify Arabic, security, performance and resilience; then extend to KSA/Kuwait and another business.

The Fynd Sales Coach skill informed these boundaries: product capability, custom extension and integration proof are deliberately separated. The demo is not a claim of generally available support for every row.
