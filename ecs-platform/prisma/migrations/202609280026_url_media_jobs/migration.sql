ALTER TABLE "MediaSourceJob" ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'DAM';
ALTER TABLE "MediaSourceJob" DROP CONSTRAINT media_job_limits;
ALTER TABLE "MediaSourceJob" ADD CONSTRAINT media_job_limits CHECK (
 "demoFailures" BETWEEN 0 AND 3 AND "expectedVersion">0 AND "version">0 AND "attempts">=0 AND "cycleAttempts">=0 AND "replayCount">=0
 AND "status" IN ('PENDING','PROCESSING','RETRY','SUCCEEDED','DLQ')
 AND (
  ("sourceType"='DAM' AND "sourceRef" IN ('studio-front','studio-back') AND "destinationOrigin" ~ '^http://127[.]0[.]0[.]1:[0-9]{1,5}$')
  OR ("sourceType"='URL' AND length("sourceRef") BETWEEN 1 AND 2048 AND (
   ("sourceRef"='demo://supplier/front.png' AND "destinationOrigin" ~ '^http://127[.]0[.]0[.]1:[0-9]{1,5}$')
   OR ("destinationOrigin" ~ '^https://[a-z0-9.-]+$' AND starts_with("sourceRef", "destinationOrigin" || '/'))
  ))
 )
);
CREATE OR REPLACE FUNCTION ecs_media_job_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Media job evidence cannot be deleted'; END IF;
 IF ROW(NEW."id",NEW."companyId",NEW."partnerId",NEW."market",NEW."productId",NEW."actorId",NEW."requestId",NEW."requestHash",NEW."expectedVersion",NEW."sourceType",NEW."sourceRef",NEW."destinationOrigin",NEW."correlationId",NEW."demoFailures",NEW."createdAt") IS DISTINCT FROM ROW(OLD."id",OLD."companyId",OLD."partnerId",OLD."market",OLD."productId",OLD."actorId",OLD."requestId",OLD."requestHash",OLD."expectedVersion",OLD."sourceType",OLD."sourceRef",OLD."destinationOrigin",OLD."correlationId",OLD."demoFailures",OLD."createdAt") THEN RAISE EXCEPTION 'Media job request, source type, owner and destination are immutable'; END IF;
 RETURN NEW;
END; $$;
