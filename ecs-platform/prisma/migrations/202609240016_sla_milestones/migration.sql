CREATE TABLE "SlaMilestone" (
 "id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, "partnerId" TEXT NOT NULL,
 "market" TEXT NOT NULL, "entityType" TEXT NOT NULL, "entityId" TEXT NOT NULL,
 "stage" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'ON_TRACK', "version" INTEGER NOT NULL DEFAULT 1,
 "policyVersion" INTEGER NOT NULL, "origin" TEXT NOT NULL,
 "startedAt" TIMESTAMP(3) NOT NULL, "atRiskAt" TIMESTAMP(3) NOT NULL, "deadline" TIMESTAMP(3) NOT NULL,
 "breachedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3), "waivedAt" TIMESTAMP(3), "waivedBy" TEXT, "reason" TEXT,
 CONSTRAINT "SlaMilestone_status_check" CHECK ("status" IN ('ON_TRACK','AT_RISK','BREACHED','RESOLVED','WAIVED')),
 CONSTRAINT "SlaMilestone_time_check" CHECK ("startedAt" <= "atRiskAt" AND "atRiskAt" < "deadline")
);
CREATE UNIQUE INDEX "SlaMilestone_entityType_entityId_stage_key" ON "SlaMilestone"("entityType","entityId","stage");
CREATE INDEX "SlaMilestone_companyId_partnerId_market_status_idx" ON "SlaMilestone"("companyId","partnerId","market","status");
CREATE TABLE "SlaPolicy" (
 "id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, "market" TEXT NOT NULL, "stage" TEXT NOT NULL,
 "version" INTEGER NOT NULL DEFAULT 1, "durationMinutes" INTEGER NOT NULL, "warningMinutes" INTEGER NOT NULL,
 CONSTRAINT "SlaPolicy_duration_check" CHECK ("durationMinutes" > "warningMinutes" AND "warningMinutes" > 0)
);
CREATE UNIQUE INDEX "SlaPolicy_companyId_market_stage_key" ON "SlaPolicy"("companyId","market","stage");
