# Exception centre — local workflow checkpoint

The operator and vendor portals now have separate `/operator/exceptions` and `/vendor/exceptions` pages, plus record detail pages. They consolidate five implemented issue types: SLA, catalogue review, outbound integration dead letters, inbound processing dead letters and reported shipment investigations. This advances REQ-49; it does not complete all notifications/escalations or every operational exception requirement.

## Ownership and visibility

| Persona | Visible exception types |
|---|---|
| ATI super admin | All five implemented types |
| ATI operations manager | SLA, shipment investigations and both integration types |
| ATI catalogue moderator | Catalogue review |
| Vendor admin | Own partner's SLA, shipment investigations and catalogue review |
| Vendor fulfilment operator | Own partner's SLA and shipment investigations |
| Vendor catalogue manager | Own partner's catalogue review |

All queries and metrics additionally enforce current company and market membership. Unrelated roles are denied. Integration error bodies/payloads are deliberately absent from queue responses; the restricted source workspace remains the location for detailed diagnostics. Queue responses contain explicit projections, not full database records.

An authorized user can claim an unassigned issue for themselves, add a shared operational note, and release their own claim. Authorized ATI users may release another owner's claim to permit handoff. Vendors cannot release another user's claim. Direct assignment to an arbitrary user is not implemented. Each command requires at least 10 characters of explanation, CSRF and the current exception version. Concurrent claims yield one winner; the stale request gets 409.

The detail page shows the latest 50 queue actions with actor names, reason and time. These notes are shared with the roles authorized for that issue, not private personal notes. Original workflow audit evidence remains on the source record. Resolved/waived cases are read-only. Deleted/inactive assignee handling is limited: inactive accounts are labelled and ATI can release the claim; automatic reassignment is not implemented.

## Resolution is tied to source evidence

| Issue | Opens / reopens | Completes |
|---|---|---|
| SLA | Stage becomes at-risk or breached | Authoritative stage completion or reasoned operator waiver |
| Catalogue review | Moderator requests changes or rejects | Corrected item passes submission validation and returns to moderation; this does **not** mean approved/published |
| Outbound dead letter | Worker records permanent/exhausted failure | Successful adapter acknowledgement |
| Inbound dead letter | Worker records permanent/exhausted failure | Event handler processes successfully |
| Reported shipment issue | Authorized fulfilment user reports an incident | ATI records a reasoned investigation resolution; shipment/stock/SLA/finance remain unchanged |

There is no generic “resolve” API that can hide an unsuccessful operation. Claiming, commenting and reading notifications never complete issues. Replay sets the case to `REPLAY_REQUESTED`, not `RESOLVED`; a further failure reopens it. Existing adapter destinations and idempotency keys remain unchanged by replay.

Automatic transitions increment exception versions, invalidating stale user commands. Reopening clears the old resolution reason/timestamp but retains ownership for continuity. A repeated observation of an identical open failure does not create another case. New failure notifications use the exception revision rather than the resettable retry count, so another failed replay produces a new alert without duplicate processing spam.

## Filtering and API

- `GET /api/v1/exceptions`: strict `kind`, `status`, `market`, `ownership`, `page`, `limit`; default actionable statuses are OPEN and REPLAY_REQUESTED, limit capped at 100.
- `GET /api/v1/exceptions/:id`: projected case plus latest queue activity.
- `POST /api/v1/exceptions/:id/commands`: `CLAIM`, `RELEASE` or `COMMENT`, expectedVersion and reason. ATI fulfilment roles can additionally use `RESOLVE_REPORT` only for reported shipment investigations; it cannot resolve system-generated failures.
- All three success schemas are strict shared Zod/OpenAPI DTOs, exercised through serialized HTTP response validation.
- Metrics respect kind/market/ownership filters but deliberately ignore the selected status/page. “Unassigned” counts actionable cases only.
- Detail pages link to their source. Integration replay is available to ATI only and uses the existing protected replay endpoints; a pending worker is not presented as a successful resolution.

Migration 018 adds ownership, version, updated/resolution timestamps and a scope index. It is additive and does not reset orders, stock or financial entries. Historical terminal exceptions have no fabricated resolution timestamp. Queue transitions use wall-clock timestamps; SLA milestones retain the separate injectable business clock. New catalogue decisions create cases; historical catalogue decisions are not retroactively backfilled.

## Verification — 24 September 2026

- 47 unit + 81 isolated PostgreSQL integration tests pass (128 total); TypeScript, ESLint and optimized Next build pass.
- Four dedicated exception integration tests cover company/market/partner/role scope, metrics, explicit response fields, CSRF, ownership, optimistic concurrency, audit notes, terminal-state guards, reopen/idempotency and transaction rollback.
- Extended foundation tests exercise actual catalogue change-request/resubmission, outbound failed replay then success, and inbound repeated permanent failure. Both replay flows retain an actionable issue until their source succeeds. Repeated failures notify again.
- The larger foundation suite initially exceeded the unchanged 200/minute per-IP limit. An explicit response assertion established HTTP 429; that independent import story now uses its own simulated client. Production rate limits were not relaxed.
- Browser: operator queue shows the existing Northline open/unassigned confirmation breach, metrics include the retained Lumera waiver, and Review opens the correct source-linked detail. The ownership-write browser check was stopped by the safety reviewer pending explicit approval for that existing record. No claim or note was persisted by that attempted browser check. Full ownership mutations are verified on disposable isolated test fixtures, not yet on the preserved demo record.

## Remaining scope

Recipient-role matrices and ad-hoc shipment reporting are now implemented; see [routing](NOTIFICATION_ROUTING_GUIDE.md) and [shipment issues](SHIPMENT_ISSUES_GUIDE.md). The current suite has 137 passing tests. Recipient preferences, email/digests, timed repeat escalation, arbitrary user/team reassignment, activity pagination, all-field localization, expanded rule/chargeback workflows and live callback ingestion remain pending. This queue is not evidence that all 54 requirements, the full security audit or the automated browser suite are complete. The actual Fynd company connection remains a separate prerequisite.
