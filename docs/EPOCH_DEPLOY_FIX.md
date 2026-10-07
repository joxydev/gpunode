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

## API environment repair

The next attempt completed the worker, but `/api/offer` returned a valid
financial offer with `accrualEnabled=false`. This identifies a process flag
mismatch, rather than the UUID or document failure. The logs alone do not name
the VPS override responsible for it.

Run `92_aethermind_runtime_github.sh`, then `93_aethermind_runtime_vps.sh`.
The release keeps all homepage and background changes. A late service drop-in
appends the shared environment and a root-only public release flag file for the
API, TON watcher and Epoch worker. Controlled `UnsetEnvironment` entries are
removed while unrelated entries remain. `APP_COMMIT` also comes from this final
file, so an older environment file cannot supply the wrong release identifier.
Environment file order is verified after daemon reload. Every service runs the
same read-only flag/PDF preflight with its actual systemd environment.

The deployment prints only whitelisted process flags before changes and checks
the live API and watcher flags after restart. Secrets are never printed. The
old flag file and each managed drop-in are backed up and restored on rollback.
`ops/public-runtime-test.py` checks inherited overrides/removals and redaction;
`ops/public-runtime-integration.mjs` rejects stale flags and verifies public
offer, catalogue and ordinary participant profile on disposable PostgreSQL.
