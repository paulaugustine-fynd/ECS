# Configurable notification routing

ATI super administrators can open **Notifications → Configure notification routing** at `/operator/notifications/routing`. This extends REQ-28/49 with company/market/category/severity recipient-role policies; it does not complete every notification requirement.

## Workflow and safeguards

1. Select an authorized market. Eight rows show SLA, catalogue, integration and shipment-investigation warning/critical policies, their revision and active ATI recipient counts.
2. Configure a row, select authorized recipient roles, and enter an audit reason of at least ten characters. Selecting demo defaults only changes the form until Save is pressed.
3. Save a versioned revision. Concurrent stale saves fail and require refresh; unchanged selections are rejected. At least one selected ATI role must currently have an active user in that market.

Critical routing must retain ATI super admin. Integration alerts never target vendors. Catalogue and SLA policies are limited to roles already authorized for those workflows; routing is not a permission grant. Vendor delivery always matches the originating company, market and partner. The preview counts ATI users and vendor roles, not a promise that every partner has an active user in each selected role.

Policies apply to the next delivery evaluation, including already-active SLA warnings/breaches revisited by polling. Previously delivered notices and read/unread state remain unchanged. Existing users are deduplicated by event key; newly eligible recipients can receive an active SLA alert. Historical notice access still requires the user's current workflow role and scope, independently of their current delivery subscription.

No saved row means the explicit demo default, revision 0. New deliveries store the policy revision; older deliveries retain revision 0. Active-user coverage is checked at save time, not guaranteed forever after subsequent account changes. The reserved integration WARNING policy does not invent warning events: current dead-letter failures emit CRITICAL.

## API and persistence

- `GET /api/v1/notification-policies?market=AE`: ATI-super-admin-only matrix with allowed roles, defaults and aggregate counts; no user emails or recipient identifiers.
- `POST /api/v1/notification-policies`: market, category, severity, expectedVersion, atiRoles, vendorRoles and reason. Session, CSRF, company/market scope, optimistic concurrency and audit are enforced.
- Additive migration `202609250019_notification_policies`; database constraints also enforce the category/role boundary and mandatory critical escalation. No existing notifications or business records are deleted or reclassified.

## Verification — 25 September 2026

47 unit and 85 isolated PostgreSQL integration tests pass (132 total), alongside TypeScript, ESLint and the optimized Next build. Four routing tests cover authorization, strict input/DTOs, active-recipient rejection, audited revision changes, concurrent saves, delivery changes, history preservation, event deduplication, partner isolation and direct SQL guard rejection.

OpenAPI validates 84 operations, with 58 documented success responses and 26 remaining response-contract gaps. This remains a partial project checkpoint, not full 54-requirement acceptance.

Manual browser inspection verified all six default rows and the critical-policy editor, including mandatory admin selection and disabled unchanged Save. No policy was saved against the preserved demo; mutation behavior was tested in isolated `ecs_test`. Additive demo migration retained 2 orders, 4 fulfilment legs and 8 ledger events. The existing Northline exception remained open and unassigned. This is not an automated browser regression suite.

## Still pending

Subsequent shipment-report checkpoint adds FULFILMENT routing, bringing the matrix to eight rows. Report/ATI-resolution events link directly to their scoped investigation. See [SHIPMENT_ISSUES_GUIDE.md](SHIPMENT_ISSUES_GUIDE.md). The updated suite passes 137 tests; the earlier totals above describe the original routing checkpoint.

Email/Mailpit delivery, personal preferences, digests, repeated timed escalation, richer responsibility hierarchies and real Fynd event ingestion. All current delivery is private and in-app; no email, SMS, customer message or actual Fynd operation is sent.
