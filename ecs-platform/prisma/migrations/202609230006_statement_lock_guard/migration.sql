CREATE OR REPLACE FUNCTION ecs_locked_statement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Statements cannot be deleted'; END IF;
  IF OLD.status IN ('LOCKED','EXPORT_PENDING','EXPORTED','PAYMENT_PENDING','PAID') THEN
    IF (to_jsonb(OLD) - ARRAY['status','version','exportedId']) IS DISTINCT FROM (to_jsonb(NEW) - ARRAY['status','version','exportedId']) THEN
      RAISE EXCEPTION 'Locked statement identity, period, amounts and evidence cannot change';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
      (OLD.status='LOCKED' AND NEW.status='EXPORT_PENDING') OR
      (OLD.status='EXPORT_PENDING' AND NEW.status='EXPORTED') OR
      (OLD.status='EXPORTED' AND NEW.status='PAYMENT_PENDING') OR
      (OLD.status='PAYMENT_PENDING' AND NEW.status='PAID')
    ) THEN RAISE EXCEPTION 'Locked statement cannot be reopened or skip payout acknowledgement'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
