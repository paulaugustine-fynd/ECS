# Operational reporting — REQ-42 checkpoint

Routes: `/operator/analytics` and `/vendor/analytics`. This is a PostgreSQL-backed local report, not a live Fynd dashboard or a financial reconciliation statement.

## Demonstration

1. Sign in as ATI admin or operations and open Analytics. Dates default to the business-clock month through the following UTC day (exclusive).
2. Apply a vendor, canonical brand ID, market and date range. Only membership-authorized markets are selectable. The preserved ATI persona currently has AE membership; SA/KW scoping and currency formatting are tested in isolated fixtures, not evidence of complete seeded market journeys.
3. Click a vendor or brand ranking row to narrow the current report. Draft filter changes do not silently change the displayed report or export.
4. Open an active SLA breach to the corresponding shipment. This is read-only navigation, not a claim, waiver or resolution.
5. Export CSV using the last applied filters. The server recalculates at download time; workflow activity since the screen loaded can change the result. The export includes filter/time/currency metadata and metric definitions.
6. Use vendor admin/finance accounts to demonstrate own-partner reporting. Finance viewers cannot drill into operational shipment details. Empty cohorts show unmeasured rates rather than fabricated zeros.

## Metric contract

| Metric | Definition |
| --- | --- |
| Cohort | Parent order created at or after `from` UTC midnight, before `to` UTC midnight; current outcomes of authorized shipment lines in those orders. Maximum 366 days. |
| GMV | Captured line quantity × unit gross, excluding cancelled legs. Not current product price or whole-order total. |
| Delivered net sales | Captured net values of delivered lines, after captured discounts and before return refunds. Not vendor payable, accounting revenue recognition or settlement value. |
| Orders / shipment legs | Distinct scoped parent orders / scoped legs; cancelled legs included. Distinct counts can overlap across vendor or brand rows. |
| Fulfilment rate | Delivered legs / all scoped legs, including cancelled legs. This is a snapshot outcome rate, not on-time delivery rate. |
| Received return rate | Physically received units in RECEIVED, QC_FAILED, REFUND_PENDING or CLOSED / delivered units in the order cohort. Requested and approved returns do not count. |
| SLA compliance | On-time completed EVENT-origin milestones / completed EVENT-origin milestones on non-cancelled legs, excluding waivers. A retained breach makes a completion late. Open timers are not in the denominator. Legacy and waived counts remain visible separately. |
| Active breaches | Current stored BREACHED shipment milestones without completion, within the order cohort. Reflects the last monitor evaluation; reading does not trigger monitoring or alter workflow state. |
| Inventory sync freshness | Current inventory positions in selected market/vendor/brand, independent of order dates. Successful current-revision mock Fynd acknowledgement within 15 wall-clock minutes is fresh. Null acknowledgement is pending; older/future timestamps are stale or anomalous. Not source-feed freshness or real Fynd evidence. |

Brands use current canonical product attribution, not a historical brand snapshot. One market/currency per report; mismatched order currency, invalid line snapshots and unavailable product ownership fail closed. Zero denominators yield `null` / “Not measured”.

## Access, API and bounds

- Roles: ATI super admin, operations manager, finance analyst, auditor; vendor admin and finance viewer. No new fulfilment or commercial write permissions are granted.
- All three endpoints enforce session, role, company, market and vendor scope server-side: `GET /api/v1/analytics/metadata`, `/analytics/performance`, `/analytics/export`.
- Query: `market`, `from`, `to`, optional `partnerId` and `brand`. Metadata requires only market. Unknown fields and invalid calendar/date ranges are rejected.
- Serialized metadata/report DTOs have strict shared response schemas and OpenAPI definitions. CSV cells quote delimiters and escape formula-leading values.
- Totals are never silently truncated: over 5,000 legs, 10,000 products/inventory positions, 20,000 return cases or 50,000 milestones rejects the report. Metadata caps 2,000 partners / 10,000 products. Up to 50 oldest active breach detail links are explicitly shown, with the full aggregate count retained.
- Read-only serializable transaction provides one internally consistent report. No financial, outbox, audit, shipment or exception mutation is performed by reporting.

## Verification, 25 September 2026

- 49 unit + 95 isolated PostgreSQL integration tests pass (144 total); TypeScript, ESLint and optimized build pass. Analytics adds two unit and five integration tests, including exact decimal totals, captured-price rather than current-price calculation, mixed-partner isolation, currency/date/brand filters, request-vs-received returns, cancelled/legacy/waived SLA exclusions, malformed data, permissions, CSV safety and strict API response conformance.
- Browser: ATI aggregate AED 3,370 GMV, AED 576 delivered net sales, 2 orders / 4 legs. Lumera filter: AED 1,280, 2 orders / 2 legs. Northline brand filter: AED 240, 1 leg, 1 active confirmation breach. Breach link opens the correct assigned shipment with retained breach evidence. No waiver, claim or shipment change was made.
- OpenAPI: 89 operations; 63 documented success responses; 26 other response schemas remain pending. No migration, demo reset, deployment or live Fynd request.
- Preserved-demo read-back after UI checks: 2 orders, 4 shipments, 8 financial events, zero shipment issues and zero exception-command audits. Northline exception remains OPEN, unassigned, version 1, with no resolution time.

## Still pending

REQ-42 is advanced, not fully accepted. Public/private share links, saved dashboards, scheduled/background report jobs, complete Arabic labels, historical brand attribution, returns-stage SLA analytics, broader exception categories, scalable database aggregation and live Fynd analytics ingestion remain pending. CSV is the implemented sharing mechanism. REQ-41 cross-system transaction reconciliation is a separate unfinished requirement. The full 54-requirement goal remains active.
