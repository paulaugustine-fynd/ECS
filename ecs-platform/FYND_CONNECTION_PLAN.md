# Connect ECS to the actual Fynd test company

User decision: development/test company. Company ID, confirmed API origin and company-scoped client credentials are still required. No actual Fynd request has been made. Local mock workflows remain unchanged.

29 September access update: the desktop has an `event-marketing` MCP server configured and 572 Fynd tools loaded. Configuration/tool availability is verified; authenticated access, tenant identity and development-company scope are not yet verified. MCP authorization is separate from the ECS application's runtime credentials and does not make queued mock operations live. Rotate any credential exposed in chat before further use; do not copy it into this repository.

## 1. Establish authenticated read access

In the chosen Fynd company, use Company → Developers → Clients. Supply a dedicated least-privilege client permitted to read the company profile; do not use a consumer/storefront token or browser session cookie. Confirm exact available permissions in that account rather than assuming wildcard access.

Enter company ID, client ID and secret in the ignored `.env.fynd.local` file, then enable `FYND_CONNECTION_ENABLED=true`. Do not paste the secret into chat. `pnpm fynd:check` exchanges client credentials for a temporary token, reads the configured company profile, verifies its UID, and outputs only connection metadata. It never stores/prints tokens, follows redirects or writes business data. The test-company designation is user-confirmed; profile access does not independently establish sandbox isolation.

The initial host allowlist contains only the documented `https://api.fynd.com`. If the account uses another Fynd test cluster, verify its official origin before extending the allowlist. Do not send credentials to guessed hosts.

## 2. Map and isolate before enabling operations

- Record actual company/application, brand, product, SKU/size/article and selling-location identifiers and permitted markets. Never reuse `seed-*` or `mock-*` IDs as real identifiers.
- Select one dedicated test brand, one location and a small test assortment, disconnected from customer-facing channels, notifications and real carriers/payments.
- Mock jobs now have immutable mode/origin and ECS company/partner/market binding. Changing `FYND_MODE` cannot redirect them. Actual Fynd company/connection mappings still need implementation after tenant identification; they are not inferred from ECS company IDs.
- Verify schemas, scopes, currencies, taxonomy, rate limits, OMS state transitions and entitlements against this tenant.

## 3. Implement and validate one operation at a time

1. Read back brands, products and location inventory using the confirmed permissions.
2. Implement actual catalogue and inventory adapters, explicit mappings and read-back reconciliation.
3. Implement one test-order lifecycle using the tenant's order/shipment API contract. Do not assume the current mock's separate create-order/create-shipment calls map one-to-one to Fynd APIs.
4. Add authenticated webhook callbacks, deduplication, retries and reconciliation. Webhook registration needs an approved reachable HTTPS endpoint; do not expose the local demo or register subscriptions implicitly.
5. Exercise pause/zero-stock, split fulfilment and returns only within the approved test assortment. No payment/refund/carrier execution without separate validation and authority.

ECS retains ATI onboarding, brand-rights governance, commercial terms and concession statements. SFCC/ERP/Finance connections remain separate work. Actual Fynd operational coverage is demonstrated only by acknowledged API calls and read-back evidence—not by UI badges or mock results.

## Current implementation and evidence

- Implemented isolated read-only credential/profile probe; not connected to worker or UI.
- Unit tests use a stub transport; they do not establish an actual Fynd connection.
- Outbox migration 010 pins existing local demo commands to the original loopback mock service on port 4100. New commands explicitly capture their destination. Database guards prevent changing command ownership, payload or destination, including on replay. New live-mode commands are rejected; mock requests cannot target public origins or follow redirects. A configuration change during a chained workflow may stop it for review rather than create live child jobs.
- For a legacy database previously using another mock port, inspect and prepare its migration before applying 010; do not silently rebind jobs. This migration was verified only against the known local demo and isolated test databases.
- Full live operational adapter, webhook callbacks, tenant mappings and test-company verification remain pending.

Sources checked 23 September 2026: [Fynd authentication](https://docs.fynd.com/partners/commerce/headless/authentication/) and [company-profile API](https://docs.fynd.com/partners/commerce/sdk/latest/platform/company/companyprofile).
