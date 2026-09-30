# Private catalogue image uploads

REQ-11 is **partial**, not complete. Uploads, atomic individual replacement, ZIP-manifest imports/jobs, operator-approved URL ingestion/jobs and durable local DAM jobs are implemented. URL/DAM paths are verified with deterministic local sources, not actual suppliers. See [ZIP_JOB_GUIDE.md](ZIP_JOB_GUIDE.md), [MEDIA_URL_GUIDE.md](MEDIA_URL_GUIDE.md) and [DAM_JOB_GUIDE.md](DAM_JOB_GUIDE.md). Current total OpenAPI coverage is 108 operations; counts below describe earlier checkpoints. Compliance-document uploads are separate.

## Demonstration

1. As a vendor catalogue user, open an owned DRAFT, CHANGES_REQUESTED or REJECTED product.
2. Choose PNG, JPEG or WebP in **Upload product imagery**: 5 MB input/output, 128–4096 pixels per side, one still image, ten attached images maximum including samples.
3. Upload for review. Validated pixels are attached as PENDING; the catalogue version increments without publication. Expand private asset lineage for filename, dimensions, checksum, mock scan state and white-edge sample. This statistic is a human-review aid, not an AI quality classifier.
4. Submit the saved item. ATI can approve or reject each image with feedback. Rejection returns the product to CHANGES_REQUESTED and opens catalogue feedback for the vendor. Vendors can enter a correction reason, click **Replace image**, choose a corrected raster and save the replacement. Validation and the swap are atomic: failure leaves the original attached; success preserves position, increments the version once, sets DRAFT and makes the replacement PENDING. This works at the ten-image cap. The original pixels, receipt and reasoned before/after audit remain private and immutable. Same attached pixels are rejected rather than resetting approval. The legacy remove/upload and whole-set approval commands remain available.
5. Publish through ERP. The worker obtains ERP acknowledgement before Fynd/SFCC. Approved asset ID, checksum and dimensions appear in the mock Fynd product payload; raw file bytes do not.

The browser acceptance catalogue scenario uploads synthetic pixels through the file picker, reorders the primary image, rejects it, attempts an invalid replacement (original retained), atomically replaces it as the vendor, imports a duplicate through ZIP, resubmits, and individually approves it as ATI before publication. The private storefront preview loads the corrected image from the acknowledged SFCC simulator projection. Playwright does not intercept responses or fabricate publication success.

## Privacy, provenance and safety

### ZIP-manifest import

Use **Import an image ZIP** on an owned editable product. The ZIP must contain root-level raster files and `manifest.json`, for example `{"version":1,"images":[{"file":"front.png"},{"file":"back.jpg"}]}`. Every file must be declared once; entries append in manifest order. Existing attached images keep their order. The ten-image attachment cap includes existing images and excludes checksum duplicates.

The profile allows 10 MB compressed, 20 MB expanded, ten images, 5 MB per raster and a 16 KB manifest. It rejects folders/traversal, links/special files, case aliases, undeclared files, encryption, unsupported compression, corrupt size/CRC evidence and expansion above 200:1. Extraction is serial, memory-only and bounded by five seconds. Every image then passes the same decoder, mock scan and sanitization as a single upload.

The recommended **Queue ZIP import** action uses `POST /api/v1/catalog/items/{id}/media/zip/jobs` and retains the source privately for worker validation, retries and ATI-only replay; see [ZIP_JOB_GUIDE.md](ZIP_JOB_GUIDE.md). The optional direct endpoint `POST /api/v1/catalog/items/{id}/media/zip` accepts `requestId`, `expectedVersion`, `fileName` and `base64` (15 MB HTTP body limit). Both paths commit all attachments/receipts/audit together, incrementing the product once only if new pixels are attached. Any invalid image or audit failure commits no attachments. Exact request retries recover the immutable receipt set; changed reuse conflicts. Each receipt records `ZIP`, archive filename plus entry, original-image checksum, sanitized asset and product version. The immutable audit stores archive checksum, parsed manifest and receipt IDs. Only queued imports retain original archive bytes; direct synchronous imports do not.

- Sharp is a direct locked dependency. The extension must match a decoded PNG/JPEG/WebP. SVG, animation, corrupt/truncated input, oversized pixels, invalid base64 and traversal filenames are rejected. Decoding has a five-second processing timeout and pixel cap.
- Pixels are re-encoded as PNG without source EXIF/ICC metadata. Only sanitized bytes are retained; original checksum and filename remain in immutable ingestion provenance.
- Deterministic mock scanning rejects test malware/active-content signatures. A live-scanner setting or absent explicit demo mode fails closed. This is not production antivirus.
- Bounded bytes are private PostgreSQL data, not verified MinIO/S3 storage. Session, catalogue-role and company/market/partner checks guard downloads. PNG responses are no-store/nosniff with restrictive CSP. No public URL is created.
- Checksum dedup is limited to one company/partner/market. Exact request-ID retries return the original receipt; changed content conflicts. A separate upload of already-attached identical pixels records provenance without another product revision.
- Database triggers prohibit modifying/deleting asset bytes or ingestion evidence. Asset, attachment, product revision, receipt and audit commit together. Bounded retry handles checksum/request races; an injected audit failure proves rollback.
- Published, approved and in-review media cannot be changed through this endpoint. Approval/publication rechecks ownership, stored checksum and scan state. Seed illustrations retain their original explicitly local semantics.

API: `GET/POST /api/v1/catalog/items/{id}/media`, `POST /api/v1/catalog/items/{id}/media/commands`, `POST /api/v1/catalog/items/{id}/media/zip`, `GET /api/v1/catalog/media/{id}/content`. Strict metadata DTOs exclude bytes/base64. Single-image HTTP upload body limit is 8 MB for bounded base64. Media commands require an expected version, attached image URL and reason; `move` additionally requires a zero-based target position. All individual decisions increment the version atomically with the audit. Stale/concurrent decisions conflict rather than silently overwrite. Current OpenAPI coverage: 101/101.

## Verification and remaining acceptance

Seven unit tests cover decode/metadata stripping, formats/limits, mock scanner boundaries, archive integrity/manifest validation and DTO exclusions. Ten PostgreSQL media integration tests cover ownership/roles/CSRF, private download, version locks, replay/dedup, concurrent uploads/decisions/ZIP imports, SQL immutability, batch rollback, individual moderation/correction/order and mock publication payload lineage. Browser evidence and the latest full regression result are recorded in IMPLEMENTATION_STATUS.md.

Replacement API: `POST /api/v1/catalog/items/{id}/media/replace` accepts upload fields plus `replaceUrl` and a 5–1000-character reason. The UUID is bound to operation, target, expected version, content and reason. Exact retries return the original receipt, even after the product advances; different content or reuse for plain upload conflicts. It uses the upload receipt DTO; the `catalog.media-replace` audit links original and new images with their position. Concurrency, rollback, attachment/role/ownership/CSRF/version/state guards are tested in `tests/integration/catalog-media.test.ts`. Replacement of published content still requires a separate moderated-revision workflow, not unlocking the published product.

Still required: actual approved supplier/DAM connectivity verification; multi-product/import linkage; configurable quality/background policy; quotas/retention; object storage and validated production scanning. Storefront preview permits only allowlisted seed illustrations and the private authenticated media endpoint, never arbitrary external image URLs. This does not expose images to public storefront customers. DAM jobs are local simulations; private mock-payload references are not native Fynd hosting.

Actual Fynd asset hosting/import is unimplemented. A private ECS reference inside a mock payload is not a remotely usable Fynd image URL. Real account credentials, mappings, entitlements and contracts remain separate unverified dependencies.
