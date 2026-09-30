-- Do not reinterpret historical receipts or invent lost raw/signature evidence.
ALTER TABLE "Inbox" ADD COLUMN "envelopeVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Inbox" ADD COLUMN "eventOccurredAt" TIMESTAMP(3);
ALTER TABLE "Inbox" ADD COLUMN "rawEnvelope" TEXT;
ALTER TABLE "Inbox" ADD COLUMN "signatureTimestamp" TEXT;
ALTER TABLE "Inbox" ADD COLUMN "signature" TEXT;
ALTER TABLE "Inbox" ADD CONSTRAINT inbox_envelope_evidence CHECK (
 "envelopeVersion" IN (0,1) AND
 (("envelopeVersion"=0 AND "eventOccurredAt" IS NULL) OR ("envelopeVersion"=1 AND "eventOccurredAt" IS NOT NULL AND "rawEnvelope" IS NOT NULL)) AND
 (("rawEnvelope" IS NULL AND "signatureTimestamp" IS NULL AND signature IS NULL) OR
  ("rawEnvelope" IS NOT NULL AND "signatureTimestamp" IS NOT NULL AND signature IS NOT NULL AND "signatureTimestamp" ~ '^[0-9]+$' AND signature ~ '^[a-f0-9]{64}$'))
);
CREATE FUNCTION ecs_inbox_evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Inbound receipt evidence cannot be deleted'; END IF;
 IF (to_jsonb(OLD) - ARRAY['status','error','attempts','availableAt']) IS DISTINCT FROM
    (to_jsonb(NEW) - ARRAY['status','error','attempts','availableAt']) THEN
  RAISE EXCEPTION 'Inbound receipt evidence is immutable; replay cannot rewrite source, ownership, payload or signature';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_inbox_evidence BEFORE UPDATE OR DELETE ON "Inbox"
FOR EACH ROW EXECUTE FUNCTION ecs_inbox_evidence_immutable();
