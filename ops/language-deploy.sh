#!/usr/bin/env bash
# Atomic deployment of the AetherMind visual release and test-order cycle.
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
backup="/srv/backups/gpunode/visual-$stamp"
release="/srv/releases/gpunode/$stamp-${sha:0:12}-visual"
[[ ! -e $release && ! -e $backup ]] || fail 'Каталог этого релиза уже существует.'
install -d -m 0700 "$backup"
install -d -m 0755 -o deploy -g deploy "$release"
install -d -m 0755 -o deploy -g deploy "$root/shared/npm-cache"

activated=0
rollback(){
  trap - ERR INT TERM
  set +e
  if ((activated)); then
    systemctl stop gpunode.service
    ln -sfn "$previous" "$root/current-visual-rollback"
    mv -Tf "$root/current-visual-rollback" "$root/current"
    cp -a "$backup/gpunode.service" "$service"
    systemctl daemon-reload
    systemctl start gpunode.service
    nginx -t && systemctl reload nginx
  fi
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
[[ -f $release/backend/prisma/migrations/202609230002_test_cycle/migration.sql && -f $release/backend/test/test-cycle.test.ts && -f $release/docs/TEST_ORDER_CYCLE.md ]] || fail 'Нет миграции или проверок тестовых заказов.'
[[ -f $release/frontend/src/space-layout.css && -f $release/frontend/public/assets/cosmic-field.svg ]] || fail 'Нет адаптивной компоновки или космического фона.'
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
grep -Rqs 'Тестовый баланс' frontend/dist/assets/*.js
grep -Rqs 'cosmic-field.svg' frontend/dist/assets/*.css
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
cp -a "$service" "$backup/gpunode.service"
cp -a "$nginx_conf" "$backup/nginx.conf"
printf '%s\n' "$previous" > "$backup/previous-release.txt"

runuser -u deploy -- env PATH="$PATH" HOME=/home/deploy NODE_OPTIONS=--max-old-space-size=256 bash -c '
  set -Eeuo pipefail
  set -a; source "$1"; set +a
  cd "$2"
  npm run db:migrate
' _ "$envfile" "$release"

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
ln -sfn "$release" "$root/current-visual-next"
mv -Tf "$root/current-visual-next" "$root/current"
systemctl daemon-reload
systemctl restart gpunode.service

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
assert offer['paymentsEnabled'] is False and offer['accrualEnabled'] is False
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
[[ $(curl -sS --max-time 15 --resolve 31.77.226.26:443:127.0.0.1 -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' https://31.77.226.26/api/test/orders) == 401 ]]
[[ $(curl -sS --max-time 15 --resolve 31.77.226.26:443:127.0.0.1 -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' https://31.77.226.26/api/admin/users/11111/test-credit) == 401 ]]
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
printf '\nГОТОВО: https://31.77.226.26/\nТестовые заказы и отдельный баланс доступны на трёх языках.\nКоммит: %s\nБэкап: %s\nПлатежи и начисления остаются выключенными. Полностью закройте и заново откройте Mini App.\n' "$sha" "$backup"
