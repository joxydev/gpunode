-- TON Mainnet USDT deposits. Test accounting remains isolated.
CREATE TABLE user_wallets (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id TEXT NOT NULL UNIQUE REFERENCES "User"(id),
 network TEXT NOT NULL DEFAULT 'TON' CHECK(network='TON'),
 address VARCHAR(70) NOT NULL UNIQUE,
 wallet_app VARCHAR(100),
 verified BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
 last_connected_at TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE TABLE ton_proof_challenges (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id TEXT NOT NULL REFERENCES "User"(id),
 nonce_hash VARCHAR(64) NOT NULL UNIQUE,
 expires_at TIMESTAMPTZ(3) NOT NULL,
 consumed_at TIMESTAMPTZ(3),
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX ton_proof_challenges_user_id_created_at_idx ON ton_proof_challenges(user_id,created_at);
CREATE TABLE deposits (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 invoice_id VARCHAR(64) NOT NULL UNIQUE,
 user_id TEXT NOT NULL REFERENCES "User"(id),
 network TEXT NOT NULL DEFAULT 'TON' CHECK(network='TON'),
 asset TEXT NOT NULL DEFAULT 'USDT' CHECK(asset='USDT'),
 sender_address VARCHAR(70) NOT NULL,
 recipient_address VARCHAR(70) NOT NULL,
 jetton_master VARCHAR(70) NOT NULL,
 requested_micros BIGINT NOT NULL CHECK(requested_micros>0),
 received_micros BIGINT CHECK(received_micros>0),
 status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','DETECTED','CONFIRMED','CREDITED','EXPIRED','FAILED','REJECTED','MANUAL_REVIEW')),
 tx_hash VARCHAR(64) UNIQUE,
 trace_id TEXT,
 query_id VARCHAR(24) NOT NULL,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
 expires_at TIMESTAMPTZ(3) NOT NULL,
 detected_at TIMESTAMPTZ(3),
 confirmed_at TIMESTAMPTZ(3),
 credited_at TIMESTAMPTZ(3),
 owner_notified_at TIMESTAMPTZ(3),
 metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX deposits_user_id_created_at_idx ON deposits(user_id,created_at);
CREATE INDEX deposits_status_expires_at_idx ON deposits(status,expires_at);
CREATE TABLE wallet_ledger (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id TEXT NOT NULL REFERENCES "User"(id),
 deposit_id UUID NOT NULL UNIQUE REFERENCES deposits(id),
 type TEXT NOT NULL DEFAULT 'DEPOSIT' CHECK(type='DEPOSIT'),
 asset TEXT NOT NULL DEFAULT 'USDT' CHECK(asset='USDT'),
 amount_micros BIGINT NOT NULL CHECK(amount_micros>0),
 balance_before BIGINT NOT NULL,
 balance_after BIGINT NOT NULL,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
 metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
 CONSTRAINT wallet_ledger_balance_valid CHECK(balance_after=balance_before+amount_micros)
);
CREATE INDEX wallet_ledger_user_id_created_at_idx ON wallet_ledger(user_id,created_at);
CREATE TABLE ton_watcher_cursors (
 id VARCHAR(30) PRIMARY KEY,
 last_utime INTEGER NOT NULL CHECK(last_utime>0),
 updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE TABLE unmatched_ton_deposits (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tx_hash VARCHAR(64) NOT NULL UNIQUE,
 invoice_id VARCHAR(64),
 sender_address VARCHAR(70),
 amount_micros BIGINT,
 reason VARCHAR(100) NOT NULL,
 trace_id TEXT,
 detected_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
 metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX unmatched_ton_deposits_detected_at_idx ON unmatched_ton_deposits(detected_at);
