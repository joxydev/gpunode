-- Existing verified wallet addresses remain valid for standard deposits.
-- Gasless requires a fresh TON Proof to populate these fields.
ALTER TABLE user_wallets
  ADD COLUMN public_key VARCHAR(64),
  ADD COLUMN wallet_version VARCHAR(20);
ALTER TABLE user_wallets
  ADD CONSTRAINT user_wallets_public_key_format CHECK (public_key IS NULL OR public_key ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT user_wallets_wallet_version CHECK (wallet_version IS NULL OR wallet_version IN ('W5','V4R2','V3R2','UNKNOWN'));
