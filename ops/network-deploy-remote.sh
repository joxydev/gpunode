#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
rollback_ready=0
deploy_phase='проверки до обновления'
phase(){ deploy_phase=$1; printf '\nVPS: %s\n' "$deploy_phase"; }
fail(){ printf 'VPS: %s\n' "$*" >&2; if [[ $rollback_ready == 1 ]]; then rollback 1; fi; exit 1; }
[[ $EUID -eq 0 ]] || fail 'Требуется sudo.'
archive=${1:-}; sha=${2:-}; digest=${3:-}; code_digest=${4:-}
[[ $code_digest =~ ^[0-9a-f]{64}$ && -f ${BASH_SOURCE[0]} && ! -L ${BASH_SOURCE[0]} ]] || fail 'Неверный вложенный shell-файл.'
printf '%s  %s\n' "$code_digest" "${BASH_SOURCE[0]}" | sha256sum -c --status || fail 'Вложенный shell-файл повреждён.'
[[ $(tail -n 1 -- "${BASH_SOURCE[0]}") == '# AETHERMIND_NETWORK_REMOTE_COMPLETE' ]] || fail 'Вложенный shell-файл обрезан.' 
[[ $archive =~ ^/home/joxy/aethermind-upload\.[A-Za-z0-9]+/source\.tar\.gz$ && -f $archive && ! -L $archive ]] || fail 'Неверный архив.'
[[ $sha =~ ^[0-9a-f]{40}$ && $digest =~ ^[0-9a-f]{64}$ ]] || fail 'Неверные суммы.'
printf '%s  %s\n' "$digest" "$archive" | sha256sum -c --status || fail 'Архив повреждён.'
# shellcheck disable=SC1091
source /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 24.04 ]] || fail 'Ожидается Ubuntu 24.04.'
exec 9>/var/lock/gpunode-deploy.lock
flock -n 9 || fail 'Другой деплой выполняется.'
cd / # runuser must not inherit the private /home/joxy working directory.
root=/srv/apps/gpunode
envfile="$root/shared/runtime.env"
flagfile="$root/shared/public-release.env"
runtime_dropin=zzzz-aethermind-public-runtime.conf
dropin=/etc/systemd/system/gpunode.service.d/offer-release.conf
[[ -f $envfile && -L $root/current ]] || fail 'Нет текущего релиза или runtime.env.'
previous=$(readlink -f "$root/current")
[[ -d $previous && -f $previous/frontend/dist/index.html ]] || fail 'Текущий релиз некорректен.'
systemctl is-active --quiet gpunode.service || fail 'API до обновления не работает.'
systemctl is-active --quiet gpunode-ton-watcher.service || fail 'TON watcher до обновления не работает.'
grep -Eq '^TONCENTER_API_KEY=[A-Za-z0-9_-]{8,200}$' "$envfile" || fail 'TONCENTER_API_KEY не настроен.'
node_bin=$(sed -n 's/^ExecStart=\([^ ]*\/bin\/node\) dist\/main.js$/\1/p' /etc/systemd/system/gpunode.service)
[[ $node_bin == /opt/gpu-node/node-v22.*-linux-x64/bin/node && -x $node_bin ]] || fail 'Не найден Node.js 22 текущего сервиса.'
node_directory=$(dirname "$node_bin")
PATH="$node_directory:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PATH
for app in npm python3 runuser pg_dump pg_restore psql curl nginx systemd-analyze; do command -v "$app" >/dev/null || fail "Нет зависимости $app."; done
mem_available=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
swap_free=$(awk '/^SwapFree:/ {print $2}' /proc/meminfo)
((mem_available>128000 && mem_available+swap_free>640000)) || fail 'Для последовательной сборки нужно 128 МБ доступной RAM и суммарно 640 МБ RAM+swap.'
available=$(df -Pk /srv | awk 'NR==2 {print $4}')
((available>1800000)) || fail 'Нужно минимум 1.8 ГБ свободного места.'
stamp=$(date -u +%Y%m%dT%H%M%SZ)
release="/srv/releases/gpunode/$stamp-$sha"
backup="/srv/backups/gpunode/gpu-fx-111-$stamp"
install -d -m 0700 "$backup"
printf '%s\n' "$previous" > "$backup/previous-release.txt"
printf '%s\n' "$sha" > "$backup/requested-commit.txt"
printf '%s\n' "$digest" > "$backup/source-sha256.txt"
cp -a "$envfile" "$backup/runtime.env"
if [[ -f $flagfile ]]; then cp -a "$flagfile" "$backup/public-release.env"; fi
for unit in gpunode.service gpunode-ton-watcher.service gpunode-epoch-settle.service gpunode-ambassador.service; do
  runtime_file="/etc/systemd/system/$unit.d/$runtime_dropin"
  if [[ -f $runtime_file ]]; then cp -a "$runtime_file" "$backup/$unit.runtime.conf"; fi
done
if [[ -f $dropin ]]; then cp -a "$dropin" "$backup/offer-release.conf"; fi
for unit in gpunode-epoch-settle.service gpunode-epoch-settle.timer gpunode-ambassador.service gpunode-ambassador.timer; do if [[ -f /etc/systemd/system/$unit ]]; then cp -a "/etc/systemd/system/$unit" "$backup/$unit"; fi; done
was_timer_active=0; systemctl is-active --quiet gpunode-epoch-settle.timer && was_timer_active=1
was_timer_enabled=0; systemctl is-enabled --quiet gpunode-epoch-settle.timer && was_timer_enabled=1
was_ambassador_active=0; systemctl is-active --quiet gpunode-ambassador.timer && was_ambassador_active=1
was_ambassador_enabled=0; systemctl is-enabled --quiet gpunode-ambassador.timer && was_ambassador_enabled=1
runuser -u postgres -- pg_dump -Fc aethermind_v1 > "$backup/database.dump"
pg_restore --list "$backup/database.dump" >/dev/null
edited=0; switched=0; timer_touched=0; runtime_touched=0; migrated=0; nginx_touched=0; services_stopped=0; publication_created=0; publication_updated=0
rollback(){
  local result=${1:-1} failed_line=${2:-unknown}
  trap - ERR INT TERM HUP
  set +e
  printf 'Сбой на этапе: %s (код %s, строка %s).\n' "$deploy_phase" "$result" "$failed_line" >&2
  # Redact credentials before showing or saving service diagnostics.
  python3 - "$envfile" "$backup" "$stamp" <<'PY_DIAGNOSTICS'
import pathlib,re,subprocess,sys
envfile,backup,stamp=sys.argv[1:]
secrets=[]
for file in (pathlib.Path(envfile),pathlib.Path(backup)/'runtime.env'):
    if not file.is_file():continue
    for line in file.read_text().splitlines():
        if '=' not in line or line.lstrip().startswith('#'):continue
        key,value=line.split('=',1);value=value.strip().strip('"').strip("'")
        if re.search('SECRET|TOKEN|KEY|PASSWORD|DATABASE_URL',key) and len(value)>=6:secrets.append(value)
for unit in ('gpunode-epoch-settle.service','gpunode-ambassador.service','gpunode.service','gpunode-ton-watcher.service'):
    state=subprocess.run(['systemctl','show',unit,'-p','Result','-p','ExecMainStatus','-p','ActiveState','-p','SubState'],capture_output=True,text=True,timeout=10)
    logs=subprocess.run(['journalctl','-u',unit,'--since',f'{stamp[:4]}-{stamp[4:6]}-{stamp[6:8]} {stamp[9:11]}:{stamp[11:13]}:{stamp[13:15]} UTC','--no-pager','-n','40','-o','cat'],capture_output=True,text=True,timeout=10)
    text=f'\n{unit}\n{state.stdout}{logs.stdout}'
    for secret in sorted(set(secrets),key=len,reverse=True):text=text.replace(secret,'[REDACTED]')
    text=re.sub(r'postgres(?:ql)?://[^\s\"\']+','[DATABASE_URL]',text)
    (pathlib.Path(backup)/(unit+'.log')).write_text(text)
    print(text,file=sys.stderr)
PY_DIAGNOSTICS
  if ((timer_touched)); then systemctl stop gpunode-ambassador.timer gpunode-ambassador.service >/dev/null 2>&1 || true; fi
  # Never restore financial rows. Older code is allowed only before new incompatible usage.
  incompatible=0
  if ((migrated&&switched)); then
    usage=$(runuser -u postgres -- psql -Atqc "SELECT EXISTS(SELECT 1 FROM user_wallets GROUP BY network,address HAVING count(*)>1) OR EXISTS(SELECT 1 FROM user_leases WHERE status IN ('PROVISIONING','ACTIVE','OVERCLOCKED','EXPIRED') GROUP BY user_id HAVING count(*)>1) OR EXISTS(SELECT 1 FROM offer_acceptances WHERE version='88-2026-AI-NETWORK-2026-10-10-R2') OR EXISTS(SELECT 1 FROM \"LedgerEntry\" WHERE kind LIKE 'AMB_%')" aethermind_v1 2>/dev/null)
    [[ $usage == f ]] || incompatible=1
  fi
  if ((incompatible)); then
    systemctl daemon-reload
    systemctl restart gpunode.service gpunode-ton-watcher.service
    systemctl start gpunode-epoch-settle.timer
    printf 'Новые привязки, договоры, акцепты или выплаты требуют текущего кода. Релиз сохранён, Ambassador timer остановлен. БД не восстанавливалась. Нужен исправляющий выпуск. Бэкап: %s\n' "$backup" >&2
    exit 1
  fi
  if ((!switched&&publication_updated)); then if ((publication_created)); then rm -f -- "$root/shared/network-publication.json"; else cp -a -- "$backup/publication-before.json" "$root/shared/network-publication.json"; fi; fi
  if ((nginx_touched)) && [[ -f $backup/nginx-changes.json ]]; then
    python3 - "$backup/nginx-changes.json" <<'PY_RESTORE_NGINX'
import json,pathlib,sys
for item in json.loads(pathlib.Path(sys.argv[1]).read_text()):pathlib.Path(item['path']).write_bytes(pathlib.Path(item['backup']).read_bytes())
PY_RESTORE_NGINX
    nginx -t && systemctl reload nginx
  fi
  if ((timer_touched)); then
    systemctl stop gpunode-epoch-settle.timer gpunode-epoch-settle.service >/dev/null 2>&1 || true
  fi
  if ((runtime_touched)); then
    if [[ -f $backup/public-release.env ]]; then cp -a "$backup/public-release.env" "$flagfile"; else rm -f -- "$flagfile"; fi
    for unit in gpunode.service gpunode-ton-watcher.service gpunode-epoch-settle.service gpunode-ambassador.service; do
      runtime_file="/etc/systemd/system/$unit.d/$runtime_dropin"
      if [[ -f $backup/$unit.runtime.conf ]]; then cp -a "$backup/$unit.runtime.conf" "$runtime_file"; else rm -f -- "$runtime_file"; fi
    done
  fi
  if ((edited)); then
    cp -a "$backup/runtime.env" "$envfile"
    if [[ -f $backup/offer-release.conf ]]; then cp -a "$backup/offer-release.conf" "$dropin"; else rm -f -- "$dropin"; fi
    systemctl daemon-reload
  fi
  if ((switched)); then
    ln -sfn "$previous" "$root/current-rollback"
    mv -Tf "$root/current-rollback" "$root/current"
  fi
  if ((timer_touched)); then
    systemctl disable --now gpunode-epoch-settle.timer >/dev/null 2>&1 || true
    for unit in gpunode-epoch-settle.service gpunode-epoch-settle.timer gpunode-ambassador.service gpunode-ambassador.timer; do
      if [[ -f $backup/$unit ]]; then cp -a "$backup/$unit" "/etc/systemd/system/$unit"; else rm -f "/etc/systemd/system/$unit"; fi
    done
    systemctl daemon-reload
    systemctl reset-failed gpunode-epoch-settle.service >/dev/null 2>&1 || true
  fi
  if ((edited||switched||services_stopped)); then
    systemctl restart gpunode.service
    systemctl restart gpunode-ton-watcher.service
  fi
  if ((timer_touched)); then
    if ((was_timer_enabled)); then systemctl enable gpunode-epoch-settle.timer; fi
    if ((was_timer_active)); then systemctl start gpunode-epoch-settle.timer; fi
    if ((was_ambassador_enabled)); then systemctl enable gpunode-ambassador.timer; fi
    if ((was_ambassador_active)); then systemctl start gpunode-ambassador.timer; fi
  fi
  printf 'Откат к прежней версии. Бэкап: %s\n' "$backup" >&2
  exit 1
}
trap 'rollback "$?" "$LINENO"' ERR
trap 'rollback 130 "$LINENO"' INT
trap 'rollback 143 "$LINENO"' TERM HUP
rollback_ready=1
phase 'распаковка и проверка исходников'
install -d -o deploy -g deploy -m 0755 "$release"
python3 - "$archive" "$release" <<'PY_ARCHIVE'
import pathlib,sys,tarfile
dest=pathlib.Path(sys.argv[2])
with tarfile.open(sys.argv[1],'r:gz') as source:
    members=source.getmembers()
    if len({m.name.split('/')[0] for m in members})!=1: raise SystemExit('Invalid archive prefix')
    for member in members:
        parts=pathlib.PurePosixPath(member.name).parts
        if member.name.startswith('/') or '..' in parts or not (member.isfile() or member.isdir()): raise SystemExit('Unsafe archive entry')
        if len(parts)<2: continue
        member.name='/'.join(parts[1:])
        source.extract(member,path=dest,filter='data')
PY_ARCHIVE
chown -R deploy:deploy "$release"
[[ -d $release/contracts/archive ]] || fail 'Не найден частный архив договоров.'
find "$release/contracts" -type d -exec chmod 0700 {} +
find "$release/contracts" -type f -exec chmod 0600 {} +
runuser -u deploy -- test -r "$release/contracts/archive/manifest.json" || fail 'API не может прочитать архив договоров.'
runuser -u www-data -- test ! -r "$release/contracts/archive/manifest.json" || fail 'Частный архив доступен пользователю Nginx.'
python3 - "$release/contracts/archive" <<'PY_PRIVATE_ARCHIVE'
import hashlib,json,pathlib,sys
folder=pathlib.Path(sys.argv[1]);entries=json.loads((folder/'manifest.json').read_text())
if len(entries)!=4:raise SystemExit('Unexpected private contract manifest')
for entry in entries:
 path=folder/entry['file']
 if path.parent!=folder or not path.is_file() or path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest()!=entry['sha256']:raise SystemExit('Private contract archive checksum failed')
PY_PRIVATE_ARCHIVE
[[ -f $release/.aethermind-project && -f $release/package-lock.json ]] || fail 'Не тот проект.'
grep -Fq "OFFER_VERSION='88-2026-AI-NETWORK-2026-10-10-R2'" "$release/backend/src/offer.ts" || fail 'Неверная версия.'
[[ -f $release/frontend/src/ProductTour.tsx && -f $release/frontend/src/OwnerCredit.tsx && -f $release/backend/src/admin-credit.ts && -f $release/ops/admin-credit-integration.mjs && -f $release/backend/prisma/migrations/20261008000100_admin_balance_credit/migration.sql ]] || fail 'В архиве нет нового пополнения владельцем.'
grep -Fq 'aethermind-tour-v2' "$release/frontend/src/ProductTour.tsx" || fail 'В архиве старая демонстрация.'
[[ -f $release/ops/public-runtime.py && -f $release/ops/public-runtime-check.mjs && -f $release/ops/public-runtime-flags.json ]] || fail 'В архиве нет исправления настроек служб. Выполните скрипт 110.'
if [[ ! -f $release/ops/epoch-integration.mjs ]] || ! grep -Fq 'let last:string|undefined' "$release/backend/src/epoch-settle.ts"; then fail 'В архиве старый Epoch worker. Выполните скрипт 110.'; fi
[[ -f $release/frontend/src/design-tokens.css && -f $release/frontend/src/UI.tsx && -f $release/frontend/src/ui.css && -f $release/frontend/src/viewport.ts && -f $release/frontend/src/redesign-translations.ts ]] || fail 'В архиве нет полного редизайна.'
grep -Fq -- '--color-primary: #26e6ff;' "$release/frontend/src/design-tokens.css" || fail 'В архиве нет общей палитры.'
grep -Fq 'className="app-nav"' "$release/frontend/src/App.tsx" || fail 'В архиве нет новой навигации.'
printf '%s  %s\n' 'bfee177869e0c6d13c189df6eff3f772bb7a89509b9512711c3eb7ffdac52a0b' "$release/frontend/public/documents/public-offer-aethermind-network-2026-10-10-r2.pdf" | sha256sum -c --status || fail 'PDF не совпал.'
printf '%s  %s\n' '0c8e7036a52be9d1ff415a5a44f76743246e032aff0fe14300fa11f973e1a8eb' "$release/contracts/archive/public-offer-aethermind-2026-09-30-trc-bep.pdf" | sha256sum -c --status || fail 'Архив предыдущей редакции не совпал.'
[[ -f $release/backend/src/live-accrual.ts && -f $release/frontend/src/GpuLive.tsx && -f $release/frontend/src/live-accrual.ts && -f $release/ops/gpu-live-integration.mjs ]] || fail 'В архиве нет полного GPU Live обновления.'
python3 - "$release/ops/public-runtime-flags.json" <<'PY_GPU_COMPOUND_FLAGS'
import json,sys
flags=json.load(open(sys.argv[1]))
assert flags.get('ENABLE_COMPOUND')=='true','Canonical Compound flag is missing'
assert flags.get('FINANCIAL_PUBLIC_ACCESS')=='true','Public access is missing'
PY_GPU_COMPOUND_FLAGS
[[ -f $release/backend/src/bot-presentation.ts && -f $release/backend/src/telegram.ts && -f $release/ops/bot-config-test.py && -f $release/ops/bot-integration.mjs && -f $release/ops/bot-ci-transport.mjs ]] || fail 'В архиве нет полного обновления бота. Выполните скрипт 110.'
printf '%s  %s\n' 'fb0629877727117170f95ce25c4ea32eae7c2cfd249cd6f2c1eecd496ef2c9b6' "$release/frontend/public/assets/bot/welcome.jpg" | sha256sum -c --status || fail 'Приветственный баннер не совпал.'
[[ -f $release/frontend/src/light-effects.ts && -f $release/frontend/src/light-effects.css && -f $release/frontend/src/LightFrame.tsx ]] || fail 'В архиве нет GPU-эффектов. Выполните скрипт 110.'
grep -Fq '.protected-art[data-image-protected]{background-position:center;background-size:contain;background-repeat:no-repeat}' "$release/frontend/src/protected-art.css" || fail 'В архиве нет исправления GPU-изображений.'
grep -Fq 'useLightEffects();' "$release/frontend/src/App.tsx" || fail 'Управление световыми эффектами не подключено.'
phase 'установка зависимостей, тесты и сборка' 
# shellcheck disable=SC2016
runuser -u deploy -- env PATH="$PATH" NODE_OPTIONS=--max-old-space-size=384 bash -c '
  set -Eeuo pipefail
  cd "$1"
  npm ci --include=dev --ignore-scripts --no-audit --no-fund --prefer-offline --fetch-retries=4 --fetch-timeout=120000
  npm run db:generate
  npm test
  python3 ops/network-deploy-test.py
  python3 ops/bot-config-test.py
  npm run build
' _ "$release"
printf '%s  %s\n' 'bfee177869e0c6d13c189df6eff3f772bb7a89509b9512711c3eb7ffdac52a0b' "$release/frontend/dist/documents/public-offer-aethermind-network-2026-10-10-r2.pdf" | sha256sum -c --status || fail 'PDF сборки не совпал.'
phase 'интеграционные проверки на отдельной PostgreSQL'
runuser -u deploy -- env PATH="$PATH" python3 "$release/ops/vps-ci.py" "$release"
# Build inherits umask 077: make every public asset traversable/readable to Nginx.
chmod 0755 "$release" "$release/frontend"
find "$release/frontend/dist" -type d -exec chmod 0755 {} +
find "$release/frontend/dist" -type f -exec chmod 0644 {} +
runuser -u www-data -- test -r "$release/frontend/dist/index.html" || fail 'Nginx не может прочитать index.html.'
# shellcheck disable=SC2016
runuser -u www-data -- find "$release/frontend/dist" -type f -exec sh -c 'for file do test -r "$file" || exit 1; done' _ {} + || fail 'Nginx не может прочитать файлы сборки.'
# Additive migrations run only after the database backup; never delete financial data on rollback.
phase 'проверка текущих настроек процессов без секретов'
python3 "$release/ops/public-runtime.py" inspect
phase 'миграционный preflight без изменения финансов'
python3 "$release/ops/run-runtime.py" "$release" "$envfile" -- node ops/network-preflight.mjs "$backup/preflight-before-stop.json"
# The former catalogue uses limits 5/3/2. Only the limit migration may change them.
# Check all other terms while the API and watcher are still running.
catalog_snapshot(){
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -At -F '|' aethermind_v1 -c "SELECT c.id,c.price_usdt,c.contract_days,c.daily_yield_percent,c.compound_boost_percent,coalesce(c.contract_reference,''),c.is_active,c.is_experimental,c.supply_known,c.total_supply,c.available_supply,c.max_per_user,(SELECT count(*) FROM user_leases l WHERE l.node_id=c.id AND l.status IN ('PROVISIONING','ACTIVE','OVERCLOCKED','EXPIRED')) FROM gpu_catalog c WHERE c.id IN ('NODE_4090','NODE_A100','NODE_H100') ORDER BY c.tier_level" > "$1"
}
phase 'проверка каталога до остановки служб'
catalog_snapshot "$backup/catalog-preflight.txt"
python3 "$release/ops/network-catalog-check.py" "$backup/catalog-preflight.txt" --allow-legacy-limits
phase 'остановка обработчиков и финальный бэкап'
timer_touched=1; services_stopped=1
for unit in gpunode-epoch-settle.timer gpunode-epoch-settle.service gpunode-ambassador.timer gpunode-ambassador.service; do
 if systemctl cat "$unit" >/dev/null 2>&1; then systemctl stop "$unit"; fi
done
systemctl stop gpunode.service gpunode-ton-watcher.service
runuser -u postgres -- pg_dump -Fc aethermind_v1 > "$backup/database-quiesced.dump"
pg_restore --list "$backup/database-quiesced.dump" >/dev/null
python3 "$release/ops/run-runtime.py" "$release" "$envfile" -- node ops/network-preflight.mjs "$backup/preflight-final.json"
catalog_snapshot "$backup/catalog-before.txt"
python3 "$release/ops/network-catalog-check.py" "$backup/catalog-before.txt" --allow-legacy-limits
phase 'добавочные миграции рабочей базы'
python3 "$release/ops/run-runtime.py" "$release" "$envfile" -- npm run db:migrate
migrated=1
# The offer publishes maximum category sizes, not current free inventory.
phase 'проверка каталога с сохранением фактических остатков'
# GPU Live and Compound use confirmed existing stock; never overwrite inventory.
catalog_snapshot "$backup/catalog-after.txt"
python3 "$release/ops/network-catalog-check.py" "$backup/catalog-after.txt"
python3 - "$backup/catalog-before.txt" "$backup/catalog-after.txt" <<'PY_CATALOG_PRESERVATION'
import pathlib,sys
def snapshot(path):
    return {row[0]:row[:11]+row[12:] for row in (line.split('|') for line in pathlib.Path(path).read_text().splitlines())}
if snapshot(sys.argv[1]) != snapshot(sys.argv[2]):
    raise SystemExit('Миграции изменили параметры, фактические остатки или резервы каталога; переключение остановлено.')
print('Каталог: изменён только max_per_user; ставки, сроки и фактические остатки сохранены.')
PY_CATALOG_PRESERVATION

phase 'настройка публичного доступа'
# Mark rollback state before the first configuration write.
edited=1
runtime_touched=1
python3 "$release/ops/public-runtime.py" install --envfile "$envfile" --flagfile "$flagfile" --commit "$sha" --node "$node_bin"
phase 'закрытие публичного архива'
nginx_touched=1
python3 "$release/ops/network-nginx.py" "$backup"
nginx -t
phase 'проверка TON RPC и резерва кошелька'
# Verify public-payment configuration, TON RPC, treasury reserve, and Jetton wallet before switching.
python3 - "$envfile" "$node_bin" "$release" <<'PY_TON'
import os,pathlib,subprocess,sys
file,node,release=sys.argv[1:]
env=os.environ.copy()
for line in pathlib.Path(file).read_text().splitlines():
    if '=' in line and not line.lstrip().startswith('#'):
        key,value=line.split('=',1)
        if key.isidentifier():env[key]=value.strip().strip('"').strip("'")
js='''import {tonConfig} from './backend/dist/ton/config.js';import {TonCenter} from './backend/dist/ton/center.js';const config=tonConfig();if(config.access!=='public')throw Error('Not public');const center=new TonCenter(config);const balance=await center.treasuryBalance();if(balance<config.minTreasuryReserve)throw Error('Insufficient TON treasury reserve');await center.jettonWallet(config.treasury);console.log('TON RPC, public mode and treasury reserve: OK');'''
subprocess.run([node,'--input-type=module','-e',js],cwd=release,env=env,check=True,timeout=35)
PY_TON
# Install the idempotent Epoch worker before enabling accrual. Keep old units for rollback.
phase 'установка и проверка systemd-конфигурации'
sed "s|@NODE_BIN@|$node_bin|g" "$release/ops/gpunode-epoch-settle.service.in" > /etc/systemd/system/gpunode-epoch-settle.service
cp "$release/ops/gpunode-epoch-settle.timer" /etc/systemd/system/gpunode-epoch-settle.timer
chmod 0644 /etc/systemd/system/gpunode-epoch-settle.service /etc/systemd/system/gpunode-epoch-settle.timer
sed "s|@NODE@|$node_bin|g" "$release/ops/gpunode-ambassador.service.in" > /etc/systemd/system/gpunode-ambassador.service
cp "$release/ops/gpunode-ambassador.timer" /etc/systemd/system/gpunode-ambassador.timer
chmod 0644 /etc/systemd/system/gpunode-ambassador.service /etc/systemd/system/gpunode-ambassador.timer

systemd-analyze verify /etc/systemd/system/gpunode-ambassador.service /etc/systemd/system/gpunode-ambassador.timer /etc/systemd/system/gpunode.service /etc/systemd/system/gpunode-ton-watcher.service /etc/systemd/system/gpunode-epoch-settle.service /etc/systemd/system/gpunode-epoch-settle.timer
install -d -m 0755 /etc/systemd/system/gpunode.service.d
printf '[Service]\nEnvironment=APP_COMMIT=%s\n' "$sha" > "$dropin"
chmod 0644 "$dropin"
phase 'публикация новой редакции и непубличный архив'
if [[ -e $root/shared/network-publication.json ]]; then cp -a -- "$root/shared/network-publication.json" "$backup/publication-before.json"; else publication_created=1; fi
publication_updated=1
python3 "$release/ops/network-publication.py" "$root/shared/network-publication.json" "$flagfile" '88-2026-AI-NETWORK-2026-10-10-R2' 'bfee177869e0c6d13c189df6eff3f772bb7a89509b9512711c3eb7ffdac52a0b' > "$backup/publication.json"
# Keep the UTC publication value in the literal runtime for CLI maintenance too.
python3 - "$flagfile" "$envfile" <<'PY_NETWORK_ENV'
import pathlib,re,sys
flags,env=map(pathlib.Path,sys.argv[1:]);lines=[v for v in flags.read_text().splitlines() if v.startswith(('NETWORK_PUBLISHED_AT=','NETWORK_PROGRAM_STARTED_AT='))]
text='\n'.join(v for v in env.read_text().splitlines() if not re.match(r'^\s*(?:export\s+)?NETWORK_(?:PUBLISHED_AT|PROGRAM_STARTED_AT)\s*=',v))+'\n'+'\n'.join(lines)+'\n';env.write_text(text);env.chmod(0o600)
PY_NETWORK_ENV
ln -sfn "$release" "$root/current-next"
mv -Tf "$root/current-next" "$root/current"
switched=1
systemctl daemon-reload
systemctl reload nginx
python3 "$release/ops/public-runtime.py" verify --envfile "$envfile" --flagfile "$flagfile"
phase 'первый запуск исправленного Epoch worker'
systemctl reset-failed gpunode-epoch-settle.service >/dev/null 2>&1 || true
if ! systemctl start gpunode-epoch-settle.service; then fail 'Первый запуск Epoch worker завершился ошибкой. Журнал службы будет выведен перед откатом.'; fi
phase 'перезапуск API и TON watcher'
systemctl restart gpunode.service
systemctl restart gpunode-ton-watcher.service
healthy=0
for attempt in {1..30}; do
  if curl -fsS --max-time 2 http://127.0.0.1:3100/api/health > "$backup/health.json" 2>/dev/null; then healthy=1; break; fi
  sleep 1
done
((healthy)) || fail 'API не запустился. Проверьте journalctl -u gpunode.service -n 80.'
python3 - "$backup/health.json" "$sha" <<'PY_HEALTH'
import json,sys
health=json.load(open(sys.argv[1]))
assert health.get('status')=='ok' and health.get('commit')==sys.argv[2],health
PY_HEALTH
phase 'первый расчёт Ambassador без исторических зачислений'
python3 "$release/ops/run-runtime.py" "$release" "$envfile" "$flagfile" -- node ops/network-backfill-dry-run.mjs "$backup/network-history-dry-run.json"
systemctl reset-failed gpunode-ambassador.service >/dev/null 2>&1 || true
systemctl start gpunode-ambassador.service
[[ $(systemctl show gpunode-ambassador.service -p Result --value) == success ]] || fail 'Ambassador worker завершился ошибкой.'
phase 'проверка фактических настроек API и TON watcher'
python3 "$release/ops/public-runtime.py" live --commit "$sha"
curl -fsS --max-time 15 http://127.0.0.1:3100/api/offer > "$backup/offer.json" || fail 'API /api/offer вернул ошибку.'
python3 - "$backup/offer.json" <<'PY_OFFER'
import json,sys
offer=json.load(open(sys.argv[1]))
assert offer['version']=='88-2026-AI-NETWORK-2026-10-10-R2',offer
assert offer['documentSha256']=='bfee177869e0c6d13c189df6eff3f772bb7a89509b9512711c3eb7ffdac52a0b',offer
assert offer.get('paymentsEnabled') is True,'API: public deposits are disabled'
assert offer.get('accrualEnabled') is True,'API: accrual is disabled despite public runtime binding'
assert offer.get('compoundEnabled') is True,'API: public Compound is disabled'
assert (offer.get('financialOffer') or {}).get('sha256')==offer['documentSha256'],'API: financial offer/PDF unavailable'
PY_OFFER
# Watcher must perform a fresh scan on this release before accepting the deployment.
scan_after=$(date -u +%s)
watcher_fresh=0
for attempt in {1..24}; do
  printf 'VPS: проверка прохода TON watcher %s/24\n' "$attempt"
  systemctl is-active --quiet gpunode-ton-watcher.service || fail 'TON watcher остановился.'
  fresh=$(runuser -u postgres -- psql -Atqc "SELECT COALESCE((SELECT updated_at >= to_timestamp($scan_after) FROM ton_watcher_cursors WHERE id='TON_USDT'),false)" aethermind_v1)
  if [[ $fresh == t ]]; then watcher_fresh=1; break; fi
  sleep 3
done
((watcher_fresh)) || fail 'TON watcher не завершил новый проход индексирования.'
phase 'проверка публичного каталога без production-сессий'
# Ordinary-user purchases, activation, owner credit and projections were tested
# on the isolated database by the release's current ops/vps-ci.py.
# Production smoke checks use public GET only; no synthetic Telegram sessions.
node --input-type=module <<'JS_GPU_PUBLIC_SMOKE'
const base='http://127.0.0.1:3100/api';
const response=await fetch(base+'/v1/market',{signal:AbortSignal.timeout(10000)});
if(!response.ok)throw Error('Public market is unavailable');
const market=await response.json(),expected={NODE_4090:'1.80',NODE_A100:'3.00',NODE_H100:'4.20'};
if(market.purchasesEnabled!==true)throw Error('Public purchases are disabled');
for(const [id,rate] of Object.entries(expected)){
 const node=market.nodes.find(item=>item.id===id);
 if(!node||node.experimental||node.compoundPercent!==rate)throw Error('Compound tariff mismatch: '+id);
}
for(const node of market.nodes.filter(item=>item.experimental))if(node.canBuy||node.compoundPercent)throw Error('Experimental tariff became purchasable');
const privateResponse=await fetch(base+'/v1/market/leases',{signal:AbortSignal.timeout(10000)});
if(privateResponse.status!==401)throw Error('Private GPU details are exposed');
console.log('Public market, three Compound rates and private GET guard: OK');
JS_GPU_PUBLIC_SMOKE
phase 'проверка frontend и GPU-изображений через Nginx'
curl -fsS --max-time 15 --resolve 31.77.226.26:443:127.0.0.1 https://31.77.226.26/ -o "$backup/public-index.html" || fail 'Nginx не отдал frontend.'
index_digest=$(sha256sum "$release/frontend/dist/index.html"); index_digest=${index_digest%% *}
printf '%s  %s\n' "$index_digest" "$backup/public-index.html" | sha256sum -c --status || fail 'Nginx отдаёт другой frontend.'
for family in 4090 a100 h100; do
  for variant in card-160 card-320 card-480 detail-360 detail-720 detail-1080; do
    path="assets/market/$family/$variant.webp"
    curl -fsS --max-time 15 --resolve 31.77.226.26:443:127.0.0.1 "https://31.77.226.26/$path" -o "$backup/public-asset.webp" || fail "Nginx не отдал $path."
    expected_asset=$(sha256sum "$release/frontend/dist/$path"); expected_asset=${expected_asset%% *}
    printf '%s  %s\n' "$expected_asset" "$backup/public-asset.webp" | sha256sum -c --status || fail "Не совпало изображение $path."
  done
done
for variant in ambient-mobile ambient-desktop; do
  path="assets/$variant.webp"
  curl -fsS --max-time 15 --resolve 31.77.226.26:443:127.0.0.1 "https://31.77.226.26/$path" -o "$backup/public-asset.webp" || fail "Nginx не отдал $path."
  expected_asset=$(sha256sum "$release/frontend/dist/$path"); expected_asset=${expected_asset%% *}
  printf '%s  %s\n' "$expected_asset" "$backup/public-asset.webp" | sha256sum -c --status || fail "Не совпал фон $path."
done
for variant in 320 640; do
  path="assets/partners/ambassador-$variant.webp"
  curl -fsS --max-time 15 --resolve 31.77.226.26:443:127.0.0.1 "https://31.77.226.26/$path" -o "$backup/partner-asset.webp" || fail "Nginx не отдал $path."
  expected_asset=$(sha256sum "$release/frontend/dist/$path"); expected_asset=${expected_asset%% *}
  printf '%s  %s\n' "$expected_asset" "$backup/partner-asset.webp" | sha256sum -c --status || fail "Не совпала иллюстрация $path."
done
path='assets/bot/welcome.jpg'
curl -fsS --max-time 15 --resolve 31.77.226.26:443:127.0.0.1 "https://31.77.226.26/$path" -o "$backup/welcome.jpg" || fail 'Nginx не отдал приветственный баннер.'
printf '%s  %s\n' 'fb0629877727117170f95ce25c4ea32eae7c2cfd249cd6f2c1eecd496ef2c9b6' "$backup/welcome.jpg" | sha256sum -c --status || fail 'Публичный приветственный баннер не совпал.'
runuser -u deploy -- test -r "$release/frontend/public/assets/bot/welcome.jpg" || fail 'Бот не может прочитать приветственный баннер.'
[[ $(systemctl show gpunode-epoch-settle.service -p Result --value) == success && $(systemctl show gpunode-epoch-settle.service -p ExecMainStatus --value) == 0 ]] || fail 'Epoch завершился с ошибкой.'


curl -fsS --max-time 15 --resolve 31.77.226.26:443:127.0.0.1 https://31.77.226.26/documents/public-offer-aethermind-network-2026-10-10-r2.pdf -o "$backup/public-offer.pdf" || fail 'Nginx не отдал публичный PDF.'
printf '%s  %s\n' 'bfee177869e0c6d13c189df6eff3f772bb7a89509b9512711c3eb7ffdac52a0b' "$backup/public-offer.pdf" | sha256sum -c --status || fail 'Публичный PDF не совпал.'
systemctl is-active --quiet gpunode.service || fail 'API не активен.'
systemctl is-active --quiet gpunode-ton-watcher.service || fail 'Watcher не активен.'
nginx -t
phase 'проверка текущего регламента и закрытых публичных архивов'
curl -fsS --max-time 15 http://127.0.0.1:3100/api/v1/network/regulation > "$backup/regulation.json"
python3 - "$backup/regulation.json" "$backup/publication.json" <<'PY_REGULATION'
import json,sys
r,p=map(lambda path:json.load(open(path)),sys.argv[1:]);assert r['version']==p['version'] and r['documentSha256']==p['sha256'];assert r['publishedAt']==p['publishedAt'] and r['effectiveAt']==p['effectiveAt']
PY_REGULATION
for old in public-offer-aethermind.pdf public-offer-aethermind-2026-09-21.pdf public-offer-aethermind-2026-09-30-trc-bep.pdf public-offer-aethermind-ton-2026-10-07.pdf public-offer-aethermind-network-2026-10-10.pdf; do
 code=$(curl -sS --max-time 15 --resolve 31.77.226.26:443:127.0.0.1 -o /dev/null -w '%{http_code}' "https://31.77.226.26/documents/$old")
 [[ $code == 410 ]] || fail "Старая публичная оферта не закрыта: $old, HTTP $code."
done
runuser -u postgres -- psql -Atqc "SELECT count(*)=3 FROM pg_indexes WHERE indexname IN ('one_unfinished_tariff','one_legacy_tariff','user_wallets_network_address_idx')" aethermind_v1 > "$backup/schema-check.txt"
[[ $(cat "$backup/schema-check.txt") == t ]] || fail 'Не найдены защитные индексы.'
# Migration names and exact SQL checksums are checked by Prisma deploy; inspect schema independently.
runuser -u postgres -- psql -Atqc "SELECT to_regclass('network_reward') IS NOT NULL AND to_regclass('network_paths') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='user_wallets'::regclass AND conname='user_wallets_address_key')" aethermind_v1 > "$backup/network-schema.txt"
[[ $(cat "$backup/network-schema.txt") == t ]] || fail 'Схема Ambassador/общих кошельков не совпала.'
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -Atqc "SELECT count(*)=3 AND bool_and(max_per_user=1) FROM gpu_catalog WHERE id IN ('NODE_4090','NODE_A100','NODE_H100')" aethermind_v1 > "$backup/catalog-limit-check.txt"
[[ $(cat "$backup/catalog-limit-check.txt") == t ]] || fail 'Лимит одного незавершённого договора на тариф не установлен.'

systemctl enable --now gpunode-ambassador.timer
systemctl is-active --quiet gpunode-ambassador.timer || fail 'Ambassador timer не запущен.'
phase 'включение проверенного Epoch timer'
systemctl enable --now gpunode-epoch-settle.timer
systemctl is-active --quiet gpunode-epoch-settle.timer || fail 'Таймер Epoch не работает.'
trap - ERR INT TERM HUP
# External Telegram settings run after all release checks. A Bot API outage must
# not roll back a healthy application or financial workers. Retry only bot-config.
phase 'настройка и проверка оформления Telegram-бота'
bot_config_ok=1
python3 "$release/ops/bot-config.py" || bot_config_ok=0
printf 'ГОТОВО: коммит %s\nБэкап: %s\nНесколько GPU, общий TON-кошелёк, фон, уведомления, поддержка и AI Ambassador Network обновлены; Compound: public ON; пополнение владельцем: ON\nМиграция добавочная; новые финансовые записи сохраняются при откате\nНастройки API, TON watcher, Epoch и Ambassador проверены; история ожидает точного утверждения владельцем; пять денежных трактовок доступны в панели\nОферта: USDT TON; пополнение: public\nЗаказы: public, активация владельцем и Epoch timer включены\n' "$sha" "$backup"
if ((bot_config_ok)); then
  printf 'Бот: приветственный баннер, структурированные ответы и команды RU/EN/RO готовы.\n'
else
  printf 'Приложение обновлено и работает. Настройка Telegram не завершена; повторите только: sudo python3 /srv/apps/gpunode/current/ops/bot-config.py\n' >&2
  exit 1
fi
# AETHERMIND_NETWORK_REMOTE_COMPLETE
