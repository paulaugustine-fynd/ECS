-- Sales governance is independent of canonical content/publication revisions.
ALTER TABLE "Product"
  ADD COLUMN "saleStatus" TEXT NOT NULL DEFAULT 'ENABLED',
  ADD COLUMN "saleVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "saleChangedAt" TIMESTAMP(3),
  ADD COLUMN "saleReason" TEXT,
  ADD CONSTRAINT "product_sale_status" CHECK ("saleStatus" IN ('ENABLED', 'PAUSED', 'DELISTED')),
  ADD CONSTRAINT "product_sale_version" CHECK ("saleVersion" > 0),
  ADD CONSTRAINT "product_sale_evidence" CHECK ("saleVersion" = 1 OR ("saleChangedAt" IS NOT NULL AND length(trim("saleReason")) >= 5));

CREATE FUNCTION guard_product_sales_control() RETURNS trigger AS $$
BEGIN
  IF (NEW."saleStatus", NEW."saleVersion", NEW."saleChangedAt", NEW."saleReason") IS DISTINCT FROM
     (OLD."saleStatus", OLD."saleVersion", OLD."saleChangedAt", OLD."saleReason") THEN
    IF NEW."saleVersion" <> OLD."saleVersion" + 1 OR NEW."saleStatus" = OLD."saleStatus" OR
       NEW."saleChangedAt" IS NULL OR NEW."saleReason" IS NULL OR length(trim(NEW."saleReason")) < 5 THEN
      RAISE EXCEPTION 'Sales-control decisions require a changed status, next revision, timestamp and reason';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER product_sales_control_guard BEFORE UPDATE ON "Product"
  FOR EACH ROW EXECUTE FUNCTION guard_product_sales_control();
