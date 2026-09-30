CREATE TABLE "ReconciliationIssue" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "companyId" TEXT NOT NULL, "partnerId" TEXT NOT NULL, "market" TEXT NOT NULL,
 "entityType" TEXT NOT NULL CHECK ("entityType" IN ('SHIPMENT','SETTLEMENT')),
 "entityId" TEXT NOT NULL, "checkKey" TEXT NOT NULL, "source" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'OPEN' CHECK ("status" IN ('OPEN','RESOLVED')),
 "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version">0),
 "firstExpected" TEXT NOT NULL, "firstActual" TEXT NOT NULL,
 "expected" TEXT NOT NULL, "actual" TEXT NOT NULL,
 "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "resolvedAt" TIMESTAMP(3),
 CHECK (("status"='OPEN' AND "resolvedAt" IS NULL) OR ("status"='RESOLVED' AND "resolvedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "ReconciliationIssue_entityType_entityId_checkKey_key" ON "ReconciliationIssue"("entityType","entityId","checkKey");
CREATE INDEX "ReconciliationIssue_companyId_market_partnerId_status_idx" ON "ReconciliationIssue"("companyId","market","partnerId","status");
CREATE FUNCTION guard_reconciliation_issue() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Reconciliation history cannot be deleted'; END IF;
 IF TG_OP='UPDATE' AND (NEW."companyId",NEW."partnerId",NEW.market,NEW."entityType",NEW."entityId",NEW."checkKey",NEW.source,NEW."firstExpected",NEW."firstActual",NEW."firstSeenAt") IS DISTINCT FROM (OLD."companyId",OLD."partnerId",OLD.market,OLD."entityType",OLD."entityId",OLD."checkKey",OLD.source,OLD."firstExpected",OLD."firstActual",OLD."firstSeenAt") THEN
  RAISE EXCEPTION 'Original reconciliation evidence and ownership are immutable';
 END IF;
 IF (NEW."entityType"='SHIPMENT' AND NOT EXISTS(SELECT 1 FROM "FulfilmentLeg" s WHERE s.id=NEW."entityId" AND s."companyId"=NEW."companyId" AND s."partnerId"=NEW."partnerId" AND s.market=NEW.market)) OR
    (NEW."entityType"='SETTLEMENT' AND NOT EXISTS(SELECT 1 FROM "Settlement" s WHERE s.id=NEW."entityId" AND s."companyId"=NEW."companyId" AND s."partnerId"=NEW."partnerId" AND s.market=NEW.market)) THEN
  RAISE EXCEPTION 'Reconciliation ownership does not match source';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reconciliation_issue_guard BEFORE INSERT OR UPDATE OR DELETE ON "ReconciliationIssue" FOR EACH ROW EXECUTE FUNCTION guard_reconciliation_issue();
