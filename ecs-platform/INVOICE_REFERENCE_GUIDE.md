# SFCC customer invoice references — REQ-40

ATI remains merchant of record. SFCC creates the customer tax invoice; ECS does not generate a competing invoice, compute its tax, fetch its document or send customer communications. The Fynd-style operator interface stores a reference to the SFCC-owned document. Fynd and SFCC remain mocked in this demonstration.

## Presenter journey

1. Sign in as ATI operations and open a dispatched/delivered shipment from My orders. The historical Lumera shipment is a ready-to-use fixture; no new order is needed.
2. Open **Customer invoice references** below the fulfilment workspace. The ATI packing slip is deliberately separate and explicitly not a VAT invoice.
3. Use **Receive demo invoice reference** with a fictional invoice number. The control submits a signed `SFCC / invoice.updated` event to the real local webhook endpoint. Receipt acceptance is not business-processing success.
4. Refresh invoice references after the polling worker runs. The saved number, ISSUED/VOIDED status, source revision, issue date, document reference and processed receipt ID appear only after successful processing.
5. In Integration trace, inspect the receipt or a rejected event. An early invoice goes to the inbox dead-letter queue; after the shipment is dispatched, reasoned replay processes it and resolves the exception.

The simulator emits initial ISSUED references only. Revised and VOIDED events are supported through the signed webhook contract and tested through the API; no operator button fabricates those SFCC decisions. `sfcc.demo.invalid` is intentionally not a working document host.

## Contracts and guarantees

- Outbound SFCC `shipmentStatus` jobs now include the external order/channel, internal and Fynd shipment IDs, status, retained tracking, currency and item IDs/SKUs/quantities. They declare ATI/SFCC ownership; they do not contain invoice files or vendor commission rules.
- Inbound `invoice.updated` data: `externalOrderId`, `channel`, `invoiceNumber`, positive integer `version`, `status` (`ISSUED` or `VOIDED`), HTTPS `url`, ISO `issuedAt`, and unique nonempty `shipmentIds`. See `SfccInvoiceUpdatedData` in the generated OpenAPI 3.1 document. Unknown fields are rejected during asynchronous processing.
- Order identity must match the envelope company/market and channel. Every shipment must belong to that order and be DISPATCHED or DELIVERED. The invoice cannot predate the order. The current signed-envelope deployment remains UAE/company scoped; broader markets require their own configured mappings, not bypassing the guard.
- `SFCC_INVOICE_ALLOWED_HOSTS` is an exact, comma-separated hostname allowlist, defaulting to `sfcc.demo.invalid`. URLs require HTTPS with no credentials, query, fragment or custom port. No URL is fetched or rendered as a clickable link. This validates a reference's shape and configured origin, not the document's authenticity, contents or VAT compliance.
- Initial state must be ISSUED revision 1. The same revision/content is idempotent even under a different event ID. Conflicting, skipped and stale revisions fail. Later revisions must be sequential, keep the original order/date/shipment coverage, and cannot revive a voided invoice. A corrected replacement uses a new invoice number after voiding the old one.
- Migration 015 adds the current invoice-reference record linked to its order. The append-only audit preserves before/after revision history. Receipt IDs connect state to signed inbox evidence. Failures roll back domain changes and remain in the existing retry/DLQ/replay flow.
- `GET /api/v1/shipments/{id}/invoices` is limited to ATI super admin, operations, finance and auditor, then company/market scoped. All vendor roles and unrelated ATI roles are denied. Existing vendor order/shipment DTOs do not embed customer invoice references.
- `POST /api/v1/demo/invoices` additionally requires ATI fulfilment authority, session/CSRF and enabled demo controls. It creates only fictional signed reference events, not tax documents or payments.

## Verification and remaining scope

Two new unit tests and five PostgreSQL integration tests cover strict metadata, signed intake, role/company/market isolation, duplicate events, conflicts, sequential revision/void, URL rejection, invalid shipment coverage, premature events, replay and simulator guards. Existing fulfilment tests assert the outbound SFCC facts. Full regression: 45 unit + 65 isolated integration tests passed on 24 September 2026; TypeScript, lint and optimized Next build also passed.

Browser verification processed `cmufcmho00000t940firaec99` for `history_lumera_leg_001`, with invoice `DEMO-INV-ra_leg_001`, revision 1. Before/after read-only checks: 2 orders, 4 shipments and 8 financial events unchanged; invoice references increased from 0 to 1. No demo reset, live tenant call, public push or deployment.

Remaining: actual ATI SFCC payload/host/signature mapping, real document access and tax-compliance ownership acceptance, multi-market invoice configuration, an operator revision-history UI and the broader 54-requirement acceptance audit. This is verified local reference synchronization, not proof of production tax-invoice compliance or actual Fynd integration.
