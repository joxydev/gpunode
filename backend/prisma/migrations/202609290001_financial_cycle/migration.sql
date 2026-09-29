-- Forward-only lifecycle metadata. Legacy leases retain NULL terms and are never settled by the new worker.
ALTER TABLE user_leases
  ALTER COLUMN expires_at DROP NOT NULL,
  ADD COLUMN offer_version VARCHAR(64),
  ADD COLUMN offer_document_sha256 VARCHAR(64),
  ADD COLUMN mode VARCHAR(12),
  ADD COLUMN principal_micros BIGINT,
  ADD COLUMN base_daily_rate_bps INTEGER,
  ADD COLUMN compound_daily_rate_bps INTEGER,
  ADD COLUMN contract_days INTEGER,
  ADD COLUMN compound_cycle_days INTEGER,
  ADD COLUMN activated_at TIMESTAMPTZ(3),
  ADD COLUMN epoch_ends_at TIMESTAMPTZ(3),
  ADD COLUMN settled_days INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN accrual_remainder INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN base_accrued_micros BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN compound_principal_micros BIGINT,
  ADD COLUMN compound_profit_micros BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN current_compound_block INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN compound_block_ends_at TIMESTAMPTZ(3),
  ADD COLUMN completed_at TIMESTAMPTZ(3),
  ADD COLUMN early_unbonded_at TIMESTAMPTZ(3),
  ADD COLUMN unbond_fee_micros BIGINT,
  ADD COLUMN supply_released_at TIMESTAMPTZ(3),
  ADD COLUMN terms_snapshot JSONB;
ALTER TABLE user_leases DROP CONSTRAINT user_leases_status_check;
ALTER TABLE user_leases ADD CONSTRAINT user_leases_status_check
  CHECK (status IN ('PROVISIONING','ACTIVE','EXPIRED','OVERCLOCKED','CANCELLED','COMPLETED','EARLY_UNBONDED'));
ALTER TABLE user_leases ADD CONSTRAINT financial_lease_terms_valid CHECK (
  offer_version IS NULL OR (
    offer_document_sha256 ~ '^[0-9a-f]{64}$' AND mode IN ('BASE','COMPOUND') AND
    principal_micros > 0 AND base_daily_rate_bps > 0 AND
    (mode = 'BASE' OR compound_daily_rate_bps > 0) AND
    contract_days IN (30,60,90) AND compound_cycle_days = 30 AND
    settled_days BETWEEN 0 AND contract_days AND accrual_remainder BETWEEN 0 AND 9999 AND
    base_accrued_micros >= 0 AND compound_profit_micros >= 0 AND
    terms_snapshot IS NOT NULL AND
    ((status='PROVISIONING' AND activated_at IS NULL AND epoch_ends_at IS NULL) OR
     (status<>'PROVISIONING' AND (activated_at IS NOT NULL OR status='CANCELLED')))
  )
);
CREATE INDEX user_leases_settlement_due_idx ON user_leases(status,activated_at) WHERE offer_version IS NOT NULL;

CREATE FUNCTION financial_lease_terms_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.offer_version IS NOT NULL AND (
    OLD.offer_version,OLD.offer_document_sha256,OLD.mode,OLD.principal_micros,
    OLD.base_daily_rate_bps,OLD.compound_daily_rate_bps,OLD.contract_days,
    OLD.compound_cycle_days,OLD.terms_snapshot,OLD.purchase_price,
    OLD.daily_yield_usdt,OLD.contract_reference
  ) IS DISTINCT FROM (
    NEW.offer_version,NEW.offer_document_sha256,NEW.mode,NEW.principal_micros,
    NEW.base_daily_rate_bps,NEW.compound_daily_rate_bps,NEW.contract_days,
    NEW.compound_cycle_days,NEW.terms_snapshot,NEW.purchase_price,
    NEW.daily_yield_usdt,NEW.contract_reference
  ) THEN
    RAISE EXCEPTION 'Immutable financial lease terms';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER financial_lease_terms_immutable BEFORE UPDATE ON user_leases
  FOR EACH ROW EXECUTE FUNCTION financial_lease_terms_immutable();

ALTER TABLE "RentalRequest" ADD COLUMN lease_id UUID UNIQUE REFERENCES user_leases(id) ON DELETE RESTRICT;
ALTER TABLE "RentalRequest" ADD CONSTRAINT paid_lease_request_valid CHECK (
  lease_id IS NULL OR ("paymentStatus"='PAID' AND NOT "isTestOrder")
);

CREATE TABLE lease_accruals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id UUID NOT NULL REFERENCES user_leases(id) ON DELETE RESTRICT,
  day_index INTEGER NOT NULL CHECK (day_index > 0),
  mode VARCHAR(12) NOT NULL CHECK (mode IN ('BASE','COMPOUND')),
  opening_principal_micros BIGINT NOT NULL CHECK (opening_principal_micros > 0),
  rate_bps INTEGER NOT NULL CHECK (rate_bps > 0 AND rate_bps <= 10000),
  yield_micros BIGINT NOT NULL CHECK (yield_micros >= 0),
  closing_principal_micros BIGINT NOT NULL CHECK (closing_principal_micros >= opening_principal_micros),
  compound_block INTEGER NOT NULL CHECK (compound_block >= 0),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(lease_id,day_index)
);

ALTER TABLE withdrawal_requests
  ADD COLUMN platform_fee_micros BIGINT,
  ADD COLUMN network_fee_micros BIGINT,
  ADD CONSTRAINT withdrawal_fee_components_valid CHECK (
    (platform_fee_micros IS NULL OR platform_fee_micros=0) AND
    (network_fee_micros IS NULL OR network_fee_micros>=0) AND
    (network_fee_micros IS NULL OR fee_micros=network_fee_micros)
  );
