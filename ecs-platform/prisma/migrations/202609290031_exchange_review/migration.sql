ALTER TABLE "ExchangeRequest"
 ADD COLUMN "reviewAction" TEXT,
 ADD COLUMN "reviewedAt" TIMESTAMP(3),
 ADD COLUMN "reviewedBy" TEXT,
 ADD COLUMN "reviewReason" TEXT,
 ADD COLUMN "reviewSnapshot" JSONB;

ALTER TABLE "ExchangeRequest" DROP CONSTRAINT exchange_request_bounds;
ALTER TABLE "ExchangeRequest" ADD CONSTRAINT exchange_request_bounds CHECK (
 "quantity" BETWEEN 1 AND 1000 AND "replacementTotal">=0 AND "currency"='AED' AND "market"='AE'
 AND length("reason") BETWEEN 5 AND 1000 AND "requestHash" ~ '^[a-f0-9]{64}$'
 AND (
  ("status"='REQUESTED' AND "version"=1 AND "reviewAction" IS NULL)
  OR ("status" IN ('APPROVED','REJECTED') AND "version"=2 AND "reviewAction" IS NOT NULL AND "reviewAction"="status")
  OR ("status"='CANCELLED' AND (("version"=2 AND "reviewAction" IS NULL) OR ("version"=3 AND "reviewAction" IS NOT NULL AND "reviewAction"='APPROVED')))
 )
 AND (
  ("status"<>'CANCELLED' AND "cancelledAt" IS NULL AND "cancelledBy" IS NULL AND "cancellationReason" IS NULL)
  OR ("status"='CANCELLED' AND "cancelledAt" IS NOT NULL AND "cancelledBy" IS NOT NULL AND "cancellationReason" IS NOT NULL AND length("cancellationReason") BETWEEN 5 AND 1000)
 )
 AND (
  ("reviewAction" IS NULL AND "reviewedAt" IS NULL AND "reviewedBy" IS NULL AND "reviewReason" IS NULL AND "reviewSnapshot" IS NULL)
  OR ("reviewAction" IS NOT NULL AND "reviewAction" IN ('APPROVED','REJECTED') AND "reviewedAt" IS NOT NULL AND "reviewedBy" IS NOT NULL AND "reviewReason" IS NOT NULL AND length("reviewReason") BETWEEN 5 AND 1000
   AND (("reviewAction"='APPROVED' AND "reviewSnapshot" IS NOT NULL AND jsonb_typeof("reviewSnapshot")='object') OR ("reviewAction"='REJECTED' AND "reviewSnapshot" IS NULL)))
 )
);
DROP INDEX "ExchangeRequest_one_active_return";
CREATE UNIQUE INDEX "ExchangeRequest_one_active_return" ON "ExchangeRequest"("returnId") WHERE "status" NOT IN ('CANCELLED','REJECTED');

CREATE OR REPLACE FUNCTION ecs_exchange_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE returned "ReturnCase"%ROWTYPE; replacement "Product"%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Exchange request history cannot be deleted'; END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW."version"<>OLD."version"+1 THEN RAISE EXCEPTION 'Exchange transition must advance exactly one revision'; END IF;
  IF OLD."status"='REQUESTED' AND NEW."status" IN ('APPROVED','REJECTED') THEN
   IF (to_jsonb(NEW)-ARRAY['status','version','reviewAction','reviewedAt','reviewedBy','reviewReason','reviewSnapshot']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['status','version','reviewAction','reviewedAt','reviewedBy','reviewReason','reviewSnapshot'])
   THEN RAISE EXCEPTION 'Review cannot change accepted exchange evidence'; END IF;
  ELSIF OLD."status" IN ('REQUESTED','APPROVED') AND NEW."status"='CANCELLED' THEN
   IF (to_jsonb(NEW)-ARRAY['status','version','cancelledAt','cancelledBy','cancellationReason']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['status','version','cancelledAt','cancelledBy','cancellationReason'])
   THEN RAISE EXCEPTION 'Cancellation cannot change accepted evidence or the ATI decision'; END IF;
  ELSE RAISE EXCEPTION 'Invalid exchange request transition';
  END IF;
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
