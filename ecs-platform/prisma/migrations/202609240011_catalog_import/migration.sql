CREATE TABLE "CatalogImport" (
 "id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, "partnerId" TEXT,
 "market" TEXT NOT NULL, "actorId" TEXT NOT NULL, "requestKey" TEXT NOT NULL,
 "source" TEXT NOT NULL, "fileName" TEXT NOT NULL, "checksum" TEXT NOT NULL,
 "originalRows" JSONB NOT NULL, "rows" JSONB NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'STAGED', "version" INTEGER NOT NULL DEFAULT 1,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT catalog_import_status CHECK (status IN ('STAGED','SUBMITTED'))
);
CREATE UNIQUE INDEX "CatalogImport_actorId_requestKey_key" ON "CatalogImport"("actorId","requestKey");
CREATE INDEX "CatalogImport_companyId_partnerId_market_idx" ON "CatalogImport"("companyId","partnerId",market);
CREATE FUNCTION ecs_import_immutability() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status = 'SUBMITTED' OR
 ROW(OLD."companyId",OLD."partnerId",OLD.market,OLD."actorId",OLD."requestKey",OLD.source,OLD."fileName",OLD.checksum,OLD."originalRows")
 IS DISTINCT FROM
 ROW(NEW."companyId",NEW."partnerId",NEW.market,NEW."actorId",NEW."requestKey",NEW.source,NEW."fileName",NEW.checksum,NEW."originalRows") THEN
  RAISE EXCEPTION 'Import source and submitted batch are immutable';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_catalog_import BEFORE UPDATE ON "CatalogImport" FOR EACH ROW EXECUTE FUNCTION ecs_import_immutability();
