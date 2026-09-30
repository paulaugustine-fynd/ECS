CREATE TABLE "BrandRight" (
 "id" TEXT PRIMARY KEY, "partnerId" TEXT NOT NULL REFERENCES "Partner"("id"),
 "brand" TEXT NOT NULL, "market" TEXT NOT NULL, "categories" TEXT[] NOT NULL,
 "validFrom" TIMESTAMP(3) NOT NULL, "validUntil" TIMESTAMP(3) NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'DRAFT', "evidence" TEXT NOT NULL, "reason" TEXT NOT NULL,
 "version" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "BrandRight_dates" CHECK ("validUntil" > "validFrom"),
 CONSTRAINT "BrandRight_categories" CHECK (cardinality("categories") > 0),
 CONSTRAINT "BrandRight_status" CHECK ("status" IN ('DRAFT','APPROVED','PAUSED','SUSPENDED','REVOKED','REJECTED'))
);
CREATE INDEX "BrandRight_partnerId_brand_market_status_idx" ON "BrandRight"("partnerId","brand","market","status");
ALTER TABLE "Inventory" ADD COLUMN "lastEligible" BOOLEAN;
-- Scope/evidence/dates are fixed after review; renewals require a new record.
CREATE FUNCTION protect_brand_right_scope() RETURNS trigger AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
  IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'Reviewed brand rights cannot be deleted'; END IF;
  RETURN OLD;
 END IF;
 IF OLD.status <> 'DRAFT' AND
  ROW(NEW."partnerId",NEW.brand,NEW.market,NEW.categories,NEW."validFrom",NEW."validUntil",NEW.evidence)
  IS DISTINCT FROM ROW(OLD."partnerId",OLD.brand,OLD.market,OLD.categories,OLD."validFrom",OLD."validUntil",OLD.evidence)
 THEN RAISE EXCEPTION 'Reviewed brand-right scope is immutable'; END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER brand_right_scope BEFORE UPDATE OR DELETE ON "BrandRight" FOR EACH ROW EXECUTE FUNCTION protect_brand_right_scope();
