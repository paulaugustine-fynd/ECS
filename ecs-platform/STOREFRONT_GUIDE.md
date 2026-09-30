# Storefront visibility evidence — local SFCC simulation

This implements the demo visibility prerequisite for **REQ-19**, complementing the ERP-first publication journey in **REQ-18** and the ATI merchant-of-record boundary in **REQ-01**. It does not prove visibility on Bloomingdale’s actual SFCC site and does not connect to actual Fynd.

## Demonstration

1. Open **My products → a product**. Complete validation, moderation and **Publish through ERP** as usual. SFCC publication now persists a distinct downstream customer-content record, not just an acknowledgement string.
2. Select **Check storefront**. Passing requires current ERP/Fynd/SFCC publication identities, a current successful SFCC command, matching downstream company/partner/market/version/identity and content fingerprint, and a visible record.
3. For valid previously seeded published items, ATI moderators/admins can select **Refresh SFCC simulator content**. This queues a new guarded, auditable local command. A fabricated seeded publication flag alone is insufficient evidence. The refresh can repair missing, hidden or drifted simulator content; ordinary retries retain their idempotency keys.
4. The private preview displays the stored downstream English or Arabic title, exact price, approved demo image, public product attributes and Al Tayer merchant identity. It does not expose vendor IDs, floor prices, commission, review notes or arbitrary internal attributes. Checkout is disabled. Only allowlisted local demo illustrations are loaded; external media references are not fetched by the preview.
5. Open partner readiness. At least one current published SKU must have verified visible content. The isolated test selects a SKU with this evidence. Hiding/removing/changing that record invalidates readiness, even if an older test passed. Activation remains a separate command requiring every gate.

## Persistence and safety

- Migration 014 adds `MockStorefrontProduct`, with downstream version, identity, visibility and customer-content fingerprint. No seeded read-back is silently fabricated and no existing demo data is reset.
- `upsertProduct` checks current content/identity before transport and acknowledgement. SFCC acknowledgement also checks stored read-back. An old version cannot overwrite a newer simulator record.
- `publishStorefront` is mock-only, company/partner/market bound and rechecked before and after transport. No company credentials, public webhook or live system is required.
- `GET /api/v1/catalog/items/:id/storefront` is authenticated and company/market/partner scoped. It returns customer content only when evidence passes; otherwise it returns the blocker without presenting an unverified preview.
- `POST /api/v1/catalog/items/:id/commands` with action `refresh-storefront` requires current version, ATI catalogue authority and CSRF protection. It does not change the canonical product version, stock, customer orders or financial ledger.

## Test evidence and limits

Automated tests cover ERP-first persistence, missing/hidden/drifted content, repair, private-field exclusion, exact decimal formatting, owner/role/CSRF isolation, stale-command rejection before transport, older downstream revision rejection, and invalidation of launch evidence when storefront visibility disappears. The integration suite exercises the same guarded handlers and HTTP mock service against isolated PostgreSQL.

This is an authenticated evidence preview within the operations console, not a replacement customer storefront. It does not implement SFCC cache/search-index propagation, channel assignment, real browsing sessions, checkout, payments, translation generation or complete locale-aware taxonomy. Only the product title/layout is switched for Arabic; attribute labels remain English in this checkpoint. At least-one-visible-SKU readiness is the current demo policy, not proof that the entire assortment or every market is live.
