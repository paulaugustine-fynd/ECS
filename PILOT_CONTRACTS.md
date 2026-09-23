# Proposed ATI/Fynd pilot handoff

This is a design for review, not a live connector specification or commitment about Fynd generally available APIs.

## System ownership and interfaces

| Flow | Source → target | Proposed object/method | Authority / owner | Proof required |
|---|---|---|---|---|
| Vendor identity | Concession extension → ATI ERP → extension | Match/create request + authoritative ID response; API or approved batch | ATI ERP master-data team | Existing vendor match, duplicate rejection, failed/retried create |
| Catalogue | Brand → AI PIM/extension → ATI ERP → SFCC | CSV/XLSX/API ingestion; approved revision event | ATI taxonomy/catalogue governance; Fynd PIM/adapter owners | Bad row handling, variant mapping, actual SFCC visibility |
| Pricing | ATI commercial policy/RPM → integration → SFCC PriceBooks | Approved list/sale price, currency, dates, revision | ATI pricing/RPM owner | Effective dates, override approval, mismatch reconciliation |
| Inventory | Brand/WMS/store → OMS/integration → SFCC | Versioned SKU-location stock event | Agreed physical inventory authority; OMS reservation owner | Duplicate/out-of-order update, pause zeroing, oversell test |
| Orders | SFCC → integration → OMS | Signed webhook; order and line IDs, payment state | SFCC owns customer order; OMS owns fulfilment plan | Duplicate delivery, split legs, reservation rollback |
| Fulfilment | OMS → vendor/WMS/store/carrier → SFCC | Commands/status events, AWB, label reference | Fynd OMS + ATI operations; external execution owners | Brand/warehouse/BOPIS; carrier timeout; independent SLAs |
| Returns | SFCC → OMS/reverse carrier → QC → SFCC/payment | Return eligibility, appointment, QC, refund/credit event | ATI return policy; payment system owns actual refund | Damaged/inspection/exchange, retry without duplicate refund |
| Finance | OMS financial events → ATI ERP/finance | Immutable line ledger, statement, reconciliation acknowledgement | ATI finance owns accounting/disbursement | Commission basis, promotion funding, tax/shipping/FX, disputed variance |
| WMS appointments | Extension → ATI WMS → extension | PO lines, location, movement, requested slot/confirmation | ATI WMS team | Slot unavailable, reschedule, inbound vs return pickup |

## Common contract controls

- Authentication: server-side OAuth/service identity or ATI-approved mTLS; no credentials in browser storage. Exact scheme subject to each product API.
- Authorization: tenant/business/market/vendor scope derived from identity, not a client selector. Separate operator, finance and vendor actions.
- Envelope: event ID, correlation ID, idempotency key, entity ID, source revision, schema version, occurred/received timestamp, business and market.
- Delivery: durable transaction/outbox, at-least-once transport, idempotent consumers, bounded retries/backoff and dead-letter queues. No silent overwrites from stale revisions.
- Reconciliation: periodic source/target totals and record comparisons, exception owner, resolution evidence and audited replay. Replaying must not duplicate order reservations, refunds or payable handoffs.
- Audit/privacy: immutable server audit; encryption, document malware checks, signed asset links, retention/deletion policy and approved regional hosting. Use only synthetic data until approved.
- Operations: dashboards/alerts, rate limits, observability, support responsibility, backup/restore and failure rehearsal.

## Bounded pilot acceptance

One UAE concession, synthetic products/orders, one approved ATI ERP/SFCC sandbox path, representative brand and warehouse fulfilment, one BOPIS case if available, one resaleable and one damaged return, one exchange, and one finance statement.

Acceptance must measure actual operational outcomes: no duplicate order/refund effects on replay; no oversell under agreed concurrency; publication visible in the real test storefront; correct stock disposition; reconciled financial events and zero unexplained statement variance. SLA/volume targets must come from ATI baselines; none are invented here.

Required ATI decisions: source-of-truth ownership, API/schema access, return rules and additional processing window, commission/promotion/tax/shipping basis, settlement calendar/currencies, country policy, peak volumes, security/residency and operating/support ownership. Fynd product owners must classify each workbook row as out-of-box, configuration, extension/integration, roadmap (non-committed), unsupported or needs discovery with current evidence.

No external accounts were created or connected by this implementation. Connecting a pilot is a new authorized phase, not an implied consequence of showing this local demo.
