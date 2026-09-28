-- Preserve historical tickets while admitting the production support categories.
-- This is a forward-only widening of the original CHECK; no ticket rows change.
ALTER TABLE "Ticket"
  DROP CONSTRAINT "ticket_category_valid",
  ADD CONSTRAINT "ticket_category_valid" CHECK (
    "category" IN (
      'QUESTION', 'COMPLAINT', 'PAYMENT', 'WITHDRAWAL', 'ACCOUNT',
      'WALLET', 'NODE', 'TECHNICAL', 'OTHER'
    )
  );
