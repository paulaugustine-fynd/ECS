# Simulation Studio — presenter guide

Route: `/operator/simulations`. Sign in with a fictional ATI operator account, such as `admin@ati.demo` / `Demo123!`.

## What this adds

18 scenario workbenches map to all 54 original requirement IDs. This is a **separate simulation layer**, not completion of every native operational workflow. Original onboarding, vendor and operator screens remain separate and unchanged in ownership. Open the operational workspace link to switch back to the existing implementation.

Each scenario has editable fictional inputs, sequential business outcomes, a request/response timeline, failure injection, same-key retry, duplicate handling and a downloadable JSON evidence pack. The print action supports browser Save as PDF and visibly marks the output as a simulation, not a commercial document. Runs persist in append-only PostgreSQL audit snapshots; reloading resumes the run. No new database migration is required.

Only ATI demo roles can access the studio. Runs are scoped to the authenticated company **and creator**. Scenario actor names represent fictional participants, not impersonation of actual user accounts. Foreign users/companies receive 404 for a run. Mutations require session + CSRF and expected-version checks. Old snapshots and operational records are never reset.

## 35–45 minute demonstration

| Chapter | Scenario | Requirement IDs |
|---|---|---|
| Partners | Invitation, compliance correction, ERP vendor, readiness and activation | 1–4, 19, 43–44 |
| Partners | Brand/SKU pause, preserved order and restoration | 5–6 |
| Catalogue | Commercial rules, price-floor override, funded promotion and chargeback | 7–8, 35, 45, 50 |
| Catalogue | Supplier intake, SFTP/connector simulation, mapping and duplicates | 9–10, 12–14 |
| Catalogue | Upload/URL/ZIP/DAM lineage and creative-job fixture | 11, 14, 17 |
| Catalogue | English/Arabic translation fixture and human approval | 16, 18 |
| Catalogue | Trusted vendor automatic/manual approval branches | 14–15, 18, 50 |
| Integrations | ERP-first product publication → Fynd → SFCC → read-back | 18–19, 45–46 |
| Operations | Location stock, thresholds, reservation and stale-event rejection | 20–21, 45, 48, 50 |
| Operations | Signed-event fixture, routing, split legs and partial delivery | 1, 22–25, 45, 48, 50 |
| Operations | Pick/pack, void label/manifest and verified BOPIS collection | 25–27 |
| Operations | Simulated clock, SLA breach, email preview, escalation and waiver | 28, 49–51 |
| Post-purchase | Return eligibility, grace period, pickup, Good/Bad QC and refund | 29–32, 34–35, 45 |
| Post-purchase | Exchange, price difference, payment approval/decline and replacement | 33 |
| Finance | Market currency, tax/FX fixture, invoice, statement, payout and reconciliation | 7, 35–41 |
| Operations | Inbound PO, delivery appointment, reschedule, receipt and return collection | 20, 32, 47 |
| Reporting | Metrics, report delivery preview and audit evidence | 42, 49, 51 |
| Integrations | Service boundaries, second-company namespace and multi-market context | 43, 46, 48, 51–54 |

1. Start with partner launch and explain ATI merchant-of-record / SFCC ownership.
2. Open catalogue intake and trusted approval. Compare trusted versus restricted submissions.
3. In connected publication, click **Fail next handoff**, reload, then **Replay failed handoff**. Inspect the stable key and unmodified business facts while failed.
4. Run stock rules twice: enough stock, then safety stock equal to on-hand. Compare accepted versus rejected reservation.
5. Run split order, fulfilment and warehouse appointments. Enter a wrong collection code, then create a new run with fixture code **4826**.
6. Run returns for Good QC, Bad QC and day 31 against a 30-day window. Bad QC must quarantine and hold refund; expired eligibility must not book a pickup.
7. Run an exchange with declined payment; confirm stock release and no replacement shipment.
8. For finance set price **1050**, discount **0**, fictional tax **5%**, commission **28%**, handling **20**, agreed FX **1** and received FX **1.01**. Expected tax **50.00**, commission **280.00**, payable **700.00**, actual settlement **707.00**, variance **7.00**. These are illustrative demo rules, not tax or accounting guidance.
9. Replay a duplicate: the event is recorded as ignored with **zero effects**.
10. Export evidence, review requirement mapping, then show the corresponding operational workspace.

## Honest boundaries

- No network connection to Fynd, SFCC, ERP/PIM, WMS, Finance, Logistics, suppliers, AI or email is made by the studio. Their requests, acknowledgements and read-backs are deterministic fixtures, not independent remote-state proof.
- Creative outputs use a bundled illustration, not newly generated photography. Translation uses a known bilingual fixture, not a general translation service.
- Invoices, labels, manifests, reports, settlements and payout receipts are simulated facts/printable evidence, not valid tax documents, carrier barcodes, actual email deliveries or money movements.
- Tax/FX inputs are fictional presenter settings. Currency precision is demonstrated; no real tax rates or FX quotes are asserted.
- Multi-company provisioning, user permissions, source connectors and market expansion inside scenarios are fictional evaluations. They do not create real companies, users, integrations or production entitlements.
- Each run is isolated and sequential; it does not feed data into another scenario or operational tables. No continuous background scheduler or full translation of every studio screen is claimed.
- Coverage shows which requirement IDs have had a simulated outcome exercised, including expected rejection paths. It must not be called “54 requirements fully implemented” or a production-readiness percentage.
- The original requirements evidence register continues to describe native implementation gaps; this guide describes the presentation simulations separately.

## Verification commands

Verified 30 September 2026: all **148 unit tests**, **four new database/API tests**, **two new browser journeys**, TypeScript, ESLint, **125/125** OpenAPI contracts and optimized Next.js browser-test build pass. Browser journeys cover saved failure/replay, duplicate handling, exact finance, JSON download, trusted/manual approval, Bad QC, invalid collection code, warehouse appointments, Arabic fixture publication and no-consent creative-job rejection. Desktop and 390px mobile screenshots were inspected. This is not a new run of the complete historical integration/browser suite or a full accessibility/RTL acceptance claim.

Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm openapi:validate`.

Database tests: `pnpm exec vitest run tests/integration/simulations.test.ts --no-file-parallelism` against a disposable local `/ecs_test` database. Browser tests: `pnpm test:e2e simulations.spec.ts`; this creates a fresh database and does not reset presenter or hosted data.

If the normal local PostgreSQL server is unavailable, `node --import tsx scripts/simulation-postgres.ts` starts a distinct retained acceptance cluster on port **55433**. Set `TEST_DATABASE_URL=postgresql://ecs:ecs_local_only@127.0.0.1:55433/ecs_test` for acceptance. The test-only password is fictional; it is not an infrastructure credential.

This feature does not by itself publish a GitHub commit or change Vercel. Check the release evidence before claiming the hosted app contains it.
