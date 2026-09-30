# Durable ZIP imagery — local demonstration

REQ-11 remains partial. This workflow adds background ZIP ingestion to the same scoped worker used for DAM and URL jobs. It does not connect to Fynd, a supplier DAM, production malware scanning or object storage.

## Presenter journey

1. Open an owned editable product. Under **Import an image ZIP**, select a ZIP containing root-level PNG/JPEG/WebP files and `manifest.json`: `{"version":1,"images":[{"file":"front.png"},{"file":"back.jpg"}]}`.
2. Choose **Queue ZIP import**. The request stores an immutable private archive and pending job together; no images are attached yet. Keep the product unchanged while the job runs.
3. Use **Refresh ZIP jobs**. The worker validates every entry, sanitizes every image, and commits attachments, ordered receipts, product revision and audit atomically. New images remain PENDING for ATI review. Checksum duplicates retain source receipts without duplicate attachments or unnecessary product revisions.
4. For recovery, select the explicit **Exhaust retries, then ATI replay** demo scenario before queueing. Three simulated transient failures produce DLQ. An ATI catalogue moderator may provide a reason and replay the current job version; the fourth attempt succeeds. Vendors cannot replay jobs.
5. Corrupt content or a changed product is a permanent failure. Correct the archive and queue a new request at the current product version. Replay cannot replace retained source bytes or override stale-version checks.

The optional **Direct synchronous ZIP import** disclosure retains the existing immediate endpoint; it has no durable job or automatic retry and does not retain source ZIP bytes. Failure injection applies only to queued imports.

## API and storage

- `POST /api/v1/catalog/items/{id}/media/zip/jobs`: UUID `requestId`, `expectedVersion`, ASCII ZIP `fileName`, canonical `base64`, optional `demoFailures` (0–3). HTTP body limit 15 MB; decoded ZIP limit 10 MB. Ownership, role, CSRF, state and version apply before storage.
- Job creation, private `MediaSourceArchive` and queue audit commit together. Exact replay returns the existing job; changed reuse conflicts. SQL rejects archive updates/deletion and source/owner/destination rebinding. Source checksum and size are verified before processing.
- `GET /api/v1/catalog/items/{id}/media/jobs`: latest 50 scoped source jobs, filtered to ZIP by this UI. Progress includes `receiptIds` (maximum ten) and the first `receiptId` for compatibility; raw bytes, lease token, request hash and internal destination are excluded. There is no raw-archive download route.
- `POST /api/v1/catalog/media/jobs/{id}/replay`: ATI-only, current version and reason required. Original actor authorization, product version and ownership are checked again before new ingestion.
- Migration 027 adds the archive table, ZIP binding constraints and receipt arrays; historical DAM/URL `receiptId` values are backfilled into arrays without changing their destinations.

Queue acceptance is quarantine, **not** validation or malware clearance. Parsing happens in the worker: up to ten images, 20 MB expanded total, 5 MB per image, bounded manifest, CRC/size and compression-ratio checks. Traversal, folders, links, encryption, undeclared files and case aliases are rejected. All images must validate before a single atomic attachment transaction. Archive bytes never execute or extract to the filesystem.

The worker uses a 60-second lease, conditional acknowledgements, three attempts per cycle and audit history. After attachment commits but acknowledgement fails, the next attempt recovers the complete immutable receipt set without parsing/attaching/revising again. Infrastructure failures retry; invalid content and authorization/version failures dead-letter.

## Evidence and limits

Six ZIP integration cases in `tests/integration/media-source-jobs.test.ts` cover quarantine/privacy, manifest order, worker races, immutable source binding, invalid-content rollback, queue/import audit rollback, committed-receipt recovery, retry/replay authority and stale/unauthorized work. The browser catalogue journey queues a duplicate archive through the file picker, observes worker success and continues through human approval and mock publication. Unit DTO checks reject raw archive fields and oversized receipt lists.

Remaining: source quotas/cancellation/retention, multi-product/import linkage, configurable quality policy, validated production scanner/object storage, actual supplier/DAM connectivity and native Fynd media delivery. Immutable source retention currently means no purge path; production retention and storage capacity must be designed before rollout. Local synthetic-image tests are not visual-quality or production-security acceptance.
