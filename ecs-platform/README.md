# ATI ECS — full-stack build in progress

**Source release, 30 September 2026:** published as a demo with fictional credentials below. Current release checks: **94 unit tests, 218 PostgreSQL integration tests, strict TypeScript, ESLint, 121/121 OpenAPI contracts and optimized Next build pass**. The last isolated browser run passed all **14 scenarios**, including payment-held replacement cancellation; it preceded the receipt-schema tightening in this release. No hosted full-stack runtime or live Fynd connection is claimed. Earlier dated checkpoints below retain their original counts.

This is the new implementation of the supplied 23 September 2026 build pack. The previous browser-local demo remains untouched in the parent directory. **This is not yet the complete 54-requirement demo.** See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for implemented evidence and remaining work.

**Full scope audit:** [REQUIREMENTS_EVIDENCE.md](REQUIREMENTS_EVIDENCE.md) maps every source requirement to current code/tests and missing acceptance. The [remaining build sequence](REMAINING_BUILD_PLAN.md) covers contracts, catalogue/media, partner activation, fulfilment, returns/exchanges, finance/multi-market and final handoff. `pnpm requirements:validate` checks the register's IDs, priorities and evidence paths—not functional completion.

**Latest media checkpoint (29 September):** ZIP imports now join URL/DAM background jobs, with private immutable source quarantine, all-or-nothing image validation, transient retries, dead letters, ATI-only replay and recovery of every committed receipt after acknowledgement failure. Human review remains mandatory. Verification: 83 unit + 160 integration + 4 browser scenarios; OpenAPI 108/108. REQ-11 remains partial: real supplier/DAM verification, multi-product linkage, configurable quality, production scanning/object storage, retention and native Fynd hosting remain pending. See [ZIP_JOB_GUIDE.md](ZIP_JOB_GUIDE.md), [CATALOG_MEDIA_GUIDE.md](CATALOG_MEDIA_GUIDE.md), [MEDIA_URL_GUIDE.md](MEDIA_URL_GUIDE.md) and [DAM_JOB_GUIDE.md](DAM_JOB_GUIDE.md). Earlier counts below are historical checkpoints.

**Latest catalogue checkpoint (29 September):** CSV/XLSX source-column mapping, explicit ignored columns, exact taxonomy/attribute conversions, read-only before/after preview and immutable batch mapping are implemented. The mapping panel spans the workspace so source and ATI values can be compared. Verification: **87 unit + 164 PostgreSQL integration + 5 browser scenarios**, and OpenAPI **109/109**. Saved reusable profiles, unit conversion and parent-variant consolidation remain pending; REQ-12 stays partial.

**Latest API verification: 93 unit + 218 PostgreSQL integration tests pass; OpenAPI 121/121.** Approved exchanges create a separate order/reservation, typed SFCC mock payment and new Fynd mock shipment. Pre-payment/awaiting-Fynd cancellation and provisional 30-minute demo-clock hold expiry now obtain separate payment and fulfilment acknowledgements before releasing stock. Captured payments require their own refund acknowledgement; lost or late responses cannot reopen cancelled work. The previous 13-scenario browser checkpoint covers M→L replacement delivery with original history preserved; the expanded cancellation browser run is recorded in [BROWSER_ACCEPTANCE_GUIDE.md](BROWSER_ACCEPTANCE_GUIDE.md). **Explicit business declines, formal callbacks/reconciliation and broader policies remain pending**; see [EXCHANGE_IMPLEMENTATION_GUIDE.md](EXCHANGE_IMPLEMENTATION_GUIDE.md). Good/Bad-QC photos, quarantine and separate refund override remain covered; see [RETURN_INSPECTION_GUIDE.md](RETURN_INSPECTION_GUIDE.md). All external acknowledgements are local mocks, not actual Fynd or money movement.

**Browser acceptance:** `pnpm test:e2e` boots a fresh isolated database, API, mock service, worker and test build. Thirteen scenarios cover the connected story plus mapped CSV submission, portal separation, cross-partner denial, DAM retry/replay and vendor correction → ATI approval → ERP/Fynd/SFCC mock publication/read-back. See [BROWSER_ACCEPTANCE_GUIDE.md](BROWSER_ACCEPTANCE_GUIDE.md) for isolation and incomplete coverage, and [CONNECTED_JOURNEY_GUIDE.md](CONNECTED_JOURNEY_GUIDE.md) for presentation steps. These are local mock acknowledgements, not actual Fynd connectivity.

ATI remains merchant of record. SFCC owns the customer storefront, checkout, payment and customer communications. ECS owns concession governance and financial statements. Fynd is a proposed operational integration, not a confirmed tenant implementation. Every current adapter is explicitly a mock; live mode fails closed rather than falling back to mock success.

**Actual Fynd connection requested:** the target is a development/test company. See [FYND_CONNECTION_PLAN.md](FYND_CONNECTION_PLAN.md). The desktop's `event-marketing` MCP configuration and loaded Fynd tools were verified; no authenticated tenant call has yet been verified. This is distinct from the ECS runtime: the separate `pnpm fynd:check` read-only probe still needs company identity and runtime credentials. MCP availability does not connect the outbox or enable live operational writes. Keep secrets in the ignored `.env.fynd.local`, never in chat or Git.

**Operational SLA workflow:** shipment and return detail pages now show durable stage timers, warnings/breaches and audited operator waivers for late confirmation. See [SLA_WORKFLOW_GUIDE.md](SLA_WORKFLOW_GUIDE.md) for the exact demo policies and verification. The [operational inbox](NOTIFICATIONS_GUIDE.md) routes private SLA, catalogue-review and integration-failure notices. Administrators can now configure [versioned recipient-role matrices](NOTIFICATION_ROUTING_GUIDE.md); email, digests, personal preferences and repeated timed escalation remain pending.

**Exception centre:** [source-linked queues and ownership](EXCEPTIONS_GUIDE.md) now consolidate SLA, catalogue, integration and [reported shipment issues](SHIPMENT_ISSUES_GUIDE.md). Claim, handoff and investigation notes are audited; a failed replay stays actionable until the source operation succeeds.

**API contract checks:** `pnpm openapi:validate --complete` covers all 121 implemented operations and their success-response schemas, without a running database. `--export` writes an ignored local JSON contract. Shared strict envelopes are checked against serialized responses in the isolated integration suite. The inbound v1 event profile retains signed raw evidence and explicit legacy compatibility; `pnpm events:validate` checks its committed schema. Exchange purchase/refund/cancellation has a typed local outbound profile; other outbound operation-owned JSON remains incomplete. See [API_CONTRACT_GUIDE.md](API_CONTRACT_GUIDE.md) and [EVENT_CONTRACT_GUIDE.md](EVENT_CONTRACT_GUIDE.md). Schema coverage does not prove every workflow, branch, permission or real Fynd compatibility.

**Catalogue imports:** CSV, template-based XLSX and REST payloads share a database-backed validation/correction/moderation workflow. Excel imports preserve Arabic and text identifiers; formulas, hidden data and external workbook links are rejected. Download the Excel template from the catalogue-import screen. See [CATALOG_IMPORT_GUIDE.md](CATALOG_IMPORT_GUIDE.md) for the supported profile and remaining feed/media limitations.

## Runtime

**Individual SKU controls:** ATI can now pause/delist a SKU with a reason, queue zero sellable stock to both mock destinations and retain physical inventory, reservations and open shipments. Restoration rechecks independent approval/mapping gates. See [PRODUCT_SALES_GUIDE.md](PRODUCT_SALES_GUIDE.md) for the UI, eight integration tests and remaining scheduled/live acceptance work.

**Analytics:** dedicated operator/vendor reports now support scoped market/vendor/brand/date filters, GMV, delivered sales, fulfilment/return/SLA rates, rankings, inventory-ack freshness, breach links and CSV exports. See [ANALYTICS_GUIDE.md](ANALYTICS_GUIDE.md) for definitions, evidence and pending REQ-42 work. This is local operational reporting, not live Fynd analytics or REQ-41 reconciliation.

**Reconciliation:** a separate ATI finance/audit workspace compares stored SFCC/Fynd receipts, delivery ledger entries and Finance statement exports. Recorded scans, guarded reasoned resolution, retained original evidence and recurrence are implemented. Demo-only reconstruction can append missing delivery entries when source evidence matches; it cannot overwrite amounts or move money. `pnpm demo:reconciliation prepare 01` adds an isolated fictional held-export story; `release 01` lets the local worker obtain its acknowledgement. Detection and resolution were browser-verified. REQ-41 remains partial—see [RECONCILIATION_GUIDE.md](RECONCILIATION_GUIDE.md) for the walkthrough and pending read-back/reporting work.

**Customer invoicing:** SFCC remains the issuer. Signed invoice-reference events now appear on ATI shipment detail, never in vendor views. The local simulator, revision/void rules, permissions and remaining production dependencies are documented in [INVOICE_REFERENCE_GUIDE.md](INVOICE_REFERENCE_GUIDE.md).

- Node 22.13+ (verified here with bundled Node 24.19), pnpm 11.19
- PostgreSQL + Prisma migrations
- Fastify API; Next.js web application
- Redis/BullMQ outbox dispatcher (Compose supplied; Redis execution not yet verified on this machine)
- Private local document storage with an optional S3/MinIO adapter (S3 runtime verification pending); Mailpit/email delivery pending
- Six deterministic, idempotent mock adapters

## Standard local setup

Run from this directory:

```sh
cp .env.example .env
docker compose up -d
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Use **http://localhost:3000**, matching `WEB_ORIGIN`; `127.0.0.1` is a different browser origin. API: http://localhost:4000; API docs: http://localhost:4000/docs; mocks: http://localhost:4100. Ports are bound to loopback. No external service credentials are required.

Do not run demo users or fault/reset controls against a production database. `.env` is ignored. Fictional data only. Publication of the demo source and fictional login credentials was authorized on 30 September 2026. Real secrets, private runtime data and the confidential source build pack remain excluded. Publishing source does not deploy the full-stack runtime; the existing Vercel static demo is a separate application.

## Without Docker: local PostgreSQL development

The optional embedded PostgreSQL package creates only project-local data under `.local/postgres` and binds port **55432**. It does not install system services. The macOS arm64 binary has been verified; other platforms are not yet verified.

```sh
pnpm exec tsx scripts/local-postgres.ts
```

Keep that terminal open. Set the port in `.env`'s `DATABASE_URL` to `55432`. Run migrations and seed in another terminal. The current workstation has this setup. This fallback is PostgreSQL only: it does **not** replace Redis, MinIO or Mailpit.

To run the implemented workflows without Redis, use the explicitly labelled PostgreSQL polling transport. It shares the same durable outbox, atomic leases and acknowledgement handler; it is not a silent Redis fallback:

```sh
pnpm dev:local
```

For the optimized local demo, run `pnpm build` then `pnpm preview:local`. PostgreSQL must already be running. All servers bind loopback; the sample accounts are not intended for a public deployment.

Or run services independently:

```sh
pnpm exec tsx apps/api/src/main.ts
pnpm exec tsx apps/mock-systems/src/main.ts
pnpm exec tsx apps/worker/src/local.ts
pnpm exec next dev apps/web --webpack -H 127.0.0.1 -p 3000
```

## Accounts

All fictional local accounts use `Demo123!`:

| Account | Persona |
| --- | --- |
| admin@ati.demo | ATI super admin |
| partner.manager@ati.demo | Partner manager |
| catalog@ati.demo | Catalogue moderator |
| ops@ati.demo | Operations manager |
| finance@ati.demo | Finance analyst |
| auditor@ati.demo | Read-only auditor |
| admin@maisonazure.demo | Maison Azure vendor admin |
| fulfilment@maisonazure.demo | Maison Azure fulfilment |
| finance@maisonazure.demo | Maison Azure finance viewer |
| catalog@lumera.demo | Lumera catalogue manager |
| admin@ateliernoor.demo | New partner onboarding |

Atelier Noor is the new application. Maison Azure remains active so its trading history is consistent. The source sample GTIN check digits were corrected while retaining originals in product provenance. The missing dress size L was added.

## Current verifiable flow

1. Sign in as the ATI partner manager.
2. Open Partners & brands → Atelier Noor → Review.
3. Start review, download private fictional evidence, approve the three current sample documents with evidence reasons, then approve the partner. The operator decision-reason field is required for requesting information or rejecting; brand rights are reviewed separately in their registry.
4. Request ERP sync. The API saves the domain change, audit and outbox job atomically.
5. With worker and mock server running, the ERP job obtains a deterministic `mock-erp-*` identity. Integration Trace shows status, attempts and correlation ID.
6. Brand authorization and Fynd pre-activation mapping are separate guarded actions. Use **Locations** to configure fulfilment ownership and operating limits, then **Map Fynd** in the partner drawer to obtain current per-brand/location mock acknowledgements and read-back evidence. Activation remains blocked until the remaining readiness evidence actually exists. See [mapping workflow](MAPPING_GUIDE.md).

The separate `/onboarding` experience has six steps: business profile, brands/operations, compliance, commercial summary, review/submission and launch readiness. Sign in as `admin@ateliernoor.demo` after ATI requests information to edit and resubmit. Saved drafts and document versions persist in PostgreSQL; unsaved business changes must be saved before uploading. The original Bloomingdale's logo/footer remain separate from the operator console.

In **Partners & brands → Review → Launch readiness**, inspect inventory evidence per SKU/location. **Sync inventory** queues a fresh revision to the local Fynd and SFCC mocks; **Refresh readiness evidence** checks both acknowledgements and downstream quantities. APPROVED/PAUSED partners remain at zero customer availability. This command does not adjust stock or reservations. Missing/currently stale evidence keeps the gate pending even if legacy seed flags say otherwise. All current ERP/Fynd/SFCC publication identities are also required for ATP and new orders.

The **Isolated launch test** panel runs a persisted one-unit virtual order through eight local Fynd/SFCC mock acknowledgements. It never creates a customer order, changes business stock or posts finance. Enter a reason, run the test, refresh its progress, and inspect the readiness result. Failed steps use audited replay; changed configuration requires a new test. Activation/reactivation cannot use seeded `testOrderPassed` flags. Separate mapping and [storefront visibility evidence](STOREFRONT_GUIDE.md) now require current downstream mock read-back. The product page includes a private English/Arabic customer-content preview. See [LAUNCH_TEST_GUIDE.md](LAUNCH_TEST_GUIDE.md); no mock result establishes an actual Fynd/SFCC connection.

Document upload accepts PDF/PNG/JPEG or fictional TXT, up to 5 MB. Private bytes are stored outside public assets; downloads require both an authorized session and a 60-second user-bound signed URL. The local scanner is explicitly **mock**, not production malware protection. `DOCUMENT_STORAGE=local` requires demo mode; `DOCUMENT_STORAGE=s3` is implemented but has not been verified against MinIO here. Uploaded files, signatures, passwords and invitation tokens are not application-log payloads.

Existing metadata-only seed records can be materialized as clearly fictional downloadable text with `pnpm demo:documents`. The command is additive, targets only recognized local fixture records, and preserves real uploads and prior decisions. Fresh seeding creates the same private sample evidence.

ATI's **Invite a partner** creates a provisional partner and a 24-hour single-use invitation. The local preview link uses a fragment token; acceptance creates only the server-assigned vendor role/company/partner membership. No email is sent. New credentials are entered by the demo presenter. Reminders, invite revocation/resend and production identity/email delivery are still pending.

### Commercial configuration

Open **Commercial terms** as ATI admin, partner manager or finance analyst. Vendor admins/finance viewers and ATI auditors have scoped read access.

1. Select Maison Azure. Its original v1 has a 28% base, 30% Handbags override and weekly cadence.
2. Create a new draft version, optionally scoped to a canonical catalogue brand. Configure market/currency, commission, category overrides, settlement cadence, effective dates, return window and handling charge.
3. Preview example gross and separately funded discounts. On AED 1,000 gross with AED 100 vendor-funded and AED 50 ATI-funded discount, a 30% rate means AED 270 commission and AED 630 vendor payable; 32% means AED 288 and AED 612. This creates no ledger entries or payments.
4. Save with a reason, then separately approve or reject the draft with a review reason. Dates are explicit UTC; retroactive changes are refused. Future versions remain inactive until their start.
5. Approved records cannot be edited or deleted at the database level. Copy them to new versions. Brand-specific terms win over partner defaults; within each scope the newest effective approved version wins. Category precedence is exact path, deepest matching segment, then base.
6. New orders snapshot the selected agreement ID/version, rate and return policy. Existing orders and statements do not reprice when terms change.

Cadence is currently configured and displayed, not an automatic statement scheduler. Percentage commissions and return-handling charges are implemented; other fee models and full multi-market trading remain separate gaps. All commercial data is fictional demonstration configuration, not a legally binding agreement.

### Brand/category/territory authorization

Open **Brand rights** (`/operator/brands` or the read-only `/vendor/brands`). ATI admin and partner manager create drafts with canonical brand ID, market, category paths, UTC period, evidence reference and reason. Save, then separately approve/reject. Reviewed scope is immutable; create a new record for renewal. Conflicting overlapping reviewed periods are blocked.

Pause Maison Azure with a reason: catalogue coverage becomes blocked and inventory shows zero sellable stock. Physical stock, reservations and accepted shipments are unchanged. Resume after reviewing valid evidence: eligible availability returns. Suspend has the same new-sale block; revoke is permanent. Expiry applies at the exclusive end timestamp. Current catalogue, order and API inventory checks are immediate; both worker transports scan eligibility every ten seconds to queue revised Fynd/SFCC availability. Queued messages require mock acknowledgement and are not real downstream updates.

Seed grants are explicitly fictional, not real distribution rights. Existing local fixtures can be augmented using `pnpm demo:brand-rights`; it never overwrites existing rights. The deprecated `brandApproved` Boolean grants no permission. Real evidence attachment/verification, reminder delivery, optional two-person review and production-scale expiry scheduling remain pending.

### Catalogue review and publication

Start a new assortment at **Catalogue imports** (`/operator/catalog/imports` or `/vendor/catalog/imports`). Download the CSV template, upload a UTF-8 file (up to 100 rows / 256 KB), then inspect errors, correct rows with audit reasons or explicitly exclude them. The original uploaded row values remain immutable. Submission creates new products **in review**, not published products. Existing SKUs are never overwritten, and opening stock is not sellable until product/partner/rights gates permit it. See [CATALOG_IMPORT_GUIDE.md](CATALOG_IMPORT_GUIDE.md) for the full workflow and API boundary.

1. Open My products → Northline Home Percale Duvet Cover. The separate product page shows the missing Arabic title and rejected media.
2. Add an Arabic title, save the draft, and observe the refreshed validation. A below-floor price can be saved as a draft but cannot be submitted.
3. Submit for review. As an ATI catalogue moderator, record review evidence and approve the sample media, then approve the product.
4. Publish through ERP. ERP starts PENDING; Fynd and SFCC remain BLOCKED until ERP responds with an identity.
5. Refresh status to see independent target acknowledgements. The product becomes PUBLISHED only when all three succeed.
6. Failed targets appear in Integration Trace and can be replayed with a reason; resolved jobs close their integration exception.

The seeded approved Lumera lip colour is a shorter publication-only scenario. Draft editing is limited to draft/returned/rejected products; mapped CSV/XLSX/API imports can create new SKUs in review. Governed published-item revisions and automated image assessment remain pending. The category rules are explicit local demo rules, not validated ATI configuration.

### Inventory and split-order demonstration

For a connected, reproducible version of the following scenes, use [CONNECTED_JOURNEY_GUIDE.md](CONNECTED_JOURNEY_GUIDE.md). It distinguishes the fresh test fixture from preserved presenter history and explains the actual routing outcome.

1. Sign in as `admin@ati.demo` or `ops@ati.demo`, open **My orders**, and receive the signed sample order. Keep the API, worker and mock services running.
2. Pending receipts and shipments refresh automatically until acknowledged; manual Refresh remains available. Reusing the same reference and content is idempotent; use a new reference for a new order.
3. Open a leg to inspect every routing candidate, ATP and rejection reason. Five routing policies are selectable in the simulator. Manual override is API-only and cannot bypass hard eligibility gates.
4. Accept → start picking → enter exact picked quantities → confirm → ready for dispatch → enter tracking → carrier handover. Each requested change remains pending until the mock Fynd acknowledgement; the page refreshes automatically.
5. Download the ATI packing slip after packing. ATI operators may confirm fictional delivery; vendors cannot self-certify delivery. Actual carrier event processing is pending.
6. Sign in as Maison Azure to see only Maison legs. The other partners' lines and total basket value are not exposed in the vendor order response.
7. Inventory → Adjust stock requires an operational role and a reason. Source sequences reject stale updates; reserved quantities cannot be edited. A vendor cannot adjust stock at an ATI-owned warehouse.

The demo fixture carries a vendor-funded AED 64 discount on two Lumera serums. Order total is AED 2,666. No customer payment is collected. Delivery acknowledgement creates the immutable sales/discount/commission ledger.

**Routing clarification:** with fresh fixture configuration, Hybrid Waterfall sends the dress to Maison Azure JAFZA Warehouse, serums to Lumera Beauty Dubai Warehouse and the candle to ATI Dubai Central DC. The supplied runbook's dress → Dubai Mall outcome is not the default hybrid result. Store First changes prioritization; always show the actual chosen candidate and trace rather than claim an unselected location. Brand/location mappings must have current local acknowledgements before new orders are accepted.

### Returns and settlements

Optional fast-start: `pnpm demo:history` adds one clearly labelled historical delivered Lumera order. It is idempotent and does not reset existing records. Opening inventory is treated as already reflecting that historical delivery; financial recognition is booked at the current demo clock. The fixture's external IDs are explicitly fixtures, not evidence of real Fynd transactions.

1. ATI operations → **Returns** → Request a return → select a delivered shipment and one unit. The original agreement window and unclaimed delivered quantity are validated on the server.
2. Approve with a reason, wait for Fynd mock acknowledgement, book a mock pickup, then record receipt.
3. Good QC restocks once and queues the SFCC refund instruction. Bad QC adds damaged/non-sellable units, holds the refund and requires an audited ATI override before any payable reversal.
4. For two Lumera serums: gross AED 640 − vendor discount AED 64 − commission AED 184.32 = payable AED 391.68. A one-unit return instructs a customer refund of AED 288, reverses vendor payable by AED 195.84, and separately deducts an AED 20 handling charge. Remaining payable: **AED 175.84**. This is the amount for that isolated sale/return story; existing unassigned events or adjustments in the selected period change a presenter's total. Do not reset or overwrite existing records to force that number.
5. Finance & settlements → New statement → Lumera → September 2026 → Calculate → Review → Lock. Each decision needs a reason. Ledger changes require recalculation before review/lock; entries cannot be claimed by two statements.
6. Download locked CSV evidence or export to mock Finance. Simulated payout confirmation does not move money. Vendor finance viewers can read only their own statements and cannot mutate them.
7. Append corrections from the Adjustment tab. Locked periods never change; new entries are available to later statements.

Still pending in this area: linked exchange/replacement orders, QC file evidence, configurable policy/commercial editors, actual carrier/refund/Finance callback handlers, settlement disputes and advanced accounting reconciliation. Do not represent an SFCC mock acknowledgement as an actual completed customer refund.

## Tests

```sh
pnpm typecheck
pnpm lint
pnpm test
```

Integration tests require a **separate local `ecs_test` database**. They refuse any other database and truncate only test fixtures. Migrate it first:

```sh
DATABASE_URL=postgresql://ecs:ecs_local_only@127.0.0.1:5432/ecs_test pnpm db:migrate
pnpm test:integration
```

Use port 55432 for the embedded PostgreSQL setup. Vitest derives the test database from `.env` or `TEST_DATABASE_URL` and always uses `/ecs_test`.

Historical contract checkpoint (superseded by the latest counts above): 68 unit tests + 125 real-PostgreSQL integration tests (193 total), including five structural requirement-register tests which do not establish business acceptance. Coverage includes partner isolation, signed v1/legacy order and invoice intake, immutable receipt evidence, concurrent stock reservation, individual SKU pause/delist/restoration, fulfilment, returns/QC/refunds, settlement immutability, transaction reconciliation/recovery and repeatable presenter scenarios, operational analytics, SLA/exception/notification routing, one-use invitations, private evidence, RFI resubmission, commercial snapshots, territorial brand rights, CSV/XLSX ingestion, mapping/launch evidence, storefront read-back and strict operational response envelopes. Integration tests invoke the same handlers directly, so they do not establish Redis/BullMQ runtime verification. Strict TypeScript, ESLint, optimized app build, committed inbound-event schema equality and the complete OpenAPI coverage gate pass (96/96 success schemas). Outbound operation contracts, remaining callbacks, exhaustive branch conformance and automated browser-suite coverage remain pending. See the dated checkpoints for actual browser evidence and limitations.

`pnpm demo:reset` prompts before erasing the local `ecs_demo` fictional records and sessions. It is restricted to loopback and that exact database name. It cannot reset remote databases. Existing business state is never overwritten by `db:seed`.

## Remaining implementation

Use the [54-requirement evidence register](REQUIREMENTS_EVIDENCE.md) and [remaining build plan](REMAINING_BUILD_PLAN.md) as the current gap list. Major missing workflows include catalogue asset ingestion, trusted-vendor auto-approval, generated-image jobs, linked exchanges, tax/FX handling and WMS appointments/POs. Existing SLA, notifications, analytics and reconciliation are implemented locally but still partial; they are not wholly absent. Cross-cutting gaps include complete Arabic, browser automation, response/event contracts and infrastructure verification. Actual external-system connections remain separate unverified dependencies.

The checked-in schema includes future domain tables but an empty table is **not** an implemented workflow.
