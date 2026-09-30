# Connected order → return → settlement demonstration

This is the implementation-current local journey, not a claim that the full supplied 35–45 minute runbook is complete. All integration acknowledgements below come from deterministic local simulators. No customer payment, carrier booking, refund or bank payout is performed externally.

## Repeatable verification without touching presenter data

Run `pnpm test:e2e fulfilment.spec.ts` with local PostgreSQL already running. The harness creates a fresh `ecs_e2e_<UUID>` database, applies all migrations, seeds fictional records and prepares current mappings through the local mock adapter. It runs the real API, polling worker and browser app. It never resets `ecs_demo`.

The eight scenarios are serial because they intentionally share one business story. The first return uses the shipment actually delivered in preceding browser actions; finance uses its actual sale and return ledger. The fourth scene returns the remaining serum through Bad QC and a separate goodwill refund override. Four further scenes prepare, review and execute a dress-size exchange. A failed earlier scenario skips its dependants. No test sets order, shipment, return, payment or settlement success directly in the database.

Use separate browser profiles for ATI operations, Maison Azure fulfilment and ATI finance when presenting manually. Seed credentials are listed in README. Keep the demo clock within the original policy window; new delivery and its return in this automated story occur on the same demo day, not the source pack's three-day historical fixture.

## 1. Receive and allocate one basket

As `ops@ati.demo`, open My orders and enter a unique fictional reference. Receive the sample order. It enters the signed SFCC inbox before allocation; pending processing and shipment acknowledgements refresh automatically.

The basket totals AED 2,666: dress, two serums and candle, including the AED 64 vendor-funded beauty discount. In the fresh fixture's **Hybrid Waterfall** configuration the selected locations are:

| Partner | Product | Location |
| --- | --- | --- |
| Maison Azure | Dress | Maison Azure JAFZA Warehouse |
| Lumera | Two serums | Lumera Beauty Dubai Warehouse |
| Northline Home | Candle | ATI Dubai Central DC |

The source runbook names Dubai Mall for the dress. That is not the implemented hybrid preference. Do not edit inventory or fake the trace to force that result: select the intended policy and explain its actual candidates. Store-first versus warehouse-first is a business-policy decision.

Receive the **same reference and content** again: the same receipt is returned, with exactly the original three shipment IDs. A new reference creates another order and consumes available stock; it is not a harmless reset button.

## 2. Fulfil independently under the correct role

As `fulfilment@maisonazure.demo`, My orders shows only Maison Azure's shipment. Another partner's shipment endpoint returns 404. Open the visible leg and inspect the selected location and routing alternatives.

Accept → start picking → confirm the exact picked quantity → ready for dispatch → enter a fictional tracking reference → confirm carrier handover. An empty/mismatched picked quantity is rejected. Each state advances only after mock Fynd acknowledgement; the UI polls rather than optimistically claiming completion.

Download the ATI/Bloomingdale's packing slip after packing. It contains only the current shipment and explicitly says it is not a VAT invoice. This is not a carrier label or manifest.

Only ATI operations may use Confirm demo delivery. Completing Maison Azure does not deliver Lumera or Northline. The automated story next fulfils and delivers Lumera's two units, leaving Northline assigned to prove independent progress.

## 3. Return one delivered serum

As ATI operations, open Returns → Request a return. Select the delivered Lumera shipment, its serum line and quantity 1. Enter a reason and submit. The server checks original policy and remaining returnable quantity.

Approve return → wait for mock Fynd return identity → book mock pickup → wait for Logistics acknowledgement → record receipt → retain a private inspection photo and notes → QC passed / Restock. Every decision needs an evidence reason. The case closes only after the mock SFCC refund instruction is acknowledged. The recorded QC snapshot binds the photo ID, condition, disposition, actor and decision time; photos are locked afterwards.

Expected evidence:

- Good stock increases by one; damaged stock is unchanged.
- Customer refund instruction: **AED 288.00**.
- Vendor payable reversal: **AED 195.84**.
- Separate return-handling charge: **AED 20.00**.
- Fynd return, Logistics pickup and SFCC instruction references remain visible.

Private photos and Bad QC are covered by the fourth scene below. Self-delivery, pickup slots and actual callback-driven carrier/refund processing are not proven by this browser story. The dress exchange is described separately below. See the requirements register for current implementation/gaps.

## 4. Reconcile, lock and hand off

As `finance@ati.demo`, create a Lumera September 2026 statement. Calculate → mark reviewed → lock, with a reconciliation reason each time.

For this isolated story: sale 640.00 − vendor-funded discount 64.00 − commission 184.32 − return reversal 195.84 − handling charge 20.00 = **AED 175.84**. The retained six-event snapshot also includes a zero-value operator-funded discount entry. A presenter's existing unassigned transactions or corrections can change the period total; never erase history to force this sample amount.

Export to mock Finance, wait for acknowledgement, then simulate payout confirmation. The locked CSV retains the return reversal. Recalculation is no longer offered after locking. Another partner's finance user cannot read this statement. The displayed payout is explicitly simulated; ECS has not moved money.

## 5. Exchange the delivered dress from M to L

Use the actually delivered Maison Azure line to request a return. **Explore exchange variants → Preview replacement** initially explains missing refund and unpublished size-L gates. It makes no reservation or payment.

As ATI catalogue/admin, submit the size-L draft, review it, then publish through ERP and wait for the Fynd/SFCC mock acknowledgements. As operations, complete the original size-M return through Good QC and acknowledged refund. Existing presenter variants may need additional catalogue correction; never copy publication success flags from size M.

As the Maison Azure partner, preview again, accept the separate replacement price and save a reasoned request. ATI can reject with feedback; a renewed request needs newly accepted terms. ATI approval retains its own decision snapshot but does not reserve stock. Before checkout, the partner can cancel with its history preserved.

For an approved request that should proceed, ATI records a **Replacement checkout reason**, selects the explicit simulated-customer-acceptance checkbox and chooses **Start simulated replacement checkout**. A new order reserves size L; fulfilment is blocked until the typed local SFCC purchase receipt is acknowledged. The portal then shows the separate charge, receipt, new order and shipment link. No actual customer consent or money movement is recorded.

Fresh seed size-L stock is at **Maison Azure Dubai Mall**, unlike the original size-M warehouse allocation. The new route must follow real eligibility, not a hardcoded assumption. As Maison Azure fulfilment, open the new shipment, accept/pick/pack/dispatch; ATI confirms demo delivery. The original delivery and original refund remain unchanged. Integration tests separately assert new sale AED 1,850 and commission AED 518 rather than editing the original ledger.

Before fulfilment begins, ATI can enter a **Replacement cancellation reason** and choose **Cancel replacement checkout**, including while payment or Fynd acknowledgement is pending. The evidence panel shows separate SFCC payment and Fynd cancellation outcomes. Stock stays reserved until both arrive; a captured purchase requires a separate refund acknowledgement. Do not use the old pre-order request-cancellation button or manually release inventory. Pending payment holds enter this same flow after thirty minutes on the demo clock. Failure controls affect only local simulators; restore/replay failed jobs through Integration Trace.

For an accepted/picking replacement, cancellation remains in its shipment workspace. Stock release waits for Fynd mock acknowledgement; the separate SFCC cancellation refund has its own pending/acknowledged state. See [EXCHANGE_IMPLEMENTATION_GUIDE.md](EXCHANGE_IMPLEMENTATION_GUIDE.md) for the provisional policy and remaining gaps.

## Boundaries and recovery

After the first statement is locked, the fourth scene returns the remaining serum, records a synthetic private inspection image, chooses **QC failed · Quarantine** and verifies on-hand and damaged stock each increase by one, with no increase in good stock. The refund is held. Another partner cannot fetch the photo. A separate reasoned **Approve refund override** obtains mock refund acknowledgement without releasing stock or changing the original BAD/QUARANTINE/photo decision. Its new financial entries are not part of the already locked AED 175.84 snapshot. See [RETURN_INSPECTION_GUIDE.md](RETURN_INSPECTION_GUIDE.md).

- Inspect Integration Trace when a pending step fails. Do not change database success flags. Retry/replay requires its normal scoped, reasoned workflow.
- Screenshots, test databases and reports are local, ignored diagnostics; they are not approved for publication.
- The root static demo, deployed site and preserved presenter records are separate from disposable acceptance fixtures.
- This story proves specific local workflows, not native Fynd compatibility, all 54 requirements, complete Arabic/accessibility coverage, or production readiness.
