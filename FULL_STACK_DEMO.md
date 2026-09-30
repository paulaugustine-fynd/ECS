# ECS full-stack demo source

The full-stack demo is in [ecs-platform](ecs-platform/README.md). This branch preserves the existing browser-only Vercel application at the repository root. Deploying this branch with the existing Vercel settings still serves that static application; it does not host the full-stack API or worker.

## Fictional demo logins

All these local demo accounts use the password `Demo123!`:

| Login | Role |
| --- | --- |
| admin@ati.demo | ATI administrator |
| ops@ati.demo | ATI operations |
| finance@ati.demo | ATI finance |
| admin@maisonazure.demo | Vendor administrator |
| fulfilment@maisonazure.demo | Vendor fulfilment |
| admin@ateliernoor.demo | New partner onboarding |

Full account list and setup: [ecs-platform/README.md](ecs-platform/README.md). Use only fictional data. These shared accounts are for an isolated demo, not a public production tenant.

## Start locally

```sh
cd ecs-platform
cp .env.example .env
docker compose up -d
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev:local
```

Open http://localhost:3000. PostgreSQL polling runs the durable worker explicitly; Redis/BullMQ and S3/MinIO runtime verification remain pending. All external systems use mocks. Do not seed a production database.

## Release evidence and limits

- 94 unit tests and 218 PostgreSQL integration tests passed.
- Strict TypeScript, ESLint, 121/121 OpenAPI response contracts and optimized Next build passed.
- Last isolated Chromium run passed 14 scenarios before the final receipt-contract tightening.
- All 54 requirements are tracked, not fully accepted: 50 partial and 4 not implemented.
- Real credentials, local environment files, database contents, uploads, node_modules, browser reports and confidential input documents are excluded.

A hosted full-stack demo needs a PostgreSQL database, private API/mock-service/worker hosting, persistent document storage and restricted access. Keep demo controls isolated; the current guard intentionally rejects demo mode in a production runtime. Do not disable that guard just to deploy on Vercel.
