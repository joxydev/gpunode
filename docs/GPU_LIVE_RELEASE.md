# GPU Live and public Compound

Baseline: `d3c21ae5544d6b4582cc75e468ea23d65fb2b2b0`.
Implementation branch: `codex/gpu-live-counters-20261009`.

## Accounting and API

`backend/src/live-accrual.ts` is a pure read-only projection of a lease's frozen
terms, confirmed settlement fields and the server UTC time. It uses the same
`accrueDay` function and fractional carry as settlement. It never inserts a
ledger entry, updates a lease or moves the available balance.

Each period starts at `activatedAt + dayIndex * 86400000`. It is a full 24-hour
interval, independent of local midnight, timezone and DST. Unsettled completed
periods are projected in memory; their profit is returned separately from
confirmed profit. After settlement that amount moves into confirmed profit
without being added twice. The contract end returns SYNCING, never a fictitious
extra earning period. Invalid, legacy, paused and inactive rows are static.

`/api/me`, `/api/v1/market/leases` and the new authenticated, owner-filtered
`/api/v1/market/leases/:id` return `liveAccrual`. Money fields are integer
micro-USDT strings. The DTO includes serverNow, snapshotKey, period boundaries,
opening/projected capital, daily yield, processed/pending days and profit.

For a projected daily yield D and elapsed whole seconds s:

```
F(s) = floor(D * s / 86400)
delta(k) = floor(D * k / 8640) - floor(D * (k - 1) / 8640)
sum(delta(k), k=1..8640) = D
```

The UI derives each value from the server snapshot and a shared monotonic
performance.now clock. It uses one 1-second timer only while a visible counter
subscribes. It does not call the API each second. Existing 30-second refreshes
are deduplicated, old responses are rejected and foregrounding forces a fresh
snapshot. Stale data freezes after 90 seconds. A period boundary holds the last
value and requests one refresh before displaying the next period.

## Public Compound and interface

ENABLE_COMPOUND=true is part of the canonical public runtime flags used by
API, TON watcher and Epoch service. The three existing published tariffs remain
subject to offer acceptance, actual inventory, available balance and the
existing one-active-order rule. Quantum stays experimental and unavailable.
Existing BASE leases, TON proof/payment code, owner-credit logic, legal PDF and
ledger settlement implementation are preserved.

Orders default to BASE and require an explicit Compound selection. An uncertain
request keeps its original mode and idempotency key in sessionStorage across
navigation and reload. Mode changes are disabled until that request resolves.
A confirmed order stays confirmed if a subsequent read refresh fails.

GPU details use the existing optimized WebP hardware art and separate current
period profit, remaining time, last 10-second portion, daily projection,
confirmed profit, pending settlement and capital. Dashboard and My GPUs show
compact cards; direct links return to their original scroll position and focus.

Illustrative workloads change deterministically every 6 seconds and tasks every
18 seconds. They are labelled as illustrations, not physical telemetry. They
stop in the background or offscreen and never affect money. Transform/opacity
animations use WAAPI with cancellation/finished handling, reduced motion and
focus/inert cleanup. The TON wallet stays mounted when changing sections.
RU/EN/RO labels use My GPUs; the unwanted performance-profile sentence is removed.

## Delivery and recovery

100_aethermind_gpu_live_github.sh embeds a checked Git bundle. It backs up the
original HEAD, preserves dirty tracked and untracked work in a durable local
stash reference, integrates compatible main changes without reset/force and
pushes normally. Actions remains workflow_dispatch only. It records the actual
verified final remote SHA in `.git/aethermind-gpu-live-release`.

101_aethermind_gpu_live_vps.sh uses that exact SHA (or one explicit SHA argument),
checks it belongs to main, archives it without changing local work, verifies a
complete embedded remote shell and uploads both files using the existing SSH
key. Both wrappers check their own full-file checksum and last marker before
Git/SSH actions. The SSH socket name stays short on Termux; sudo and passphrases
use the normal terminal.

The existing Ubuntu/Node 22/deploy/systemd/release pipeline builds sequentially
with a bounded heap. It runs the current ops/vps-ci.py on disposable native
PostgreSQL before production migrations or switching current, including all
existing financial, Epoch, owner-credit and public runtime suites plus the new
GPU Live HTTP suite. It preserves real catalog inventory. Public smoke checks
use public GET only; no production Telegram sessions are forged and no real
purchase, credit or acceptance is made for testing. Release checks verify the
commit, Compound flag, preflight, fresh watcher scan, Epoch result, Nginx index,
GPU WebPs, backgrounds and legal PDF.

Rollback restores compatible code, runtime/drop-ins and service/timer state.
It never restores a historical database over new operations or deletes money,
settlements, balances or newly created Compound leases.

## Validation and limits

Local Node 22 production build passes. Backend 46 and frontend 6 unit tests pass,
including exact sums of all 8640 portions for non-divisible amounts and bigint
extremes; BASE 30/60/90; Compound first/second days, block boundaries, carry,
catch-up and contract end. Runtime helper tests: 6 passed.

New real Nest/Prisma HTTP suite passes using isolated WASM PostgreSQL over the
PostgreSQL wire protocol. Three ordinary non-canary users buy/activate the three
Compound tariffs; retries do not duplicate orders, mode mutation conflicts,
foreign detail access is denied, GET does not write ledger, catch-up transfers
pending profit correctly, settlement replay and terminal payout are idempotent.
For Alpha, the first daily yield is 0.900000 USDT, first closing capital is
50.900000, and second daily yield is 0.916200.

Browser matrix: RU/EN/RO on 320/360/390/430/768/1024/1440; six static lease states;
200% text and reduced motion (34 combinations, including owner and ordinary roles). Regression checks cover device
clock changes, Telegram activated/deactivated, direct back/focus, retained
Compound mode/key after a network failure and reload, definitive refusal,
landscape, repeated modal exits and retained TON wallet/invoice after refusal.
These browser financial responses and wallet transactions are synthetic.

Native PostgreSQL concurrency, live TON RPC, actual VPS/systemd and public HTTPS
are checked by script 101 on the target server; they are not claimed as local
live validation. Physical Telegram Android WebView was not available. Performance
measurements use the same headless Chromium 153, data and scripts on both builds:
mobile 390x844 at 4x CPU throttle and desktop 1440x1000 at 1x; three scroll passes
per screen, modal/GPU transitions, and a full minute with the counter visible.
Reported dropped frames are a requestAnimationFrame estimate, not device GPU
telemetry. Raw trace files and metrics are retained with the local QA run.

Primary animation references:
- https://web.dev/articles/animations-guide
- https://developer.mozilla.org/en-US/docs/Web/API/Animation/finished
- https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
