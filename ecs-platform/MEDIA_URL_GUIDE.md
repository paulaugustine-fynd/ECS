# Approved-source image URL ingestion

This is a local-demo REQ-11 capability, not a verified live supplier or Fynd media connection.

## Presenter workflow

Open an editable product as its vendor catalogue user. Under **Import imagery from a source URL**, choose **Use local supplier sample**, optionally select **Fail first attempt, then retry**, then **Queue URL import**. Use **Refresh URL jobs** to see the actual worker progress. The exact alias `demo://supplier/front.png` maps to `/media-demo/front.png` on the captured IPv4 loopback mock service. The returned blue raster is synthetic, not product photography or vendor DAM content. It must pass the same sanitizer and human moderation gate as upload/ZIP imagery. Avoid editing the draft until the job completes; a changed revision dead-letters the old job rather than overwriting the newer product.

`POST /api/v1/catalog/items/{id}/media/url/jobs` accepts a UUID `requestId`, `expectedVersion`, `url` and optional demo-only `demoFailures` (0–3). Queue-time policy validation performs no DNS or HTTP request. Migration 026 adds immutable `sourceType` to the shared media-job table, defaulting existing rows to DAM without redirecting them. Ownership, original requester, product version, source URL, destination origin and scenario are frozen. Public progress includes source type but excludes leases and private request metadata.

The actual polling worker uses the same lease, bounded attempts, audit and ATI-only reasoned replay as [DAM jobs](DAM_JOB_GUIDE.md). Retryable URL failures are DNS/network/timeout/truncation, HTTP 429 and HTTP 5xx; redirects, policy denial, invalid pixels and stale/unauthorized work dead-letter immediately. Three attempts per cycle are allowed. Replay retains the original source and product revision and rechecks current policy; it cannot override a revoked host or stale product. The destination for a queued demo alias is unaffected by changing `MOCK_ORIGIN`. Remote hosts must still be approved on each attempt, with DNS/IP revalidation and pinning per download. A stable job ingestion key recovers committed pixels after a failed job acknowledgement without fetching or revising twice. New attachments remain PENDING.

The **Direct synchronous import** disclosure retains `POST /api/v1/catalog/items/{id}/media/url`, accepting UUID `requestId`, `expectedVersion` and `url`. It has no durable status or automatic retry; exact request replay returns its receipt without a second download. Both paths perform product role/ownership/state/version checks before network activity and use the atomic owned-asset/draft/audit transaction, including the ten-image cap. Immutable lineage retains source URL, original byte checksum, sanitized asset checksum and product revision. Stored source URLs cannot contain credentials or signed query strings.

## Optional operator-approved remote source

`MEDIA_URL_ALLOWED_HOSTS` defaults to empty. Remote downloads are denied unless the operator explicitly configures an exact lowercase hostname after approving that source. No real supplier host was configured or contacted during implementation. Do not set wildcard domains or put secrets in URLs. Only canonical HTTPS direct PNG/JPEG/WebP paths on port 443 are accepted; URL credentials, query strings, fragments, IP literals, trailing-dot hostnames, encoded paths and alternate ports are rejected. Signed/private DAM URLs need a separate authenticated adapter, not relaxation of this boundary.

DNS resolves IPv4 A records with bounded resolver settings. Every returned address must pass the conservative special/private-address exclusions. A validated address is supplied to the HTTP request lookup callback, preventing a second DNS lookup from changing the target. IPv6-only sources are unsupported. HTTPS retains the original hostname for normal certificate/SNI validation. Requests do not forward application cookies or credentials, do not follow redirects, use a fresh non-pooled connection, and request identity encoding. A 10-second download deadline, 16 KB header cap and both declared/streamed 5 MB limits bound the response. MIME must match the raster suffix; truncated/empty or content-encoded bodies are rejected. Sanitization and the explicitly mock scanner still run before storage.

The demo alias is the only HTTP/private-address exception and only uses the configured `127.0.0.1` mock origin in explicit non-production demo mode. It cannot select arbitrary internal paths, hosts or URLs.

## Evidence and remaining work

- Five URL unit tests exercise canonical-host policy, literal/private/special addresses, mixed DNS sets, mock-origin restrictions, queued origin matching and transient/permanent response classification.
- Two catalogue integration cases verify real loopback fetch, immutable source lineage, replay without refetch, ownership/CSRF/state/version boundaries and no partial product mutations for denied sources.
- Three real loopback transport cases exercise bounded bodies without forwarded credentials, rejected redirects/MIME and streamed overflow/truncation.
- Five additional job integration cases cover network-free queueing, idempotency and cross-type request conflicts, concurrent workers, pinned loopback destination under environment changes, SQL source immutability, transient retries/exhaustion/ATI replay, revoked host, stale work, CSRF/partner isolation and acknowledgement recovery without refetch.
- The browser journey queues the mock URL with one simulated transient failure, waits for the real worker's second-attempt success and unlinks its attachment while retaining lineage, alongside atomic file replacement and ZIP/publication checks.

Public DNS/TLS connectivity to an approved supplier has not been exercised. This implementation is not a production SSRF/security certification. Remaining work includes durable ZIP jobs, configurable source management, authenticated live DAM, multi-product import linkage, production scanning, quotas/retention and object storage. Actual Fynd image hosting/import remains unimplemented. Runtime evidence remains local PostgreSQL polling, not Redis/BullMQ or an always-on Vercel worker.

Technical references checked 28 September 2026: [Node HTTPS request options](https://nodejs.org/api/https.html), [Node DNS resolver API](https://nodejs.org/api/dns.html), [IANA special-purpose IPv4 registry](https://www.iana.org/assignments/iana-ipv4-special-registry). Exclusions intentionally reject some globally reachable special-purpose ranges; they are not an exhaustive claim about arbitrary networking environments.
