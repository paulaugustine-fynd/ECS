CREATE TABLE "MockStorefrontProduct" (
 "productId" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, "partnerId" TEXT NOT NULL,
 market TEXT NOT NULL, version INTEGER NOT NULL CHECK (version > 0),
 "externalId" TEXT NOT NULL, fingerprint TEXT NOT NULL, visible BOOLEAN NOT NULL DEFAULT true,
 content JSONB NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
