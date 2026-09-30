ALTER TABLE "Agreement" ADD CONSTRAINT "agreement_rate_range" CHECK ("rate" >= 0 AND "rate" <= 1);
ALTER TABLE "Agreement" ADD CONSTRAINT "agreement_date_range" CHECK ("validUntil" > "validFrom");
CREATE FUNCTION protect_approved_agreement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status = 'APPROVED' THEN
  RAISE EXCEPTION 'Approved agreements are immutable; append a new effective-dated version';
 END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER agreement_immutable BEFORE UPDATE OR DELETE ON "Agreement"
FOR EACH ROW EXECUTE FUNCTION protect_approved_agreement();
