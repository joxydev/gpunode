BEGIN;
ALTER TABLE "User" ADD COLUMN "agreementVersion" TEXT;
ALTER TABLE "User" ADD COLUMN "agreementAcceptedAt" TIMESTAMP(3);
COMMIT;
