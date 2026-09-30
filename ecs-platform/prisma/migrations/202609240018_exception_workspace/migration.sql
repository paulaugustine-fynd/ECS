ALTER TABLE "Exception" ADD COLUMN "assigneeId" TEXT,
 ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
 ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 ADD COLUMN "resolvedAt" TIMESTAMP(3);
-- Existing terminal rows have no reliable resolution timestamp. Do not invent one.
CREATE INDEX "Exception_companyId_market_partnerId_status_idx" ON "Exception"("companyId", "market", "partnerId", "status");
