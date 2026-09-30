# Catalogue import workflow

This local implementation covers staged CSV, data-only Excel/XLSX and authenticated REST ingestion, including a source-field mapping preview for file uploads. It does not claim SFTP or actual Fynd ingestion support. Per-product media jobs are implemented separately; bulk import/media linkage remains pending.

## Presenter journey

1. Sign in as ATI admin/catalogue moderator or a vendor admin/catalogue manager. Open Catalogue imports. Download the defined template.
2. Upload the supplied `catalog_import_demo.csv` from the private build pack. It spans partners, so use ATI—not a vendor account. Use **Preview source columns**, map required targets and explicitly ignore unused columns, then **Refresh mapping preview** until ready. Canonical template headers map by identity; custom `shade` may map to `colour`. Optional exact value conversions can map `Lips` to `Beauty/Makeup/Lips` or `Midnight` to `Black`. Click **Validate and save batch**. The supplied file contains existing SKUs, invalid sample GTINs, missing Arabic/category content, a below-floor handbag and a suspended vendor/location. These are intentionally visible errors; existing catalogue records are never overwritten.
3. Inspect a row. The drawer lists all issues, editable content and available similar-product links. Complete its category-specific attributes. Only local sample asset paths are accepted in this checkpoint.
4. Correct the row into a genuinely new **fictional** demo SKU if demonstrating creation. Record that provenance in the reason. Do not change a real product's identity merely to bypass duplication. Exact duplicate rows should be excluded or corrected at their existing product, not force-imported.
5. Exclude defective rows with reasons, or fix every remaining included row. ATI may review a probable duplicate as a distinct product with evidence; exact SKU/GTIN and repeated parent variants remain blocked. Any subsequent row edit invalidates that decision.
6. Submit the included rows. ECS rechecks current permissions, rights, duplicates, mappings and floors atomically. Products are created in `IN_REVIEW`; opening inventory is non-sellable, media remains pending and no publication job is created.
7. Open the created product. Continue through ATI media/product review, then the existing ERP-first mock publication workflow. Successful import is not successful publication and is not evidence of an actual Fynd connection.

The browser-verified local batch is `cmuf529nl0000t9zl4kokuh0y`: one fictional `LUM-LIP-DEMO-CORAL` product submitted and four source rows excluded. Original source products remain unchanged. Its SKU/GTIN should not be reused for another new-product demonstration.

## Data and validation contract

- Original source-keyed and canonical corrected rows are separate. Source checksum, immutable versioned mapping, uploader, request key, revisions and audit entries are persisted. Original rows, mapping and submitted batches cannot be updated at the database level. Parsed source values are retained, not the original binary file; CSV parsing already trims whitespace. Legacy batches retain null mapping without inventing historical evidence.
- CSV bounds: UTF-8, 256 KB, 1–100 product records, at most 500 characters per field and 1–50 unique safe headers of at most 80 characters. Custom headers require mapping or explicit ignore; missing required targets, duplicate source use, inconsistent columns and malformed quoting prevent staging. Header-only files are templates, not valid batches. The low-level strict template parser remains available for canonical callers.
- Excel bounds: `.xlsx` only, 256 KB, one visible `Catalogue` worksheet, header in row 1 and 1–100 consecutive product rows. Use the downloadable Excel template at `/templates/ecs-catalogue-template.xlsx`. It has text-formatted identifier columns and numeric price/quantity columns. Headers and business validation are shared with CSV/API; the source remains `XLSX` in history and audit. Legacy `.xls` and `.xlsm` are not supported.
- Excel text and rich/shared strings retain Unicode and leading zeros. Discovery remembers numeric source columns; only mapped prices/quantity may use them. Other mapped numeric columns block staging with an explicit text-storage issue. Ignored columns are not product input. Formulas (even with cached results), dates, percentages, errors, hidden rows/columns, merged cells and ambiguous/multiple sheets are rejected. Paste values into the template rather than relying on spreadsheet calculations.
- XLSX archives are read in memory, never extracted. ZIP entry count, individual/total expanded size, entry-name validation, encrypted entries, duplicate entries, XML depth and field/row bounds are checked. Macros, embedded binaries, XML entity declarations and external relationships are rejected; no relationship or image URL is fetched. Limits are 64 archive entries, 1 MB per expanded entry and 4 MB total. This is a bounded local data-import profile, not an antivirus service or support for every Excel feature.
- Required header names match the supplied file: `partner_code,brand,vendor_sku,gtin,parent_sku,title_en,title_ar,category,colour,size,list_price,selling_price,currency,image_url,location_code,quantity`.
- Optional header names: `material,country_of_origin,skin_type,finish,scent`. Values become mandatory according to the category. Import preserves text identifiers, including leading GTIN zeroes. It does not calculate spreadsheet formulas.
- Example AE demo floors are declared in `packages/domain/catalog-import.ts` and cannot be set by an upload. These sample brand/category policies are not evidence of ATI-wide minimum advertised price rules.
- Parent families must retain partner, brand and category. Size/colour variants cannot repeat. Brand/category/title-token similarity of 0.8 or greater is a human-review candidate, except distinct size/colour siblings of the same family. This deliberately limited heuristic is not AI or image-based duplicate detection.
- Vendor uploads contain only their own partner code. Operator mixed batches are private to operator catalogue roles. New products become visible to their owning vendor under normal product isolation.
- Validation reports are authenticated, scoped CSV downloads. Formula-like cell values are escaped. Reports are snapshots; submission revalidates against current database state.

## Local REST endpoints

All endpoints require an ECS session with catalogue permissions. POST also requires the session CSRF token and an allowed browser origin. This is not yet a machine-to-machine integration credential scheme.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v1/catalog/imports/metadata` | Permitted partners/locations, template columns, sample assets and policies |
| `GET /api/v1/catalog/imports/template` | Download header template |
| `GET /api/v1/catalog/imports` | Latest 50 scoped batches |
| `POST /api/v1/catalog/imports` | Stage `CSV` content, `XLSX` base64 or `API` rows with a UUID request key |
| `POST /api/v1/catalog/imports/preview` | Read-only file inspection, mapping completeness, numeric-column issues and up to five raw/canonical sample rows; no database mutation |
| `GET /api/v1/catalog/imports/:id` | Current batch and validation |
| `GET /api/v1/catalog/imports/:id/errors.csv` | Current validation report |
| `POST /api/v1/catalog/imports/:id/rows` | Correct/exclude a row with expected batch version and reason |
| `POST /api/v1/catalog/imports/:id/duplicate-decision` | ATI-only distinct-product evidence for a probable duplicate |
| `POST /api/v1/catalog/imports/:id/submit` | Atomically create the included, valid products in review |

API ingestion uses `{source: "API", fileName: "API batch", requestKey: "<UUID>", rows: [...]}` with the same named string fields as CSV. CSV ingestion uses `{source: "CSV", fileName: "assortment.csv", requestKey: "<UUID>", content: "<UTF-8 text>"}`. Do not put workflow status, ownership IDs, floor overrides or external Fynd IDs in rows. They are server-controlled.

Excel ingestion uses `{source: "XLSX", fileName: "assortment.xlsx", requestKey: "<UUID>", base64: "<canonical base64 bytes>"}`. CSV/XLSX optionally include `mapping: {fields: {colour: "shade", ...}, ignoredHeaders: ["supplier_notes"], values: [{field: "colour", from: "Midnight", to: "Black"}]}`. Map all required fields; the example ellipsis is not literal JSON. Value conversions support category, colour, size, currency and country_of_origin with up to 100 exact rules. Currency rules normalize case only, never FX. No units, translations or categories are inferred. Business taxonomy/brand/floor rules still apply after mapping.

The checksum is SHA-256 of original workbook bytes (or the existing serialized CSV-content hash). Extracted source rows are retained separately from corrections; the binary workbook itself is not stored. A repeated actor/request key returns the existing batch only when source, filename, checksum and semantic mapping match; reordered mapping keys/rules do not conflict. Legacy requests without mappings retain their previous replay semantics. Workbook/mapping errors cause no staging or audit mutation. Business errors create a staged batch for correction, not a product. Editing the upload or mapping invalidates the browser preview; a delayed response from an older upload cannot enable staging for a new one.

The server uses pinned `yauzl` for serial, size-validated ZIP reads and `fast-xml-parser` for bounded XML parsing. See the upstream [ZIP read/size-validation documentation](https://github.com/thejoshwolfe/yauzl#readme) and [XML parser documentation](https://github.com/NaturalIntelligence/fast-xml-parser#readme). Downloadable template and positive test fixture were generated independently with the bundled spreadsheet tool; adversarial tests mutate ZIP/XML only in memory.

## Still required for full acceptance

SFTP ingestion, optional commerce-platform adapters, reusable/versioned cross-batch mapping profiles, unit normalization, production ingestion scale, update/revision imports, bulk media linkage, production scanning/object storage, persistent parent-child consolidation, image/attribute duplicate matching and merge decisions, full locale support and actual tenant-validated Fynd handoffs. XLSX supports the bounded one-sheet data-only layout, not arbitrary workbooks. Current API request/success schemas are covered; exhaustive business acceptance remains incomplete. The broader 54-requirement goal remains open.
