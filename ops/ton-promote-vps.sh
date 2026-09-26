#!/usr/bin/env bash
# Explicit, independently audited promotion of the standard attach and gasless rollout.
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo 'Run with sudo on the VPS.' >&2; exit 1; }
mode=${1:-};invoice=${2:-};hash=${3:-}
[[ $mode == standard || $mode == gasless-canary || $mode == gasless-owner || $mode == gasless-all || $mode == gasless-off ]] || { echo 'Mode: standard | gasless-canary | gasless-all | gasless-off' >&2; exit 1; }
cd /
exec 9>/var/lock/gpunode-deploy.lock
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 1; }
root=/srv/apps/gpunode;envfile=$root/shared/runtime.env;release=$(readlink -f "$root/current")
[[ $release == /srv/releases/gpunode/* && -f $release/ops/ton-audit.mjs && -f $envfile ]] || { echo 'TON release not installed.' >&2; exit 1; }
systemctl is-active --quiet gpunode.service
systemctl is-active --quiet gpunode-ton-watcher.service
backup="/srv/backups/gpunode/ton-promotion-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 0700 "$backup"
cp -a "$envfile" "$backup/runtime.env"
changed=0

runtime(){
 (
  set -a
  # shellcheck disable=SC1090
  source "$envfile"
  set +a
  runuser --preserve-environment -u deploy -- env PATH="$(dirname "$(sed -n 's/^ExecStart=\([^ ]*\/bin\/node\) dist\/main.js$/\1/p' /etc/systemd/system/gpunode.service)"):$PATH" HOME=/home/deploy "$@"
 )
}
rollback(){
 trap - ERR INT TERM;set +e
 if ((changed)); then cp -a "$backup/runtime.env" "$envfile";systemctl restart gpunode.service;fi
 echo "Promotion not confirmed; prior configuration saved in $backup" >&2
 exit 1
}
trap rollback ERR INT TERM

if [[ $mode == standard || $mode == gasless-all ]]; then
 [[ $invoice =~ ^dep_[a-f0-9]{32}$ && $hash =~ ^[a-f0-9]{64}$ ]] || { echo 'Need exact authorized canary invoice ID and treasury transaction hash.' >&2; exit 1; }
 audit=standard;[[ $mode == standard ]] || audit=gasless
 runtime node "$release/ops/ton-audit.mjs" "$audit" "$invoice" "$hash"
 echo "Trace: https://tonviewer.com/transaction/$hash"
 echo 'Check the Mainnet trace: jetton execution, transfer_notification, actual GRAM costs, excess refund (standard), treasury amount and relay fee (gasless).'
 answer=''
 read -r -p 'After reviewing the trace type TRACE_OK: ' answer </dev/tty
 [[ $answer == TRACE_OK ]] || { echo 'No rollout without a reviewed trace.' >&2; exit 1; }
fi

case $mode in
 gasless-off)
  pending=$(runuser -u postgres -- psql -Atqc "SELECT count(*) FROM deposits WHERE status='PENDING' AND expires_at>now() AND metadata #>> '{gasless,externalBoc}' IS NOT NULL" aethermind_v1)
  [[ $pending == 0 ]] || { echo "Signed gasless invoices still pending: $pending. Wait for the watcher before disabling." >&2; exit 1; }
  changed=1
  printf 'ENABLE_TON_GASLESS=false\nTON_GASLESS_SMOKE_OWNER_ONLY=true\n' >> "$envfile"
  ;;
 standard)
  [[ $(awk -F= '/^TON_JETTON_ATTACH_GRAM=/{v=$2}END{print v}' "$envfile") == 0.1 ]] || { echo 'Public attach was already changed.' >&2; exit 1; }
  changed=1
  printf 'TON_JETTON_ATTACH_GRAM=0.05\nTON_JETTON_ATTACH_SMOKE_OWNER_GRAM=\n' >> "$envfile"
  ;;
 gasless-canary|gasless-owner)
  [[ $(awk -F= '/^TON_JETTON_ATTACH_GRAM=/{v=$2}END{print v}' "$envfile") == 0.05 ]] || { echo 'Standard Mainnet promotion must finish first.' >&2; exit 1; }
  key=''
  read -rs -p 'TONAPI API key (hidden input): ' key </dev/tty;echo
  [[ $key =~ ^[A-Za-z0-9_-]{8,200}$ ]] || { echo 'Invalid TONAPI key format.' >&2; exit 1; }
  changed=1
  printf 'TONAPI_API_KEY=%s\nENABLE_TON_GASLESS=true\nTON_GASLESS_SMOKE_OWNER_ONLY=true\n' "$key" >> "$envfile"
  unset key
  runtime node --input-type=module -e 'import("file:///srv/apps/gpunode/current/backend/dist/ton/gasless.js").then(async m=>{const {tonConfig}=await import("file:///srv/apps/gpunode/current/backend/dist/ton/config.js");const relay=await new m.TonApiGasless(tonConfig()).relay();if(!relay)throw Error("TONAPI does not support the official USDT master");process.stdout.write("TONAPI USDT relay verified\n")})'
  ;;
 gasless-all)
  [[ $(awk -F= '/^TON_GASLESS_SMOKE_OWNER_ONLY=/{v=$2}END{print v}' "$envfile") == true && $(awk -F= '/^ENABLE_TON_GASLESS=/{v=$2}END{print v}' "$envfile") == true ]] || { echo 'Gasless canary not active.' >&2; exit 1; }
  changed=1
  printf 'TON_GASLESS_SMOKE_OWNER_ONLY=false\n' >> "$envfile"
  ;;
esac
chmod 0600 "$envfile"
systemctl restart gpunode.service
ready=0
for _ in {1..25}; do if curl -fsS --max-time 2 http://127.0.0.1:3100/api/health >/dev/null 2>&1; then ready=1;break;fi;sleep 1;done
((ready)) || { echo 'API did not recover.' >&2;false; }
curl -fsS --max-time 15 --resolve 31.77.226.26:443:127.0.0.1 https://31.77.226.26/api/health >/dev/null
systemctl is-active --quiet gpunode-ton-watcher.service
runtime node --input-type=module -e 'import("file:///srv/apps/gpunode/current/backend/dist/ton/config.js").then(m=>{const c=m.tonConfig();if(!c.enabled)throw Error("Deposits disabled");process.stdout.write(JSON.stringify({publicAttachNano:c.attachAmount.toString(),gaslessEnabled:c.gaslessEnabled,canaryOnly:c.gaslessSmokeOwnerOnly,testerIds:c.paymentTestIds})+"\n")})'
trap - ERR INT TERM
echo "Promotion $mode complete; backup: $backup"
