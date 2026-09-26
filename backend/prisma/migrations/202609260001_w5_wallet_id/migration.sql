-- Reconnecting with TON Proof fills wallet_id. Existing wallets keep standard deposits.
ALTER TABLE user_wallets ADD COLUMN wallet_id VARCHAR(10);
ALTER TABLE user_wallets ADD CONSTRAINT user_wallets_wallet_id_format
  CHECK (wallet_id IS NULL OR wallet_id ~ '^(0|[1-9][0-9]{0,9})$');
