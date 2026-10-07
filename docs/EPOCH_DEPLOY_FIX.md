# Epoch worker deployment repair

The old worker applied `id > ''` to the UUID primary key on its first page.
PostgreSQL rejected it with `22P02` before returning any rows, including on an
empty database. The first page now omits the cursor; subsequent pages use a real
lease UUID. Advisory locks and connection cleanup are also checked.

The service runs from `current/backend`, uses `dist/epoch-settle.js` and limits
the Node heap to 256 MB. CLI entry detection resolves symlinks. Failure output
includes a safe database/framework code without dumping credentials.

## Release checks

`ops/vps-ci.py` starts disposable PostgreSQL, applies all migrations and runs:

- `ops/integration.mjs`: authentication, current PDF acceptance, support,
  notifications, TON watcher credit/replay and withdrawals at the offer minimum.
- `ops/financial-integration.mjs`: purchase idempotency, owner actions, Base and
  Compound settlement, early unbonding and ledger reservation/refunds.
- `ops/epoch-integration.mjs`: empty first page, actual CLI, advisory lock,
  101 active leases crossing a page boundary, repeated timer run and pause flag.

All fixtures require `CI_INTEGRATION=1` and database `aethermind_ci`. This does not
accept agreements or create test balances in the production database.

## Deployment scripts

Run `90_aethermind_epoch_github.sh` first, then `91_aethermind_epoch_vps.sh` in
Termux. The GitHub script applies the repair to the existing homepage release.
The VPS script builds and runs disposable-database integration checks before
touching the live timer. It then stops the timer, applies additive migrations,
validates inventory, verifies TON, installs/checks units and starts the worker
before restarting the public API. The timer is enabled after runtime checks.

Inventory confirmation is entered locally. Enter preserves an already confirmed
pool. Root opens private catalogue SQL through stdin for the postgres process.
An optimistic check rejects catalogue changes made after the deployment snapshot.

On failure the script shows sanitized service diagnostics and restores the
previous release, environment and timer configuration. Database migrations,
confirmed inventory and financial records are preserved. A database dump is
kept in the private deployment backup for recovery; it is never restored over
new transactions automatically.
