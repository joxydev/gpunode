# Owner balance credits and mobile dashboard update

Base: `f6040769141c415245c57a2250400de53a6c0cc6`. The public runtime helper, flag precedence across all three services, Epoch worker UUID pagination, offer PDFs/hashes and existing financial calculations remain in this release.

## Credit workflow

Open **Управление → Пользователи**, find an existing participant and open their card. Choose **Пополнить баланс**, enter a positive decimal USDT amount (up to six places) and a reason of 3–500 characters. Review the receiver and exact amount, then confirm. The recipient receives ordinary available ledger funds and one internal notification. The reason is visible only in owner records; it is not included in the recipient's message or activity details.

`POST /api/admin/users/:id/balance/credits` requires an authenticated owner session and the existing accepted agreement. Body: `{"amount":"12.345678","reason":"Returned payment","idempotencyKey":"<UUID>"}`. The server derives the actor from the session and rejects extra input fields. GET on the same URL returns the most recent 30 credits and also requires owner authentication. User IDs are checked against existing accounts; this route never creates accounts.

The amount is parsed with BigInt. The signed PostgreSQL BIGINT maximum is 9,223,372,036,854.775807 USDT. Each amount and the resulting aggregate balance must fit its storage range. The sum is read as a PostgreSQL numeric string so an already oversized aggregate is rejected without conversion overflow.

An owner/key advisory transaction lock precedes the recipient `User FOR UPDATE` lock shared with purchases, withdrawals and deposit settlement. The database also enforces owner/key uniqueness and one operation per ledger row. Operation, positive ADMIN_CREDIT ledger row, Audit and notification commit in one transaction. Retry with the same normalized receiver/amount/reason returns the original operation and original before/after balances; changing any of them with the same key returns 409. Current balance is re-read after success. Pending requests keep their UUID in sessionStorage during timeouts and navigation; confirmed success enables a new independent credit. A definite validation/conflict rejection allows editing; ambiguous network/server failure retains the same UUID.

This does not create `TonDeposit`, `WalletLedger`, invoice or blockchain confirmation rows, does not affect confirmed-TON-deposit statistics and does not activate equipment. Ordinary offer, stock, purchase, withdrawal and settlement checks still apply. Recipient balance refresh remains every 30 seconds and also runs when the app returns to the foreground.

## Migration and rollback

`20261008000100_admin_balance_credit` is additive. It creates one metadata table, foreign keys, uniqueness and positive-amount/before-after checks. It does not alter old ledger rows, deposits, acceptances or leases. Run `npm run db:migrate` after a database/configuration backup. The VPS script builds and runs tests on disposable PostgreSQL before touching the live database.

Code rollback retains the additive table and all new money operations. **Do not restore an old database dump or remove new ledger/credit records as part of code rollback.** Old code still sums ADMIN_CREDIT into the available balance; it simply lacks the new owner action. Backup dumps are recovery artifacts for a separate deliberate recovery, not automatic rollback input.

## Validation

Run Node 22:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run db:generate
npm test
npm run build
```

The existing GitHub Checks workflow and `python3 ops/vps-ci.py <release>` run all existing HTTP financial/Epoch/public-runtime suites plus `ops/admin-credit-integration.mjs`. The new suite refuses any database other than isolated `aethermind_ci` with `CI_INTEGRATION=1`. It verifies owner-first auth, invalid input, decimal precision, one-micro credit, self credit, duplicate/concurrent keys, cross-recipient conflicts, aggregate overflow, forced mid-transaction failure, notification/activity isolation, unchanged TON statistics and competing purchase/withdrawal. It never runs automatic credits on the production database.

For the dashboard, test the production bundle at 320/360/390/430/768/1280/1440 px, three matching 18-second scroll traces at mobile 4× CPU and desktop 1×, plus reduced motion, language variants, foreground refresh, owner form, Telegram BackButton mock and all five tour slides. Emulated CPU/software GPU traces cannot establish physical Android or Telegram WebView FPS. Real-device GPU, keyboard and safe-area verification remains a device check. Rendering guidance: https://web.dev/articles/rendering-performance, https://web.dev/articles/animations-guide and https://developer.chrome.com/docs/devtools/performance.
