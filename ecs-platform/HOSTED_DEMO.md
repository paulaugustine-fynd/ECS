# Working hosted ECS demo

Open [ECS demo](https://ecs-beryl.vercel.app/login).

| Workspace | Fictional login |
| --- | --- |
| ATI administrator | admin@ati.demo |
| ATI operations | ops@ati.demo |
| ATI finance | finance@ati.demo |
| Maison Azure partner | admin@maisonazure.demo |
| Partner fulfilment | fulfilment@maisonazure.demo |
| New partner onboarding | admin@ateliernoor.demo |

Password for these fictional accounts: `Demo123!`.

This is the full-stack application, not the old browser-only demo: server-side API, PostgreSQL sessions/business records, private object storage and durable simulated integration jobs. Credentials for the infrastructure are stored only in Vercel's sensitive environment variables. No real data should be entered into shared demonstration accounts.

## Demonstration evidence

- Five partners, eleven users and eight catalogue items were seeded in the dedicated Supabase database.
- A private document upload/download and partner access-denial checks passed on the hosted URL.
- Order `BLOOM-HOSTED-VERIFY-001` has three fulfilment legs. The Maison Azure leg was delivered; its return completed with a mock refund acknowledgement. Other legs remain available for a fulfilment demonstration.
- Current brand/location mappings were provisioned through the mock outbox, not fabricated as live Fynd connections.

## Boundaries

- Fynd, SFCC, ERP, Finance, WMS and Logistics integrations remain simulated.
- Workers run in bounded batches during authenticated API activity and while a visible demo page is polling. This is not an always-on production scheduler.
- Production and Preview share the dedicated fictional demo database.
- Uploads are currently limited to approximately 2.8 MB in the hosted UI.
- Hosting does not complete the 54-requirement implementation goal. That broader goal remains paused; see the existing requirements evidence register for feature gaps.

See [deployment details](VERCEL_DEPLOYMENT_STATUS.md) and [local setup](README.md).
