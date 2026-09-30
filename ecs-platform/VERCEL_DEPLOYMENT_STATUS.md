# Full-stack Vercel deployment status

This source now includes an isolated hosted-demo runtime. Deployment is not complete until hosted acceptance passes. Fictional demo credentials may be published; infrastructure secrets may not.

## Hosted configuration implemented

- Vercel Root Directory: `ecs-platform/apps/web`, Framework: Next.js, Build: `pnpm run build`, output default. Include files outside the root directory.
- Connect the dedicated Supabase resource as sensitive environment variables. Set `ECS_API_RUNTIME=embedded`, `ECS_HOSTED_DEMO_PROJECT` to its project reference, and `WEB_ORIGIN` to the exact HTTPS app origin.
- Server-only configuration validates `POSTGRES_PRISMA_URL`, the Supabase URL and service-role key, uses the private `ecs` schema, derives mock signing secrets and refuses live adapters. It never uses a production `NODE_ENV` bypass.
- First API initialization seeds only an empty database under a transaction/advisory lock. Existing partners prevent reseeding. No hosted reset is exposed.
- Documents use the private `ecs-demo-documents` bucket and authorized API downloads. No public object URLs are generated.
- The inline simulator retains durable outbox/inbox, leases, acknowledgements, idempotency, retries and replay. Bounded worker runs are triggered by authenticated API requests and a visible-page heartbeat. Jobs stay saved while idle; this is not an autonomous always-on production worker.
- Hosted base64 uploads are limited to about 2.8 MB per file by serverless request size. Larger archives need a future direct-upload workflow.
- Production and Preview share this dedicated fictional demo database, not separate tenants. Each separately accessed deployment needs its own correct `WEB_ORIGIN` for mutations.
- The cloud schema was provisioned through a consolidated Supabase migration. Reconcile Prisma migration history before applying future migrations through Prisma CLI.

Local pre-release checks passed: TypeScript, ESLint, 103 unit tests, six embedded-API/inline-simulator integration tests, and production build from the application directory. Hosted acceptance remains required.

## Implemented locally

- `ECS_API_RUNTIME=embedded` opts the Next.js application into an in-process Fastify API at `/api/v1/*`. Set the same value at build and runtime. The default remains the existing external API rewrite so local presenter and acceptance environments are unchanged.
- The bridge keeps Fastify authentication, PostgreSQL sessions, partner/role scope, CSRF/origin checks, response codes, binary downloads, multiple session cookies and request-body limits. API responses are never cached.
- Initialization is lazy and shared within a warm process. A failed startup returns a redacted 503 and can retry on a subsequent request. Forwarded IP headers are not trusted; anonymous requests use a conservative shared rate-limit bucket. A hosted distributed limiter/edge protection remains necessary.

## Original deployment checklist (items 1–5 now implemented; hosted acceptance pending)

1. Provision an ECS-specific hosted PostgreSQL database. No existing unrelated database may be reused or migrated. Apply all migrations and seed only this dedicated fictional demo database; keep connection strings in deployment secrets, never GitHub.
2. Supply durable private document/media storage. Local filesystem storage is unsuitable for a serverless deployment. Larger base64/ZIP imports need direct private object upload plus job references to stay within platform request limits.
3. Implement and test an explicit hosted-demo configuration. The existing production/demo prohibition remains in force; do not bypass it by setting `NODE_ENV=development` on Vercel. Keep live Fynd disabled, enable secure session cookies, and configure exact public origins and generated private secrets.
4. Host the durable job dispatcher and mock services, or implement a bounded serverless execution transport with equivalent acknowledgement/retry/replay semantics. Existing infinite local polling and loopback-only adapter destinations are not hosted workers.
5. Configure the Vercel project for the full-stack source, not the root static `public/` build. GitHub commits can trigger deployments but cannot provision missing database/storage credentials or edit Vercel secrets through the currently connected GitHub tools.
6. Verify a fresh browser login, partner isolation, document upload/download, order processing, failure/replay, returns and persistence across function restarts. Only then replace the static production deployment.

No real customer data, card details or live Fynd credentials belong in this public demo. The source release's fictional `Demo123!` accounts do not authorize publishing infrastructure secrets.
