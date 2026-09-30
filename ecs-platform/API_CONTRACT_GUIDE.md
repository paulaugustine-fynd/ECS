# API contract and verification

The implemented API now has 109 operations (29 September catalogue-mapping checkpoint), all with request/success contracts. `POST /catalog/imports/preview` provides a scoped, read-only source/mapping preview; staging retains immutable source and mapping evidence. See [CATALOG_IMPORT_GUIDE.md](CATALOG_IMPORT_GUIDE.md). Media routes cover uploads/replacement, ZIP/URL imports, provenance, moderation, private content and DAM/URL/ZIP job list/queue/replay; see [CATALOG_MEDIA_GUIDE.md](CATALOG_MEDIA_GUIDE.md), [ZIP_JOB_GUIDE.md](ZIP_JOB_GUIDE.md) and [DAM_JOB_GUIDE.md](DAM_JOB_GUIDE.md). Earlier counts below are dated checkpoints. Its OpenAPI 3.1 document is generated from the actual Fastify route registry, then enriched with the request schemas used by the handlers. This is the local ECS contract, **not a Fynd API contract**. It does not establish tenant compatibility or enable actual Fynd writes.

## Commands

Run from `ecs-platform`:

```sh
pnpm openapi:validate
pnpm openapi:validate --export
pnpm openapi:validate --complete
```

- The normal check validates OpenAPI 3.1 structure, unique operation IDs, required path parameters, request coverage, JSON bodies, authentication and error contracts. It exits nonzero for those failures.
- `--export` additionally writes `.local/contracts/ecs-openapi.json`, which is ignored by Git. Nothing is published or uploaded.
- `--complete` also requires documented success schemas for every implemented operation. **Current coverage: 109 of 109.** A documented marker without an actual success payload schema is rejected. This is coverage of the current API, not proof that all required business endpoints, event contracts or runtime branches exist.

The checker starts the route registry without opening a port, querying PostgreSQL, starting a worker, sending webhook requests or calling any external adapter. It supplies inert configuration defaults when environment variables are absent. Remote/file reference resolution is disabled in the validator. The current document contains only local references.

When the API is restarted with this code, `/docs` serves Swagger UI and `/docs/json` serves the same document. Automated in-process HTTP tests verify `/docs/json` without requiring PostgreSQL. An already-running non-watch API process must be restarted to pick up changes.

## Authentication and validation

28 September 2026 — inbound v1 contract: strict source/tenant/market binding, original signed-body evidence, stable event correlation, replay verification and legacy version-0 compatibility are now implemented. The OpenAPI request union includes both formats and named SFCC order/invoice v1 schemas. See [EVENT_CONTRACT_GUIDE.md](EVENT_CONTRACT_GUIDE.md) for exact scope and remaining outbound/callback work. This does not enable or certify a native Fynd connection.

Latest shipment-report checkpoint: 47 unit and 90 isolated integration tests pass. Both report routes have strict DTOs. Scope/CSRF, immutable SQL evidence, concurrent retries, ATI-only resolution and unchanged operational state are tested. See [SHIPMENT_ISSUES_GUIDE.md](SHIPMENT_ISSUES_GUIDE.md).

Latest routing checkpoint: 47 unit and 85 isolated integration tests pass. The two notification-policy operations have strict success DTOs, admin-only scope, versioned audited saves and category/role guard tests. See [NOTIFICATION_ROUTING_GUIDE.md](NOTIFICATION_ROUTING_GUIDE.md).

Latest exception-centre checkpoint: 47 unit and 81 isolated integration tests pass. Three new strict response DTOs cover scoped queue/metrics, source-linked detail/history and ownership commands. CSRF, stale claims, forbidden partners/markets/roles and authoritative resolution/replay paths are tested. See [EXCEPTIONS_GUIDE.md](EXCEPTIONS_GUIDE.md).

Latest inbox checkpoint: 47 unit and 77 isolated PostgreSQL integration tests pass, alongside TypeScript, ESLint and the optimized Next build. Both notification routes have strict success DTOs exercised through serialized API validation. Recipient and current role/scope checks, CSRF and field exclusions are covered; configurable delivery channels remain outside this checkpoint. See [NOTIFICATIONS_GUIDE.md](NOTIFICATIONS_GUIDE.md).

- Login and invitation acceptance are public, rate-limited entry points. Business routes require the `ecs_session` HTTP-only cookie. Mutations additionally require the **matching** `x-csrf-token` from login or `/auth/me`.
- Browser mutations are subject to the existing origin guard. A documented endpoint is not necessarily available to every logged-in role: company, market, partner and operation-specific authorization remain enforced in the domain.
- Webhooks use `x-webhook-signature` and `x-webhook-timestamp`, not a session or bearer token. Sign `timestamp + "." + exactRawJsonBody` with SHA-256 HMAC. The current replay window is five minutes.
- Webhook `202` means the envelope was accepted into the durable inbox, **not** that its business operation completed. SFCC `order.created` and `invoice.updated` processing are implemented. The document includes `SfccOrderCreatedData` and `SfccInvoiceUpdatedData` for their later payload validation; other source handlers remain pending.
- JSON input schemas preserve string money, input-before-transform types, enums, revision/sequence fields, nested imports, length bounds and strict-object rules. Zod transformations, custom refinements, cross-field checks and state/ownership rules remain authoritative server logic, not a promise that JSON Schema alone can validate an operation.
- Query defaults and bounds are documented. `q` is implemented on partner/catalogue listing and the SLA queue; the shared pagination parser accepting a parameter does not mean every route applies it. Partner listing does not apply the `market` query parameter. The SLA queue uses its own strict, scoped query schema and documented count semantics.
- Errors use `{ "error": { "code", "message", "correlationId" } }`; the response header also carries `x-correlation-id`. The contract lists common rejection statuses, not a guarantee that each route can produce every listed status.

## Differences from the supplied skeleton

The source pack is preserved. It describes a proposed API rather than all the implemented routes. Examples of deliberate implementation differences:

| Skeleton assumption | Current implementation |
| --- | --- |
| Bearer authentication | Cookie session + CSRF for authenticated mutations |
| Separate submit/approve/activate paths | Versioned `/partners/{id}/commands` with action and reason |
| Generic partner creation | Operator invitation + separate invitation acceptance/application workflow |
| Bare arrays for lists | Response envelopes such as `{items, total}`; some are role-specific |
| Synchronous webhook success | Durable inbox `202`, subsequent processing/retry evidence |

These differences must be reconciled with any external consumer before integration. This checkpoint does not implement backward compatibility with the skeleton or claim its unimplemented routes exist.

## Regression evidence and remaining work

25 September 2026 — remaining 26 response envelopes implemented: launch runs/history, imports/metadata/row decisions, catalogue lists/details/commands, inventory, finance events/statements, inbox/outbox replay and audit. Six new negative unit tests and four PostgreSQL integration tests cover nonempty payloads, decimal serialization, excluded import internals, scoped nested partner data, operational launch projections, statement evidence, queue/replay/audit permission and the explicit historical reconciliation fixture. The existing import, launch, fulfilment and finance tests now also validate these new envelopes via the serialized-response hook.

Full regression: 60 unit + 118 isolated integration tests (178), TypeScript, ESLint, optimized Next build and `openapi:validate --complete` pass. The refreshed local server's `/docs/json` also passes the complete gate. Authenticated read-only checks validate populated preserved-demo catalogue (9), inventory (11), financial events (13), statements (2), first-page jobs/audit (25 each), inbox (2), import metadata and batches (2). These checks did not mutate business data or make an actual Fynd call.

Important boundary: product `data`, financial `snapshot`, integration `payload`/`response`, audit `before`/`after` and launch `configuration` contain producer-owned JSON. Their variable inner structure is explicitly described as evidence, not falsely declared a complete canonical event model. Surrounding DTO fields, nested operational projections, numeric/date/money types and import/statement branches are strict. Historical training statement provenance has its own explicit variant; an unrestricted statement-evidence catch-all is not used. Canonical event versioning and field-level policy audits remain required.

Earlier checkpoint, 24 September 2026: SLA milestone reads, waivers, queue and policy read/write add five documented request/response operations. Regression passes 47 unit + 72 isolated integration tests. Queue totals are scoped before pagination; policy writes require rules authority and preserve existing stage deadlines. See `SLA_WORKFLOW_GUIDE.md` for contracts, browser evidence and remaining notification gaps.

The preceding invoice checkpoint added two documented request/response operations and the named asynchronous `SfccInvoiceUpdatedData` schema. XLSX is documented as a third import-source variant. See `INVOICE_REFERENCE_GUIDE.md` and `CATALOG_IMPORT_GUIDE.md` for evidence and limitations.

The prior fulfilment-contract checkpoint added nine strict schemas covering operator/vendor order lists, shipment lists/details/commands, simulator receipts and return lists/create/detail/commands. Serialized integration responses validate requested versus acknowledged shipment status, frozen return-policy and commercial snapshots, good/bad QC and refund-override evidence. Simulator `PENDING` and `duplicate` responses do not claim downstream processing. Historical fixture routing is a distinct, explicit shape, not arbitrary JSON.

That prior checkpoint passed 35 unit and 58 isolated PostgreSQL integration tests, TypeScript, ESLint and the optimized Next build. Its API tests exercise both order personas, vendor shipment detail/list consistency, cross-market and role rejection, duplicate simulator intake and scoped return evidence. Negative unit tests reject full-basket fields inside vendor order references and false live-processing claims. Read-only checks against the preserved demo also passed for its two orders, four shipments and one return, including the historical delivery. That checkpoint needed no migration, demo reset or external integration call. These checks do not prove all fulfilment requirements or a complete sensitive-field audit.

Earlier partner-response checkpoint:

24 September 2026: TypeScript, ESLint and optimized Next build pass; 32 unit tests and 55 isolated PostgreSQL integration tests pass. Contract tests cover structure/route coverage, cookie/CSRF versus HMAC, input types and revision fields, imports, path/query/download definitions, new-route/missing-body/duplicate-ID failures, real unauthorized error responses and the served document. The response audit found and repaired a partner-detail shortcut around commercial/application/document permissions. All eleven seeded personas are checked, including a separate cross-market agreement case. Strict validation rejects the remaining response gaps as expected. No schema migration, demo reset, public push, deployment or actual Fynd request was performed.

The 21 newly documented response routes cover partner summaries/details and mutations, invitations, agreements, brand rights, locations, storage health and storefront previews. Their strict Zod response schemas are shared with documentation and verified against serialized HTTP responses in the integration suite using the test-only `createServer({verifyResponseContracts:true})` option. This option cannot be enabled outside `NODE_ENV=test`; it validates without silently stripping output fields. Existing integration scenarios exercise these contracts, but do not prove exhaustive branch coverage for every route.

Partner listing now exposes an explicit summary DTO without application or review data. Partner details return an `access` descriptor and omit unauthorized application/review/commercial fields; document metadata is filtered using the same permissions as downloads and does not include storage object keys. Application access is limited to ATI super admin, partner manager, auditor and the scoped vendor admin. ATI Finance can see commercial terms and bank-letter metadata, but not the full application; the vendor finance viewer can see its own commercial terms but not compliance documents. Agreements in details are also filtered by the actor's markets. Basic operational readiness remains visible; this is not a completed all-endpoint field-security audit.

Browser checks on the restarted local preview verified fulfilment restriction notices with no document download buttons, and ATI Finance's bank-confirmation-only view. Hidden documents are labeled restricted, not missing. The preceding API-doc-only checkpoint's restart caveat is now resolved for the current preview.

Remaining contract work: version and validate canonical events/operation payloads; extend runtime conformance to all branches, audit sensitive-field exclusions across endpoints, add missing business endpoints as workflows are built, and reconcile the full source specification. Current response markers distinguish `documented` from `pending`; they do not assert exhaustive runtime conformance. The test-only serialized-response hook uses the shared domain response registry; the previously documented authentication/download/health responses are not all handled by that hook. Future routes without explicit schemas must fail the complete gate.

Implementation: `apps/api/src/request-schemas.ts`, `apps/api/src/openapi.ts`, `packages/contracts/partner-responses.ts`, `packages/contracts/fulfilment-responses.ts`, `packages/domain/partner-view.ts`, `packages/contracts/validate-openapi.ts`, `scripts/validate-openapi.ts`. Zod v3 remains the application's existing validation library; the pinned `zod-to-json-schema` v3 converter is a compatibility bridge. Its upstream is deprecated in favor of Zod v4's native conversion; a future migration must preserve runtime validation behavior and re-run contract tests.
