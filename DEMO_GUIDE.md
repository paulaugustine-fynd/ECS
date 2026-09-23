# ATI External Concessions Demo Guide

**Superseded:** use [DEMO_WALKTHROUGH.md](DEMO_WALKTHROUGH.md) for the implemented workflows and [REQUIREMENTS_COVERAGE.md](REQUIREMENTS_COVERAGE.md) for current evidence. The original concept narrative below is retained as historical context.

## The story to tell

Bloomingdale's keeps its existing customer experience and remains merchant of record. External brands operate through a dedicated partner journey, while ATI controls approvals, product quality, inventory, orders, returns and settlements from one Fynd-powered operations layer.

This is a concept demonstration. The journeys and data are realistic, but the connectors shown are mocked until ATI and Fynd confirm APIs, ownership and configuration.

## Demo entry points

- `/public/` — persona launchpad and architecture story
- `/apply/` — Bloomingdale's UAE invitation sign-in and standalone eight-step brand application
- `/partner/` — approved vendor's Bloomingdale's-branded operational workspace
- `/ati/` — ATI marketplace command centre in Fynd's design language

All four pages share browser-local demo state. Submit in the application, approve in ATI, and the changed status appears in the partner workspace.

## Suggested 12-minute walkthrough

1. **Partner onboarding — 2 minutes**
   - Start on the persona launchpad, then open the separate Brand Application.
   - Explain that the vendor remains invisible to the end customer.
   - Move through all eight stages: business, authorization, compliance, commercials, catalogue, inventory, operations and review.
   - Point out English/Arabic readiness, document verification, catalogue validation and ATI-branded fulfilment.

2. **Submission and hand-off — 30 seconds**
   - Submit the Maison Élan application.
   - Return to the launchpad and open the separate ATI console.

3. **ATI overview — 1 minute**
   - Show pending applications, catalogue readiness and orders at SLA risk.
   - Explain that exceptions are surfaced for action rather than hidden in separate systems.

4. **Vendor and catalogue control — 1.5 minutes**
   - Open Applications, inspect the complete review drawer and approve Maison Élan.
   - Open Vendors & Brands to show pause/delist behavior: sellable inventory goes to zero while open orders continue.
   - Open Catalogue to show AI PIM validation, Arabic-content gaps, duplicate detection, trusted-vendor rules and publication via ATI ERP to SFCC.

5. **Inventory and orders — 1 minute**
   - In the Partner Workspace, show location inventory, stock buffers and sync health.
   - Accept an assigned order, then print the ATI label and dispatch it.
   - In the ATI console, explain multi-source routing and independent SLA tracking for each fulfilment leg.

6. **Returns and settlements — 1.5 minutes**
   - In the Partner Workspace, complete return QC and explain the refund/restock events.
   - Show how sales, commission, returns and chargebacks create a transparent vendor statement while ATI finance retains payout ownership.

7. **Integration boundary — 30 seconds**
   - Finish on Integrations and Audit Log.
   - Reinforce that SFCC stays customer-facing; Fynd AI PIM, Konnect and OMS provide catalogue, synchronization and orchestration; ATI ERP, WMS and finance remain systems of record where agreed.

## Positioning language

- “This is the target operating experience we can configure and integrate with ATI.”
- “The storefront remains unchanged; this platform sits behind it.”
- “Fynd handles the commerce orchestration while ATI retains the appropriate enterprise systems of record.”
- “The pilot would certify each connector and rule before production rollout.”

## Do not claim yet

- Do not call the SFCC, ERP, WMS or finance connectors live.
- Do not commit to a production SLA, residency model or delivery date.
- Do not describe tax, settlement or chargeback calculations as finalized.
- Do not imply that the demo contains real customer, vendor or transaction data.

## Best next step to request

Ask ATI for a 90-minute solution workshop covering system ownership, API availability, operating volumes, commercial rules, fulfilment paths, returns, finance reconciliation and UAE/KSA/Kuwait requirements. The output should be a row-by-row support classification and a bounded pilot scope.
