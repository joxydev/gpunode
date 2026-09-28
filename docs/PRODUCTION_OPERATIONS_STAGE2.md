# AetherMind: production operations, stage 2

Base commit on GitHub `main`: `adc3908d8543a582f89072d6a078e83696f35b38`.

## Financial model

- USDT deposits on TON still enter the balance only from the existing watcher after a successful treasury notification. The same SQL transaction creates one `DEPOSIT_CREDITED` notification. The invoice create path creates `DEPOSIT_CREATED` in its transaction. A mismatched or late payment creates `DEPOSIT_MANUAL_REVIEW` without credit.
- Withdrawal requests are manual. A valid TON Mainnet destination and an available ledger balance are required. Creation locks the user row, creates one withdrawal and one negative `WITHDRAWAL_RESERVE` ledger entry. Idempotent retries use `(user_id, idempotency_key)`.
- The user can cancel only `REQUESTED`. The owner can reject `REQUESTED`, `UNDER_REVIEW` or `APPROVED`. These terminal actions create one positive `WITHDRAWAL_RELEASE` ledger entry. `PROCESSING` can only advance to `COMPLETED` with a unique transaction hash. Completion does not deduct a second time. No server signer, mnemonic or automatic transfer exists.
- The operator must verify the destination, amount, available reserve and actual on-chain transfer independently before marking `COMPLETED`. An optional fee and net amount are recorded only when known.

## Data and access

- Notifications, withdrawals, activity, support references and data requests are filtered by the authenticated user ID on the server. Admin routes require the participating owner identity.
- Activity aggregates existing deposits, withdrawals, ledger entries and leases; it does not duplicate a deposit because the corresponding deposit ledger entry is excluded.
- Data export and deletion create formal requests for manual review. Neither request automatically exports or deletes financial history. The owner sees outstanding requests in Operations.
- Public authenticated status returns coarse operational modes. Owner Operations reads reachability and a watcher timestamp without returning credentials, treasury funds or internal endpoints.

## Rollout

The VPS deploy script verifies the previous release is the exact stage 1 commit, builds and runs tests in a separate release, runs the HTTP integration suite against disposable PostgreSQL, backs up the live database, applies the additive migration, and switches the symlink. It keeps `runtime.env`, watcher unit and nginx configuration unchanged. On a failed post-switch check, it restores the previous release and service unit. The schema is forward only.

The forward-only `202609280002_support_categories` migration widens the historical `ticket_category_valid` constraint. Stage 2's first isolated HTTP run discovered that the old CHECK rejected `PAYMENT`; it failed before the live database or release was changed. The new migration preserves existing tickets, admits every category accepted by the API, and keeps unknown categories rejected.

After deployment, complete the real Telegram and W5 gasless payment smoke with a compatible wallet, verify `CREDITED`, one notification and one activity entry, and inspect the owner deposit view. For the withdrawal smoke, create a small test request, review it in Owner, reject it, and verify the reserved amount is released exactly once. No real withdrawal transfer is part of this stage.
