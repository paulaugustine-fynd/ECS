CREATE TABLE "MediaSourceJob" (
 "id" TEXT PRIMARY KEY,"companyId" TEXT NOT NULL,"partnerId" TEXT NOT NULL REFERENCES "Partner"("id"),"market" TEXT NOT NULL,
 "productId" TEXT NOT NULL REFERENCES "Product"("id"),"actorId" TEXT NOT NULL REFERENCES "User"("id"),
 "requestId" TEXT NOT NULL,"requestHash" TEXT NOT NULL,"expectedVersion" INTEGER NOT NULL,"sourceRef" TEXT NOT NULL,"destinationOrigin" TEXT NOT NULL,"correlationId" TEXT NOT NULL,
 "demoFailures" INTEGER NOT NULL DEFAULT 0,"status" TEXT NOT NULL DEFAULT 'PENDING',"version" INTEGER NOT NULL DEFAULT 1,"attempts" INTEGER NOT NULL DEFAULT 0,"cycleAttempts" INTEGER NOT NULL DEFAULT 0,"replayCount" INTEGER NOT NULL DEFAULT 0,
 "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"leaseToken" TEXT,"leaseUntil" TIMESTAMP(3),"receiptId" TEXT REFERENCES "MediaIngestion"("id"),"lastError" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT media_job_limits CHECK ("demoFailures" BETWEEN 0 AND 3 AND "expectedVersion">0 AND "version">0 AND "attempts">=0 AND "cycleAttempts">=0 AND "replayCount">=0 AND "sourceRef" IN ('studio-front','studio-back') AND "status" IN ('PENDING','PROCESSING','RETRY','SUCCEEDED','DLQ') AND "destinationOrigin" ~ '^http://127[.]0[.]0[.]1:[0-9]{1,5}$')
);
CREATE UNIQUE INDEX "MediaSourceJob_companyId_requestId_key" ON "MediaSourceJob"("companyId","requestId");
CREATE INDEX "MediaSourceJob_status_availableAt_idx" ON "MediaSourceJob"("status","availableAt");
CREATE FUNCTION ecs_media_job_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Media job evidence cannot be deleted'; END IF;
 IF ROW(NEW."id",NEW."companyId",NEW."partnerId",NEW."market",NEW."productId",NEW."actorId",NEW."requestId",NEW."requestHash",NEW."expectedVersion",NEW."sourceRef",NEW."destinationOrigin",NEW."correlationId",NEW."demoFailures",NEW."createdAt") IS DISTINCT FROM ROW(OLD."id",OLD."companyId",OLD."partnerId",OLD."market",OLD."productId",OLD."actorId",OLD."requestId",OLD."requestHash",OLD."expectedVersion",OLD."sourceRef",OLD."destinationOrigin",OLD."correlationId",OLD."demoFailures",OLD."createdAt") THEN RAISE EXCEPTION 'Media job request, owner and destination are immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER media_job_binding BEFORE UPDATE OR DELETE ON "MediaSourceJob" FOR EACH ROW EXECUTE FUNCTION ecs_media_job_binding();
