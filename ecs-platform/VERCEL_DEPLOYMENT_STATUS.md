# Full-stack Vercel deployment status

This is deployment preparation, **not a claim that the full-stack application is hosted**. The GitHub source release includes fictional login credentials. The currently deployed root application remains the browser-only demo until a full-stack runtime passes acceptance.

## Implemented locally

- `ECS_API_RUNTIME=embedded` opts the Next.js application into an in-process Fastify API at `/api/v1/*`. Set the same value at build and runtime. The default remains the existing external API rewrite so local presenter and acceptance environments are unchanged.
- The bridge keeps Fastify authentication, PostgreSQL sessions, partner/role scope, CSRF/origin checks, response codes, binary downloads, multiple session cookies and request-body limits. API responses are never cached.
- Initialization is lazy and shared within a warm process. A failed startup returns a redacted 503 and can retry on a subsequent request. Forwarded IP headers are not trusted; anonymous requests use a conservative shared rate-limit bucket. A hosted distributed limiter/edge protection remains necessary.

## Remaining before switching the production branch/build

1. Provision an ECS-specific hosted PostgreSQL database. No existing unrelated database may be reused or migrated. Apply all migrations and seed only this dedicated fictional demo database; keep connection strings in deployment secrets, never GitHub.
2. Supply durable private document/media storage. Local filesystem storage is unsuitable for a serverless deployment. Larger base64/ZIP imports need direct private object upload plus job references to stay within platform request limits.
3. Implement and test an explicit hosted-demo configuration. The existing production/demo prohibition remains in force; do not bypass it by setting `NODE_ENV=development` on Vercel. Keep live Fynd disabled, enable secure session cookies, and configure exact public origins and generated private secrets.
4. Host the durable job dispatcher and mock services, or implement a bounded serverless execution transport with equivalent acknowledgement/retry/replay semantics. Existing infinite local polling and loopback-only adapter destinations are not hosted workers.
5. Configure the Vercel project for the full-stack source, not the root static `public/` build. GitHub commits can trigger deployments but cannot provision missing database/storage credentials or edit Vercel secrets through the currently connected GitHub tools.
6. Verify a fresh browser login, partner isolation, document upload/download, order processing, failure/replay, returns and persistence across function restarts. Only then replace the static production deployment.

No real customer data, card details or live Fynd credentials belong in this public demo. The source release's fictional `Demo123!` accounts do not authorize publishing infrastructure secrets.
