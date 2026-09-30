CREATE TABLE "Notification" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "companyId" TEXT NOT NULL, "partnerId" TEXT,
 "market" TEXT NOT NULL, "category" TEXT NOT NULL, "severity" TEXT NOT NULL,
 "entityType" TEXT NOT NULL, "entityId" TEXT NOT NULL, "eventKey" TEXT NOT NULL,
 "title" TEXT NOT NULL, "message" TEXT NOT NULL,
 "eventAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "readAt" TIMESTAMP(3),
 CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "Notification_category_check" CHECK ("category" IN ('SLA','CATALOG','INTEGRATION')),
 CONSTRAINT "Notification_severity_check" CHECK ("severity" IN ('WARNING','CRITICAL'))
);
CREATE UNIQUE INDEX "Notification_userId_eventKey_key" ON "Notification"("userId","eventKey");
CREATE INDEX "Notification_userId_companyId_market_readAt_idx" ON "Notification"("userId","companyId","market","readAt");
