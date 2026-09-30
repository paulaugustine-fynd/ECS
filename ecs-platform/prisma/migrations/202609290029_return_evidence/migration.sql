CREATE TABLE "ReturnEvidence" (
 "id" TEXT PRIMARY KEY, "returnId" TEXT NOT NULL REFERENCES "ReturnCase"("id"),
 "companyId" TEXT NOT NULL, "partnerId" TEXT NOT NULL, "market" TEXT NOT NULL,
 "actorId" TEXT NOT NULL, "correlationId" TEXT NOT NULL, "requestId" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
 "returnVersion" INTEGER NOT NULL, "fileName" TEXT NOT NULL, "notes" TEXT NOT NULL,
 "originalChecksum" TEXT NOT NULL, "checksum" TEXT NOT NULL, "contentType" TEXT NOT NULL,
 "byteSize" INTEGER NOT NULL, "width" INTEGER NOT NULL, "height" INTEGER NOT NULL,
 "scanStatus" TEXT NOT NULL, "bytes" BYTEA NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT return_evidence_limits CHECK (
 "returnVersion">1 AND length(notes) BETWEEN 5 AND 1000 AND "byteSize" BETWEEN 1 AND 5242880
 AND octet_length(bytes)="byteSize" AND width BETWEEN 128 AND 4096 AND height BETWEEN 128 AND 4096
 AND "contentType"='image/png' AND "scanStatus"='MOCK_CLEAN'
 AND checksum ~ '^[a-f0-9]{64}$' AND "originalChecksum" ~ '^[a-f0-9]{64}$'
 )
);
CREATE UNIQUE INDEX "ReturnEvidence_companyId_actorId_requestId_key" ON "ReturnEvidence"("companyId","actorId","requestId");
CREATE INDEX "ReturnEvidence_returnId_createdAt_idx" ON "ReturnEvidence"("returnId","createdAt");
CREATE FUNCTION ecs_return_evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Return inspection evidence is immutable'; END;
$$;
CREATE TRIGGER immutable_return_evidence BEFORE UPDATE OR DELETE ON "ReturnEvidence" FOR EACH ROW EXECUTE FUNCTION ecs_return_evidence_immutable();
