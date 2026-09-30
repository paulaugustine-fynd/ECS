ALTER TABLE "ExchangeExecution" ADD COLUMN "holdExpiresAt" TIMESTAMP(3);
-- Backfill only the new field, preserving the immutable execution evidence.
ALTER TABLE "ExchangeExecution" DISABLE TRIGGER exchange_execution_guard;
UPDATE "ExchangeExecution" SET "holdExpiresAt"="createdAt"+interval '30 minutes';
ALTER TABLE "ExchangeExecution" ENABLE TRIGGER exchange_execution_guard;
ALTER TABLE "ExchangeExecution" ALTER COLUMN "holdExpiresAt" SET NOT NULL;
ALTER TABLE "ExchangeExecution" DROP CONSTRAINT exchange_execution_bounds;
ALTER TABLE "ExchangeExecution" ADD CONSTRAINT exchange_execution_bounds CHECK (
 "market"='AE' AND "currency"='AED' AND "amount">=0 AND length("reason") BETWEEN 5 AND 1000 AND "requestHash" ~ '^[a-f0-9]{64}$'
 AND "holdExpiresAt">"createdAt"
 AND (("paymentStatus"='PENDING' AND "version"=1 AND "purchaseReceipt" IS NULL AND "refundReceipt" IS NULL)
 OR ("paymentStatus"='VOIDED' AND "version"=2 AND "purchaseReceipt" IS NULL AND "refundReceipt" IS NULL)
 OR ("paymentStatus"='CAPTURED' AND "version"=2 AND "purchaseReceipt" IS NOT NULL AND "refundReceipt" IS NULL)
 OR ("paymentStatus"='REFUND_PENDING' AND "version"=3 AND "purchaseReceipt" IS NOT NULL AND "refundReceipt" IS NULL)
 OR ("paymentStatus"='REFUNDED' AND "version"=4 AND "purchaseReceipt" IS NOT NULL AND "refundReceipt" IS NOT NULL))
);
CREATE OR REPLACE FUNCTION ecs_exchange_execution_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request "ExchangeRequest"%ROWTYPE; replacement "Order"%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Exchange execution evidence cannot be deleted'; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO request FROM "ExchangeRequest" WHERE id=NEW."exchangeId";
  SELECT * INTO replacement FROM "Order" WHERE id=NEW."orderId";
  IF request.id IS NULL OR replacement.id IS NULL OR request.status<>'APPROVED'
   OR request."companyId"<>NEW."companyId" OR request."partnerId"<>NEW."partnerId" OR request.market<>NEW.market
   OR replacement."companyId"<>NEW."companyId" OR replacement.market<>NEW.market OR replacement.currency<>NEW.currency
   OR replacement.total<>NEW.amount OR request."replacementTotal"<>NEW.amount OR replacement.status<>'AWAITING_PAYMENT'
   OR NEW."paymentStatus"<>'PENDING'
  THEN RAISE EXCEPTION 'Invalid exchange order, accepted amount or ownership'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['paymentStatus','version','purchaseReceipt','refundReceipt']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['paymentStatus','version','purchaseReceipt','refundReceipt'])
    OR NEW.version<>OLD.version+1
    OR NOT ((OLD."paymentStatus"='PENDING' AND NEW."paymentStatus" IN ('CAPTURED','VOIDED'))
     OR (OLD."paymentStatus"='CAPTURED' AND NEW."paymentStatus"='REFUND_PENDING')
     OR (OLD."paymentStatus"='REFUND_PENDING' AND NEW."paymentStatus"='REFUNDED'))
    OR (OLD."purchaseReceipt" IS NOT NULL AND NEW."purchaseReceipt" IS DISTINCT FROM OLD."purchaseReceipt")
    OR (OLD."refundReceipt" IS NOT NULL AND NEW."refundReceipt" IS DISTINCT FROM OLD."refundReceipt")
  THEN RAISE EXCEPTION 'Exchange execution identity and receipts are immutable'; END IF;
 END IF;
 RETURN NEW;
END;
$$;

CREATE TABLE "ExchangeCancellation" (
 "id" TEXT PRIMARY KEY, "executionId" TEXT NOT NULL UNIQUE REFERENCES "ExchangeExecution"("id"),
 "actorId" TEXT NOT NULL, "reason" TEXT NOT NULL, "requestHash" TEXT NOT NULL, "cause" TEXT NOT NULL, "payload" JSONB NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'REQUESTED', "version" INTEGER NOT NULL DEFAULT 1,
 "sfccReceipt" JSONB, "fyndReceipt" JSONB, "createdAt" TIMESTAMP(3) NOT NULL, "completedAt" TIMESTAMP(3),
 CONSTRAINT exchange_cancellation_bounds CHECK (length("reason") BETWEEN 5 AND 1000 AND "requestHash" ~ '^[a-f0-9]{64}$'
 AND "cause" IN ('OPERATOR_CANCELLED','PAYMENT_HOLD_EXPIRED') AND "version">0
 AND "status" IN ('REQUESTED','REFUND_PENDING','COMPLETED')
 AND (("status"='COMPLETED')=("completedAt" IS NOT NULL))
 AND ("status"='REQUESTED' OR ("sfccReceipt" IS NOT NULL AND "fyndReceipt" IS NOT NULL)))
);
CREATE FUNCTION ecs_exchange_cancellation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Cancellation evidence cannot be deleted'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'REQUESTED' OR NEW.version<>1 OR NEW."sfccReceipt" IS NOT NULL OR NEW."fyndReceipt" IS NOT NULL OR NEW."completedAt" IS NOT NULL
  THEN RAISE EXCEPTION 'Cancellation must start as an unacknowledged request'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['status','version','sfccReceipt','fyndReceipt','completedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','sfccReceipt','fyndReceipt','completedAt'])
   OR NEW.version<>OLD.version+1 OR OLD.status='COMPLETED'
   OR (OLD.status='REFUND_PENDING' AND NEW.status<>'COMPLETED')
   OR (OLD."sfccReceipt" IS NOT NULL AND NEW."sfccReceipt" IS DISTINCT FROM OLD."sfccReceipt")
   OR (OLD."fyndReceipt" IS NOT NULL AND NEW."fyndReceipt" IS DISTINCT FROM OLD."fyndReceipt")
  THEN RAISE EXCEPTION 'Cancellation intent and receipts are immutable'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER exchange_cancellation_guard BEFORE INSERT OR UPDATE OR DELETE ON "ExchangeCancellation" FOR EACH ROW EXECUTE FUNCTION ecs_exchange_cancellation_guard();

CREATE TABLE "MockExchangeState" (
 "system" TEXT NOT NULL, "exchangeId" TEXT NOT NULL, "orderId" TEXT NOT NULL, "identity" JSONB NOT NULL,
 "closed" BOOLEAN NOT NULL DEFAULT false, "purchaseReceipt" JSONB, "orderCreated" BOOLEAN NOT NULL DEFAULT false, "revision" INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY ("system","exchangeId"), UNIQUE ("system","orderId"),
 CHECK ("system" IN ('SFCC','FYND') AND "revision">0 AND ("system"='SFCC' OR "purchaseReceipt" IS NULL) AND ("system"='FYND' OR NOT "orderCreated"))
);
CREATE FUNCTION ecs_mock_exchange_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Simulator fence cannot be deleted'; END IF;
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['closed','purchaseReceipt','orderCreated','revision']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['closed','purchaseReceipt','orderCreated','revision'])
  OR NEW.revision<>OLD.revision+1 OR (OLD.closed AND NOT NEW.closed)
  OR (OLD."orderCreated" AND NOT NEW."orderCreated")
  OR (OLD.closed AND (NEW."orderCreated" IS DISTINCT FROM OLD."orderCreated" OR NEW."purchaseReceipt" IS DISTINCT FROM OLD."purchaseReceipt"))
  OR (OLD."purchaseReceipt" IS NOT NULL AND NEW."purchaseReceipt" IS DISTINCT FROM OLD."purchaseReceipt"))
 THEN RAISE EXCEPTION 'Simulator identity, receipts and closed fence are immutable'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER mock_exchange_guard BEFORE UPDATE OR DELETE ON "MockExchangeState" FOR EACH ROW EXECUTE FUNCTION ecs_mock_exchange_guard();
