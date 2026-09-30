CREATE TABLE "InvoiceReference" (
 "id" TEXT PRIMARY KEY, "orderId" TEXT NOT NULL REFERENCES "Order"("id"),
 "companyId" TEXT NOT NULL, "market" TEXT NOT NULL, "channel" TEXT NOT NULL,
 "invoiceNumber" TEXT NOT NULL, "version" INTEGER NOT NULL CHECK ("version" > 0),
 "status" TEXT NOT NULL CHECK ("status" IN ('ISSUED', 'VOIDED')),
 "url" TEXT NOT NULL, "issuedAt" TIMESTAMP(3) NOT NULL,
 "shipmentIds" TEXT[] NOT NULL, "payloadHash" TEXT NOT NULL,
 "receiptId" TEXT NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "InvoiceReference_companyId_market_channel_invoiceNumber_key"
 ON "InvoiceReference"("companyId", "market", "channel", "invoiceNumber");
CREATE INDEX "InvoiceReference_orderId_idx" ON "InvoiceReference"("orderId");
