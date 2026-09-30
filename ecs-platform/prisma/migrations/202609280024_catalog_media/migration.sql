CREATE TABLE "MediaAsset" (
 "id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, "partnerId" TEXT NOT NULL REFERENCES "Partner"("id"), "market" TEXT NOT NULL,
 "checksum" TEXT NOT NULL, "contentType" TEXT NOT NULL, "byteSize" INTEGER NOT NULL, "width" INTEGER NOT NULL, "height" INTEGER NOT NULL,
 "bytes" BYTEA NOT NULL, "scanStatus" TEXT NOT NULL, "quality" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT media_limits CHECK ("byteSize" BETWEEN 1 AND 5242880 AND octet_length(bytes)="byteSize" AND width BETWEEN 128 AND 4096 AND height BETWEEN 128 AND 4096 AND "contentType"='image/png' AND "scanStatus"='MOCK_CLEAN' AND checksum ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX "MediaAsset_companyId_partnerId_market_checksum_key" ON "MediaAsset"("companyId","partnerId","market","checksum");
CREATE TABLE "MediaIngestion" (
 "id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, "partnerId" TEXT NOT NULL, "market" TEXT NOT NULL,
 "productId" TEXT NOT NULL REFERENCES "Product"("id"), "assetId" TEXT NOT NULL REFERENCES "MediaAsset"("id"),
 "requestId" TEXT NOT NULL, "requestHash" TEXT NOT NULL, "originalChecksum" TEXT NOT NULL,
 "sourceType" TEXT NOT NULL, "sourceRef" TEXT NOT NULL, "actorId" TEXT NOT NULL, "correlationId" TEXT NOT NULL,
 "productVersion" INTEGER NOT NULL, "duplicate" BOOLEAN NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "MediaIngestion_companyId_requestId_key" ON "MediaIngestion"("companyId","requestId");
CREATE INDEX "MediaIngestion_productId_createdAt_idx" ON "MediaIngestion"("productId","createdAt");
CREATE FUNCTION ecs_media_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Catalogue asset bytes and ingestion lineage are immutable'; END;
$$;
CREATE TRIGGER immutable_media_asset BEFORE UPDATE OR DELETE ON "MediaAsset" FOR EACH ROW EXECUTE FUNCTION ecs_media_immutable();
CREATE TRIGGER immutable_media_ingestion BEFORE UPDATE OR DELETE ON "MediaIngestion" FOR EACH ROW EXECUTE FUNCTION ecs_media_immutable();
