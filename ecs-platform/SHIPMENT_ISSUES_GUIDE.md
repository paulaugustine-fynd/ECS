# Shipment issue reporting

This implements the explicit **Report exception** action in build-spec §7.5 and advances REQ-25/49. It is an ECS investigation workflow, not a Fynd shipment-state API or a claim of full fulfilment coverage.

## Demonstration flow

1. Open an assigned shipment in the operator or partner portal, then **Shipment issues → Report an issue**.
2. Choose stock mismatch, damaged item, pick/pack delay, carrier delay, delivery issue or Other. Select Warning or Critical and explain the issue in 10–1,000 characters.
3. Submit. The report records the observed shipment stage/revision and creates a scoped exception and audit entry in the same transaction as its in-app notices.
4. Follow **Open investigation**. Authorized vendor and ATI users can claim, comment and release ownership. Only ATI super admin/operations may **Record ATI resolution**, with a reason and current version.
5. Revisit the shipment: the report remains visible with its original evidence and resolved/open status. Reports can be raised after delivery/cancellation for late-discovered issues; each new incident gets a new report rather than rewriting history.

Messages and investigation notes are shared with the authorized partner/ATI fulfilment roles. Do not enter credentials, customer payment data or unrelated sensitive details. Alert previews deliberately omit report details; the scoped investigation contains them.

## Boundaries and invariants

- Every report is scoped from the actual shipment, not client-supplied company/partner/market values. Vendor fulfilment/admin and ATI operations/admin can report; other roles cannot.
- A stale shipment revision rejects a new report. Same actor/company/request key with identical input returns the existing result, including after a later stage change. Different content on the same key returns an idempotency conflict. Concurrent identical requests produce one report, audit and delivery set.
- Report rows are immutable, with SQL scope and update/delete guards. Resolutions are appended in exception audit history. Case ownership and resolution use optimistic versions and CSRF.
- Reporting, commenting and resolving do **not** change shipment status, tracking, inventory, reservations, SLA deadlines, outbox commands or finance. Shipment completion does not automatically resolve an investigation.
- `RESOLVE_REPORT` is allowed only for reported FULFILMENT cases. System-generated SLA, catalogue and integration cases still require their original source resolution/waiver/replay rules.
- The FULFILMENT notification category has configurable Warning/Critical role policies. Defaults notify ATI admin/operations and the originating partner's admin/fulfilment roles. Critical retains admin escalation. Resolution emits a Warning event with a direct investigation link. No external message is sent.
- The shipment panel shows the latest 100 reports. The paginated exception centre remains the route to older cases; attachment evidence, report-specific SLA/escalation, automated corrective actions and arbitrary reassignment are not implemented.

## API and verification

`GET /api/v1/shipments/:id/issues` returns projected report evidence and case references. `POST` accepts requestKey (UUID), expectedShipmentVersion, code, severity and details. Both use strict success DTOs. Existing `/exceptions/:id/commands` accepts the restricted `RESOLVE_REPORT` command.

Migration 020 adds immutable ShipmentIssue records and extends notification category constraints. Five isolated integration tests cover scope/role/CSRF, strict input and response projection, stage snapshots, concurrent retry deduplication, immutable SQL guards, ATI-only closure, stale actions, notification recipients, terminal shipment reporting, unchanged operational state and transaction rollback on notification failure.

Verified 25 September 2026: 47 unit + 90 isolated PostgreSQL integration tests (137 total), TypeScript, ESLint and optimized Next build pass. OpenAPI: 86 operations, 60 documented success responses, 26 remaining response gaps. This is not all-54-requirement acceptance or an actual Fynd integration.

Manual browser verification on the preserved Lumera shipment confirmed the empty report panel, code/priority form, observed PICKING revision 4 and disabled short/empty submission. A visual spacing/textarea issue was corrected, rebuilt and rechecked. No report was submitted in the demo: read-back retained zero reports, 2 orders, 4 shipments, 8 ledger entries and Northline OPEN/unassigned revision 1. End-to-end report/resolve mutations are covered in isolated API integration tests, not yet an automated browser regression.
