# Remaining ECS build sequence

This plan closes the original build-pack scope; it does not replace it with the current implementation. [REQUIREMENTS_EVIDENCE.md](REQUIREMENTS_EVIDENCE.md) is the baseline. Keep the existing root static demo, public deployment and preserved `ecs_demo` data unchanged. Use additive migrations and disposable `ecs_test`/fresh acceptance environments. Do not publish the confidential source pack.

## Order and exit criteria

### 1. Contracts and executable acceptance foundation

Requirements: 48, 51, 52; all subsequent work depends on this.

- Current-operation success DTO coverage is complete (121/121, including exchange execution/cancellation); preserve the complete gate. The strict inbound v1 envelope, retained signature/raw evidence, ownership/correlation checks and explicit legacy compatibility are implemented; see [EVENT_CONTRACT_GUIDE.md](EVENT_CONTRACT_GUIDE.md). Exchange purchase/refund/cancellation now has a strict versioned local simulator contract. Next, complete remaining outbound payload contracts and business callbacks. Producer-owned historical JSON remains explicitly opaque until its producer contract is versioned.
- Isolated browser runner/configuration and thirteen scenarios now cover mapped CSV submission, operator/vendor login, cross-partner denial, durable DAM retry/replay, draft-to-publication/read-back and a connected multi-partner order → fulfilment → Good-QC return → locked mock settlement, followed by Bad-QC photos/refund override, M→L preview/request/review/cancellation and separate replacement checkout/payment/fulfilment with unchanged original history. See [BROWSER_ACCEPTANCE_GUIDE.md](BROWSER_ACCEPTANCE_GUIDE.md). Append real browser journeys with each feature; complete all personas and the source runbook. Tests must not clear the preserved demo database or assume seeded success flags.
- Establish complete request/response/event validation, worker crash/retry/idempotency tests and actor-role audit snapshots.
- Exit: complete contract validation passes; a disposable browser suite proves one end-to-end authorized journey and one denied partner access; failures leave no partial writes.

### 2. Catalogue ingestion, media and governed approval

Requirements: 08–18, 50. Missing catalogue assets are the first new business workflow to build.

- Upload, atomic individual replacement, atomic ZIP imports/jobs, approved-host URL fetch/jobs, durable local DAM jobs, individual review/correction, ordering and private storefront display are implemented; see [CATALOG_MEDIA_GUIDE.md](CATALOG_MEDIA_GUIDE.md), [ZIP_JOB_GUIDE.md](ZIP_JOB_GUIDE.md) and [DAM_JOB_GUIDE.md](DAM_JOB_GUIDE.md). URL/DAM evidence uses local fixtures, not actual suppliers. Next implement multi-product import linkage and source configuration. No arbitrary URL fetch or unscanned publication. PostgreSQL byte storage must not be presented as verified MinIO/S3.
- Source-field mapping preview, explicit ignored columns, exact category/attribute value conversions and immutable per-batch provenance are implemented for CSV/XLSX. Next add reusable profiles/unit normalization, persistent parent/variants and simulated SFTP checkpoint/retry history; leave optional commerce connectors visibly stubbed until implemented.
- Add configurable quality rules, image-hash/fuzzy duplicate decisions and bulk review. Preserve already-published content through moderated revisions.
- Add price-floor/override and funded promotion rules/PriceBook messages; exact money and immutable historical snapshots.
- Implement trusted low-risk auto-approval with restricted-item manual gates, sampling, reasons and the same publication path.
- Implement deterministic translation and image jobs with clearly labelled mock results, original/output lineage, glossary/consent and human approval. Never describe supplied SVGs as newly generated imagery.
- Exit: defective import → safe assets → mapping/correction → duplicate decisions → Arabic draft → moderated/trusted paths → ERP-first publish → Fynd/SFCC mock read-back. Failure and security cases tested through API and browser.

### 3. Partner administration and full activation story

Requirements: 02–07, 19, 43, 44, 49, 51.

- Complete invitations/resend/revoke/expiry, bilingual document/application/RFI journey, brand evidence linkage, reminders and role/user administration.
- Add fee variants, effective controls, risk/operational holds and full decision history. Scoped suspended availability must not stop accepted orders.
- Finish immediate SKU browser story and scheduled item effectivity without changing original order snapshots.
- Wire private operational email to local Mailpit only, with delivery jobs, recipient scope, preferences/digests and repeated escalation. No customer communications or real external email by default.
- Exit: a newly invited fictional partner reaches ACTIVE only after current documents/terms/ERP/rights/mappings/stock/storefront/test-order evidence; invalidate each dependency and demonstrate the gate closes. Complete English and Arabic browser runs.

### 4. Source feeds, routing and fulfilment

Requirements: 20–28, 45–50.

- Signed/deduplicated stock feeds; configurable product/location/tag thresholds and versioned routing simulate/approve/activate workbench.
- Partial-line multi-source allocation, rerouting under failure, market/currency/cutoff/freshness gates and non-oversell races.
- BOPIS ready/collection flow, branded shipping documents/manifests, carrier tracking callbacks and operator handoff.
- WMS delivery and return-collection appointments and inbound POs with callbacks/state transitions; pick-task support is not a substitute.
- Expand SLA override hierarchy and timed escalation while pinning prior milestone policy.
- Exit: one order across ATI warehouse, vendor warehouse and brand store; independent exception recovery; a pickup order; WMS appointment/PO; stock, OMS and storefront read-back with duplicate/out-of-order callbacks.

### 5. Returns, reverse logistics and exchanges

Requirements: 29–35, 45, 47.

- Signed SFCC return ingress; versioned scoped ReturnPolicy with customer eligibility and separate operational window/non-returnable rules. Capture exact decision facts.
- Return label/pickup slots/status callbacks plus self-delivery. Private immutable QC photos, original condition/disposition snapshots and reasoned refund override are implemented and browser-tested; remaining stock-disposition overrides, broader disposition choices and external reconciliation must not be conflated with refund approval. See [RETURN_INSPECTION_GUIDE.md](RETURN_INSPECTION_GUIDE.md).
- Scoped exchange options, shared-routing/decimal-price preview, accepted requests, ATI approval/rejection and pre-order cancellation lead to a separate new reservation/order, typed SFCC mock purchase and Fynd mock fulfilment. Pre-payment/awaiting-Fynd cancellation and demo-clock hold expiry now reconcile independent simulator outcomes before release, including capture/order/shipment responses racing cancellation; see [EXCHANGE_IMPLEMENTATION_GUIDE.md](EXCHANGE_IMPLEMENTATION_GUIDE.md). Next add explicit business declines, formal callbacks/reconciliation, post-dispatch/partial/repeated exchange policies and broader browser recovery. Preserve original delivery and append-only financial lineage. Refund-and-repurchase and thirty-minute holds remain provisional demo rules; production policy is an ATI open decision.
- Signed refund/credit-note confirmations and replay-safe reversals/chargebacks.
- Exit: Good/Bad QC, outside-window rejection, delayed operational receipt, M→L exchange with linked legs, failed replacement and duplicate callbacks; no double stock or money entries.

### 6. Complete finance and multi-market operations

Requirements: 07, 35–42, 53, 54.

- Replace hardcoded AED/first-market finance assumptions with source-owned currency/market and precision rules. Preserve existing ledger and statement history; corrections are append-only.
- Fixture-based VAT/import VAT/shipping and transaction/settlement FX facts with source/date/rate/variance. ATI confirms production rules; the demo is not a tax calculator.
- Versioned chargebacks, scheduled statements, PDF/CSV, disputes, per-order Finance messages and signed payout acknowledgement. No disbursement inside ECS.
- Reconcile independent operational read-back, returns/refunds/credit notes/payouts and tax/FX. Export/share governed reports with scope rechecked at access time.
- Positive end-to-end UAE, KSA and Kuwait scenarios, market-specific activation/time zones/localization; provision a second fictional operator using the same modules.
- Exit: exact line → event → statement → export → acknowledgement reconciliation for every currency, retained discrepancy/resolution evidence, locked history unaffected by future policy/FX changes, no cross-company leak.

### 7. Infrastructure, visual/locale acceptance and handoff

Requirements: all 54 and build-spec definition of done. Run incrementally, not only at the end.

- App containers and clean-machine boot; real local Redis/BullMQ, MinIO and Mailpit tests, bounded retries/leases/recovery and all-dependency health/metrics.
- Full English/Arabic/RTL, responsive keyboard/focus/accessibility passes. Compare exact approved Bloomingdale's assets/footer and Fynd console screenshots; keep onboarding and consoles separate.
- Complete every persona and 35–45 minute presenter journey in a browser suite, plus volume/latency and security/failure runs in disposable environments.
- Preserve source artifacts; supply implementation-current START_HERE_FOR_CODEX, DEMO_RUNBOOK, FYND_DATA_FLOW, README, traceability, OpenAPI, event schema, seeds and env example. Document deterministic starting state, expected outcomes and recovery per scene.
- Exit: every row in the evidence register has full proof, all specified commands execute successfully on a fresh environment, no unsupported/live claim, and no required gap remains. Only then can the overarching goal be complete.

## Parallel dependency: actual Fynd test-company connection

This is an external-access dependency, not a reason to stop local feature work. User selected development/test; ID/console URL and credentials are still required. Follow [FYND_CONNECTION_PLAN.md](FYND_CONNECTION_PLAN.md).

1. Confirm account and official API origin; store least-privilege credentials only in ignored local/server configuration.
2. Read-only authentication/company identity, then real brand/product/location/inventory reads. Record actual IDs; never use mock IDs against Fynd.
3. Confirm entitlements, request schemas, routing authority, state transitions, webhook scopes and rate limits. Implement explicit per-market/company mappings.
4. Enable a bounded test brand/location/assortment disconnected from customer-facing channels and real carrier/payment actions. Add catalogue/inventory writes with independent read-back, then test orders/shipments/returns.
5. Register callbacks only at an approved HTTPS endpoint with verified authentication and replay protection. Compare events with remote state and the ECS audit chain.

No credentials or confirmed tenant means no live-connection claim. Do not flip old queued mock jobs to live. Real carrier/refund/payment execution, external communications, publishing/deployment and confidential-pack distribution are separate authority boundaries.

## Completion evidence required for each delivery slice

- Source requirement and gap closed, not merely a new endpoint or table.
- Scoped authorization, invalid transition, concurrency/idempotency, rollback and callback failure tests.
- Browser proof for the new user journey and Arabic/RTL coverage where exposed.
- Strict API/event contracts and retained lineage/audit.
- Fresh fixture/reset compatibility; preserved demo unaffected except approved additive changes.
- Updated evidence register and runbook. Record untested paths explicitly; never convert a plan into proof.
