# ATI demonstration implementation plan

## Goal and scope

Build an internally consistent interactive demonstration of all 54 workbook requirements, with three separate persona experiences and working local business logic. Preserve official Bloomingdale's logo/footer assets and Fynd console styling. External systems use explicit simulations. Live credentials, certified production security/scale, market tax approval and Fynd generally available capability confirmation remain pilot dependencies.

## Execution sequence

1. **Foundation:** canonical launchpad; shared domain records; stable IDs; versioned local persistence; cross-tab refresh; six vendors and representative products, locations, orders and returns; testable pure business functions.
2. **Onboarding:** English/Arabic form and saved progress; invitation/application; documents; reasoned review, information requests and resubmission; ERP acknowledgement; controlled activation from catalogue visibility, inventory readiness and test-order evidence.
3. **Catalogue:** create/edit products; CSV/Excel ingestion and preview; source-field mapping and variant parents; assets; duplicate/content/image checks; translation preview; moderation and feedback; trusted-vendor policy; ERP then SFCC publishing acknowledgements. Image-generation requirement gets an explicitly simulated preview workflow.
4. **Trading:** scoped vendor/brand/SKU pause; calculated stock with reservations and buffers; price-floor/override/promotion terms; route simulation and split legs; independent stages, real downloadable demo packing documents, tracking, BOPIS and SLA clock.
5. **After-sales/finance:** return eligibility; reverse appointments; receipt and conditional QC; restock/hold; linked exchange; refund and invoice data events; calculated ledger; statements, cycle/currency selection, chargebacks, FX variance and finance reconciliation.
6. **Operations:** persisted rules and permission profiles; event payloads/acknowledgements/failure/replay; exception assignment/resolution; audit before/after/reasons; calculated reporting, filters and downloads; operator/business/market context.
7. **Verification/handoff:** meaningful domain tests for gates, inventory, routing, QC, financial conservation, idempotency and scoping; browser walkthroughs; responsive review; updated demo guide and requirement evidence matrix with remaining production dependencies.

## Acceptance scenarios

Implementation status: the local demonstration phases are implemented. Domain checks and browser walkthroughs are recorded in `VERIFICATION.md`; the exact requirement-level limits and production backlog are in `REQUIREMENTS_COVERAGE.md`. “Implemented demo” does not mean “all workbook requirements supported in production.”

- A draft vendor cannot activate; information request and resubmission work; approval + ERP link + validated stock + published SKU + passed test order unlock activation.
- A bad import produces actionable row errors; corrected product passes moderation; staged acknowledgement controls storefront visibility.
- A paused SKU has zero sellable stock without erasing physical stock; its existing reserved orders can finish.
- A mixed-source order creates independent fulfilment legs; routing and reservation prevent overselling; a late leg creates an actionable exception.
- Return eligibility uses customer days separately from processing buffer; damaged and resaleable QC produce different inventory effects; refund acknowledgement and chargeback are traceable.
- An exchange reserves replacement stock and links the original return; a financial statement reconciles to underlying events; replay does not duplicate effects.
- Market/vendor filters and role profiles affect the same records on both portals; all mutations create audit entries.

## Scope boundary

Demonstration completion means the required behavior is executable locally or explicitly illustrated for externally dependent AI/connector features. It does not mean a certified production concession platform, live integrations, real authentication, tax advice, irreversible external messages, or a completed vendor capability questionnaire.
