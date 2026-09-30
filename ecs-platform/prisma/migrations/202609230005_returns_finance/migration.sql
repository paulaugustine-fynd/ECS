ALTER TABLE "ReturnCase" ADD COLUMN "lineId" TEXT NOT NULL DEFAULT 'legacy', ADD COLUMN "requestKey" TEXT, ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "fyndReturnId" TEXT, ADD COLUMN "logisticsId" TEXT, ADD COLUMN "refundId" TEXT;
UPDATE "ReturnCase" SET "requestKey" = 'legacy:' || id;
ALTER TABLE "ReturnCase" ALTER COLUMN "requestKey" SET NOT NULL;
CREATE UNIQUE INDEX "ReturnCase_requestKey_key" ON "ReturnCase" ("requestKey");
ALTER TABLE "ReturnCase" ADD CONSTRAINT return_quantity CHECK (quantity > 0 AND refund >= 0 AND "payableReversal" >= 0 AND chargeback >= 0);
ALTER TABLE "Settlement" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
CREATE FUNCTION ecs_locked_statement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Statements cannot be deleted'; END IF;
  IF OLD.status IN ('LOCKED','EXPORT_PENDING','EXPORTED','PAYMENT_PENDING','PAID') AND
    (OLD.payable IS DISTINCT FROM NEW.payable OR OLD.evidence IS DISTINCT FROM NEW.evidence OR OLD."from" IS DISTINCT FROM NEW."from" OR OLD."to" IS DISTINCT FROM NEW."to" OR OLD."partnerId" IS DISTINCT FROM NEW."partnerId" OR OLD.currency IS DISTINCT FROM NEW.currency) THEN
    RAISE EXCEPTION 'Locked statement amounts and evidence cannot change';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_locked_statement BEFORE UPDATE OR DELETE ON "Settlement" FOR EACH ROW EXECUTE FUNCTION ecs_locked_statement();
