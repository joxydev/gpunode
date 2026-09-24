-- Cancellation only releases the user's pending invoice slot. A transfer sent to a cancelled invoice must still be reconciled.
ALTER TABLE deposits DROP CONSTRAINT deposits_status_check;
ALTER TABLE deposits ADD CONSTRAINT deposits_status_check CHECK (status IN ('PENDING','CANCELLED','DETECTED','CONFIRMED','CREDITED','EXPIRED','FAILED','REJECTED','MANUAL_REVIEW'));

-- Preserve historical ledger records for audit without permitting any further simulated credits.
CREATE FUNCTION retire_simulated_balances() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Historical simulation ledger is retired';
END;
$$;
CREATE TRIGGER retired_simulated_ledger BEFORE INSERT OR UPDATE ON test_ledger_entries
 FOR EACH ROW EXECUTE FUNCTION retire_simulated_balances();
CREATE TRIGGER retired_simulated_assets BEFORE INSERT OR UPDATE ON test_assets
 FOR EACH ROW EXECUTE FUNCTION retire_simulated_balances();
