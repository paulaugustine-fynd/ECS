ALTER TABLE "Notification" ADD COLUMN "policyVersion" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "NotificationPolicy" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "companyId" TEXT NOT NULL,
 "market" TEXT NOT NULL,
 "category" TEXT NOT NULL CHECK ("category" IN ('SLA','CATALOG','INTEGRATION')),
 "severity" TEXT NOT NULL CHECK ("severity" IN ('WARNING','CRITICAL')),
 "atiRoles" TEXT[] NOT NULL,
 "vendorRoles" TEXT[] NOT NULL,
 "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version">0),
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "notification_policy_ati_coverage" CHECK (cardinality("atiRoles") > 0),
 CONSTRAINT "notification_policy_critical_escalation" CHECK ("severity" <> 'CRITICAL' OR 'ATI_SUPER_ADMIN'=ANY("atiRoles")),
 CONSTRAINT "notification_policy_ati_scope" CHECK (
  ("category" IN ('SLA','INTEGRATION') AND "atiRoles" <@ ARRAY['ATI_SUPER_ADMIN','ATI_OPERATIONS_MANAGER']::TEXT[])
  OR ("category"='CATALOG' AND "atiRoles" <@ ARRAY['ATI_SUPER_ADMIN','ATI_CATALOG_MODERATOR']::TEXT[])),
 CONSTRAINT "notification_policy_vendor_scope" CHECK (
  ("category"='SLA' AND "vendorRoles" <@ ARRAY['VENDOR_ADMIN','VENDOR_FULFILMENT_OPERATOR']::TEXT[])
  OR ("category"='CATALOG' AND "vendorRoles" <@ ARRAY['VENDOR_ADMIN','VENDOR_CATALOG_MANAGER']::TEXT[])
  OR ("category"='INTEGRATION' AND cardinality("vendorRoles")=0))
);
CREATE UNIQUE INDEX "NotificationPolicy_companyId_market_category_severity_key" ON "NotificationPolicy"("companyId", "market", "category", "severity");
