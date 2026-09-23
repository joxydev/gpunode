-- Test-only accounting. No entries touch the real LedgerEntry or user_leases tables.
BEGIN;

CREATE TABLE test_ledger_entries (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
 amount_micros BIGINT NOT NULL CHECK (amount_micros <> 0),
 kind TEXT NOT NULL CHECK (kind IN ('MANUAL_CREDIT','ORDER_DEBIT','ORDER_REFUND')),
 source_id TEXT NOT NULL UNIQUE,
 actor_id TEXT NOT NULL,
 reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 300),
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT test_ledger_sign CHECK ((kind='ORDER_DEBIT' AND amount_micros<0) OR (kind<>'ORDER_DEBIT' AND amount_micros>0))
);
CREATE INDEX test_ledger_entries_user_id_created_at_idx ON test_ledger_entries(user_id,created_at);

ALTER TABLE "RentalRequest"
 ADD COLUMN "isTestOrder" BOOLEAN NOT NULL DEFAULT FALSE,
 ADD COLUMN "testPriceMicros" BIGINT,
 ADD COLUMN "testTermDays" INTEGER,
 ADD COLUMN "testRateBps" INTEGER,
 ADD COLUMN "testOfferVersion" VARCHAR(64),
 ADD COLUMN "userUnread" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "RentalRequest" DROP CONSTRAINT request_payment_status_valid;
ALTER TABLE "RentalRequest" ADD CONSTRAINT request_payment_status_valid CHECK ("paymentStatus" IN ('WAITING','PAID','TEST_CREDIT'));
ALTER TABLE "RentalRequest" ADD CONSTRAINT test_order_snapshot_valid CHECK (
 (NOT "isTestOrder" AND "paymentStatus" <> 'TEST_CREDIT') OR
 ("isTestOrder" AND "paymentStatus" = 'TEST_CREDIT' AND "testPriceMicros" > 0 AND "testTermDays" BETWEEN 1 AND 3650 AND "testRateBps" BETWEEN 1 AND 10000 AND "testOfferVersion" IS NOT NULL)
);
CREATE INDEX "RentalRequest_testOrder_status_createdAt_idx" ON "RentalRequest" ("isTestOrder",status,"createdAt");

CREATE TABLE test_assets (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id TEXT NOT NULL UNIQUE REFERENCES "RentalRequest"(id) ON DELETE RESTRICT,
 user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
 node_id VARCHAR(64) NOT NULL REFERENCES gpu_catalog(id) ON DELETE RESTRICT,
 price_micros BIGINT NOT NULL CHECK (price_micros > 0),
 term_days INTEGER NOT NULL CHECK (term_days BETWEEN 1 AND 3650),
 rate_bps INTEGER NOT NULL CHECK (rate_bps BETWEEN 1 AND 10000),
 status TEXT NOT NULL DEFAULT 'AWAITING_ALLOCATION' CHECK (status='AWAITING_ALLOCATION'),
 approved_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX test_assets_user_id_approved_at_idx ON test_assets(user_id,approved_at);
COMMIT;
