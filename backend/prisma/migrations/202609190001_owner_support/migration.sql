ALTER TABLE "RentalRequest" ADD COLUMN "decision" TEXT, ADD COLUMN "closureReason" TEXT, ADD COLUMN "closedAt" TIMESTAMP(3);
ALTER TABLE "RentalRequest" ADD CONSTRAINT "request_decision_valid" CHECK ("decision" IS NULL OR ("decision" IN ('ACCEPTED','REJECTED') AND "status"='CLOSED' AND "closureReason" IS NOT NULL AND length(trim("closureReason")) BETWEEN 3 AND 1000 AND "closedAt" IS NOT NULL));
ALTER TABLE "Ticket" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'QUESTION', ADD COLUMN "subject" TEXT NOT NULL DEFAULT 'Обращение', ADD COLUMN "status" TEXT NOT NULL DEFAULT 'OPEN';
UPDATE "Ticket" SET "status"='ANSWERED' WHERE "reply" IS NOT NULL;
ALTER TABLE "Ticket" ADD CONSTRAINT "ticket_category_valid" CHECK ("category" IN ('QUESTION','COMPLAINT')), ADD CONSTRAINT "ticket_status_valid" CHECK ("status" IN ('OPEN','IN_PROGRESS','ANSWERED','CLOSED'));
CREATE INDEX "Ticket_status_createdAt_idx" ON "Ticket" ("status", "createdAt");
