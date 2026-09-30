# ECS full-stack demo

The working full-stack demo is hosted at **https://ecs-beryl.vercel.app/login**.

The deployed source is [ecs-platform/apps/web](ecs-platform/apps/web), with an embedded server-side API, dedicated Supabase PostgreSQL database, private storage and bounded simulated integration workers. Vercel builds that directory, not the older static application preserved at the repository root.

## Fictional demo logins

All these accounts use password `Demo123!`:

| Login | Workspace |
| --- | --- |
| admin@ati.demo | ATI administrator |
| ops@ati.demo | ATI operations |
| finance@ati.demo | ATI finance |
| admin@maisonazure.demo | Vendor administrator |
| fulfilment@maisonazure.demo | Vendor fulfilment |
| admin@ateliernoor.demo | New partner onboarding |

Use only fictional data. Infrastructure credentials are sensitive Vercel variables, never GitHub files.

## Verified on the hosted application

- Login, PostgreSQL sessions and cross-partner access denial.
- Private Supabase document upload and byte-for-byte authorized download.
- Mock provisioning, signed order intake, three fulfilment legs, dispatch/delivery and a closed return with acknowledged simulated refund.
- Failed mock job persisted to the dead-letter queue, followed by successful replay and restored readiness.

The fictional verification order is `BLOOM-HOSTED-VERIFY-001`.

## Limits

All external business integrations remain mocked, including Fynd. Workers process bounded batches during authenticated API activity and visible-page polling; they are not an always-on production scheduler. Hosted uploads are limited to approximately 2.8 MB. Preview and Production share the dedicated fictional demo database.

The 54-requirement implementation goal is **not complete** and remains paused. Hosting completion is not full functional or production-readiness acceptance.

See [hosted demo guide](ecs-platform/HOSTED_DEMO.md), [deployment details](ecs-platform/VERCEL_DEPLOYMENT_STATUS.md), and [local setup](ecs-platform/README.md).
