-- Additive migration: no changes to balances, deposits, leases or acceptances.
CREATE TABLE "AdminBalanceCredit" (
  "id" UUID NOT NULL,
  "actorId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "amountMicros" BIGINT NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "idempotencyKey" UUID NOT NULL,
  "ledgerId" TEXT NOT NULL,
  "balanceBeforeMicros" BIGINT NOT NULL,
  "balanceAfterMicros" BIGINT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminBalanceCredit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AdminBalanceCredit_amount_check" CHECK ("amountMicros" > 0),
  CONSTRAINT "AdminBalanceCredit_balance_check" CHECK ("balanceAfterMicros"::numeric = "balanceBeforeMicros"::numeric + "amountMicros"::numeric),
  CONSTRAINT "AdminBalanceCredit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AdminBalanceCredit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AdminBalanceCredit_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "LedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AdminBalanceCredit_actorId_idempotencyKey_key" ON "AdminBalanceCredit"("actorId", "idempotencyKey");
CREATE UNIQUE INDEX "AdminBalanceCredit_ledgerId_key" ON "AdminBalanceCredit"("ledgerId");
CREATE INDEX "AdminBalanceCredit_userId_createdAt_idx" ON "AdminBalanceCredit"("userId", "createdAt");
