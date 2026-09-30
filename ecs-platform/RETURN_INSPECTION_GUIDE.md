# Return inspection evidence and disposition

This implements the local ECS evidence portion of REQ-31. Fynd/Logistics/SFCC remain deterministic simulators; this is not confirmation of a native tenant QC feature or a real refund.

## Operator journey

1. Open a return for an actually delivered line. Approve, book the mock pickup and record receipt.
2. In **Inspection photos**, choose a PNG/JPEG/WebP and describe the visible condition. Save the photo before recording QC. Use fictional item/packaging/seal images, never customer faces, addresses or documents.
3. Review the retained image and notes, then enter the separate decision reason.
4. **QC passed · Restock** adds good stock and requests the refund/financial reversal. **QC failed · Quarantine** increments physical and damaged stock equally, so the returned item does not increase sellable stock; refund remains held and no reversal is posted yet.
5. Inspect **Recorded inspection decision**: original condition, disposition, reason, decision time and photo count are retained. A reasoned ATI refund override may proceed from Bad QC, but does not relabel the item as good or release quarantined stock.

Photos are optional evidence, not an invented mandatory-photo business rule. A decision without photos records an explicit empty evidence set. ATI must confirm its actual photo policy. Uploaded notes are immutable; if an inspection explanation is mistaken, preserve the record and clarify in the QC reason rather than silently replacing it.

## Storage and authorization

- At most six photos per return; 5 MB each, 128–4096 pixels per side. Decode and re-encode as PNG strips EXIF/location metadata. Corrupt, animated, oversized or mismatched images are rejected.
- Sanitized bytes are stored privately in PostgreSQL, not under `public/` and not in a public bucket. Original bytes are not retained; original and sanitized SHA-256 checksums record provenance. The scanner is explicitly a local mock, not production malware certification.
- ATI operations/super-admin can upload only while the return is RECEIVED. Scoped fulfilment users may read their authorized return's retained photos. Other partners, catalogue-only users, unauthenticated sessions and forged CSRF writes are denied.
- Photo bytes, identity, notes and provenance are SQL-immutable. Authorized content requests receive `private, no-store`; IDs are not public access tokens.
- Upload increments the return revision. The serializable QC transaction snapshots the exact retained photo IDs with its condition/disposition/reason/actor/time. Upload versus QC races cannot silently add an image after the decision or omit an already committed image.
- Exact upload retries recover the immutable receipt, even after QC. Changed content under the same request ID conflicts. Duplicate pixels are rejected. Audit, bytes and revision commit or roll back together.

## API surface

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/returns/{id}/evidence` | Scoped metadata; no raw bytes or internal request hash |
| POST | `/api/v1/returns/{id}/evidence` | Versioned, reasoned photo upload under authenticated CSRF protection |
| GET | `/api/v1/returns/evidence/{id}/content` | Authorized sanitized PNG |

Existing return commands keep their original state guards. New decisions append `policy.qcDecision`; historical cases without that field are not rewritten or retroactively claimed to have photo evidence. Good-QC ledger snapshots include the recorded QC facts. Bad-QC refund overrides retain the original quarantine decision.

## Verification and limits

`tests/integration/return-evidence.test.ts` exercises private content, role/partner/CSRF boundaries, immutability, idempotency, stale/concurrent requests, capacity, rollback, Good QC, Bad QC and override stock invariants. Browser acceptance uses a synthetic raster through the actual file picker and decodes the protected image; it does not visually establish the physical condition of an item.

Remaining: signed external QC callbacks/reconciliation, production object storage/scanning, approved retention/erasure policy, broader disposition choices and reasoned stock-disposition overrides. A refund override is not a stock-disposition override. This page does not implement exchanges, collection appointments or carrier-label generation.
