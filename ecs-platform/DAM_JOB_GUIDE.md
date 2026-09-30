# Durable DAM imports — local simulator

REQ-11 remains partial. The product page now has a **Vendor DAM · local connector** panel backed by PostgreSQL jobs and the actual polling worker. This is not a live vendor DAM or native Fynd asset-hosting integration. [Queued URL imports](MEDIA_URL_GUIDE.md) and [queued ZIP imports](ZIP_JOB_GUIDE.md) share the worker and replay controls; optional direct URL and ZIP imports remain synchronous.

## Demonstrate the failure/recovery workflow

1. As an owned vendor catalogue user, open an editable product. Choose `studio-front` or `studio-back`; both return deterministic synthetic raster pixels.
2. Select **Exhaust retries, then ATI replay** and queue the import. This is an explicit demo fault injection, not an observed supplier outage.
3. Use **Refresh DAM jobs**. Three failed attempts produce DLQ. The original product and media are unchanged while those failures occur.
4. As ATI super-admin or catalogue moderator, enter a replay reason and replay the current job version. The fourth total attempt succeeds because the three simulated failures are exhausted. The new image is attached PENDING, not auto-approved or published.
5. Review the image through the existing per-image workflow. The stored source is `demo-dam://studio-front@demo-v1` (or back), with original/sanitized checksums and private receipt lineage.

Use a draft without simultaneous edits: the job pins the expected product version. If the draft changes, the job is dead-lettered with STALE_VERSION; queue a fresh request at the current reviewed version rather than expecting replay to overwrite it.

## Contracts and execution

- `GET/POST /api/v1/catalog/items/{id}/media/jobs` lists the latest 50 scoped DAM/URL/ZIP jobs or queues a new DAM request. Request fields: UUID `requestId`, `expectedVersion`, `sourceRef`, and optional `demoFailures` (0–3). Each UI panel filters by the public `sourceType`; URL and ZIP queueing use separate endpoints.
- `POST /api/v1/catalog/media/jobs/{id}/replay` requires ATI catalogue authority, the current job `expectedVersion`, and a meaningful reason. Vendors can view their own job progress but cannot replay it.
- Queue identity is company/request-ID scoped and payload-bound. SQL guards freeze product/company/partner/market/requester, original version, source, destination, correlation and demo scenario; existing jobs cannot be redirected by later environment changes. Public DTOs exclude lease tokens, requester internals, request hashes and destination details.
- The worker uses a conditional PostgreSQL lease claim (60 seconds). Competing dispatchers cannot claim the same unexpired job. Completion/failure updates require the current lease token. Expired leases can be reclaimed.
- Transient source/worker failures use a maximum of three download attempts per cycle with exponential delay; permanent authorization/content/version failures dead-letter immediately. Recovery after a crashed third lease can record a recovery attempt without making another download once its attempt budget is exhausted.
- Each claim, retry, failure, replay and completion is retained in the existing append-only audit. Replay starts a new cycle but preserves total attempts, the original binding and prior audit history.
- The original requester is reloaded and permission/product scope checked before a new import. A stable job-specific ingestion key recovers already-committed attachment evidence if acknowledgement fails, so recovery does not download or revise twice.
- The mock DAM GET endpoint authenticates with the configured local mock secret, pins a canonical loopback destination and disallows redirects. Its bounded response identifies the asset reference/revision and original checksum. Sanitization/mock scanning and normal human approval remain mandatory. Live DAM authentication, tenant authorization and vendor entitlements are not implemented.
- `pollMediaJobs` runs from both worker entrypoints. Verified runtime is the existing local PostgreSQL polling worker; this does not establish Redis/BullMQ deployment acceptance. There is no standalone always-on worker on Vercel in this checkpoint.

## Evidence and remaining scope

Two contract unit cases and five PostgreSQL integration cases cover request/DTO boundaries, exact request replay, concurrent workers, pinned destinations, immutable SQL bindings, retry exhaustion, ATI-only replay, committed-attachment recovery, stale work, CSRF/partner isolation, expired leases and revoked requester access. A fourth Chromium scenario exercises the real background worker and ATI replay without setting job status directly. Full verification results are in IMPLEMENTATION_STATUS.md.

Remaining: live vendor DAMs; source configuration and credentials management; cancellation and operational retention/quotas; multi-product source mapping; production malware scanning/object storage; comprehensive queue observability/load testing; and native Fynd asset hosting/import verification. No confidential pack or job data is approved for public deployment by this work.
