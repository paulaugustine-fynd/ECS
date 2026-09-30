# Transaction-level reconciliation

REQ-41 is **partially implemented**, not complete. The operator workspace compares recorded local evidence from SFCC, Fynd, the ECS ledger and Finance. It does not query an actual Fynd tenant or independently read back current remote shipment/payment state.

## Access and workflow

Open `/operator/reconciliation` as ATI super-admin or finance analyst. ATI auditors can inspect but cannot scan, reconstruct or resolve. Vendors cannot access cross-system investigation records; their scoped sales and statements remain in Analytics and Settlements. All API operations enforce company and market scope; changes require CSRF and a reason of 10–1,000 characters.

1. Choose a shipment or statement and inspect the evidence. This is read-only and does not populate the issue queue.
2. Enter an investigation reason and **Record scan**. Each missing/mismatched check creates a durable case, or updates/reopens its existing case. Repeated identical failures do not create duplicate cases.
3. Correct the source through the appropriate workflow. A new match does not automatically close an investigation.
4. Enter the verified correction reason and **Verify source & resolve**. The server checks the source again inside the transaction and refuses closure if the evidence remains missing or different. Stale case revisions are rejected.
5. Inspect first-observed values and audit history. A later recurrence reopens the same case while retaining its original evidence.

An empty queue means no recorded cases match the filter—not that all transactions reconcile.

## What each comparison means

| Evidence | Comparison |
| --- | --- |
| Captured shipment | Valid line snapshots, unique line IDs and internally consistent captured net amounts |
| SFCC source | Processed order-event lines and currency versus the captured shipment/order |
| Fynd shipment | Captured shipment ID and current stage versus the latest eligible recorded mock acknowledgement |
| SFCC status | Current shipment stage, shipment ID, source order ID and currency versus recorded status feedback |
| Delivery ledger | Captured quantity, gross, separately funded discounts and commission versus four immutable delivery entries per line |
| Statement | Payable versus the owned, same-currency ledger events recorded in its evidence |
| Locked statement | Every selected event must be claimed by that statement |
| Finance export | Statement, partner, currency, amount, event IDs and external reference versus the recorded export acknowledgement |

`MATCH` means the named stored records agree. `MISSING` means eligible evidence is unavailable, not zero. `MISMATCH` means recorded values differ. `NOT_DUE` is excluded from success: for example, a picking shipment should not yet have delivery recognition.

Eligible acknowledgements require a successful mock-bound outbox job and a matching mock record, payload hash, operation, system and external ID. A pending/failed latest command cannot be hidden by an older successful receipt. This proves a recorded exchange only. Export acknowledgement is not payout confirmation, and none of these checks proves real money movement.

## Guarded local recovery

**Reconstruct missing entries** appears only for a delivered AE/AED shipment in demo mode when source lines and delivery/status receipts match and the only discrepancy is an entirely absent delivery-entry set. The observed shipment revision and reason are mandatory. Only finance/admin can execute it.

Recovery uses the existing delivery-recognition routine and its idempotency keys. It appends absent entries from captured terms; it does not overwrite amounts, invent a balancing adjustment, change inventory/order status, enqueue an external command or move money. Unexpected existing events, partial/mismatched entry sets or conflicting receipts block recovery. Repeating a completed recovery creates no duplicate financial entries. Issues still require explicit verified resolution.

## Repeatable presenter scenario: held Finance export

From this project directory with the local database seeded and preview running:

```sh
pnpm demo:reconciliation prepare 01
```

This additive command creates a **paused fictional training partner**, four explicitly historical opening ledger entries, a locked AED 152 statement and one mock-bound export job held until 2100. It does not create a customer order, deduct stock, forge an acknowledgement, claim existing partners' ledger entries or change any previous scenario. Gross AED 200 minus vendor-funded discount AED 10 minus commission AED 38 gives vendor payable AED 152; the separately ATI-funded AED 5 discount is excluded from vendor payable.

1. In Reconciliation, select `vnd_reconciliation_training · EXPORT_PENDING · ation_01`. Expect two matches and one missing Finance acknowledgement.
2. Enter a clearly labelled training reason and **Record scan**. Inspect the open case. **Verify source & resolve** remains disabled because the evidence is missing.
3. Release just this scenario's held job:

   ```sh
   pnpm demo:reconciliation release 01
   ```

4. The existing outbox worker sends the request to the local Finance mock. It stores the real mock acknowledgement and attempt record, changes the statement to EXPORTED and appends an export marker. No payout command is queued.
5. Click **Refresh evidence**. All three checks should match, while the investigation remains open. Enter the verified correction reason and **Verify source & resolve**.
6. Expand **First-observed evidence** and inspect Audit history. The original missing observation survives closure; the statement is exported, not paid.

Repeating `prepare 01` or `release 01` is idempotent and preserves completed history. To present a fresh run, use a new lowercase run label (1–24 letters/digits/hyphens), for example `prepare workshop-02`, and release that same label. Each new run adds its own four historical events and statement; it does not reset earlier runs. Fixture controls reject production/remote databases, disabled demo mode, live Finance mode, public mock origins, foreign identifier collisions and missing provenance. Preparation is atomic with the export hold, so the running worker cannot race ahead of the demonstration.

These are historical finance fixtures, not proof of a customer order progressing through SFCC/Fynd. The seed/release controls are CLI commands; an in-page scenario launcher is not implemented.

## Verified evidence — 25 September 2026

- Migration `202609250021_reconciliation` creates scoped cases with immutable original evidence, protected ownership and no deletion. It was applied additively to the preserved local demo; no reset occurred.
- Six isolated PostgreSQL integration tests exercise missing-ledger detection, concurrent scan deduplication, guarded/idempotent recovery, reasoned closure, recurrence, actual deterministic mock dispatch, Finance export comparison, role/company/market/CSRF isolation, response contracts and audit-failure rollback.
- Full regression: **49 unit + 106 integration tests (155)** pass. TypeScript, ESLint and optimized build pass. OpenAPI structural/request validation passes for **94 operations**; **68** have documented success schemas and **26 remain pending**. Five scenario tests additionally cover atomic/concurrent preparation, held-job worker exclusion, source release, worker acknowledgement, explicit resolution, idempotent re-preparation, local-only guards, foreign-key collisions and audit-failure rollback.
- Browser read-only review: the existing Lumera PICKING leg reports **7 MATCH / 1 NOT DUE**; its captured net is AED 576. The existing paid Lumera statement reports **3 MATCH**, with payable AED 175.840 matching the ledger and recorded Finance export. These are local mock comparisons, not verification of an actual payout.
- Before fixture installation, preserved demo counts were **2 orders / 4 shipments / 8 ledger events**, with zero reconciliation actions. The new run adds only its training partner, statement, four opening events and one export marker: **existing partners still have 8 ledger events; training has 5; orders remain 2 and shipments 4**.
- Browser execution of run `01` verified detection (2 MATCH / 1 MISSING), disabled premature resolution, refresh after the real local worker acknowledgement (3 MATCH), reasoned closure at revision 2 and expanded original missing evidence. Its export job succeeded in one attempt; the statement is EXPORTED for AED 152, with **zero training payout confirmations**. Re-preparation returned `created:false` without reopening or resetting anything.
- Northline remains OPEN, unassigned, revision 1; exception ownership-action audit count remains zero. No existing business transaction or Northline investigation was changed.

## Remaining work before full REQ-41 acceptance

- Browser execution of delivery-ledger reconstruction and an optional in-page scenario launcher. The held-export presenter story above is verified end to end; ledger reconstruction and recurrence remain isolated-test evidence.
- Independent downstream read-back, actual Fynd tenant identifiers/permissions, live business adapters and signed callback validation.
- Return/refund/payout-level comparisons, operational base-report exports and broader vendor reconciliation reporting; tax/FX and additional market acceptance.
- Pagination/search beyond the newest 100 queue items, 100 shipments and 100 statements; the detail view shows only the latest 50 audit events.
- Scheduled/background scans, severity/assignment/escalation integration with the unified exception centre, exports and full bilingual presentation.

No real Fynd request, public Git push or deployment is implied by this checkpoint.
