-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "partnerId" TEXT,
    "markets" TEXT[] DEFAULT ARRAY['AE']::TEXT[],
    "locale" TEXT NOT NULL DEFAULT 'en',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "Partner" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INVITED',
    "markets" TEXT[] DEFAULT ARRAY['AE']::TEXT[],
    "erpVendorId" TEXT,
    "riskTier" TEXT NOT NULL DEFAULT 'MEDIUM',
    "trusted" BOOLEAN NOT NULL DEFAULT false,
    "brandApproved" BOOLEAN NOT NULL DEFAULT false,
    "fyndMapped" BOOLEAN NOT NULL DEFAULT false,
    "inventorySynced" BOOLEAN NOT NULL DEFAULT false,
    "testOrderPassed" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agreement" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "rate" DECIMAL(7,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "cadence" TEXT NOT NULL DEFAULT 'WEEKLY',
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "rules" JSONB NOT NULL,

    CONSTRAINT "Agreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "gtin" TEXT,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'AE',
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "price" DECIMAL(18,3) NOT NULL,
    "floor" DECIMAL(18,3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "data" JSONB NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Publication" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "target" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "externalId" TEXT,
    "error" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Publication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "partnerId" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "fyndId" TEXT,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inventory" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "onHand" INTEGER NOT NULL,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "damaged" INTEGER NOT NULL DEFAULT 0,
    "unavailable" INTEGER NOT NULL DEFAULT 0,
    "safetyStock" INTEGER NOT NULL DEFAULT 0,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "Inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "total" DECIMAL(18,3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "fyndId" TEXT,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FulfilmentLeg" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ASSIGNED',
    "fyndId" TEXT,
    "tracking" TEXT,
    "deadline" TIMESTAMP(3) NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "lines" JSONB NOT NULL,
    "routingTrace" JSONB NOT NULL,

    CONSTRAINT "FulfilmentLeg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnCase" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "legId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT NOT NULL,
    "policy" JSONB NOT NULL,
    "qc" TEXT,
    "refund" DECIMAL(18,3) NOT NULL,
    "payableReversal" DECIMAL(18,3) NOT NULL,
    "chargeback" DECIMAL(18,3) NOT NULL,
    "currency" TEXT NOT NULL,
    "refundStatus" TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
    "replacementOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(18,3) NOT NULL,
    "currency" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settlementId" TEXT,

    CONSTRAINT "FinancialEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CALCULATED',
    "from" TIMESTAMP(3) NOT NULL,
    "to" TIMESTAMP(3) NOT NULL,
    "payable" DECIMAL(18,3) NOT NULL,
    "evidence" JSONB NOT NULL,
    "exportedId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outbox" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "partnerId" TEXT,
    "market" TEXT NOT NULL DEFAULT 'AE',
    "target" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "correlationId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "leaseToken" TEXT,
    "error" TEXT,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationAttempt" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "detail" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inbox" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Inbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "partnerId" TEXT,
    "market" TEXT NOT NULL DEFAULT 'AE',
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exception" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "partnerId" TEXT,
    "market" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "message" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Exception_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemoClock" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "now" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemoClock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MockRecord" (
    "id" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MockRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdapterFault" (
    "system" TEXT NOT NULL,
    "remaining" INTEGER NOT NULL DEFAULT 0,
    "statusCode" INTEGER NOT NULL DEFAULT 503,

    CONSTRAINT "AdapterFault_pkey" PRIMARY KEY ("system")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Partner_code_key" ON "Partner"("code");

-- CreateIndex
CREATE INDEX "Partner_companyId_status_idx" ON "Partner"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Document_partnerId_type_version_key" ON "Document"("partnerId", "type", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Agreement_partnerId_version_key" ON "Agreement"("partnerId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE INDEX "Product_companyId_partnerId_market_idx" ON "Product"("companyId", "partnerId", "market");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_productId_version_target_key" ON "Publication"("productId", "version", "target");

-- CreateIndex
CREATE UNIQUE INDEX "Inventory_productId_locationId_key" ON "Inventory"("productId", "locationId");

-- CreateIndex
CREATE INDEX "Order_companyId_market_idx" ON "Order"("companyId", "market");

-- CreateIndex
CREATE UNIQUE INDEX "Order_channel_externalId_key" ON "Order"("channel", "externalId");

-- CreateIndex
CREATE INDEX "FulfilmentLeg_companyId_partnerId_market_idx" ON "FulfilmentLeg"("companyId", "partnerId", "market");

-- CreateIndex
CREATE INDEX "ReturnCase_companyId_partnerId_market_idx" ON "ReturnCase"("companyId", "partnerId", "market");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialEvent_idempotencyKey_key" ON "FinancialEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "FinancialEvent_companyId_partnerId_market_createdAt_idx" ON "FinancialEvent"("companyId", "partnerId", "market", "createdAt");

-- CreateIndex
CREATE INDEX "Settlement_companyId_partnerId_market_idx" ON "Settlement"("companyId", "partnerId", "market");

-- CreateIndex
CREATE UNIQUE INDEX "Outbox_idempotencyKey_key" ON "Outbox"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Outbox_status_availableAt_idx" ON "Outbox"("status", "availableAt");

-- CreateIndex
CREATE INDEX "Inbox_status_availableAt_idx" ON "Inbox"("status", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "Inbox_source_eventId_key" ON "Inbox"("source", "eventId");

-- CreateIndex
CREATE INDEX "AuditEvent_companyId_partnerId_createdAt_idx" ON "AuditEvent"("companyId", "partnerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Exception_kind_entityId_key" ON "Exception"("kind", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "MockRecord_system_idempotencyKey_key" ON "MockRecord"("system", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfilmentLeg" ADD CONSTRAINT "FulfilmentLeg_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
