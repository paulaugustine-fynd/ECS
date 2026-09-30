ALTER TABLE "Inventory" ADD CONSTRAINT inventory_nonnegative CHECK (
  "onHand" >= 0 AND reserved >= 0 AND damaged >= 0 AND unavailable >= 0 AND "safetyStock" >= 0 AND sequence >= 0
);
ALTER TABLE "Agreement" ADD CONSTRAINT agreement_valid CHECK (rate >= 0 AND rate <= 1 AND "validUntil" > "validFrom");
ALTER TABLE "Product" ADD CONSTRAINT product_prices CHECK (price >= 0 AND floor >= 0);

CREATE FUNCTION ecs_no_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Immutable history: corrections must be appended';
END;
$$;
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION ecs_no_history_mutation();
CREATE TRIGGER immutable_attempts BEFORE UPDATE OR DELETE ON "IntegrationAttempt" FOR EACH ROW EXECUTE FUNCTION ecs_no_history_mutation();

CREATE FUNCTION ecs_financial_immutability() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Financial events cannot be deleted'; END IF;
  IF (to_jsonb(OLD) - 'settlementId') IS DISTINCT FROM (to_jsonb(NEW) - 'settlementId') THEN
    RAISE EXCEPTION 'Financial amounts and evidence are immutable';
  END IF;
  IF OLD."settlementId" IS NOT NULL AND OLD."settlementId" IS DISTINCT FROM NEW."settlementId" THEN
    RAISE EXCEPTION 'A financial event cannot be reassigned to a different statement';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_financial_event BEFORE UPDATE OR DELETE ON "FinancialEvent" FOR EACH ROW EXECUTE FUNCTION ecs_financial_immutability();
