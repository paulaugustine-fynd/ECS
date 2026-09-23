# ATI External Concessions requirements audit

Reviewed 22 September 2026. Scope: the supplied workbook, the current local application source, and targeted browser checks of the separate vendor and ATI workspaces. This review does not change the application or source workbook.

## Verdict

The demo has the right broad operating model and separate user experiences, but it does not yet fulfil the workbook end to end. Many capabilities exist only as labels, sample tables, or success messages. Some important actions are broken, and activation bypasses the prerequisites specifically required by ATI.

The workbook contains 54 requirements: 52 Must Haves and two Should Haves (17: image generation; 54: future extensibility). All support/delivery/response/dependency cells in `Vendor Response!E5:H58` are blank. It is a requirements questionnaire, not an approved Fynd capability response. Its `Response Instructions!B3` asks about generally available product capability; that instruction explains the questionnaire but does not authorize submitting or modifying it.

There are three different questions: whether the demo illustrates a requirement, whether the demo implements its behavior, and whether Fynd's generally available products plus agreed integrations can deliver it. This audit answers the first two. Product owners must confirm the third before completing the formal response. Missing demo behavior does not establish that Fynd lacks the corresponding capability.

## What already exists

- Separate `/apply/`, `/partner/`, and `/ati/` experiences, with Bloomingdale's styling for vendors and Fynd styling for operators.
- An eight-step application journey, submission status, operator review drawer, approval and request-information status changes.
- A unified vendor workspace and 13 operator sections spanning applications, vendors, catalogue, inventory, orders, returns, commercials, settlement, rules, integrations, reporting and audit.
- Limited browser-local changes for vendor status, aggregate inventory, catalogue counters, order acceptance/dispatch, statement status and event history.
- Architecture copy that broadly preserves ATI as merchant of record, the ERP as vendor master, SFCC as customer commerce/invoicing, and finance as payout owner.

These are useful foundations. They are not proof of complete integrations or operational workflows.

## Findings to fix before presenting

| Priority | Finding | Evidence | Required correction |
|---|---|---|---|
| First | Two entry experiences remain. The framework homepage embeds the older combined onboarding/admin demo. | `app/page.tsx:4` points to `/demo.html`; `public/demo.html:11` contains a persona switch on one page. The static server instead exposes the new launchpad. | Use one canonical entry route for all launch/deployment methods; retain separate application, vendor and operator routes. |
| First | Vendor activation bypasses approvals and launch readiness. | `public/assets/core.js:87` sets Active and restores 184 units unconditionally. No test-order result or storefront acknowledgement exists in state. | Block activation until each required gate has evidence; show the unresolved gate and next action. Requirement 19. |
| First | Form changes are not saved. | `core.js:23–33` renders fixed inputs and saves step/status, not their values. Sign-in at lines 39–40 does not check credentials. | Persist entered company, brand, market, documents and selections; validate required fields and consent. Use clearly scoped demo access, then real identity for a pilot. Requirement 2. |
| First | Return QC cannot complete through the normal flow. | `core.js:65` binds Complete QC before the modal exists. Browser inspection confirmed no click handler on Complete QC or the Damaged choice. | Bind after opening; store selected outcome, notes and evidence; branch into resaleable, damaged and further-inspection outcomes. Requirements 29/31/34. |
| First | Key visible buttons have no implementation. | Browser inspection confirmed no handler on Add product and both ATI Inspect buttons. `core.js:56,65,77,88` corroborate it. | Implement product detail/edit and order detail; connect every visible primary action to a real demo result. |
| First | Vendor ownership differs across screens. | `core.js:58,64` assigns ECP-785198 to Maison Élan; line 77 assigns it to Atelier Noura. RTN-10422 also appears in Maison Élan's workspace while ATI lists Atelier Noura. | Use one shared record model, with stable vendor, order, line, fulfilment-leg and return IDs; scope each portal by vendor. |
| First | Publication is declared too early. | ATI approval changes a published counter (`core.js:88`); the partner page immediately interprets it as Published (line 56). | Separate Approved, Sent to ERP, Accepted by ERP, Sent to SFCC, Visible in SFCC, and Failed. Gate activation on confirmed visibility. Requirements 18/19. |
| Next | Pause zeroes only the aggregate total. | `core.js:87` changes `inventory.units`; SKU-location rows in lines 57/76 remain hardcoded and positive. Reactivation hardcodes 184. | Set sellable availability to zero for the correct vendor/brand/SKU scope, preserve physical stock and open-order reservations, and recompute on resumption. Requirements 5/6/20/21. |
| Next | Resolve changes counters without resolving product issues. | `core.js:65` increments ready/decrements issues while product rows and error descriptions remain fixed. | Store per-product validation results and actual corrections. Revalidate and update the moderation queue. Requirements 12–16. |
| Next | Rules are visual toggles only. | `core.js:88` toggles CSS and emits a toast; no persisted rule or audit event is saved. | Persist rule scope, values, effective dates and versions; demonstrate how a changed rule affects a transaction. Requirements 7/8/15/21/23/30/50. |
| Next | Integration statuses and exports are misleading as proof. | `core.js:12,60,82,88` has toast messages and fixed connection cards, without connector calls or generated files. | Label simulated services; show event payload, acknowledgement, failure and retry. Generate real local demo CSV/PDF/label artifacts where offered. |
| Next | Audit is not immutable and omits important decisions. | `core.js:6` keeps only 20 localStorage entries; line 84 uses generic actors and fixed entities. Pause reason is never read. | Record actor, full timestamp, entity, before/after values, reason and correlation ID for all decisions. Production needs durable server-side audit storage and permissions. |

Source line references describe this audit snapshot. The code is densely formatted, so some cited lines contain entire functions.

## Row-by-row coverage

The worksheet row is requirement ID + 4. For example, requirement 19 is `Vendor Response!A23:H23`. Statuses below describe this demo, not contractual product support:

- **Partial:** some relevant interaction or structure exists; important parts remain.
- **Display:** wording, sample rows or controls exist, without the required operating behavior.
- **Broken:** a central path is missing its handler or contradicts the required control.
- **Missing:** no meaningful dedicated implementation was found.

No row should be marked Fully Supported in the vendor response solely on the basis of this prototype. A percentage based on pages or labels would overstate completion.

| ID | Requirement | Demo status | Evidence and remaining work |
|---|---|---|---|
| 1 | 1P concession operating model | Partial | Separate branded portals and correct merchant-of-record narrative. Demonstrate an operator-branded customer order, invoice and multi-source fulfilment with no vendor exposure. |
| 2 | Bilingual onboarding | Partial | Eight-step journey, submit, approve and information-request status exist. Missing Arabic/RTL, saved form values, document storage, real invitations, validation, rejection reasons, reminders and a coherent resubmission loop. |
| 3 | ERP vendor master | Display | Copy states ERP ownership; vendor ID is a fixed string after approval. Add ERP matching/create-request, response ID, status and failure/retry. |
| 4 | Vendor administration | Partial | One vendor modal and document tables exist. Add document detail/version review, scoped roles/permissions, saved reasons and controls for all records. |
| 5 | Brand authorization and vendor/brand pause/delist | Partial | Vendor pause changes an aggregate stock total. No brand authorization matrix, suspension/delisting lifecycle or SKU-level propagation. Keep open orders progressing. |
| 6 | Individual SKU pause/delist | Missing | No per-item pause/delist action. Add scope, reason, sellable-stock zeroing, publication acknowledgement and open-order preservation. |
| 7 | Commercial terms | Display | Fixed term rows, nonfunctional Edit, and Add term toast. Add scoped rate/cadence editors with dates, precedence and versioned application to transactions. |
| 8 | Pricing, discounts and promotions | Display | MAP/override toggles and a fixed promotional deduction. Add actual price-floor validation, authorized overrides, thresholds, discount rules and promotion-funder accounting. |
| 9 | SKU creation/edit, bulk templates and APIs | Broken | Add product and product Open have no handlers; bulk/template buttons show messages. Implement product editor, import preview, row errors, downloadable template and API simulation. |
| 10 | CSV/Excel, API, SFTP and platform connectors | Display | Method choices in onboarding do not configure or ingest anything. Demonstrate import methods, job status, schema mapping and supported-connector dependencies. |
| 11 | Image URLs, uploads, ZIP, DAM | Display | Image-source selector only. Add local upload/URL examples, source tracking, asset validation and an asset review gallery. |
| 12 | Taxonomy/attribute/variant mapping | Display | A fixed “24/24 mapped” result and variant counts. Add source-to-target mapping, required attributes and parent/colour/size grouping. |
| 13 | Duplicate detection | Display | A static duplicate badge; Resolve only changes totals. Add comparison, detection rule, retain/link/reject decision and an updated product record. |
| 14 | Quality validation and moderation | Partial | Approve and bulk approve change a global counter. Add item-level checks, image/content results, selected-row bulk actions, rejection feedback and vendor resubmission. |
| 15 | Trusted vendor auto-approval | Display | Static policy toggles. Add persistent thresholds, trusted-vendor scope, an evaluation result and manual-review fallback. |
| 16 | EN/AR content and translation | Display | AR-missing badges and text references. Add bilingual fields, translation preview, review and validation results. |
| 17 | On-model/lifestyle image generation — Should Have | Display | A selector requests imagery but generates nothing. Add a labelled before/after example and approval path; connect a service later if in scope. |
| 18 | Publish through ERP to commerce | Partial | Approval updates a Published counter; no ERP/SFCC exchange or marketplace metadata. Add staged publishing, IDs, required attributes and acknowledgements. |
| 19 | Controlled activation | Broken | Activate ignores catalogue approval, storefront visibility and successful test orders. Implement a gate checklist driven by evidence and a test-order runner. |
| 20 | Inventory by SKU/location | Display | Fixed rows and an aggregate total; reconcile only saves a message/status. Add stock events, quantities, timestamps, source versions and recomputed availability. |
| 21 | Thresholds and oversell prevention | Display | Buffer columns and threshold labels. Add SKU/location/tag rules and reservation behavior; test that a second order cannot consume unavailable stock. |
| 22 | Commerce order events into OMS | Display | Order lists and architecture text. Add event ingestion simulation and a normalized OMS order with duplicate-event protection. |
| 23 | Ownership/rule-based routing | Display | Fixed route labels and nonfunctional Edit. Add a rule editor and decision trace for brand-, warehouse-, store-first and fallback routing. |
| 24 | Independent split fulfilment legs | Partial | Two example legs appear, but only one mutable order status exists for the split order and Inspect is unbound. Add leg IDs, independent quantities/statuses/SLAs and parent-order rollup. |
| 25 | Vendor order operations | Partial | Accept and Dispatch update local status. Missing distinct pick/pack, document files, tracking entry, carrier handover, delivery and exception handling. |
| 26 | Operator-branded fulfilment | Display | ATI-branded instructions and print-label toast. Generate an operator-branded label/packing document and show designated carrier processing. |
| 27 | Brand, warehouse and store/BOPIS models | Display | Onboarding choices and sample warehouse leg. Add three executable scenarios including collection readiness and pickup completion. |
| 28 | Stage SLAs and escalation | Display | Fixed countdowns, rates and escalation message. Add configurable stage timers, business calendars, breach events, owner and escalation progression. |
| 29 | End-to-end returns | Broken | Static return rows/timeline with a QC modal that cannot complete. Add customer event, eligibility, pickup, receipt, QC, disposition and refund acknowledgement. |
| 30 | Brand-specific return windows | Display | Fixed 30 days + 7 operational days. Sheet specifies 30 days plus an operator-defined additional window, not necessarily seven. Add configurable brand rules and separate eligibility/processing deadlines. |
| 31 | QC, restock and overrides | Broken | QC outcome buttons and Complete QC are unbound in the normal flow. Add persisted condition, disposition, override reason, stock effect and separate failed-QC path. |
| 32 | Reverse logistics | Display | Pickup/label text and Create return toast. Add pickup appointment, carrier selection, label, collection status and failed-pickup handling. |
| 33 | Exchanges | Missing | Appears in titles but there is no exchange workflow or defined integration approach. Link original return, replacement reservation/order, any amount difference and final statuses. |
| 34 | Refund and credit-note integration | Display | Text says refund is sent; no event or acknowledgement. Add QC-triggered refund request to SFCC/payment flow and vendor credit-note data, with correlation IDs and retry. |
| 35 | Chargebacks in next statement | Display | Fixed deduction row is unrelated to QC outcomes or terms. Add chargeback rules and dated financial events allocated to the correct settlement cycle. |
| 36 | Per-order financial events | Display | Financial field list and illustrative statement rows. Add an event ledger tied to order lines, rule version, currency, tax, shipping, promotion funding and net payable. |
| 37 | Vendor settlement statements | Partial | Statement view and Generated status exist, but amounts are fixed and downloads do not generate files. Calculate from the ledger, reconcile, show period selection and export actual demo artifacts. |
| 38 | Settlement timing/currency and finance handoff | Display | Correct payout ownership text; no schedule or finance acknowledgement. Add period/currency configuration, finance payload, accepted/rejected state and reconciliation. |
| 39 | Tax, import VAT, currency and FX | Display | AED/SAR and “FX exception” labels only. Add explicit transaction fields, currency precision, exchange-rate source/date and a variance example using ATI-approved rules. |
| 40 | SFCC invoice data integration | Missing | No invoice event/data workflow. Show OMS supplying operator-branded invoice data and SFCC returning the invoice reference; leave invoice generation in SFCC. |
| 41 | Transaction reconciliation | Display | “Matched” and “Reconciled” labels are hardcoded. Add OMS-vs-finance/vendor comparison, line differences, resolution reasons and actual exports. |
| 42 | Dashboards and shareable reporting | Display | Fixed KPI cards/charts. Add derived metrics, working vendor/market/date filters, drilldowns, report export and agreed sharing controls. |
| 43 | Unified vendor portal | Partial | Required areas exist on a separate route. Complete the underlying actions, vendor scoping, lifecycle-based access and consistent shared records. |
| 44 | Central operator console | Partial | Required topic areas and navigation exist. Commercial/pricing edits, item suspension and exception resolution are incomplete. |
| 45 | Bidirectional SFCC integration | Display | Static SFCC connection card. Add contracts and simulated request/response for products, PriceBooks, stock, orders and status; verify live behavior in an agreed sandbox later. |
| 46 | Enterprise integration incl. pricing/RPM | Display | ERP/PIM/WMS/finance named; no working connectors and no explicit RPM workflow. Add ownership and integration contracts for each object and system. |
| 47 | WMS appointments and PO creation | Display | WMS card mentions appointments/POs; no booking or PO objects. Add inbound delivery appointment, return-collection appointment, PO and acknowledgement scenarios. |
| 48 | Secure scalable APIs/events | Missing | Current demo has no application API/event infrastructure or authenticated operational backend. Design authenticated APIs, durable event delivery, idempotency, retries and monitoring; validate load in a pilot. |
| 49 | Notifications and exceptions | Display | Fixed alerts; Mark all read and escalations show messages only. Add configurable recipients, queues, assignment, SLA escalation and resolution; leave customer communications in SFCC. |
| 50 | Marketplace rule configuration | Display | Toggles reset on render and edits do not affect operations. Add versioned rules, scope, precedence, preview and persisted outcomes. |
| 51 | Audit trails | Partial | Some actions produce browser-local messages capped at 20. Missing identities, full dates, reason, before/after values and complete coverage. Add durable, permissioned server audit for production. |
| 52 | Standalone plug-in platform | Partial | Separate UI routes, but no plug-in API contract, operational database or deployment validation. `db/schema.ts` is empty; Worker is framework scaffolding. |
| 53 | UAE/KSA/Kuwait and scale | Display | Market/currency labels do not change logic or partition records. Add market configuration, country-specific workflows and representative multi-market scenarios; certify capacity separately. |
| 54 | Additional businesses/range extension — Should Have | Missing | Hardcoded ATI/Maison Élan context. Add operator/business/channel/market configuration and demonstrate reusing the workflow for a second business. |

## Correct target workflow

The overall direction is correct: a 1P external concession platform behind ATI's existing storefront. The sheet does not require an open consumer marketplace where vendors become visible sellers. Preserve the customer storefront and make the operational handoffs explicit.

### Onboarding and activation

1. ATI invites a vendor, or receives an application; vendor selects English/Arabic and saves business, brand, market and compliance details.
2. ATI reviews the application. Request-information creates a specific task and due date; vendor corrects/resubmits. Rejection stores and communicates a reason. Approval authorizes preparation, with the vendor still inactive for selling.
3. Match or request the vendor record in ATI ERP and retain its authoritative ID. The precise timing and any commercial/compliance sub-approvals require agreement with ATI.
4. Vendor imports products and assets, maps taxonomy/variants, resolves duplicates and content/image errors, and obtains ATI catalogue approval. Sample catalogue preparation can begin during application review; a long initial application should not require full production setup before a commercial decision.
5. Publish approved products through ATI ERP into SFCC with the required metadata. Show separate transmission and acceptance states and verify storefront visibility.
6. Validate stock/location mappings and fulfilment configuration. Run required test orders and record pass/fail evidence.
7. Activate only when requirement 19's gates pass: catalogue approval, approved SKUs visible in the storefront and required test orders passed. Additional finance/compliance/inventory gates should be labelled as agreed operating controls, not extra requirements invented from this sheet.

One detail needs ATI confirmation: how pre-live storefront visibility and test orders are isolated from normal customer sale. Use an agreed preview/test context or controlled availability; a published flag alone does not answer this.

### Order fulfilment

Customer places order in SFCC → order event enters Fynd OMS → ownership/routing rules choose source → stock is reserved and separate fulfilment legs are created → vendor/store/WMS accepts, picks and packs → ATI-branded documents and carrier handover → tracking/delivery status returns to OMS and SFCC.

Each leg has its own state and timers. SFCC retains customer communications and invoice generation; OMS supplies the required operational/invoice data. Demonstrate brand-first, warehouse-first and store/BOPIS examples, including unavailable-stock fallback and one late leg.

### Returns, exchanges and finance

SFCC return event → evaluate brand policy/customer eligibility → reverse pickup/label → receipt → QC and disposition → restock or hold with a recorded reason → refund request to SFCC/payment flow and vendor credit-note/chargeback events → next applicable statement → finance acknowledgement/reconciliation.

Distinguish a sent refund request from a confirmed refund. An operational processing window must not silently extend customer eligibility. Exchanges need a linked replacement flow and inventory reservation, with the commercial treatment explicitly defined.

Financial records should originate from the same order/return events. Apply configured commission and promotion-funding terms, show tax/currency fields, calculate net payable, and pass the statement/events to ATI finance. Disbursement stays outside the platform. ATI must confirm tax, commission basis and FX rules; the illustrative numbers currently shown are not a validated settlement model.

## How to improve the demo

### Pass 1 — make the existing story reliable

Repair the launch entry, saved inputs, QC, product creation/detail, order inspection, rejection/resubmission and activation checks. Replace hardcoded duplicate records with shared vendor/product/location/order/leg/return objects. Derive screen counts and statuses from those records. Make pause/resume update the affected stock rows and save rule changes/reasons.

Acceptance: change one vendor field and see it in ATI review; request information and resubmit; fail one activation gate and see activation blocked; resolve it and activate; pause one SKU while its existing order still completes.

### Pass 2 — demonstrate the requirements through six connected scenarios

1. **New brand:** invitation → EN/AR application → missing document → request information → resubmission → approval → ERP ID → activation checks.
2. **Catalogue:** import a mixed-quality file → map variants → resolve duplicate → correct Arabic/image issue → moderate → ERP/SFCC publishing → visible acknowledgement.
3. **Orders:** mixed vendor/warehouse order → reserve stock → split → pick/pack → actual demo label → dispatch/tracking → independent SLA breach and resolution; include a separate BOPIS case.
4. **Control:** price-floor violation → authorized override → promotion-funding term → SKU pause/delist → zero sellable stock, with open orders retained and a traceable decision.
5. **Returns/exchanges:** eligible and ineligible cases → pickup → resaleable/damaged QC → different stock/chargeback outcomes → refund acknowledgement; include linked size exchange.
6. **Finance/integration:** trace those sales/returns into one calculated statement → show FX or funding variance → resolve → finance handoff; fail and replay one integration event without duplicating a business action.

A suggested seed set is 6 vendors, 30–50 products with variants, 6 locations across the three markets, 15–20 orders, and 6 returns/exchanges. These are proposed presentation choices, not workbook requirements. Relationships and consistent outcomes matter more than large headline totals. Keep the protagonist inactive during onboarding and use established vendors for historical trading data.

### Pass 3 — align the navigation and explanations with ATI work

- Organize the operator workspace around Onboarding, Catalogue & pricing, Inventory, Orders & fulfilment, Returns & exchanges, Finance, Integrations, Rules & access, and Audit. Retain the Fynd shell but remove irrelevant/dead links from the concession demo.
- Give each vendor/product/order a detail page with status, owner, next action, linked records and history. Make searches and filters operate on the data.
- Make an exception queue actionable: owner, severity, deadline, root cause, retry/resolve and audit entry.
- Show one context for business/market/brand and apply it consistently. Add an actual Arabic experience with RTL form layout.
- Keep technical payloads in integration details and presenter tools. Operators should see readable states such as “Awaiting ERP confirmation,” not raw infrastructure details by default.
- Display simulated integration status accurately. A local simulator is sufficient for a demo if its events, errors and consequences are real within the simulation.
- Add a presenter guide that links each scenario to the workbook IDs and states what is live, simulated and still subject to product confirmation.

### Pilot work after demo acceptance

Confirm the support/delivery classification with Fynd product owners, then integrate agreed sandboxes. Replace local-only state with authenticated, vendor-scoped backend records; implement the event contracts, file/document storage, permissions, durable audit and operational monitoring. Test market requirements and agreed volumes. The existing tests check the old starter skeleton, not the concession workflows.

For each connector define source/target, object and schema, authoritative system, authentication, trigger, acknowledgement, retry/idempotency, reconciliation and owner. Priority contracts: ERP vendor identity; product publication via ERP to SFCC; PriceBook/RPM; inventory; SFCC order/status; WMS appointments/POs; reverse logistics; refund/invoice data; finance events and statements.

## Fynd solution direction

The proposed division remains AI PIM for catalogue work, OMS for order/fulfilment orchestration, and Konnect/custom APIs for system synchronization. A concession-specific portal, approval controls and finance/event extensions need explicit scoping. This is a proposed architecture, not a claim that a single out-of-the-box marketplace module meets all 54 rows.

Official pages checked during this audit describe [AI PIM](https://www.fynd.com/solutions/ai-product-information-management), [OMS](https://www.fynd.com/solutions/order-management-software), and [Konnect](https://www.fynd.com/solutions/marketplace-integration-software) in these broad areas. They do not certify the bespoke ATI workflow or the local demo. The [infrastructure page](https://www.fynd.com/infrastructure) describes platform reliability; it does not establish that these requirements have been implemented.

## Verification and source locations

- All 54 requirements and priorities read from `/Users/paulaugustine/Documents/Dump/ATI - External Concessions Platform Requirementsxlsx.xlsx`, `Vendor Response!A5:H58`; supporting instructions and summary formulas also inspected. Workbook unchanged.
- Main workflow implementation: `/Users/paulaugustine/Documents/Al Tayer/public/assets/core.js`.
- Entry mismatch: `/Users/paulaugustine/Documents/Al Tayer/app/page.tsx`, `/public/demo.html`, `/public/demo.js` versus `/public/index.html` and the separate routes.
- Backend/database evidence: `/Users/paulaugustine/Documents/Al Tayer/worker/index.ts`, `/db/schema.ts`, `/app/chatgpt-auth.ts`. Optional auth scaffolding is present; it does not implement authentication/authorization for the static operational pages.
- Browser checks: vendor catalogue Add product handler absent; return modal opens but QC outcome/Complete QC handlers absent; ATI order Inspect handlers absent; operator order ownership corroborates source discrepancy. No application records were changed for this audit.
- Code inspection establishes the remaining findings; no live Fynd, SFCC, ERP, WMS, finance, Arabic, capacity or production certification test was performed.

Recommended next work: Pass 1, followed by the six connected scenarios in Pass 2. This will make the demo credible against ATI's sheet before further visual polish or live connector work.
