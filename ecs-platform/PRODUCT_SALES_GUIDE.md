# Individual SKU sales controls — REQ-06

## Requirement and boundary

The supplied build specification §16, REQ-06 requires ATI to pause/delist individual items, zero availability and allow existing orders to complete. This implementation now provides that local workflow. Zeroing means **sellable availability**, not deleting physical inventory or reservations.

The source's proposed implementation also mentions market scope, reason and effective date. The control is scoped to the canonical product's company/partner/market; each decision requires a reason and takes effect immediately at the recorded demo-clock time. Future scheduling and a separate per-channel/per-market assortment model are not implemented. Current operational scenarios remain AE/AED.

Every downstream operation is a pinned local FYND/SFCC mock command. This does not establish an actual Fynd connection or a live storefront change.

## State and guarantees

- `Product.saleStatus`: ENABLED, PAUSED or DELISTED. Separate `saleVersion` avoids invalidating canonical content versions and current publication identities.
- ATI super-admin/catalogue moderator may pause ENABLED, delist ENABLED/PAUSED, or request restoration of PAUSED/DELISTED. Vendors and other ATI roles cannot make these decisions. Read access follows existing product company/market/partner scope.
- Every decision checks CSRF, current revision, action and a 5–1,000-character reason. Product state, all inventory revisions, audit and both destinations' outbox jobs commit in one serializable transaction.
- New orders immediately reject a restricted SKU, including manual routing. Concurrent intake either commits before the decision with a valid reservation or rejects after it; no partial order/reservation survives rejection. An existing identical order receipt remains idempotent.
- All of the SKU's inventory positions receive fresh zero-availability revisions when restricted. Physical on-hand, reservations, source sequence, other products, publication records and existing fulfilment snapshots are unchanged by the decision.
- Later stock counts, dispatch and return/restock calls share `queueStock` and therefore retain zero ATP while restricted. Mock inventory revisions prevent older messages overwriting newer acknowledged zero stock.
- Existing shipments continue through normal fulfilment and finance handlers. Dispatch consumes only their existing physical/reserved quantities. Delisting is not shipment cancellation.
- Restoration checks ACTIVE partner, current successful publications, catalogue validation, effective brand rights and current mapping evidence. Location/stock gates still control actual restored ATP. A stale or missing prerequisite rejects restoration transactionally.
- SQL constraints/triggers reject invalid status values, missing decision evidence and invalid revision changes. Historical audit entries use the existing immutable audit table. These guards do not turn a privileged direct database connection into an authorized API client.
- Isolated launch-test scenario selection excludes paused/delisted products, even when their approved content remains published.

## UI and verification evidence

Open **My products → a product → Sales availability**. The same panel appears read-only for vendors; ATI catalogue roles receive the action buttons. It shows:

1. Sales state, decision revision and count of retained open shipments.
2. Each location's physical, reserved and sellable stock.
3. Current FYND/SFCC job state and independently stored mock quantity/revision. “Verified” requires a successful current scoped command and matching read-back; queued/failed or stale records do not pass.
4. A reasoned confirmation step with disabled submission until a valid reason is entered.
5. The latest decision/effective time and the latest 50 immutable audit entries.

The product list separately displays paused/delisted badges without disguising the catalogue publication state. Customer-facing content may remain visible but unavailable; hiding/removing content from search is not claimed.

**Preserved demo browser check, 25 September 2026:** Maison Azure dress displayed one retained open shipment, Dubai Mall 6 physical / 1 reserved / 3 sellable and JAFZA 20 / 3 / 15. Both targets matched current stored stock. Opened Pause sales, verified that Confirm pause was disabled with no reason, then cancelled. No sales decision was saved. Desktop screenshot reviewed at 1280×720.

**Mutation proof:** [eight integration tests](tests/integration/product-sales.test.ts) run only in guarded local `ecs_test` with a dedicated company/partner/assortment. They cover isolation/permissions/CSRF, atomic all-location pause, zero read-back, stale positive receipt ordering, delisting plus fresh physical count, complete existing shipment fulfilment/delivery ledger, guarded restoration/new-order success, competing decisions, SQL guards, rollback and order-intake races. This is in-process API plus real PostgreSQL and HTTP mock-server proof, not a recorded end-to-end browser mutation suite.

Latest full regression: **49 unit + 114 integration = 163 tests passed**. TypeScript, ESLint, optimized build and OpenAPI structure/request checks pass. There are 96 API operations, 70 success response schemas and 26 explicitly unfinished response contracts. Both new sales-control routes have strict response schemas.

Migration `202609250022_product_sales_control` was applied additively to test and preserved demo. Read-only post-check: 2 orders, 4 shipments, 13 ledger entries (including the earlier five reconciliation-training entries), 9 products with ENABLED/revision 1, zero item sales-decision audits. Northline remains OPEN/unassigned/revision 1. No reset, public push or deployment occurred.

## Presenter sequence

For an explicitly selected fictional rehearsal SKU:

1. Note its current stock and open shipment(s).
2. Pause or delist with a reason. Show zero ECS sellable stock and pending destination jobs.
3. Use **Check stock sync** after worker processing; both target badges must become verified with observed zero.
4. Attempt a new order for the SKU; demonstrate `ITEM_NOT_SELLABLE` without a new reservation.
5. Process the already-existing shipment normally. Show that ATP remains zero after dispatch.
6. Review restoration. Missing approval/rights/mapping evidence must block it. Once prerequisites pass, restore with a reason and verify new stock revisions.
7. Expand decision history. Catalogue content/publication version remains separate from sales-decision revisions.

Do not present pending jobs as a successful downstream block. If zero sync fails, local intake remains blocked but the remote channel is not yet confirmed safe; inspect the integration trace and use its authorized replay workflow. Live fail-safe/channel cutoff behavior still needs actual tenant design and testing.

## Remaining acceptance work

- Browser mutation walkthrough on a dedicated presenter fixture, automated browser regression and mobile/Arabic labels.
- Scheduled effective decisions and multi-market/channel assortment policy from the proposed design.
- Actual Fynd credentials, native catalogue/inventory identifier mappings, operation contracts and read-back verification; actual SFCC integration.
- Live channel cache/search behavior, in-flight external checkout races and operational escalation while a zero-stock command fails.
- Complete all other source requirements and overall definition-of-done gates. This checkpoint does not complete the 54-requirement goal.
