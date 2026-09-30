# Versioned inbound event contract

This is the executable **local ECS profile**, not a native Fynd, SFCC or other external-system contract. The original build-pack schema is preserved outside this implementation. Actual Fynd account access remains unconfigured.

## Implemented boundary

`packages/events/envelope.ts` defines the strict envelope. `schemas/event-envelope.schema.json` is its checked-in JSON Schema; `pnpm events:validate` fails if the artifact differs from the runtime definition. OpenAPI also exposes `EcsEventEnvelopeV1`, `LegacyDemoWebhook`, `SfccOrderCreatedV1` and `SfccInvoiceUpdatedV1`.

The supplied schema permits future positive integer versions and an optional/null market. The implemented profile deliberately supports **version 1 only**, requires a two-letter market, bounds identity fields and rejects extra root/subject fields. A version number is not a promise of future compatibility. `data` is producer-owned JSON at initial acceptance; registered business handlers validate its fields before making changes.

- Required: eventId, type, version, occurredAt, producer, tenantId, market, correlationId, subject and data.
- Optional: causationId, idempotencyKey and metadata. A supplied non-null idempotencyKey must equal eventId in this profile.
- Producer must match the authenticated source path. The current demo credential is explicitly bound to `cmp_ati_uae` / `AE`; another tenant or market is rejected, not implicitly provisioned.
- Known consumers are SFCC `order.created` and `invoice.updated`. The subject must respectively identify `ORDER` / externalOrderId or `INVOICE` / invoiceNumber. Unknown source/type combinations can be durably accepted but fail into the inbox dead-letter queue; acceptance is not processing success.

## Signature, identity and lineage

Sign `timestamp + "." + exactRawJsonBody` using the configured local SHA-256 HMAC secret. Initial delivery requires the existing five-minute signature window. `occurredAt` describes the event; the signature timestamp describes this delivery attempt. They are not interchangeable.

The inbox saves the original raw body, its hash, signature and signature timestamp together with the normalized identity, payload and event correlation. PostgreSQL prevents changes/deletion of receipt evidence; only status, error, attempts and scheduling are mutable. Signature/raw evidence is excluded from list and replay responses and replay audit snapshots. It remains private database evidence—not encrypted secret storage or a completed retention policy.

Deduplication is by source + eventId and the exact raw-body hash. Reordering JSON or changing any envelope content under the same event ID is a conflict, even if its business meaning appears equivalent. A retry should re-sign the original bytes with a fresh delivery timestamp. The simulator does this automatically for an identical request, keeping occurrence time and correlation stable.

`x-correlation-id` identifies the HTTP attempt. `x-event-correlation-id` identifies the accepted event chain, including duplicate responses. The order and its downstream commands retain the event correlation. Replay validates retained raw-body identity and checksums again; it does not reject the already-accepted event just because its original delivery signature is now old. A bad subject cannot be repaired by editing the receipt or replaying it unchanged.

## Legacy compatibility

The exact legacy `{eventId, type, companyId, market, data}` request remains accepted as version 0. Newly accepted legacy requests retain raw/signature evidence. Migration 023 leaves historical receipts as version 0 with null occurrence/raw/signature fields; unavailable evidence is not fabricated. Their original IDs, hashes, correlations, statuses and business effects are retained. The simulator attempts the original legacy serialization for old receipts; ingress still rejects a hash conflict rather than rewriting history.

## Verification

Run from `ecs-platform` with the documented local test database:

```sh
pnpm events:validate
pnpm openapi:validate --complete
pnpm test
pnpm test:integration
```

Eight unit tests cover schema/artifact equality, strict version and source/scope/key validation, checksum and subject verification, JSONB key ordering, legacy behavior, and simulator retries. Seven isolated PostgreSQL event tests cover signed/concurrent duplicate intake, immutable SQL evidence, denied scope/signatures, subject/unsupported-data DLQ, rollback/retry and one-time order/outbox processing. The invoice suite additionally proves v1 simulator processing and unchanged receipt lineage on duplicate delivery. Tests execute against disposable `ecs_test`, not the preserved demo.

## Remaining scope

- Outbound commands retain their existing immutable destination/operation protocol; they have **not** all been converted to the new canonical envelope.
- Other business callback handlers, operation-specific payload contracts, independent remote read-back and full branch coverage remain incomplete.
- Local shared-secret authentication is not per-connection production authentication, key rotation or verified native Fynd webhook compatibility.
- Multi-company/market credential mappings, storage/queue runtime and crash/load proof, full browser acceptance and the other 54-requirement gaps remain open.

The JSON Schema and green tests prove this bounded implementation, not all integration requirements or an actual external connection.
