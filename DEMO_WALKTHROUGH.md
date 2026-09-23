# ATI concession demo — presenter walkthrough

## Open and run

The current preview is **http://127.0.0.1:4173/index.html**. Use this origin consistently: `localhost` and `127.0.0.1` have separate browser data.

For a fresh local session, serve the `public` directory using `python3 -m http.server 4173 --bind 127.0.0.1 --directory public`. No application dependencies are required to run this static demonstration. The framework homepage now embeds the same launchpad; the obsolete combined demo redirects there.

Three distinct experiences:

- `/apply/?vendor=V1`: Bloomingdale’s eight-step brand application, English/Arabic, locally saved fields and sample documents.
- `/partner/?vendor=V1`: separate brand workspace. The demo-brand selector lets a presenter inspect established brands too.
- `/ati/`: Fynd-style operator console, with a black global rail, secondary navigation and purple action styling.

Use sample data only. Uploads and audit are browser-local, not securely stored on a server. Every external acknowledgement is simulated. No email, order, shipment, refund or payment is sent to a real account. Existing older demo storage is untouched; the new state uses `ati-concessions-v5`.

## 1. Introduce the operating model

This is a **1P external concession operation**, not a vendor-visible customer marketplace. ATI remains merchant of record. Bloomingdale’s customer storefront, customer communications and invoicing remain in SFCC. Vendors have a separate operational workspace; ATI governs approvals, fulfilment and finance exceptions.

The Fynd product mapping is proposed: AI PIM for catalogue, OMS for order orchestration and Konnect/custom adapters for synchronization. It is not evidence that the entire extension is one generally available Fynd module.

## 2. Onboard Maison Élan

1. Open the brand application. Change a company/contact field; continue and return to verify it saved. Switch to Arabic to show the RTL form and translated journey labels.
2. On Documents, upload a small **sample** bank confirmation (TXT/PDF/image, maximum 300 KB). Licence and tax documents are seeded metadata; replace them with sample files if you want downloadable evidence.
3. Review catalogue source, fulfilment model and illustrative terms. Confirm authority/accuracy on the final step and submit.
4. In ATI → Applications → Review application, inspect document versions. Request more information with a reason to show the vendor feedback/resubmission loop, or verify all three documents and approve.
5. Request ERP identity. In Integrations, acknowledge the Vendor master event. The authoritative demo ERP ID is populated only after that response.
6. Do **not** activate yet. The console should explain the missing publication, stock and test gates.

Brand invitations produce a local application URL; they do not send email. Approval is separate from activation. Brand rights can be suspended and cannot be bypassed by activation.

## 3. Publish a collection

1. Open Catalogue. The seed has 36 products across six vendors; V1’s products are drafts. V1-002 lacks Arabic content; V1-003 needs an image review.
2. Open a product and save actual corrections. Translation preview is a small dictionary-based suggestion requiring human review, not a live translation API.
3. Use Import catalogue → API simulator for a quick source → field mapping → validation → import example. CSV and XLSX uploads use the same mapping screen. Invalid rows are not imported; job history retains errors.
4. Individual images or ZIP assets can be attached. Uploaded image dimensions are checked. URL/DAM references are metadata with manual review, not live downloads from an asset service.
5. Submit, approve and publish one valid V1 product. Acknowledge Catalogue ERP, then Catalogue visible in SFCC. A separate RPM/PriceBook event chain illustrates pricing synchronization.
6. Validate inventory, run the isolated local test order, then activate V1. The local readiness test exercises reservation, stage progression and ledger posting on an isolated copy; it does not consume operational stock.

Image-generation brief includes a clearly labelled layout preview and approval. It does not create an AI on-model image. Imported/new products start with zero physical stock; adjust inventory explicitly before selling.

## 4. Fulfil a mixed-source order

1. ATI → Orders → Simulate SFCC order. Choose UAE, first product **V2-007**, second **V3-014**. Preview the ATI warehouse and brand-source allocations, then confirm.
2. Inspect the first leg. Accept → Confirm pick & pack → Dispatch with a demo AWB → Confirm delivery. The second leg remains independently actionable.
3. Download the operator-branded packing document. It is an HTML print document with a demo disclaimer, not a carrier-valid label or tax invoice.
4. Open Customer order view: product/status is visible, vendor identity is not. SFCC invoice data is queued when all legs complete; acknowledge its event to see the invoice reference.
5. Use V2-007 with the BOPIS route for a separate store scenario. Its final stages are Ready for collection → Collected.
6. Try excessive quantity, a cross-market product or a paused SKU. New allocation must fail without changing stock. Existing reserved orders may still finish after a vendor pause.

## 5. Return, inspect and exchange

- **RET-101** begins Received. Choose Resaleable to restore stock, Damaged to retain stock out of sale, or Inspection needed to hold financial processing. A reason is mandatory.
- **RET-102** begins Requested: book pickup → collection → receipt → QC. Reverse-label download is demonstrative.
- For an exchange, create a case against delivered **ORD-102 / LEG-3**, choose a replacement published SKU, advance to receipt and complete QC. Inspect the linked replacement order, reservation and amount difference.
- Refund acknowledgement is separate from QC completion. Inspect and acknowledge the SFCC refund/credit-note data event.
- The return ledger reverses the original sale’s commission rate, not a subsequently edited commercial rate. A chargeback is included in the calculated net.

Customer eligibility and extra operational processing time are separate rules. The seven-day demo processing buffer is an assumption, not a workbook-prescribed fixed value. Partial-unit returns, payment top-up for exchange differences and physical carrier exceptions need pilot expansion.

## 6. Settle and control the operation

1. Generate a September statement for Atelier Noura. All totals come from actual local sale/return events.
2. Reconcile with a mismatching finance total to create Variance. Reconcile to the correct total with a reason, send to ATI finance and acknowledge the finance event.
3. Export the real statement CSV. Overlapping statements cannot hand off the same ledger events twice. Disbursement remains with ATI finance.
4. Try a connection outage and replay. Inspect event payloads, errors, attempts and idempotent acknowledgement. An edited product invalidates stale publication responses.
5. Change routing/SLA/trusted-vendor rules. Advance the demo clock in Exceptions and assign/resolve a breach. Business-days mode excludes Saturday/Sunday in UTC as a **demo assumption**, not a GCC holiday calendar.
6. Switch market, role and business. Finance and Viewer have restricted mutations; Vendor is scoped to its brand. These are demonstration permission profiles, not secure authentication.
7. Reporting derives metrics and supports date/market filtering, CSV and shareable HTML export. Audit shows actor, reason and before/after values without the old 20-event cap.

## Handoff and limits

See `REQUIREMENTS_COVERAGE.md` for all 54 rows and `PILOT_CONTRACTS.md` for the production handoff plan. The original workbook is unchanged and its vendor response columns remain unfilled. Do not present this demo as a certified product-support response.

Automated verification: `npm test` or `node --test tests/domain.test.mjs`. The static demo path was tested directly; a fresh framework dependency installation/build is not claimed.
