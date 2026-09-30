# Operational inbox — local demo checkpoint

The operator and vendor consoles now have a separate **Notifications** page and an unread bell. This implements part of REQ-49 and the alert-delivery portion of REQ-28, not the complete configurable notification requirement.

## Default event → recipient behaviour

These defaults now have an ATI-super-admin-only [versioned routing editor](NOTIFICATION_ROUTING_GUIDE.md). Policies can narrow or extend delivery within each category's authorized roles; critical alerts retain administrator escalation. Historical notices/read state are preserved.

| Event | ATI recipients | Vendor recipients |
|---|---|---|
| SLA at risk | Operations manager | That partner's admin and fulfilment operator |
| SLA breached | Operations manager and super admin | That partner's admin and fulfilment operator |
| Catalogue changes requested / rejected | Super admin and catalogue moderator | That partner's admin and catalogue manager |
| Outbox or inbound receipt dead-letter failure | Super admin and operations manager | None: trace/payload access remains ATI-only |
| Reported shipment issue / ATI investigation resolution | Super admin and operations manager | That partner's admin and fulfilment operator |

Only active users in the event's company and market receive notices. Vendor membership must match the event partner. Read APIs additionally recheck the recipient's current role, company, market and partner membership, so historical notices do not bypass a later role/scope change. Unrelated roles can open an empty inbox; the page is not a grant of workflow access.

Delivery is an insert inside the business-event transaction. A database unique constraint on recipient/event key deduplicates retries without resetting read state. SLA polling can backfill a currently active warning/breach, including for newly eligible recipients; it does not synthesize historical notices for resolved or waived stages. Catalogue and integration notices are generated on new decisions/failures, not retroactively from existing audit history. A replay that genuinely fails again can create another failure notice for that attempt.

## What the user sees

- Unread, all and read views; authorized category filter; server-side pagination.
- Per-recipient mark read/unread, without changing the underlying exception.
- Separate business event and wall-clock delivery timestamps, displayed in GST. This makes demo-clock alerts distinguishable from their actual delivery time.
- Links to the affected shipment, return or catalogue review. Integration notices open the restricted integration/receipt workspace, not a new record-specific detail page.
- The header polls the unread count every 15 seconds; the inbox list updates on navigation, filters, read/unread and explicit refresh. There is no claim of WebSocket/push delivery.

Messages intentionally omit raw moderator feedback, error bodies, integration payloads, credentials and commercial snapshots. Authorized users open the original workflow for details. Inbox notices describe events; the source workflow remains authoritative for current resolution.

## API and storage

- `GET /api/v1/notifications`: strict optional `category`, `state=UNREAD|ALL|READ`, `page`, `limit` (maximum 100). `total` is filter-specific; `unread` is across all categories currently authorized for the recipient.
- `POST /api/v1/notifications/:id/read`: `{ "read": true|false }`; authenticated session plus CSRF required. Other recipients' IDs return 404.
- Both success responses have strict shared Zod/OpenAPI contracts. Recipient IDs and internal event keys are excluded.
- Additive migration `202609240017_operational_notifications`; no reset of demo orders, inventory or finance data.

## Verification — 24 September 2026

TypeScript, ESLint, optimized Next build, 47 unit tests and 77 isolated PostgreSQL integration tests pass. Five dedicated inbox integration tests cover recipient selection, concurrent deduplication, rollback, scope and role changes, inactive sessions, CSRF, pagination/read state, exact response projection and actual catalogue decisions. Existing SLA and foundation tests additionally verify real warning/breach, outbox DLQ and inbound DLQ delivery hooks. Tests use fictional local users and systems; no actual Fynd call or email is involved.

Manual browser check: the existing Northline confirmation breach appeared in Aisha's operator inbox; mark read reduced the bell to zero and removed it from Unread; All retained the event; mark unread restored the badge; Open workflow reached the correct Northline shipment with its breach still present. Read/unread was restored to unread for the presentation. This is manual verification, not an automated browser regression suite.

## Remaining acceptance work

Shipment reporting and ATI investigation resolution now generate scoped FULFILMENT notices with direct exception links. They never change the shipment, stock, SLA or financial state. See [SHIPMENT_ISSUES_GUIDE.md](SHIPMENT_ISSUES_GUIDE.md); the updated suite passes 137 tests.

Subsequent exception-centre checkpoint: the previously missing cross-module queue now combines SLA, catalogue and integration issues with ownership, notes and source-verified resolution. See [EXCEPTIONS_GUIDE.md](EXCEPTIONS_GUIDE.md). Repeated integration failures now use exception revision keys so a failed replay alerts again even when attempt counts reset. The current suite passes 128 tests; the earlier figures above describe the inbox-only checkpoint.

Subsequent routing checkpoint: configurable company/market/category/severity recipient-role matrices are implemented and the suite now passes 132 tests. See [NOTIFICATION_ROUTING_GUIDE.md](NOTIFICATION_ROUTING_GUIDE.md). REQ-49 is still **partial**: email/Mailpit delivery, digest scheduling/personal preferences, timed repeat escalation and signed actual Fynd status/SLA event ingestion remain pending. No customer email/SMS or reverse-logistics communication is sent. Chargeback candidates and richer SLA policy overrides also remain separate work. The local UI must not be described as fully connected to Fynd or as all-54-requirement complete.
