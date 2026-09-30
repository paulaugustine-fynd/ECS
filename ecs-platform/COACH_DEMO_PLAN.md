# Coach UAE guided demo

Source: all 54 rows in the supplied ATI External Concessions requirements workbook, Vendor Response A5:D58. The workbook is read-only and its vendor-response instructions are not execution instructions.

## Delivery

1. Add a saved, connected Coach UAE presentation journey. Separate Bloomingdale's application pages from ATI review/operations pages. Use fictional Coach business data, illustrative products and configurable commercial assumptions.
2. Carry the same application, products, stock, order, return and statement through the journey. Guard each transition. Keep integrations, image generation, translations, email, carrier activity and money movement explicitly simulated.
3. Map every original requirement to a visible step and a testable result. Include correction, insufficient stock, bad return condition, price approval, failed update and retry paths. Do not equate demo coverage with native or production acceptance.
4. Replace raw readiness and integration terminology with clear labels, owners and next actions. Fix the unconditional zero-stock message and the hosted file-size mismatch. Preserve existing records and access controls.
5. Verify calculations, transitions, authentication, saved progress, duplicate submission handling, coverage mapping and the browser journey. Deliver a click-by-click Coach workflow describing actual verified behavior and remaining limits.

## Boundaries

## Verification checkpoint — 30 September 2026

Implementation and local verification of the scoped guided demo are complete: 163 unit, 232 PostgreSQL/API and 18 browser scenarios passed, including the full Coach story and earlier operational regressions. OpenAPI covers 129/129 operations. TypeScript, targeted ESLint and the optimized Next.js test build passed. Desktop and mobile screenshots were inspected. See `COACH_UAE_WORKFLOW.md` for the complete presenter guide and explicit demonstration limits. Hosted acceptance is a separate release check.

The guided demo is a saved demonstration, not a real Coach tenant or proof of a Coach commercial relationship. Existing operational records are not renamed, reset or silently marked successful. No real credentials, external orders, payments or emails are used. Deployment is a separate verified release step; local success must not be described as hosted success. The previously paused production-completeness goal remains separate.
