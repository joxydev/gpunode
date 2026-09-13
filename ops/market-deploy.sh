#!/usr/bin/env bash
# Update the existing AetherMind installation. No cleanup, bootstrap or secret prompts.
# Shell bodies below intentionally expand variables inside the target shell.
# shellcheck disable=SC2016
set -Eeuo pipefail
umask 077
fail(){ printf '\nОШИБКА: %s\n' "$*" >&2; exit 1; }
note(){ printf '\n>> %s\n' "$*"; }
[[ $EUID -eq 0 ]] || fail 'Требуется sudo.'
cd /
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
archive=${1:-}; sha=${2:-}; expected=${3:-}
[[ $archive =~ ^/home/joxy/aethermind-upload\.[a-zA-Z0-9]+/source\.tar\.gz$ && -f $archive && ! -L $archive ]] || fail 'Некорректный архив.'
[[ $sha =~ ^[a-f0-9]{40}$ && $expected =~ ^[a-f0-9]{64}$ ]] || fail 'Некорректная контрольная сумма.'
printf '%s  %s\n' "$expected" "$archive" | sha256sum --check --status || fail 'Архив повреждён.'
exec 9>/var/lock/gpunode-deploy.lock
flock -n 9 || fail 'Другой деплой уже работает.'
root=/srv/apps/gpunode
envfile="$root/shared/runtime.env"
service=/etc/systemd/system/gpunode.service
[[ -L $root/current && -f $envfile && -f $service ]] || fail 'Сначала нужен работающий gpunode предыдущего этапа.'
grep -q '^# Managed by AetherMind v1$' "$service" || fail 'Неизвестный unit; автоматическая замена запрещена.'
previous=$(readlink -f "$root/current")
[[ $previous == /srv/releases/gpunode/* && -f $previous/frontend/dist/index.html ]] || fail 'Не найден предыдущий релиз.'
systemctl is-active --quiet gpunode.service || fail 'Старая служба не работает. Сначала устраните её ошибку.'
systemctl is-active --quiet gpu-cert-renew.timer || fail 'Таймер продления HTTPS не работает.'
nginx -t
available=$(df -Pk /srv | awk 'NR==2 {print $4}')
((available>1200000)) || fail 'Нужно минимум 1.2 ГБ свободного места для сборки и бэкапа.'
node_bin=$(sed -n 's/^ExecStart=\([^ ]*\/bin\/node\) dist\/main.js$/\1/p' "$service")
[[ $node_bin =~ ^/opt/gpu-node/node-v22\.[0-9]+\.[0-9]+-linux-x64/bin/node$ && -x $node_bin ]] || fail 'Не удалось определить установленный Node.js 22.'
node_path=$(dirname "$node_bin")
export PATH="$node_path:$PATH"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="/srv/backups/gpunode/market-$stamp"
release="/srv/releases/gpunode/$stamp-${sha:0:12}-market"
[[ ! -e $release && ! -e $backup ]] || fail 'Каталог этого релиза уже существует.'
install -d -m 0700 "$backup"
install -d -m 0755 -o deploy -g deploy "$release"
activated=0
rollback(){
  trap - ERR INT TERM
  set +e
  if ((activated)); then
    systemctl stop gpunode.service
    ln -sfn "$previous" "$root/current-market-rollback"
    mv -Tf "$root/current-market-rollback" "$root/current"
    cp -a "$backup/gpunode.service" "$service"
    systemctl daemon-reload
    systemctl start gpunode.service
    nginx -t && systemctl reload nginx
  fi
  printf '\nОбновление не подтверждено. Предыдущий релиз: %s\nРезервная копия: %s\nСхема БД автоматически не откатывается.\n' "$previous" "$backup" >&2
  exit 1
}
trap rollback ERR INT TERM
note 'Извлекаю точный коммит GitHub в отдельный релиз.'
python3 - "$archive" "$release" <<'PY'
import pathlib,sys,tarfile
with tarfile.open(sys.argv[1],'r:gz') as archive:
    members=archive.getmembers()
    if len({m.name.split('/')[0] for m in members})!=1: raise SystemExit('Invalid archive root')
    for m in members:
        parts=pathlib.PurePosixPath(m.name).parts
        if m.name.startswith('/') or '..' in parts or not(m.isfile() or m.isdir()): raise SystemExit('Unsafe archive entry')
        if len(parts)<2: continue
        m.name='/'.join(parts[1:]);archive.extract(m,path=sys.argv[2],filter='data')
PY
[[ -f $release/.aethermind-project && -f $release/MARKET.md && -f $release/backend/src/market.ts && -f $release/frontend/src/Market.tsx ]] || fail 'В main ещё нет обновления маркета. Запустите первый скрипт.'
printf '%s\n' "$sha" > "$release/DEPLOYED_COMMIT"
chown -R deploy:deploy "$release"
chmod 0755 "$release" "$release/frontend"
note 'Сборка и тесты на VPS. Действующая версия пока продолжает работать.'
runuser -u deploy -- env PATH="$PATH" NODE_OPTIONS=--max-old-space-size=384 bash -c '
 set -Eeuo pipefail
 umask 022
 cd "$1"
 export DATABASE_URL=postgresql://unused:unused@127.0.0.1:5432/unused
 npm ci --include=dev --ignore-scripts --no-audit --no-fund
 npm run db:generate
 npm test
 npm run build
' _ "$release"
find "$release/frontend/dist" -type d -exec chmod 0755 {} +
find "$release/frontend/dist" -type f -exec chmod 0644 {} +
# Running from / avoids the previous /home/joxy traversal failure.
runuser -u www-data -- test -r "$release/frontend/dist/index.html"
runuser -u www-data -- find "$release/frontend/dist" -type f -exec sh -c 'for f do test -r "$f" || exit 1; done' _ {} +
note 'Сохраняю базу и настройки перед добавочной миграцией.'
runuser -u postgres -- pg_dump -Fc aethermind_v1 > "$backup/database.dump"
pg_restore --list "$backup/database.dump" >/dev/null
cp -a "$envfile" "$backup/runtime.env"
cp -a "$service" "$backup/gpunode.service"
cp -a /etc/nginx/sites-available/gpunode-ip.conf "$backup/nginx.conf"
printf '%s\n' "$previous" > "$backup/previous-release.txt"
runuser -u deploy -- env PATH="$PATH" NODE_OPTIONS=--max-old-space-size=256 bash -c '
 set -Eeuo pipefail; set -a; source "$1"; set +a; cd "$2"; npm run db:migrate
' _ "$envfile" "$release"
note 'Переключаю приложение и проверяю результат.'
activated=1
python3 - "$service" "$sha" <<'PY'
import pathlib,re,sys
p=pathlib.Path(sys.argv[1]);source=p.read_text()
result,count=re.subn(r'^Environment=APP_COMMIT=[a-f0-9]{40}$','Environment=APP_COMMIT='+sys.argv[2],source,flags=re.M)
if count!=1: raise SystemExit('Unexpected APP_COMMIT in unit')
p.write_text(result)
PY
chmod 0644 "$service"
ln -sfn "$release" "$root/current-market-next"
mv -Tf "$root/current-market-next" "$root/current"
systemctl daemon-reload
systemctl restart gpunode.service
healthy=0
for _attempt in {1..30}; do
 if curl -fsS --max-time 2 http://127.0.0.1:3100/api/health -o "$backup/health.json" 2>/dev/null; then healthy=1; break; fi
 sleep 1
done
((healthy)) || { printf 'API не запустился: sudo journalctl -u gpunode -n 60\n' >&2; false; }
nginx -t
systemctl reload nginx
web=(--fail --silent --show-error --max-time 15 --resolve 31.77.226.26:443:127.0.0.1)
curl "${web[@]}" https://31.77.226.26/api/health -o "$backup/https-health.json"
curl "${web[@]}" https://31.77.226.26/api/v1/market -o "$backup/market.json"
curl "${web[@]}" https://31.77.226.26/ -o "$backup/index.html"
python3 - "$backup" "$sha" <<'PY'
import json,pathlib,sys
root=pathlib.Path(sys.argv[1]);h=json.loads((root/'https-health.json').read_text());m=json.loads((root/'market.json').read_text())
assert h['status']=='ok' and h['commit']==sys.argv[2]
assert m['version']=='market-v1' and m['purchasesEnabled'] is False
assert {n['id'] for n in m['nodes']} >= {'NODE_4090','NODE_A100','NODE_H100','NODE_QBIT'}
assert 'AetherMind' in (root/'index.html').read_text()
PY
mapfile -t assets < <(grep -oE '/assets/[^" ]+\.(js|css)' "$backup/index.html" | sort -u)
((${#assets[@]}>=2))
for asset in "${assets[@]}"; do curl "${web[@]}" "https://31.77.226.26$asset" -o /dev/null; done
for id in 4090 a100 h100 qbit; do
 for name in card-320.webp detail-720.webp icon-80.png; do
  curl "${web[@]}" "https://31.77.226.26/assets/market/$id/$name" -o /dev/null
 done
done
[[ $(curl -sS --max-time 15 --resolve 31.77.226.26:443:127.0.0.1 -o /dev/null -w '%{http_code}' -X POST https://31.77.226.26/api/v1/market/buy) == 401 ]]
systemctl is-active --quiet gpunode.service
systemctl is-active --quiet gpu-cert-renew.timer
trap - ERR INT TERM
printf '\nГОТОВО: https://31.77.226.26/\nМодуль: market-v1\nКоммит: %s\nБэкап: %s\nКнопка @Videomarket_GPUbot и HTTPS сохранены. Откройте приложение заново.\n' "$sha" "$backup"
