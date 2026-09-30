CREATE TABLE "ExchangeRequest" (
 "id" TEXT PRIMARY KEY,
 "companyId" TEXT NOT NULL, "partnerId" TEXT NOT NULL, "market" TEXT NOT NULL,
 "returnId" TEXT NOT NULL REFERENCES "ReturnCase"("id"),
 "replacementProductId" TEXT NOT NULL REFERENCES "Product"("id"),
 "actorId" TEXT NOT NULL, "requestId" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
 "correlationId" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'REQUESTED', "version" INTEGER NOT NULL DEFAULT 1,
 "reason" TEXT NOT NULL, "quantity" INTEGER NOT NULL, "currency" TEXT NOT NULL,
 "replacementTotal" DECIMAL(18,3) NOT NULL, "snapshot" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "cancelledAt" TIMESTAMP(3), "cancelledBy" TEXT, "cancellationReason" TEXT,
 CONSTRAINT exchange_request_bounds CHECK (
   "quantity" BETWEEN 1 AND 1000 AND "replacementTotal">=0 AND "currency"='AED' AND "market"='AE'
   AND length("reason") BETWEEN 5 AND 1000 AND "requestHash" ~ '^[a-f0-9]{64}$'
   AND (("status"='REQUESTED' AND "version"=1 AND "cancelledAt" IS NULL AND "cancelledBy" IS NULL AND "cancellationReason" IS NULL)
     OR ("status"='CANCELLED' AND "version"=2 AND "cancelledAt" IS NOT NULL AND "cancelledBy" IS NOT NULL AND "cancellationReason" IS NOT NULL AND length("cancellationReason") BETWEEN 5 AND 1000))
 )
);
CREATE UNIQUE INDEX "ExchangeRequest_companyId_actorId_requestId_key" ON "ExchangeRequest"("companyId","actorId","requestId");
CREATE UNIQUE INDEX "ExchangeRequest_one_active_return" ON "ExchangeRequest"("returnId") WHERE "status"<>'CANCELLED';
CREATE INDEX "ExchangeRequest_companyId_partnerId_market_returnId_idx" ON "ExchangeRequest"("companyId","partnerId","market","returnId");
CREATE FUNCTION ecs_exchange_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE returned "ReturnCase"%ROWTYPE; replacement "Product"%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Exchange request history cannot be deleted'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['status','version','cancelledAt','cancelledBy','cancellationReason']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['status','version','cancelledAt','cancelledBy','cancellationReason'])
     OR OLD."status"<>'REQUESTED' OR NEW."status"<>'CANCELLED' OR NEW."version"<>OLD."version"+1
  THEN RAISE EXCEPTION 'Exchange evidence is immutable; only a pending request may be cancelled'; END IF;
 ELSE
  SELECT * INTO returned FROM "ReturnCase" WHERE id=NEW."returnId";
  SELECT * INTO replacement FROM "Product" WHERE id=NEW."replacementProductId";
  IF returned.id IS NULL OR replacement.id IS NULL
    OR returned."companyId"<>NEW."companyId" OR returned."partnerId"<>NEW."partnerId" OR returned.market<>NEW.market
    OR replacement."companyId"<>NEW."companyId" OR replacement."partnerId"<>NEW."partnerId" OR replacement.market<>NEW.market
    OR returned.quantity<>NEW.quantity OR returned.currency<>NEW.currency OR replacement.currency<>NEW.currency
    OR returned.status<>'CLOSED' OR returned."refundStatus"<>'ACKNOWLEDGED' OR returned."refundId" IS NULL
    OR returned."replacementOrderId" IS NOT NULL OR NEW.status<>'REQUESTED'
  THEN RAISE EXCEPTION 'Exchange ownership, quantity or completed-refund precondition is invalid'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER exchange_request_guard BEFORE INSERT OR UPDATE OR DELETE ON "ExchangeRequest" FOR EACH ROW EXECUTE FUNCTION ecs_exchange_request_guard();
