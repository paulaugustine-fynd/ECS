# Isolated launch-order verification

This is a local mock verification protocol, not a connection to actual Fynd and not a customer order. It closes the pre-activation test-order dependency without making an APPROVED partner sellable.

## Operator walkthrough

1. Open **Partners & brands → Review**. Complete current documents, ERP identity, commercial terms, territorial brand rights, mapping, catalogue, inventory and storefront visibility preparation. If needed, **Sync inventory**, then refresh readiness after both acknowledgements. Use the product's **Check storefront** panel to inspect downstream customer content; see [STOREFRONT_GUIDE.md](STOREFRONT_GUIDE.md).
2. In **Isolated launch test**, enter a reason and choose **Run isolated test**. ATI administrators and partner managers may start it; authorized operational/audit users and the owning vendor administrator may inspect its history.
3. Choose **Refresh test progress**. The durable worker advances allocation, acceptance, picking, packing, ready-to-dispatch, dispatch, delivery and SFCC confirmation. Each stage is a separate idempotent outbox command with its own persisted acknowledgement.
4. If an integration step fails, ATI operations/admin can use the existing reasoned **Integration trace → Replay** flow. The same run resumes from the failed stage; it does not create a second virtual order.
5. A PASSED historical run is insufficient on its own. The readiness gate checks its current configuration fingerprint, eight successful commands and the downstream virtual-order state. Once every gate passes, ATI may separately activate the partner.

## Isolation and evidence

- Tables: `LaunchTest` stores immutable identity/snapshot/reason plus step progress; `MockLaunchOrder` stores only the isolated virtual state. Completed evidence cannot be updated/deleted through normal SQL mutations; demo reset remains an explicit guarded operation.
- Commands: `launchOrderStep`, seven to FYND mock and one to SFCC mock. Their mode, origin, partner/company/market and payload are pinned. No WMS, carrier, Finance or payment calls are made.
- Uses a deterministic, eligible AE/AED SKU/location with at least one physically available unit. It copies **one virtual unit**; it never reserves, consumes or replenishes business inventory.
- Reuses normal shipment transition validation in the mock state machine. Wrong stage, target, identity, fingerprint or virtual stock state is rejected. SFCC can confirm only after virtual delivery.
- No `Order`, `FulfilmentLeg`, `ReturnCase`, `FinancialEvent` or settlement is created by the protocol. Approval alone still exposes zero customer ATP.
- The snapshot binds product version/content/price, current publication identities, brand rights, effective agreement/rate/policy, location configuration, ERP identity and inventory source sequence. JSON canonicalization makes the fingerprint stable across PostgreSQL key ordering. Current stock availability and partner eligibility are rechecked; changing stock revision solely due to activation does not invalidate the configuration test.
- Changed configuration or expired/withdrawn rights invalidate readiness. A queued stale job fails before transport; a change during transport prevents acknowledgement from counting. Historical PASSED records remain historical, not rewritten.
- Starting a run requires all other readiness gates. Repeated request IDs return the original run; altered content conflicts. Competing starts cannot create two running tests. Starting a newer run supersedes older failed jobs for evidence purposes.
- Read history is partner/company/market scoped. Operational responses omit the commercial snapshot and raw command payloads.

## API

- `GET /api/v1/partners/:id/launch-tests` — latest 20 scoped histories with step outcomes.
- `POST /api/v1/partners/:id/launch-tests` — authenticated/CSRF-protected ATI command: `expectedVersion`, UUID `requestId`, and `reason` (5–1000 characters).
- `GET /api/v1/partners/:id` — recomputed readiness, including the latest run’s actual validity.
- Existing `POST /api/v1/integrations/jobs/:id/replay` — reasoned operator recovery.

## Limits

This tests one canonical product/location through a dedicated mock protocol; it is not a complete production routing, split-order, tax, payment, carrier, cancellation or returns certification. Those have separate workflows/tests. Brand/location provisioning and storefront content now have separate mock read-back gates; the isolated order does not substitute for them. None proves real Fynd endpoints, tenant permissions, entitlements or actual SFCC visibility. Multi-market launch policy, selectable test assortments, broader scenario suites and actual tenant-bound execution remain future work. Never send this protocol or fictional seed payloads to an actual Fynd company.
