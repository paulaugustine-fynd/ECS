-- Before this migration every operational adapter was mock-only. Preserve the
-- existing local demo destination, never infer a real tenant from current env.
ALTER TABLE "Outbox" ADD COLUMN "destinationMode" TEXT NOT NULL DEFAULT 'mock';
ALTER TABLE "Outbox" ADD COLUMN "destinationOrigin" TEXT NOT NULL DEFAULT 'http://127.0.0.1:4100';
ALTER TABLE "Outbox" ALTER COLUMN "destinationMode" DROP DEFAULT;
ALTER TABLE "Outbox" ALTER COLUMN "destinationOrigin" DROP DEFAULT;
ALTER TABLE "Outbox" ADD CONSTRAINT outbox_mock_destination CHECK (
  "destinationMode" = 'mock' AND "destinationOrigin" ~ '^http://127[.]0[.]0[.]1:[0-9]{1,5}$'
);

CREATE FUNCTION ecs_outbox_command_immutability() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD."companyId", OLD."partnerId", OLD.market, OLD.target,
         OLD."destinationMode", OLD."destinationOrigin", OLD.operation,
         OLD."aggregateId", OLD.payload, OLD."idempotencyKey", OLD."correlationId")
     IS DISTINCT FROM
     ROW(NEW."companyId", NEW."partnerId", NEW.market, NEW.target,
         NEW."destinationMode", NEW."destinationOrigin", NEW.operation,
         NEW."aggregateId", NEW.payload, NEW."idempotencyKey", NEW."correlationId") THEN
    RAISE EXCEPTION 'Outbox command and destination are immutable; replay preserves the original destination';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_outbox_command BEFORE UPDATE ON "Outbox"
FOR EACH ROW EXECUTE FUNCTION ecs_outbox_command_immutability();
