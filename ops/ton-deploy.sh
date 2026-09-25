#!/usr/bin/env bash
# TON Mainnet USDT integration: isolated build, test, backup, guarded worker.
# shellcheck disable=SC2016
set -Eeuo pipefail
umask 077

fail(){ printf '\nОШИБКА: %s\n' "$*" >&2; exit 1; }
note(){ printf '\n>> %s\n' "$*"; }

[[ $EUID -eq 0 ]] || fail 'Требуется sudo.'
cd /
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

archive=${1:-}
sha=${2:-}
expected=${3:-}
[[ $archive =~ ^/home/joxy/aethermind-upload\.[A-Za-z0-9]+/source\.tar\.gz$ && -f $archive && ! -L $archive ]] || fail 'Некорректный архив.'
[[ $sha =~ ^[a-f0-9]{40}$ && $expected =~ ^[a-f0-9]{64}$ ]] || fail 'Некорректная контрольная сумма.'
printf '%s  %s\n' "$expected" "$archive" | sha256sum --check --status || fail 'Архив повреждён.'

exec 9>/var/lock/gpunode-deploy.lock
flock -n 9 || fail 'Другой деплой уже работает.'

root=/srv/apps/gpunode
envfile="$root/shared/runtime.env"
service=/etc/systemd/system/gpunode.service
nginx_conf=/etc/nginx/sites-available/gpunode-ip.conf
[[ -L $root/current && -f $envfile && -f $service && -f $nginx_conf ]] || fail 'Не найдено работающее окружение gpunode.'
grep -q '^# Managed by AetherMind v1$' "$service" || fail 'Неизвестный systemd unit; автоматическая замена запрещена.'
previous=$(readlink -f "$root/current")
[[ $previous == /srv/releases/gpunode/* && -f $previous/frontend/dist/index.html ]] || fail 'Предыдущий релиз повреждён.'
systemctl is-active --quiet gpunode.service || fail 'Действующая служба не работает.'
systemctl is-active --quiet gpu-cert-renew.timer || fail 'Таймер продления HTTPS не работает.'
nginx -t
[[ -d /usr/lib/postgresql ]] || fail 'Не найдены серверные бинарники PostgreSQL.'
available=$(df -Pk /srv | awk 'NR==2 {print $4}')
((available>1200000)) || fail 'Нужно минимум 1.2 ГБ свободного места для сборки и бэкапа.'

node_bin=$(sed -n 's/^ExecStart=\([^ ]*\/bin\/node\) dist\/main.js$/\1/p' "$service")
[[ $node_bin =~ ^/opt/gpu-node/node-v22\.[0-9]+\.[0-9]+-linux-x64/bin/node$ && -x $node_bin ]] || fail 'Не удалось определить Node.js 22.'
node_path=$(dirname "$node_bin")
export PATH="$node_path:$PATH"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="/srv/backups/gpunode/ton-usdt-$stamp"
release="/srv/releases/gpunode/$stamp-${sha:0:12}-ton"
[[ ! -e $release && ! -e $backup ]] || fail 'Каталог этого релиза уже существует.'
install -d -m 0700 "$backup"
install -d -m 0755 -o deploy -g deploy "$release"
install -d -m 0755 -o deploy -g deploy "$root/shared/npm-cache"

activated=0
env_changed=0
worker=/etc/systemd/system/gpunode-ton-watcher.service
worker_preexisting=0
[[ -f $worker ]] && worker_preexisting=1
if ((worker_preexisting)); then
  grep -q '^# Managed by AetherMind TON USDT$' "$worker" || fail 'Unknown TON watcher systemd service.'
fi
rollback(){
  trap - ERR INT TERM
  set +e
  if ((activated)); then
    systemctl stop gpunode-ton-watcher.service 2>/dev/null || true
    systemctl stop gpunode.service
    if ((env_changed)); then cp -a "$backup/runtime.env" "$envfile"; env_changed=0; fi
    ln -sfn "$previous" "$root/current-ton-rollback"
    mv -Tf "$root/current-ton-rollback" "$root/current"
    cp -a "$backup/gpunode.service" "$service"
    cp -a "$backup/nginx.conf" "$nginx_conf"
    if ((worker_preexisting)); then cp -a "$backup/gpunode-ton-watcher.service" "$worker"; else systemctl disable gpunode-ton-watcher.service 2>/dev/null || true; rm -f -- "$worker"; fi
    systemctl daemon-reload
    systemctl start gpunode.service
    if ((worker_preexisting)); then systemctl restart gpunode-ton-watcher.service; fi
    nginx -t && systemctl reload nginx
  fi
  if ((env_changed)); then cp -a "$backup/runtime.env" "$envfile"; fi
  if [[ -f $backup/nginx.conf ]]; then cp -a "$backup/nginx.conf" "$nginx_conf"; nginx -t && systemctl reload nginx; fi
  printf '\nОбновление не подтверждено. Предыдущий релиз: %s\nРезервная копия: %s\nСхема БД автоматически не откатывается: новая миграция только добавочная.\n' "$previous" "$backup" >&2
  exit 1
}
trap rollback ERR INT TERM

note 'Извлекаю точный коммит GitHub в отдельный релиз.'
python3 - "$archive" "$release" <<'PY'
import pathlib, sys, tarfile
source, target = sys.argv[1:]
with tarfile.open(source, 'r:gz') as bundle:
    members = bundle.getmembers()
    roots = {member.name.split('/')[0] for member in members}
    if len(roots) != 1:
        raise SystemExit('Invalid archive root')
    for member in members:
        parts = pathlib.PurePosixPath(member.name).parts
        if member.name.startswith('/') or '..' in parts or not (member.isfile() or member.isdir()):
            raise SystemExit('Unsafe archive entry')
        if len(parts) < 2:
            continue
        member.name = '/'.join(parts[1:])
        bundle.extract(member, path=target, filter='data')
PY

[[ -f $release/.aethermind-project && -f $release/docs/OFFER_IMPLEMENTATION.md && -f $release/docs/OWNER_CONTROL_CENTER.md ]] || fail 'В архиве нет документации панели владельца.'
[[ -f $release/backend/src/offer.ts && -f $release/frontend/src/Offer.tsx && -f $release/frontend/src/Profile.tsx && -f $release/frontend/src/Referrals.tsx ]] || fail 'Неполный исходный код обновления.'
[[ -f $release/backend/prisma/migrations/202609230001_user_language/migration.sql && -f $release/frontend/src/LanguagePicker.tsx && -f $release/frontend/src/LegalTranslations.tsx && -f $release/ops/vps-ci.py ]] || fail 'Нет языковой миграции, перевода документов или VPS CI.'
[[ -f $release/backend/prisma/migrations/202609240002_cancel_invoice/migration.sql ]] || fail 'Нет миграции отмены счёта.'
[[ -f $release/frontend/src/space-layout.css && -f $release/frontend/public/assets/cosmic-field.svg ]] || fail 'Нет адаптивной компоновки или космического фона.'
[[ -f $release/backend/prisma/migrations/202609240001_ton_usdt_deposits/migration.sql && -f $release/backend/src/deposits/watcher.ts && -f $release/backend/test/ton-payments.test.ts && -f $release/frontend/public/tonconnect-manifest.json && -f $release/frontend/src/WalletView.tsx ]] || fail 'Отсутствует полный модуль USDT TON.'
[[ -f $release/backend/prisma/migrations/202609250001_ton_proof_wallet_identity/migration.sql && -f $release/backend/src/ton/gasless.ts && -f $release/backend/src/ton/gasless-messages.ts && -f $release/backend/src/deposits/gasless-service.ts && -f $release/backend/test/gasless.test.ts ]] || fail 'Отсутствует TON Proof / gasless этап.'
printf '%s  %s\n' 'b21177972dbdeedbea731e826b070ff7fb148ec1f96e7892536e67e40732ce88' "$release/frontend/public/documents/public-offer-aethermind.pdf" | sha256sum --check --status || fail 'PDF оферты отличается от утверждённого документа.'
printf '%s  %s\n' '7678c55b371736e130bc52f5e401d7d9d33288ad6284ae2dcb7097d25ecdeca3' "$release/frontend/public/documents/user-agreement-aethermind.pdf" | sha256sum --check --status || fail 'Пользовательское соглашение повреждено.'
printf '%s\n' "$sha" > "$release/DEPLOYED_COMMIT"
chown -R deploy:deploy "$release"
chmod 0755 "$release" "$release/frontend"

note 'Сборка и unit-тесты на VPS. Действующая версия продолжает работать.'
runuser -u deploy -- env PATH="$PATH" HOME=/home/deploy NODE_OPTIONS=--max-old-space-size=384 bash -s -- "$release" "$root/shared/npm-cache" <<'BUILD'
set -Eeuo pipefail
umask 022
cd "$1"
export DATABASE_URL=postgresql://unused:unused@127.0.0.1:5432/unused
installed=0
for attempt in 1 2 3 4; do
  if npm ci --include=dev --ignore-scripts --no-audit --no-fund --prefer-offline --maxsockets=4 --fetch-retries=4 --fetch-timeout=120000 --cache "$2"; then
    installed=1
    break
  fi
  printf 'npm: повтор %s из 4\n' "$attempt" >&2
  sleep 8
done
((installed)) || exit 1
npm run db:generate
npm test
npm run build
grep -Rqs 'Этапы участия' frontend/dist/assets/*.js
grep -Rqs 'Партнёры' frontend/dist/assets/*.js
grep -Rqs 'Управление AetherMind' frontend/dist/assets/*.js
grep -Rqs 'Choose your language' frontend/dist/assets/*.js
grep -Rqs 'Alegeți limba' frontend/dist/assets/*.js
grep -Rqs 'User Agreement' frontend/dist/assets/*.js
grep -Rqs 'Мои активы' frontend/dist/assets/*.js
grep -Rqs 'Отменить счёт' frontend/dist/assets/*.js
grep -Rqs 'cosmic-field.svg' frontend/dist/assets/*.css
grep -Rqs 'Подключить TON-кошелёк' frontend/dist/assets/*.js
grep -Rqs 'Проверка газлесс-перевода' frontend/dist/assets/*.js
BUILD

find "$release/frontend/dist" -type d -exec chmod 0755 {} +
find "$release/frontend/dist" -type f -exec chmod 0644 {} +
runuser -u www-data -- test -r "$release/frontend/dist/index.html"
runuser -u www-data -- find "$release/frontend/dist" -type f -exec sh -c 'for file do test -r "$file" || exit 1; done' _ {} +

note 'Полная HTTP-проверка на отдельной временной PostgreSQL.'
runuser -u deploy -- env PATH="$PATH" HOME=/home/deploy python3 "$release/ops/vps-ci.py" "$release"

note 'Сохраняю рабочую БД и конфигурацию перед добавочной миграцией.'
runuser -u postgres -- pg_dump -Fc aethermind_v1 > "$backup/database.dump"
pg_restore --list "$backup/database.dump" >/dev/null
cp -a "$envfile" "$backup/runtime.env"
if ((worker_preexisting)); then cp -a "$worker" "$backup/gpunode-ton-watcher.service"; fi
cp -a "$service" "$backup/gpunode.service"
cp -a "$nginx_conf" "$backup/nginx.conf"
printf '%s\n' "$previous" > "$backup/previous-release.txt"

# A password is entered only into a local VPS terminal and stored in runtime.env.
if ! grep -Eq '^TONCENTER_API_KEY=[A-Za-z0-9_-]{8,200}$' "$envfile"; then
  ton_key=''
  if [[ -t 0 ]]; then read -rs -p 'TON Center API key (скрытый ввод, Enter = пока без worker): ' ton_key </dev/tty; printf '\n'; fi
  if [[ -n $ton_key ]]; then
    [[ $ton_key =~ ^[A-Za-z0-9_-]{8,200}$ ]] || fail 'Некорректный формат TON Center API key.'
    printf 'TONCENTER_API_KEY=%s\n' "$ton_key" >> "$envfile"
    unset ton_key
  fi
fi
env_changed=1
printf 'TON_NETWORK=mainnet\nTON_CHAIN_ID=-239\nTON_WALLET_VERSION=W5\nAETHERMIND_TREASURY_ADDRESS=UQBHmBs516S1EKkDLj9K-hwCD-WlvRn05ieMiScK-pBBO8iH\nUSDT_TON_MASTER=EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs\nTONCENTER_API_BASE=https://toncenter.com/api/v3\nENABLE_TON_USDT_DEPOSITS=true\n' >> "$envfile"
# Keep the public execution reserve unchanged until an actual Mainnet trace
# proves that the candidate value covers this invoice's forward payload.
# The server-side owner gets the smaller candidate only for a smoke payment.
public_attach=$(awk -F= '/^TON_JETTON_ATTACH_GRAM=/{value=$2} END{print value}' "$backup/runtime.env")
[[ -n $public_attach ]] || public_attach='0.1'
[[ $public_attach == 0.1 || $public_attach == 0.05 ]] || fail 'Неизвестное значение публичного TON attach.'
owner_canary='0.05'
[[ $public_attach == 0.1 ]] || owner_canary=''
# A later deployment must never silently undo a separately audited Mainnet promotion.
printf 'TON_JETTON_ATTACH_GRAM=%s\nTON_JETTON_ATTACH_SMOKE_OWNER_GRAM=%s\nTON_GASLESS_ATTACH_GRAM=0.05\nTONAPI_BASE=https://tonapi.io\nENABLE_TON_GASLESS=false\nTON_GASLESS_SMOKE_OWNER_ONLY=true\n' "$public_attach" "$owner_canary" >> "$envfile"
chmod 0600 "$envfile"

# runtime.env is deliberately root-only (0600). Load it in a root subshell,
# then pass the exported variables to the unprivileged deploy process. Neither
# Prisma nor the TON read check needs direct access to the secrets file.
run_with_runtime_env(){
  (
    set -a
    # shellcheck disable=SC1090
    source "$envfile"
    set +a
    runuser --preserve-environment -u deploy -- env PATH="$PATH" HOME=/home/deploy NODE_OPTIONS=--max-old-space-size=256 "$@"
  )
}

run_with_runtime_env bash -c '
  set -Eeuo pipefail
  cd "$1/backend"
      node --input-type=module -e '\''import("./dist/deposits/service.js").then(async m=>{const c=m.config;const {attachForUser}=await import("./dist/ton/config.js");const expected=BigInt(process.env.TON_JETTON_ATTACH_GRAM==="0.05"?50000000:100000000);if(c.attachAmount!==expected||attachForUser(c,process.env.OWNER_TELEGRAM_ID)!==50000000n||attachForUser(c,"non-owner")!==expected||c.gaslessEnabled)throw Error("Unsafe attach/gasless configuration");process.stdout.write("TON attach stage confirmed\\n")})'\''
' _ "$release"

# TON Connect wallets resolve bridges and wallet icons on their own HTTPS hosts.
# The manifest is fetched cross-origin by wallets, not by our authenticated API.
python3 - "$nginx_conf" <<'PY'
import pathlib,sys
file=pathlib.Path(sys.argv[1]); source=file.read_text()
old="img-src 'self' data:; font-src 'self'; connect-src 'self';"
new="img-src 'self' data: https:; font-src 'self'; connect-src 'self' https: wss:;"
if old not in source and new not in source:raise SystemExit('Unknown Nginx CSP. No change made.')
source=source.replace(old,new)
location='''    location = /tonconnect-manifest.json {
        default_type application/json;
        add_header Access-Control-Allow-Origin "*" always;
        add_header Cache-Control "public, max-age=300" always;
        try_files $uri =404;
    }
'''
if 'location = /tonconnect-manifest.json' not in source:
    if '    location /api/ {' not in source:raise SystemExit('Unknown Nginx layout')
    source=source.replace('    location /api/ {',location+'    location /api/ {',1)
file.write_text(source)
PY
nginx -t

run_with_runtime_env bash -c '
  set -Eeuo pipefail
  cd "$1"
  npm run db:migrate
' _ "$release"

if grep -Eq '^TONCENTER_API_KEY=[A-Za-z0-9_-]{8,200}$' "$envfile"; then
  note 'Проверяю master getter и индексатор TON Center v3 для treasury.'
  getter_ok=0
  for _attempt in 1 2 3; do
    if run_with_runtime_env bash -c '
      set -Eeuo pipefail; cd "$1/backend"
      node --input-type=module -e "import(\"./dist/deposits/service.js\").then(async m=>{try{const a=await m.center.jettonWallet(m.config.treasury);if(!a)throw Error();const t=Math.floor(Date.now()/1000)-300;await m.center.transactions(t,0,1);await m.center.jettonTransfers(t,0,1);process.stdout.write(\"TON master and v3 indexes verified\\n\")}catch{process.stderr.write(\"TON Center unavailable\\n\");process.exitCode=1}})"
    ' _ "$release"; then getter_ok=1; break; fi
    sleep 5
  done
  ((getter_ok)) || fail 'TON Center не подтвердил USDT Jetton Wallet treasury; публичный доступ остался закрыт.'
else
  fail 'Публичный запуск невозможен: TON Center API key отсутствует в runtime.env.'
fi

note 'Переключаю релиз и проверяю HTTPS.'
activated=1
python3 - "$service" "$sha" <<'PY'
import pathlib, re, sys
path = pathlib.Path(sys.argv[1])
source = path.read_text()
result, count = re.subn(r'^Environment=APP_COMMIT=[a-f0-9]{40}$', 'Environment=APP_COMMIT=' + sys.argv[2], source, flags=re.M)
if count != 1:
    raise SystemExit('Unexpected APP_COMMIT in unit')
path.write_text(result)
PY
chmod 0644 "$service"
ln -sfn "$release" "$root/current-ton-next"
mv -Tf "$root/current-ton-next" "$root/current"
systemctl daemon-reload
systemctl restart gpunode.service
cat > "$worker" <<UNIT
# Managed by AetherMind TON USDT
[Unit]
Description=AetherMind TON USDT deposit watcher
After=network-online.target postgresql.service gpunode.service
Wants=network-online.target
[Service]
Type=simple
User=deploy
Group=deploy
WorkingDirectory=/srv/apps/gpunode/current/backend
EnvironmentFile=/srv/apps/gpunode/shared/runtime.env
Environment=NODE_OPTIONS=--max-old-space-size=128
ExecStart=$node_bin dist/deposits/watcher.js
Restart=always
RestartSec=15
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
MemoryMax=220M
[Install]
WantedBy=multi-user.target
UNIT
chmod 0644 "$worker"
systemctl daemon-reload
if grep -Eq '^TONCENTER_API_KEY=[A-Za-z0-9_-]{8,200}$' "$envfile"; then
  systemctl enable --now gpunode-ton-watcher.service
  systemctl restart gpunode-ton-watcher.service
  systemctl is-active --quiet gpunode-ton-watcher.service || fail 'TON watcher did not start.'
else
  systemctl stop gpunode-ton-watcher.service 2>/dev/null || true
  systemctl disable gpunode-ton-watcher.service 2>/dev/null || true
  note 'TON Center key not supplied; worker remains stopped and real invoices are unavailable.'
fi

healthy=0
for _attempt in {1..30}; do
  if curl -fsS --max-time 2 http://127.0.0.1:3100/api/health -o "$backup/health.json" 2>/dev/null; then healthy=1; break; fi
  sleep 1
done
((healthy)) || { printf 'API не запустился: sudo journalctl -u gpunode -n 80\n' >&2; false; }
nginx -t
systemctl reload nginx

web=(--fail --silent --show-error --max-time 15 --resolve 31.77.226.26:443:127.0.0.1)
curl "${web[@]}" https://31.77.226.26/api/health -o "$backup/https-health.json"
curl "${web[@]}" https://31.77.226.26/api/v1/market -o "$backup/market.json"
curl "${web[@]}" https://31.77.226.26/api/offer -o "$backup/offer.json"
curl "${web[@]}" https://31.77.226.26/ -o "$backup/index.html"
curl "${web[@]}" https://31.77.226.26/documents/public-offer-aethermind.pdf -o "$backup/public-offer.pdf"
curl "${web[@]}" https://31.77.226.26/assets/cosmic-field.svg -o "$backup/cosmic-field.svg"
curl "${web[@]}" https://31.77.226.26/tonconnect-manifest.json -o "$backup/tonconnect-manifest.json"
[[ $(curl -sS --max-time 15 --resolve 31.77.226.26:443:127.0.0.1 -D - -o /dev/null https://31.77.226.26/tonconnect-manifest.json | tr -d '\r' | grep -ic '^Access-Control-Allow-Origin: \*$') -eq 1 ]] || fail 'TON Connect manifest CORS is missing.'
curl "${web[@]}" https://31.77.226.26/assets/icons/icon-180.png -o "$backup/tonconnect-icon.png"
printf '%s  %s\n' 'b21177972dbdeedbea731e826b070ff7fb148ec1f96e7892536e67e40732ce88' "$backup/public-offer.pdf" | sha256sum --check --status

python3 - "$backup" "$sha" <<'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1])
health = json.loads((root / 'https-health.json').read_text())
market = json.loads((root / 'market.json').read_text())
offer = json.loads((root / 'offer.json').read_text())
assert health['status'] == 'ok' and health['commit'] == sys.argv[2]
assert market['version'] == 'offer-88-2026-ai' and market['purchasesEnabled'] is False
assert market['nodes'][0]['dailyUsdt'] == '0.750000'
assert market['nodes'][3]['dailyUsdt'] is None
assert offer['version'] == '88-2026-AI-2026-09-21'
assert offer['paymentsEnabled'] is True and offer['accrualEnabled'] is False
manifest = json.loads((root / 'tonconnect-manifest.json').read_text())
assert manifest['url'] == 'https://31.77.226.26' and manifest['iconUrl'].endswith('/assets/icons/icon-180.png')
assert (root / 'tonconnect-icon.png').read_bytes().startswith(b'\x89PNG')
assert offer['documentSha256'] == 'b21177972dbdeedbea731e826b070ff7fb148ec1f96e7892536e67e40732ce88'
assert 'AetherMind' in (root / 'index.html').read_text()
from xml.etree import ElementTree
background = root / 'cosmic-field.svg'
assert background.stat().st_size < 20000
assert ElementTree.parse(background).getroot().tag.endswith('svg')
PY

mapfile -t assets < <(grep -oE '/assets/[^" ]+\.(js|css)' "$backup/index.html" | sort -u)
((${#assets[@]}>=2))
profile_marker=0
for asset in "${assets[@]}"; do
  target="$backup/$(basename "$asset")"
  curl "${web[@]}" "https://31.77.226.26$asset" -o "$target"
  if [[ $asset == *.js ]] && grep -q 'Choose your language' "$target" && grep -q 'Alegeți limba' "$target"; then profile_marker=1; fi
done
((profile_marker)) || fail 'HTTPS отдал старый JavaScript.'
[[ $(curl -sS --max-time 15 --resolve 31.77.226.26:443:127.0.0.1 -o /dev/null -w '%{http_code}' -X PATCH -H 'Content-Type: application/json' -d '{"language":"en"}' https://31.77.226.26/api/me/language) == 401 ]]
[[ $(curl -sS --max-time 15 --resolve 31.77.226.26:443:127.0.0.1 -o /dev/null -w '%{http_code}' -X POST https://31.77.226.26/api/profile/tariff) == 401 ]]
[[ $(curl -sS --max-time 15 --resolve 31.77.226.26:443:127.0.0.1 -o /dev/null -w '%{http_code}' https://31.77.226.26/api/admin/users) == 401 ]]
[[ $(curl -sS --max-time 15 --resolve 31.77.226.26:443:127.0.0.1 -o /dev/null -w '%{http_code}' https://31.77.226.26/api/admin/tickets) == 401 ]]
[[ $(curl -sS --max-time 15 --resolve 31.77.226.26:443:127.0.0.1 -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' https://31.77.226.26/api/test/orders) == 404 ]]
[[ $(curl -sS --max-time 15 --resolve 31.77.226.26:443:127.0.0.1 -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' https://31.77.226.26/api/admin/users/11111/test-credit) == 404 ]]
for url in /api/v1/wallet /api/v1/wallet/transactions /api/v1/deposits /api/v1/admin/deposits /api/v1/ton/health; do
  [[ $(curl -sS --max-time 15 --resolve 31.77.226.26:443:127.0.0.1 -o /dev/null -w '%{http_code}' "https://31.77.226.26$url") == 401 ]] || fail "Authorization check failed: $url"
done
systemctl is-active --quiet gpunode.service
systemctl is-active --quiet gpu-cert-renew.timer

note 'Проверяю браузерный вход и сохраняю кнопку бота.'
curl "${web[@]}" -H 'Content-Type: application/json' -d '{}' https://31.77.226.26/api/auth/browser/start -o "$backup/browser-login.json"
python3 - "$backup/browser-login.json" <<'PY'
import json, sys
result = json.load(open(sys.argv[1]))
assert len(result['secret']) == 64
assert result['url'].startswith('https://t.me/') and '?start=login_' in result['url']
PY
python3 "$release/ops/bot-config.py"

trap - ERR INT TERM
printf '\nГОТОВО: https://31.77.226.26/\nUSDT TON: публичный attach %s GRAM; gasless выключен до отдельного smoke.\nКоммит: %s\nБэкап: %s\nВывод через поддержку; заказы за баланс выключены. Откройте Mini App заново.\n' "$public_attach" "$sha" "$backup"
