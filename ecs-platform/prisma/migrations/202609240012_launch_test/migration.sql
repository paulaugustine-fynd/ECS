CREATE TABLE "LaunchTest" (
 "id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, "partnerId" TEXT NOT NULL,
 "market" TEXT NOT NULL, "actorId" TEXT NOT NULL, "requestId" TEXT NOT NULL,
 "reason" TEXT NOT NULL, "inventoryId" TEXT NOT NULL, "fingerprint" TEXT NOT NULL,
 "snapshot" JSONB NOT NULL, "destinationOrigin" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'RUNNING', "step" INTEGER NOT NULL DEFAULT 0,
 "error" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "completedAt" TIMESTAMP(3),
 CHECK (status IN ('RUNNING','FAILED','STALE','PASSED')),
 CHECK (step BETWEEN 0 AND 8),
 CHECK ((status='PASSED') = (step=8 AND "completedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "LaunchTest_companyId_partnerId_requestId_key" ON "LaunchTest"("companyId","partnerId","requestId");
CREATE INDEX "LaunchTest_companyId_partnerId_createdAt_idx" ON "LaunchTest"("companyId","partnerId","createdAt");
CREATE UNIQUE INDEX one_running_launch_test ON "LaunchTest"("companyId","partnerId") WHERE status='RUNNING';
CREATE TABLE "MockLaunchOrder" (
 "runId" TEXT PRIMARY KEY, "fingerprint" TEXT NOT NULL, "state" TEXT NOT NULL,
 "virtualOnHand" INTEGER NOT NULL CHECK ("virtualOnHand" >= 0),
 "virtualReserved" INTEGER NOT NULL CHECK ("virtualReserved" >= 0 AND "virtualReserved" <= "virtualOnHand")
);
CREATE FUNCTION ecs_launch_test_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Launch evidence cannot be deleted'; END IF;
 IF OLD.status IN ('PASSED','STALE') OR
 ROW(OLD."companyId",OLD."partnerId",OLD.market,OLD."actorId",OLD."requestId",OLD.reason,OLD."inventoryId",OLD.fingerprint,OLD.snapshot,OLD."destinationOrigin",OLD."createdAt")
 IS DISTINCT FROM
 ROW(NEW."companyId",NEW."partnerId",NEW.market,NEW."actorId",NEW."requestId",NEW.reason,NEW."inventoryId",NEW.fingerprint,NEW.snapshot,NEW."destinationOrigin",NEW."createdAt") OR
 NEW.step < OLD.step OR NEW.step > OLD.step+1 THEN
  RAISE EXCEPTION 'Launch identity/snapshot and completed evidence are immutable';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_launch_test BEFORE UPDATE OR DELETE ON "LaunchTest" FOR EACH ROW EXECUTE FUNCTION ecs_launch_test_immutable();
