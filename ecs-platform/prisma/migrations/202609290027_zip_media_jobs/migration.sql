ALTER TABLE "MediaSourceJob" ADD COLUMN "receiptIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
UPDATE "MediaSourceJob" SET "receiptIds"=ARRAY["receiptId"] WHERE "receiptId" IS NOT NULL;
ALTER TABLE "MediaSourceJob" DROP CONSTRAINT media_job_limits;
ALTER TABLE "MediaSourceJob" ADD CONSTRAINT media_job_limits CHECK (
 "demoFailures" BETWEEN 0 AND 3 AND "expectedVersion">0 AND "version">0 AND "attempts">=0 AND "cycleAttempts">=0 AND "replayCount">=0
 AND cardinality("receiptIds")<=10 AND "status" IN ('PENDING','PROCESSING','RETRY','SUCCEEDED','DLQ')
 AND (
  ("sourceType"='DAM' AND "sourceRef" IN ('studio-front','studio-back') AND "destinationOrigin" ~ '^http://127[.]0[.]0[.]1:[0-9]{1,5}$')
  OR ("sourceType"='URL' AND length("sourceRef") BETWEEN 1 AND 2048 AND (
   ("sourceRef"='demo://supplier/front.png' AND "destinationOrigin" ~ '^http://127[.]0[.]0[.]1:[0-9]{1,5}$')
   OR ("destinationOrigin" ~ '^https://[a-z0-9.-]+$' AND starts_with("sourceRef", "destinationOrigin" || '/'))
  ))
  OR ("sourceType"='ZIP' AND "sourceRef" ~ '^[A-Za-z0-9][A-Za-z0-9._ -]{0,100}[.][zZ][iI][pP]$' AND "destinationOrigin"='local://quarantined-archive')
 )
);
CREATE TABLE "MediaSourceArchive" (
 "jobId" TEXT PRIMARY KEY REFERENCES "MediaSourceJob"("id"),
 "checksum" TEXT NOT NULL, "byteSize" INTEGER NOT NULL, "bytes" BYTEA NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT media_archive_limits CHECK ("byteSize" BETWEEN 1 AND 10485760 AND octet_length(bytes)="byteSize" AND checksum ~ '^[a-f0-9]{64}$')
);
CREATE TRIGGER immutable_media_source_archive BEFORE UPDATE OR DELETE ON "MediaSourceArchive" FOR EACH ROW EXECUTE FUNCTION ecs_media_immutable();
CREATE FUNCTION ecs_media_archive_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "MediaSourceJob" WHERE id=NEW."jobId" AND "sourceType"='ZIP' AND "destinationOrigin"='local://quarantined-archive') THEN RAISE EXCEPTION 'Archive must belong to a quarantined ZIP job'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER media_archive_job BEFORE INSERT ON "MediaSourceArchive" FOR EACH ROW EXECUTE FUNCTION ecs_media_archive_job();
