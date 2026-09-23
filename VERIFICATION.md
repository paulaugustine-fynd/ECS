# Demonstration verification

22 September 2026. These results concern the local demo, not live ATI/Fynd systems.

## Automated

`node --test tests/domain.test.mjs`: **31 passing tests, zero failures**.

Coverage includes coherent relationships, gated activation, consent/documents, information-request resubmission, atomic rollback, staged publication, failed-event replay, Arabic/image/duplicate checks, trust policy, price-floor overrides, scoped pauses, reservations/oversell prevention, repeated-SKU allocation, independent splits, BOPIS, tracking requirements, retained commercial rates, resaleable/damaged/held QC, exchange allocation and price difference, return eligibility, sale/return conservation, reconciliation, role/vendor/business/market guards, deduplicated SLAs, before/after audit, stale publication responses, source-order replay, overlapping finance handoffs, review reminders and processing windows.

`node --check public/assets/domain.js` and `node --check public/assets/workflow.js`: passed.

## Browser walkthroughs completed

- All 16 operator sections rendered. No browser error logs were found in those checks.
- Return RET-101: opened case, selected Damaged, entered QC notes, completed inspection; case changed to QC complete / refund Pending.
- Generated Atelier Noura’s September statement after that return: net payable **AED 5,735**, with the return and chargeback included in the visible ledger.
- Created and saved `QA-DEMO-001`; validated saved content and submitted it for review.
- API feed simulator: source selection → mapping → one valid preview row → import → recorded draft product.
- Mixed-source order: V2-007 from ATI warehouse plus V3-014 from brand location; two independent reserved legs created. First leg progressed Accept → Pick/pack → Dispatch with AWB → Delivered; second remained New.
- Bloomingdale’s application reviewed at desktop width and 390-pixel mobile breakpoint; Arabic form switched to RTL with translated fields and steps. Temporary viewport override reset afterwards.
- Uploaded fictional `sample-bank-confirmation.txt`; file and version 1 appeared in Documents.
- Confirmed application consent and submission; operator verified three documents and approved the same vendor record.
- Opened the separate Atelier Noura partner workspace; its scoped order count included the new mixed-source order, and no browser errors were recorded.

QA used a separate `localhost` origin for later fixture work so it did not overwrite the presenter’s `127.0.0.1` data. Tests did not reset existing user demonstration records. Sample records created during browser checks may remain on the QA origin; the launchpad’s explicit Reset action is available if the presenter wants a clean seed.

## Limits of verification

- The native CSV/XLSX and ZIP paths are implemented; API-simulator mapping and local document upload were exercised in the browser. A comprehensive matrix of third-party Excel workbooks, ZIP archives and file encodings has not been certified.
- The framework entry was changed to the canonical static launchpad. A new framework dependency installation/production build was not performed; the static served application was tested directly.
- No external API, carrier, payment, tax system, authentication server, production database, concurrency load or regional compliance was tested. See `REQUIREMENTS_COVERAGE.md` and `PILOT_CONTRACTS.md`.

## Known demo simplifications

Seeded document names are metadata unless replaced by uploaded sample files. New products begin at zero stock. The creative image pane is a layout illustration, not AI output. Return cases currently cover an entire delivered leg. FX/import VAT are supplied reference metadata, not a finalized accounting engine. UTC and Saturday/Sunday business-day exclusion are explicit demo assumptions. Role selectors illustrate authorization rules but are not secure sign-in.
