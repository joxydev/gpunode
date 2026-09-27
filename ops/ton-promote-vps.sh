#!/usr/bin/env bash
# Promote a tested USDT TON payment path. A gasless release preserves standard access.
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo 'Run with sudo on VPS.' >&2; exit 1; }
mode=${1:-};invoice=${2:-};hash=${3:-}
case $mode in deposits-canary|deposits-public|deposits-off|gasless-canary|gasless-all|gasless-off) ;; *) echo 'Modes: deposits-canary | deposits-public <invoice> <treasury-tx-hash> | deposits-off | gasless-canary | gasless-all <invoice> <treasury-tx-hash> | gasless-off' >&2; exit 1;; esac
cd /
exec 9>/var/lock/gpunode-deploy.lock
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 1; }
root=/srv/apps/gpunode;envfile=$root/shared/runtime.env;release=$(readlink -f "$root/current")
[[ $release == /srv/releases/gpunode/* && -f $release/ops/ton-audit.mjs && -f $envfile ]] || { echo 'Current TON release missing.' >&2; exit 1; }
[[ -z ${AETHER_EXPECTED_RELEASE:-} || $(cat "$release/DEPLOYED_COMMIT") == "$AETHER_EXPECTED_RELEASE" ]] || { echo 'Installed release differs from the audited GitHub commit.' >&2; exit 1; }
systemctl is-active --quiet gpunode.service
systemctl is-active --quiet gpunode-ton-watcher.service
node_bin=$(sed -n 's/^ExecStart=\([^ ]*\/bin\/node\) dist\/main.js$/\1/p' /etc/systemd/system/gpunode.service)
[[ $node_bin == /opt/gpu-node/node-v22.*-linux-x64/bin/node && -x $node_bin ]] || { echo 'Node 22 not found.' >&2; exit 1; }
backup="/srv/backups/gpunode/ton-promotion-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 0700 "$backup"
cp -a "$envfile" "$backup/runtime.env"
changed=0
runtime(){ (
 set -a
 # shellcheck disable=SC1090
 source "$envfile"
 set +a
 runuser --preserve-environment -u deploy -- env PATH="$(dirname "$node_bin"):$PATH" HOME=/home/deploy "$@"
); }
rollback(){
 trap - ERR INT TERM;set +e
 if ((changed)); then cp -a "$backup/runtime.env" "$envfile";systemctl restart gpunode.service;fi
 echo "Promotion failed; configuration backup: $backup" >&2
 exit 1
}
trap rollback ERR INT TERM
access=$(awk -F= '/^TON_DEPOSIT_ACCESS=/{v=$2} END{print v}' "$envfile")
gasless=$(awk -F= '/^ENABLE_TON_GASLESS=/{v=$2} END{print v}' "$envfile")
gasless_rollout=$(awk -F= '/^TON_GASLESS_SMOKE_OWNER_ONLY=/{v=$2} END{print v}' "$envfile")
[[ $access == disabled || $access == canary || $access == public ]] || { echo 'Deploy the corrected release first.' >&2; exit 1; }

if [[ $mode == deposits-public || $mode == gasless-all ]]; then
 [[ $invoice =~ ^dep_[a-f0-9]{32}$ && $hash =~ ^[a-f0-9]{64}$ ]] || { echo 'Provide the NEW automatically credited canary invoice ID and the treasury owner transaction hash (64 hex chars).' >&2; exit 1; }
 audit=standard;[[ $mode == deposits-public ]] || audit=gasless
 runtime "$node_bin" "$release/ops/ton-audit.mjs" "$audit" "$invoice" "$hash"
 echo "Verified chain transaction: https://tonviewer.com/transaction/$hash"
fi

case $mode in
 deposits-canary)
  [[ $access == disabled && $gasless != true ]] || { echo 'Canary requires paused deposits and disabled gasless.' >&2; exit 1; }
  [[ $(awk -F= '/^OWNER_TELEGRAM_ID=/{v=$2} END{print v}' "$envfile") =~ ^[1-9][0-9]{0,19}$ ]] || { echo 'OWNER_TELEGRAM_ID missing.' >&2; exit 1; }
  # Tester IDs, if any, come only from previously configured server secrets.
  changed=1;printf 'TON_DEPOSIT_ACCESS=canary\nENABLE_TON_USDT_DEPOSITS=true\n' >> "$envfile"
  ;;
 deposits-public)
  [[ $access == canary && $gasless != true ]] || { echo 'First verify a standard canary; gasless must stay off.' >&2; exit 1; }
  changed=1;printf 'TON_DEPOSIT_ACCESS=public\n' >> "$envfile"
  ;;
 deposits-off)
  changed=1;printf 'TON_DEPOSIT_ACCESS=disabled\nENABLE_TON_USDT_DEPOSITS=false\n' >> "$envfile"
  ;;
 gasless-canary)
  [[ ( $access == canary || $access == public ) && $gasless != true ]] || { echo 'Standard Mainnet deposits must be in canary or public mode; gasless must be off.' >&2; exit 1; }
  key=''
  read -rs -p 'TONAPI key (hidden; Enter = use stored key): ' key </dev/tty;echo
  if [[ -n $key ]]; then
   [[ $key =~ ^[A-Za-z0-9_-]{8,200}$ ]] || { echo 'Invalid TONAPI key format.' >&2; exit 1; }
   changed=1;printf 'TONAPI_API_KEY=%s\n' "$key" >> "$envfile"
  fi
  unset key
  changed=1;printf 'ENABLE_TON_GASLESS=true\nTON_GASLESS_SMOKE_OWNER_ONLY=true\n' >> "$envfile"
  runtime "$node_bin" --input-type=module -e 'import("file:///srv/apps/gpunode/current/backend/dist/ton/gasless.js").then(async m=>{const {tonConfig}=await import("file:///srv/apps/gpunode/current/backend/dist/ton/config.js");const relay=await new m.TonApiGasless(tonConfig()).relay();if(!relay)throw Error("TONAPI does not support official USDT");process.stdout.write("TONAPI USDT relay verified\n")})'
  ;;
 gasless-all)
  [[ ( $access == canary || $access == public ) && $gasless == true && $gasless_rollout == true ]] || { echo 'Gasless canary must be enabled while standard deposits are in canary or public mode.' >&2; exit 1; }
  # The new W5 payment passed the full deposit and USDT relayer fee audit above.
  # If standard access was still canary, open both paths together after that proof.
  changed=1
  if [[ $access == canary ]]; then
   printf 'TON_DEPOSIT_ACCESS=public\nENABLE_TON_USDT_DEPOSITS=true\n' >> "$envfile"
  fi
  printf 'TON_GASLESS_SMOKE_OWNER_ONLY=false\n' >> "$envfile"
  ;;
 gasless-off)
  pending=$(runuser -u postgres -- psql -Atqc "SELECT count(*) FROM deposits WHERE status='PENDING' AND expires_at>now() AND metadata #> '{gasless,externalBoc}' IS NOT NULL" aethermind_v1)
  [[ $pending == 0 ]] || { echo "Signed gasless transfers in flight: $pending" >&2; exit 1; }
  changed=1;printf 'ENABLE_TON_GASLESS=false\nTON_GASLESS_SMOKE_OWNER_ONLY=true\n' >> "$envfile"
  ;;
esac
chmod 0600 "$envfile"
systemctl restart gpunode.service
ready=0
for _ in {1..25}; do if curl -fsS --max-time 2 http://127.0.0.1:3100/api/health >/dev/null 2>&1; then ready=1;break;fi;sleep 1;done
((ready)) || { echo 'API did not recover.' >&2;false; }
curl -fsS --max-time 15 --resolve 31.77.226.26:443:127.0.0.1 https://31.77.226.26/api/health >/dev/null
systemctl is-active --quiet gpunode-ton-watcher.service
runtime "$node_bin" --input-type=module -e 'import("file:///srv/apps/gpunode/current/backend/dist/ton/config.js").then(m=>{const c=m.tonConfig();process.stdout.write(JSON.stringify({access:c.access,standardAttachNano:c.attachAmount.toString(),notificationForwardNano:c.notificationForwardNano.toString(),gaslessEnabled:c.gaslessEnabled,gaslessCanaryOnly:c.gaslessSmokeOwnerOnly,testerIds:c.paymentTestIds})+"\n")})'
trap - ERR INT TERM
echo "Promotion $mode complete; backup: $backup"
