CREATE TABLE "ExchangeExecution" (
 "id" TEXT PRIMARY KEY,
 "exchangeId" TEXT NOT NULL UNIQUE REFERENCES "ExchangeRequest"("id"),
 "orderId" TEXT NOT NULL UNIQUE REFERENCES "Order"("id"),
 "companyId" TEXT NOT NULL, "partnerId" TEXT NOT NULL, "market" TEXT NOT NULL,
 "actorId" TEXT NOT NULL, "reason" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
 "currency" TEXT NOT NULL, "amount" DECIMAL(18,3) NOT NULL, "paymentPayload" JSONB NOT NULL,
 "paymentStatus" TEXT NOT NULL DEFAULT 'PENDING', "version" INTEGER NOT NULL DEFAULT 1,
 "purchaseReceipt" JSONB, "refundReceipt" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT exchange_execution_bounds CHECK (
  "market"='AE' AND "currency"='AED' AND "amount">=0 AND length("reason") BETWEEN 5 AND 1000 AND "requestHash" ~ '^[a-f0-9]{64}$'
  AND (("paymentStatus"='PENDING' AND "version"=1 AND "purchaseReceipt" IS NULL AND "refundReceipt" IS NULL)
    OR ("paymentStatus"='CAPTURED' AND "version"=2 AND "purchaseReceipt" IS NOT NULL AND "refundReceipt" IS NULL)
    OR ("paymentStatus"='REFUND_PENDING' AND "version"=3 AND "purchaseReceipt" IS NOT NULL AND "refundReceipt" IS NULL)
    OR ("paymentStatus"='REFUNDED' AND "version"=4 AND "purchaseReceipt" IS NOT NULL AND "refundReceipt" IS NOT NULL))
 )
);
CREATE INDEX "ExchangeExecution_companyId_partnerId_market_idx" ON "ExchangeExecution"("companyId","partnerId","market");
CREATE FUNCTION ecs_exchange_execution_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
    OR NOT ((OLD."paymentStatus"='PENDING' AND NEW."paymentStatus"='CAPTURED')
     OR (OLD."paymentStatus"='CAPTURED' AND NEW."paymentStatus"='REFUND_PENDING')
     OR (OLD."paymentStatus"='REFUND_PENDING' AND NEW."paymentStatus"='REFUNDED'))
    OR (OLD."purchaseReceipt" IS NOT NULL AND NEW."purchaseReceipt" IS DISTINCT FROM OLD."purchaseReceipt")
    OR (OLD."refundReceipt" IS NOT NULL AND NEW."refundReceipt" IS DISTINCT FROM OLD."refundReceipt")
  THEN RAISE EXCEPTION 'Exchange execution identity and receipts are immutable'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER exchange_execution_guard BEFORE INSERT OR UPDATE OR DELETE ON "ExchangeExecution" FOR EACH ROW EXECUTE FUNCTION ecs_exchange_execution_guard();
