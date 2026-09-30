# Operational SLA evidence — local demonstration

## Implemented flow

`ON_TRACK → AT_RISK → BREACHED → RESOLVED` with an operator-only `WAIVED` decision.

- Confirmation begins at allocation and includes the wait for the Fynd acknowledgement. Acceptance starts pick; acknowledged picking starts pack; packed starts dispatch; ready-to-dispatch does **not** restart dispatch. Dispatch starts delivery.
- Return request starts verification; the Fynd return acknowledgement starts pickup. Logistics booking does not restart pickup. Receipt starts QC; failed QC remains under the same timer until resolved. Refund instruction starts refund acknowledgement, which ends on the SFCC mock acknowledgement.
- All status-change hooks and milestone evidence commit in the same PostgreSQL transaction. Clicking a shipment transition only queues it; it does not complete that stage's timer.
- The demo clock is authoritative. Warning is inclusive; breach is strictly after the deadline, consistent with the existing within-deadline acceptance rule. The local and BullMQ workers evaluate active records approximately every ten seconds. Advancing the clock through the presenter API also evaluates milestones in that transaction.
- A durable `Exception` row with kind `SLA` and append-only audit records are created at warning/breach. Repeated polling does not duplicate them. A late completed stage retains `breachedAt` even after resolution.
- ATI operations/admin can waive the current at-risk/breached milestone with a reason of at least ten characters and an optimistic version check. Partner users cannot waive. A waiver unblocks late confirmation, but preserves the original deadline and breach evidence and does not affect the next stage. No chargeback or external message is generated automatically.

## Demonstration defaults

| Stage | Duration | Warning before deadline |
|---|---:|---:|
| Confirmation | 60 minutes | 15 minutes |
| Pick, pack, dispatch | 120 minutes each | 30 minutes |
| Delivery | 48 hours | 4 hours |
| Return verification | 4 hours | 1 hour |
| Return pickup | 48 hours | 4 hours |
| QC | 4 hours | 1 hour |
| Refund acknowledgement | 24 hours | 2 hours |

These are fictional demo policies, not ATI or Fynd contractual commitments. ATI administrators can now revise a company/market/stage baseline with a mandatory justification and expected version. Operations and vendor fulfilment users can read the permitted market's baselines but cannot edit. Before/after values and reasons are audited. Existing timers are pinned and do not read revised durations during polling. Partner/category/fulfilment-specific overrides and maker/checker approvals are not implemented.

## UI and API

The separate shipment and return detail pages have a **Stage deadlines & exceptions** panel. Vendors see only their own entities; ATI operators can enter a waiver reason when actionable. Refresh SLA reloads persisted monitor evidence; it does not alter the demo clock.

- `GET /api/v1/slas?entityType=SHIPMENT|RETURN&entityId=...`
- `POST /api/v1/slas/:id/waive` with `{ expectedVersion, reason }`

Both use session authentication, company/market/partner scope and fulfilment permissions; waiver additionally requires operator authority and CSRF. Both success responses and requests are covered by shared schemas/OpenAPI.

### SLA workspace

`/operator/sla` and `/vendor/sla` provide separate authorized views of the same persisted evidence. The default actionable queue lists at-risk/breached milestones; filters cover market, workflow type, stage, state and partner name/entity reference. Pagination is server-side and deterministically ordered by deadline then ID. The queue links to original workflows and allows in-context evidence review/waiver for authorized operators.

Metrics are calculated over the authorized company/partner/markets **before** pagination. Market/type/stage/search filters apply to metrics; the state selector does not, so users can compare current exceptions with waived/history counts. “Ever breached” retains breaches that were later waived or resolved; “waived milestones” includes completed waived stages. These are counts of tracked milestones, not a historical SLA attainment percentage.

- `GET /api/v1/slas/queue` with `market`, `entityType`, `stage`, `status`, `q`, `page`, `limit` (maximum 100).
- `GET /api/v1/slas/policies?market=AE` returns all nine baselines, including explicit default/version-zero values.
- `POST /api/v1/slas/policies` with market, stage, expectedVersion, durationMinutes, warningMinutes and reason. Requires ATI rules authority and CSRF. Duration is 2–43,200 minutes; warning must be positive and shorter than duration. Stale concurrent edits and no-op changes are rejected.
- Admin-only local presenter controls call the existing demo-clock endpoint. The UI explicitly warns that this advances time globally, including stock freshness and brand rights, and cannot rewind. No real external delivery is performed.

## Existing-data handling

Migration 016 adds tables without resetting business data. Active records discovered after installation are marked `LEGACY_OBSERVED`. Confirmation can reuse the recorded allocation time/deadline. Other legacy stages begin when observed because their original stage-start timestamp is unavailable. Do not treat them as proof of historical compliance. Closed historical fixtures are not assigned invented timers.

The local preview retained 2 orders, 4 legs and 8 ledger entries after migration. Three active stages were discovered (Maison dispatch, Lumera confirmation, Northline confirmation). Initial panel inspection did not alter the clock. The subsequent interactive workspace walkthrough intentionally advanced the fictional global clock by 61 minutes; see the evidence below.

## Verification, 24 September 2026

Subsequent inbox checkpoint: SLA warning/breach delivery now reaches the appropriate active ATI/vendor recipients transactionally, with breach escalation to ATI super admins and deduplication that preserves read state. The suite now passes 47 unit + 77 integration tests (124 total), and OpenAPI documents 79 operations / 53 success schemas. Manual browser verification confirms that reading a Northline breach notice changes only the recipient's inbox, not the breach. See [NOTIFICATIONS_GUIDE.md](NOTIFICATIONS_GUIDE.md) for routing and remaining configurable-delivery gaps. The figures below describe the preceding SLA-only checkpoint.

- 47 unit + 72 PostgreSQL integration tests pass (119 total). Added tests cover exact boundaries, stage mapping, duplicate observations, warning/breach evidence, tenant/partner/market isolation, CSRF, forbidden vendor waivers, stale submissions, late-acceptance guard and waiver, preserved breach history, dispatch timer continuity and all reverse stages. Queue tests cover scoped pagination/metrics, forbidden filters and historic breach retention. Policy tests cover all nine defaults, numeric validation, role/CSRF restrictions, successful API response contracts, immutable existing timers, future-version application, audit values and concurrent stale writes.
- Existing acknowledgement, fulfilment and return integration scenarios continue to pass with the new transactional hooks.
- TypeScript, ESLint and optimized Next build pass. OpenAPI validates 77 requests/operations and 51 success schemas; 26 unrelated success schemas still need coverage.
- Manual browser check: historical shipment shows an explicit absence of historical SLA evidence; active Lumera shipment initially showed confirmation/on-track, pinned GST deadline and monitor-origin disclosure. Panel layout visually checked.
- Interactive browser walkthrough: saved AE confirmation policy v1 (90-minute duration, 20-minute warning). Existing Lumera/Northline deadlines stayed at 13:00 GST. Advancing the clock to 12:45 showed two at-risk milestones; advancing to 13:01 showed two breaches. Late Lumera acceptance was rejected. An audited operator waiver then allowed a queued transition, which received a successful mock Fynd acknowledgement and became ACCEPTED, with a fresh pick timer due 15:01. Database read-back retained the original 13:00 breach, waiver author/reason and completed time. Northline remains open/breached for a subsequent presenter action. Orders/legs/ledger remained 2/4/8.
- This walkthrough caught a UI refresh dependency issue: shipment acknowledgement does not increment the version again, so SLA refresh must also depend on status. The dependency was corrected for shipment and return panels. A second browser transition verified the fix: Lumera became PICKING after acknowledgement, the pick milestone resolved and pack/on-track appeared after refreshing the shipment, without separately refreshing SLA. The final queue shows one open Northline breach, one waived milestone and two ever-breached milestones. Lumera is now PICKING, ready for quantity confirmation.

## Still pending for full REQ-28 / REQ-49

Maker/checker policy approval and partner/category/fulfilment-specific overrides; a unified queue including catalogue/integration exceptions (the new queue is SLA-specific); configurable escalation recipients, notification preferences, email/digests and delivery evidence; optional chargeback candidate review; event history drill-down; an automated browser suite; live Fynd/carrier/return/refund callback verification. This feature does not establish full requirement completion or a real Fynd connection.
