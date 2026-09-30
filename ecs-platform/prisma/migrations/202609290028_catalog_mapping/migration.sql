ALTER TABLE "CatalogImport" ADD COLUMN mapping JSONB;
CREATE OR REPLACE FUNCTION ecs_import_immutability() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status = 'SUBMITTED' OR
 ROW(OLD."companyId",OLD."partnerId",OLD.market,OLD."actorId",OLD."requestKey",OLD.source,OLD."fileName",OLD.checksum,OLD."originalRows",OLD.mapping)
 IS DISTINCT FROM
 ROW(NEW."companyId",NEW."partnerId",NEW.market,NEW."actorId",NEW."requestKey",NEW.source,NEW."fileName",NEW.checksum,NEW."originalRows",NEW.mapping) THEN
  RAISE EXCEPTION 'Import source, mapping and submitted batch are immutable';
 END IF;
 RETURN NEW;
END;
$$;
