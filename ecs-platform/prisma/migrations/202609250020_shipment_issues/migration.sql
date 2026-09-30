CREATE TABLE "ShipmentIssue" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "companyId" TEXT NOT NULL,
 "partnerId" TEXT NOT NULL,
 "market" TEXT NOT NULL,
 "shipmentId" TEXT NOT NULL REFERENCES "FulfilmentLeg"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "reporterId" TEXT NOT NULL,
 "requestKey" TEXT NOT NULL,
 "code" TEXT NOT NULL CHECK ("code" IN ('STOCK_MISMATCH','DAMAGED_ITEM','PICK_PACK_DELAY','CARRIER_DELAY','DELIVERY_ISSUE','OTHER')),
 "severity" TEXT NOT NULL CHECK ("severity" IN ('WARNING','CRITICAL')),
 "details" TEXT NOT NULL CHECK (length("details") BETWEEN 10 AND 1000),
 "reportedStatus" TEXT NOT NULL,
 "reportedVersion" INTEGER NOT NULL CHECK ("reportedVersion">0),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ShipmentIssue_companyId_reporterId_requestKey_key" ON "ShipmentIssue"("companyId","reporterId","requestKey");
CREATE INDEX "ShipmentIssue_companyId_partnerId_market_shipmentId_idx" ON "ShipmentIssue"("companyId","partnerId","market","shipmentId");
CREATE FUNCTION guard_shipment_issue() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Shipment issue reports are immutable'; END IF;
 IF NOT EXISTS (SELECT 1 FROM "FulfilmentLeg" s WHERE s.id=NEW."shipmentId" AND s."companyId"=NEW."companyId" AND s."partnerId"=NEW."partnerId" AND s.market=NEW.market) THEN
  RAISE EXCEPTION 'Shipment issue ownership must match its shipment';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER shipment_issue_guard BEFORE INSERT OR UPDATE OR DELETE ON "ShipmentIssue" FOR EACH ROW EXECUTE FUNCTION guard_shipment_issue();
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_category_check";
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_category_check" CHECK ("category" IN ('SLA','CATALOG','INTEGRATION','FULFILMENT'));
ALTER TABLE "NotificationPolicy" DROP CONSTRAINT "NotificationPolicy_category_check";
ALTER TABLE "NotificationPolicy" ADD CONSTRAINT "NotificationPolicy_category_check" CHECK ("category" IN ('SLA','CATALOG','INTEGRATION','FULFILMENT'));
ALTER TABLE "NotificationPolicy" DROP CONSTRAINT "notification_policy_ati_scope";
ALTER TABLE "NotificationPolicy" ADD CONSTRAINT "notification_policy_ati_scope" CHECK (
 ("category" IN ('SLA','INTEGRATION','FULFILMENT') AND "atiRoles" <@ ARRAY['ATI_SUPER_ADMIN','ATI_OPERATIONS_MANAGER']::TEXT[])
 OR ("category"='CATALOG' AND "atiRoles" <@ ARRAY['ATI_SUPER_ADMIN','ATI_CATALOG_MODERATOR']::TEXT[]));
ALTER TABLE "NotificationPolicy" DROP CONSTRAINT "notification_policy_vendor_scope";
ALTER TABLE "NotificationPolicy" ADD CONSTRAINT "notification_policy_vendor_scope" CHECK (
 ("category" IN ('SLA','FULFILMENT') AND "vendorRoles" <@ ARRAY['VENDOR_ADMIN','VENDOR_FULFILMENT_OPERATOR']::TEXT[])
 OR ("category"='CATALOG' AND "vendorRoles" <@ ARRAY['VENDOR_ADMIN','VENDOR_CATALOG_MANAGER']::TEXT[])
 OR ("category"='INTEGRATION' AND cardinality("vendorRoles")=0));
