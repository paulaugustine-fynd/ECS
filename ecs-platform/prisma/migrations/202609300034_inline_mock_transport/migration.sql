-- A fixed in-process simulator, never a real external destination. Existing
-- queued destinations and immutable command triggers are preserved unchanged.
ALTER TABLE "Outbox" DROP CONSTRAINT outbox_mock_destination;
ALTER TABLE "Outbox" ADD CONSTRAINT outbox_mock_destination CHECK (
 "destinationMode"='mock' AND ("destinationOrigin"='mock://ecs-inline' OR "destinationOrigin" ~ '^http://127[.]0[.]0[.]1:[0-9]{1,5}$')
);
ALTER TABLE "MediaSourceJob" DROP CONSTRAINT media_job_limits;
ALTER TABLE "MediaSourceJob" ADD CONSTRAINT media_job_limits CHECK (
 "demoFailures" BETWEEN 0 AND 3 AND "expectedVersion">0 AND "version">0 AND "attempts">=0 AND "cycleAttempts">=0 AND "replayCount">=0
 AND cardinality("receiptIds")<=10 AND "status" IN ('PENDING','PROCESSING','RETRY','SUCCEEDED','DLQ')
 AND (
  ("sourceType"='DAM' AND "sourceRef" IN ('studio-front','studio-back') AND ("destinationOrigin"='mock://ecs-inline' OR "destinationOrigin" ~ '^http://127[.]0[.]0[.]1:[0-9]{1,5}$'))
  OR ("sourceType"='URL' AND length("sourceRef") BETWEEN 1 AND 2048 AND (
   ("sourceRef"='demo://supplier/front.png' AND ("destinationOrigin"='mock://ecs-inline' OR "destinationOrigin" ~ '^http://127[.]0[.]0[.]1:[0-9]{1,5}$'))
   OR ("destinationOrigin" ~ '^https://[a-z0-9.-]+$' AND starts_with("sourceRef", "destinationOrigin" || '/'))
  ))
  OR ("sourceType"='ZIP' AND "sourceRef" ~ '^[A-Za-z0-9][A-Za-z0-9._ -]{0,100}[.][zZ][iI][pP]$' AND "destinationOrigin"='local://quarantined-archive')
 )
);
