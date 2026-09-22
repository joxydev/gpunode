-- Owner control center: payment-state visibility and threaded support.
-- The migration is additive and preserves the original Ticket.message/reply fields.
BEGIN;

ALTER TABLE "RentalRequest"
  ADD COLUMN "paymentStatus" TEXT NOT NULL DEFAULT 'WAITING';

ALTER TABLE "RentalRequest"
  ADD CONSTRAINT "request_payment_status_valid"
  CHECK ("paymentStatus" IN ('WAITING','PAID'));

CREATE INDEX "RentalRequest_paymentStatus_status_createdAt_idx"
  ON "RentalRequest" ("paymentStatus", "status", "createdAt");

ALTER TABLE "Ticket"
  ADD COLUMN "ownerUnread" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "userUnread" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "closedAt" TIMESTAMP(3);

CREATE TABLE ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id TEXT NOT NULL REFERENCES "Ticket"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  author_type TEXT NOT NULL CHECK (author_type IN ('USER','OWNER')),
  author_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ticket_messages_ticket_id_created_at_id_idx
  ON ticket_messages(ticket_id,created_at,id);

INSERT INTO ticket_messages (ticket_id,author_type,author_id,body,created_at)
SELECT id,'USER',"userId",left(CASE WHEN length(trim(message))=0 THEN '[Пустое сообщение из прежней версии]' ELSE message END,2000),"createdAt"
FROM "Ticket";

INSERT INTO ticket_messages (ticket_id,author_type,author_id,body,created_at)
SELECT id,'OWNER','legacy-owner',left(reply,2000),"updatedAt"
FROM "Ticket"
WHERE reply IS NOT NULL AND length(trim(reply)) > 0;

UPDATE "Ticket"
SET status='OPEN'
WHERE status='ANSWERED' AND (reply IS NULL OR length(trim(reply))=0);

UPDATE "Ticket"
SET
  "lastMessageAt" = CASE WHEN reply IS NULL OR length(trim(reply))=0 THEN "createdAt" ELSE "updatedAt" END,
  "ownerUnread" = (reply IS NULL OR length(trim(reply))=0),
  "userUnread" = (reply IS NOT NULL AND length(trim(reply))>0),
  "closedAt" = CASE WHEN status='CLOSED' THEN "updatedAt" ELSE NULL END;

ALTER TABLE "Ticket"
  ADD CONSTRAINT "ticket_closed_at_valid"
  CHECK ((status='CLOSED' AND "closedAt" IS NOT NULL) OR (status<>'CLOSED' AND "closedAt" IS NULL));

CREATE INDEX "Ticket_status_lastMessageAt_idx"
  ON "Ticket" (status,"lastMessageAt");

COMMIT;
