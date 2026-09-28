-- Forward-only production operations; existing financial tables are unchanged.
CREATE TABLE "notifications" (
 "id" UUID NOT NULL PRIMARY KEY,
 "user_id" TEXT NOT NULL REFERENCES "User"("id"),
 "type" VARCHAR(40) NOT NULL,
 "title" VARCHAR(120) NOT NULL,
 "message" VARCHAR(500) NOT NULL,
 "reference_type" VARCHAR(24),
 "reference_id" VARCHAR(100),
 "dedupe_key" VARCHAR(160) NOT NULL UNIQUE,
 "is_read" BOOLEAN NOT NULL DEFAULT false,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "notifications_user_id_created_at_id_idx" ON "notifications"("user_id","created_at","id");
CREATE INDEX "notifications_user_id_is_read_idx" ON "notifications"("user_id","is_read");

CREATE TABLE "withdrawal_requests" (
 "id" UUID NOT NULL PRIMARY KEY,
 "user_id" TEXT NOT NULL REFERENCES "User"("id"),
 "idempotency_key" UUID NOT NULL,
 "asset" VARCHAR(10) NOT NULL DEFAULT 'USDT',
 "network" VARCHAR(10) NOT NULL DEFAULT 'TON',
 "destination_address" VARCHAR(70) NOT NULL,
 "amount_micros" BIGINT NOT NULL,
 "fee_micros" BIGINT,
 "net_amount_micros" BIGINT,
 "status" VARCHAR(20) NOT NULL DEFAULT 'REQUESTED',
 "tx_hash" VARCHAR(64) UNIQUE,
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "reviewed_at" TIMESTAMPTZ(3),
 "completed_at" TIMESTAMPTZ(3),
 "rejection_reason" VARCHAR(1000),
 CONSTRAINT "withdrawal_positive_amount" CHECK ("amount_micros" > 0),
 CONSTRAINT "withdrawal_ton_usdt_only" CHECK ("asset" = 'USDT' AND "network" = 'TON'),
 CONSTRAINT "withdrawal_fees_valid" CHECK (("fee_micros" IS NULL AND "net_amount_micros" IS NULL) OR ("fee_micros" IS NOT NULL AND "fee_micros" >= 0 AND "net_amount_micros" = "amount_micros" - "fee_micros" AND "net_amount_micros" > 0)),
 CONSTRAINT "withdrawal_status_valid" CHECK ("status" IN ('REQUESTED','UNDER_REVIEW','APPROVED','PROCESSING','COMPLETED','REJECTED','CANCELLED')),
 CONSTRAINT "withdrawal_complete_hash" CHECK ("status" <> 'COMPLETED' OR ("tx_hash" IS NOT NULL AND "completed_at" IS NOT NULL)),
 CONSTRAINT "withdrawal_unique_request" UNIQUE ("user_id","idempotency_key")
);
CREATE INDEX "withdrawal_requests_user_id_created_at_id_idx" ON "withdrawal_requests"("user_id","created_at","id");
CREATE INDEX "withdrawal_requests_status_created_at_idx" ON "withdrawal_requests"("status","created_at");

CREATE TABLE "data_requests" (
 "id" UUID NOT NULL PRIMARY KEY,
 "user_id" TEXT NOT NULL REFERENCES "User"("id"),
 "kind" VARCHAR(32) NOT NULL,
 "status" VARCHAR(20) NOT NULL DEFAULT 'REQUESTED',
 "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "reviewed_at" TIMESTAMPTZ(3),
 CONSTRAINT "data_request_kind_valid" CHECK ("kind" IN ('DATA_EXPORT_REQUEST','DATA_DELETION_REQUEST')),
 CONSTRAINT "data_request_status_valid" CHECK ("status" IN ('REQUESTED','IN_PROGRESS','COMPLETED','REJECTED'))
);
CREATE INDEX "data_requests_user_id_created_at_idx" ON "data_requests"("user_id","created_at");

ALTER TABLE "Ticket" ADD COLUMN "reference_type" VARCHAR(24), ADD COLUMN "reference_id" VARCHAR(64);
CREATE INDEX "Ticket_reference_type_reference_id_idx" ON "Ticket"("reference_type","reference_id");
