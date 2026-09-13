#!/usr/bin/env bash
# AetherMind: Ubuntu 24.04 x64. Only invoked by 02_gpunode_vps.sh.
set -Eeuo pipefail
umask 077
fail(){ printf '\nОШИБКА: %s\n' "$*" >&2; exit 1; }
note(){ printf '\n>> %s\n' "$*"; }
[[ $EUID -eq 0 ]] || fail 'Запуск только через sudo.'
cd /
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
archive=${1:-}; sha=${2:-}; archive_hash=${3:-}
[[ $archive =~ ^/home/joxy/aethermind-upload\.[a-zA-Z0-9]+/source\.tar\.gz$ && -f $archive && ! -L $archive ]] || fail 'Неожиданный архив.'
[[ $sha =~ ^[0-9a-f]{40}$ && $archive_hash =~ ^[0-9a-f]{64}$ ]] || fail 'Некорректные контрольные суммы.'
printf '%s  %s\n' "$archive_hash" "$archive" | sha256sum --check --status || fail 'Архив повреждён.'
# shellcheck source=/dev/null
source /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 24.04 && $(uname -m) == x86_64 ]] || fail 'Требуется Ubuntu 24.04 x86_64.'
exec 9>/var/lock/gpunode-deploy.lock
flock -n 9 || fail 'Деплой gpunode уже запущен.'
exec 8>/var/lock/gpu-marketplace-bootstrap.lock
flock -n 8 || fail 'Старый деплой GPU Marketplace ещё выполняется.'
available=$(df -Pk /srv | awk 'NR==2 {print $4}')
((available>1800000)) || fail 'Нужно минимум 1.8 ГБ свободного места. Данные автоматически не удаляются.'
root=/srv/apps/gpunode
releases=/srv/releases/gpunode
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="/srv/backups/gpunode/$stamp"
release="$releases/$stamp-${sha:0:12}"
site=/etc/nginx/sites-available/gpunode-ip.conf
service=/etc/systemd/system/gpunode.service
for dir in "$root" "$releases" /srv/backups/gpunode; do [[ ! -L $dir ]] || fail "Неожиданная ссылка: $dir"; done
note 'Подготовка системных зависимостей. Старые данные и SSH не трогаю.'
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl xz-utils nginx postgresql postgresql-client python3 python3-venv openssl util-linux
id deploy >/dev/null 2>&1 || adduser --disabled-password --gecos '' deploy
install -d -m 0755 "$root" "$releases" /var/www/gpu-acme /etc/gpunode
install -d -m 0750 -o root -g deploy "$root/shared"
install -d -m 0700 -o root -g root /srv/backups/gpunode "$backup"
systemctl enable --now postgresql nginx

note 'Node.js 22: официальный архив с проверкой SHA-256.'
downloads=$(mktemp -d /var/tmp/aethermind-node.XXXXXX)
curl -fsS --retry 3 --max-time 90 https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o "$downloads/SHASUMS256.txt"
line=$(awk '$2 ~ /^node-v22\.[0-9]+\.[0-9]+-linux-x64.tar.xz$/ {print}' "$downloads/SHASUMS256.txt")
[[ -n $line && $(printf '%s\n' "$line" | wc -l) -eq 1 ]] || fail 'Не удалось определить версию Node.js.'
node_archive=${line##* };node_dir="/opt/gpu-node/${node_archive%.tar.xz}"
if [[ ! -x $node_dir/bin/node ]]; then
  curl -fsS --retry 3 --max-time 180 "https://nodejs.org/dist/latest-v22.x/$node_archive" -o "$downloads/$node_archive"
  (cd "$downloads"; printf '%s\n' "$line" | sha256sum --check --status)
  install -d -m 0755 /opt/gpu-node
  tar -xJf "$downloads/$node_archive" -C /opt/gpu-node --no-same-owner
fi
export PATH="$node_dir/bin:$PATH"
node --version

note 'Проверка архива и извлечение исходников.'
install -d -o deploy -g deploy -m 0755 "$release"
python3 - "$archive" "$release" <<'PY_ARCHIVE'
import pathlib,sys,tarfile
dest=pathlib.Path(sys.argv[2])
with tarfile.open(sys.argv[1],'r:gz') as archive:
    members=archive.getmembers()
    prefixes={m.name.split('/')[0] for m in members}
    if len(prefixes)!=1: raise SystemExit('Invalid archive root')
    for member in members:
        parts=pathlib.PurePosixPath(member.name).parts
        if member.name.startswith('/') or '..' in parts or not(member.isfile() or member.isdir()):
            raise SystemExit('Archive contains unsafe path or link')
        if len(parts)<2: continue
        member.name='/'.join(parts[1:])
        archive.extract(member,path=dest,filter='data')
PY_ARCHIVE
[[ -f $release/.aethermind-project && -f $release/package-lock.json ]] || fail 'Это не проект AetherMind.'
printf '%s\n' "$sha" > "$release/DEPLOYED_COMMIT"
note 'Настройки: токен вводится скрыто; пароль SSH не передаётся приложению.'
python3 "$release/ops/settings.py"
envfile="$root/shared/runtime.env"

note 'Сборка на VPS, последовательно; лимит памяти Node 384 МБ.'
chown -R deploy:deploy "$release"
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
chmod 0755 "$release" "$release/frontend"
find "$release/frontend/dist" -type d -exec chmod 0755 {} +
find "$release/frontend/dist" -type f -exec chmod 0644 {} +
runuser -u www-data -- test -r "$release/frontend/dist/index.html"
runuser -u www-data -- find "$release/frontend/dist" -type f -exec sh -c 'for file do test -r "$file" || exit 1; done' _ {} +

note 'Резервная копия перед миграцией новой базы aethermind_v1.'
runuser -u postgres -- pg_dump -Fc aethermind_v1 > "$backup/database.dump"
pg_restore --list "$backup/database.dump" >/dev/null
cp -a "$envfile" "$backup/runtime.env"
runuser -u deploy -- env PATH="$PATH" NODE_OPTIONS=--max-old-space-size=256 bash -c '
  set -Eeuo pipefail; set -a; source "$1"; set +a; cd "$2"; npm run db:migrate
' _ "$envfile" "$release"

# No deletes or schema resets; old project database is never accessed.
[[ ! -e $root/current || -L $root/current ]] || fail 'current должен быть символической ссылкой.'
previous=$(readlink "$root/current" || true)
old_active=0; old_enabled=0; new_active=0; new_enabled=0; activated=0
systemctl is-active --quiet gpu-marketplace.service && old_active=1
systemctl is-enabled --quiet gpu-marketplace.service 2>/dev/null && old_enabled=1
systemctl is-active --quiet gpunode.service && new_active=1
systemctl is-enabled --quiet gpunode.service 2>/dev/null && new_enabled=1
for f in "$site" "$service"; do if [[ -e $f ]]; then grep -q '^# Managed by AetherMind v1$' "$f" || fail "Чужой конфиг: $f"; cp -a "$f" "$backup/"; fi; done
install -d -m 0700 "$backup/enabled"
# Only the known IP vhosts and distro default are replaced. Other sites remain untouched.
for name in gpu-marketplace-ip.conf gpunode-ip.conf default; do
  entry="/etc/nginx/sites-enabled/$name"
  if [[ -e $entry || -L $entry ]]; then [[ -L $entry ]] || fail "Неожиданный обычный файл: $entry"; cp -a "$entry" "$backup/enabled/"; fi
done
rollback(){
  trap - ERR INT TERM
  set +e
  if ((activated)); then
    for name in gpu-marketplace-ip.conf gpunode-ip.conf default; do
      entry="/etc/nginx/sites-enabled/$name"
      [[ ! -L $entry ]] || unlink "$entry"
      [[ ! -L $backup/enabled/$name ]] || cp -a "$backup/enabled/$name" "$entry"
    done
    if [[ -f $backup/gpunode-ip.conf ]]; then cp -a "$backup/gpunode-ip.conf" "$site"; fi
    systemctl stop gpunode.service
    if [[ -n $previous ]]; then ln -sfn "$previous" "$root/current-rollback"; mv -Tf "$root/current-rollback" "$root/current"; elif [[ -L $root/current ]]; then unlink "$root/current"; fi
    if [[ -f $backup/gpunode.service ]]; then cp -a "$backup/gpunode.service" "$service"; fi
    systemctl daemon-reload
    if ((new_enabled)); then systemctl enable gpunode.service; else systemctl disable gpunode.service; fi
    ((new_active==0)) || systemctl start gpunode.service
    ((old_enabled==0)) || systemctl enable gpu-marketplace.service
    ((old_active==0)) || systemctl start gpu-marketplace.service
    nginx -t && systemctl reload nginx
  fi
  printf '\nДеплой не подтверждён. Прежнее приложение восстановлено, если было. БД не откатывается автоматически. Копия: %s\n' "$backup" >&2
  exit 1
}
trap rollback ERR INT TERM
activated=1
for name in gpu-marketplace-ip.conf gpunode-ip.conf default; do
  entry="/etc/nginx/sites-enabled/$name"; [[ ! -L $entry ]] || unlink "$entry"
done
tee "$site" >/dev/null <<'HTTP'
# Managed by AetherMind v1
server {
    listen 80;
    listen [::]:80;
    server_name 31.77.226.26;
    location ^~ /.well-known/acme-challenge/ { root /var/www/gpu-acme; }
    location / { default_type text/plain; return 503 "AetherMind deployment in progress"; }
}
HTTP
chmod 0644 "$site"
ln -s "$site" /etc/nginx/sites-enabled/gpunode-ip.conf
nginx -t
systemctl reload nginx
if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then ufw allow 80/tcp; ufw allow 443/tcp; fi

note 'HTTPS по IP. Сохраняю существующий сертификат и webroot продления.'
[[ -x /opt/gpu-certbot/bin/python ]] || python3 -m venv /opt/gpu-certbot
/opt/gpu-certbot/bin/python -m pip install --disable-pip-version-check --no-cache-dir 'certbot>=5.4,<6'
acme_email=$(< /etc/gpunode/acme-email)
/opt/gpu-certbot/bin/certbot certonly --webroot -w /var/www/gpu-acme --ip-address 31.77.226.26 --required-profile shortlived --cert-name gpu-marketplace-ip --non-interactive --agree-tos --email "$acme_email" --keep-until-expiring
tee /etc/systemd/system/gpu-cert-renew.service >/dev/null <<'RENEW'
[Unit]
Description=Renew IP HTTPS certificate for AetherMind
After=network-online.target nginx.service
[Service]
Type=oneshot
ExecStart=/opt/gpu-certbot/bin/certbot renew --cert-name gpu-marketplace-ip --quiet --deploy-hook "/usr/sbin/nginx -t && /usr/bin/systemctl reload nginx"
RENEW
tee /etc/systemd/system/gpu-cert-renew.timer >/dev/null <<'TIMER'
[Unit]
Description=Check IP certificate every six hours
[Timer]
OnCalendar=*-*-* 00,06,12,18:00:00
RandomizedDelaySec=300
Persistent=true
[Install]
WantedBy=timers.target
TIMER
chmod 0644 /etc/systemd/system/gpu-cert-renew.service /etc/systemd/system/gpu-cert-renew.timer

tee "$service" >/dev/null <<SERVICE
# Managed by AetherMind v1
[Unit]
Description=AetherMind GPU Node API
After=network-online.target postgresql.service
Wants=network-online.target
[Service]
Type=simple
User=deploy
Group=deploy
WorkingDirectory=$root/current/backend
EnvironmentFile=$envfile
Environment=NODE_OPTIONS=--max-old-space-size=256
Environment=APP_COMMIT=$sha
ExecStart=$node_dir/bin/node dist/main.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
MemoryMax=400M
[Install]
WantedBy=multi-user.target
SERVICE
chmod 0644 "$service"
ln -sfn "$release" "$root/current-next"
mv -Tf "$root/current-next" "$root/current"
systemctl daemon-reload
systemctl enable --now gpu-cert-renew.timer
systemctl enable gpunode.service
systemctl restart gpunode.service
healthy=0
for _attempt in {1..30}; do
  if curl -fsS --max-time 2 http://127.0.0.1:3100/api/health > "$backup/health.json"; then healthy=1; break; fi
  sleep 1
done
((healthy)) || { printf 'Служба не запустилась. Журнал: sudo journalctl -u gpunode -n 50\n' >&2; false; }

tee "$site" >/dev/null <<'HTTPS'
# Managed by AetherMind v1
limit_req_zone $binary_remote_addr zone=aethermind_api:10m rate=5r/s;
server {
    listen 80;
    listen [::]:80;
    server_name 31.77.226.26;
    location ^~ /.well-known/acme-challenge/ { root /var/www/gpu-acme; }
    location / { return 308 https://31.77.226.26$request_uri; }
}
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name 31.77.226.26;
    ssl_certificate /etc/letsencrypt/live/gpu-marketplace-ip/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/gpu-marketplace-ip/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    root /srv/apps/gpunode/current/frontend/dist;
    index index.html;
    charset utf-8;
    client_max_body_size 16k;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self' https://web.telegram.org https://*.telegram.org" always;
    location /api/ {
        limit_req zone=aethermind_api burst=40 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 5s;
        proxy_read_timeout 30s;
    }
    location ~ /\. { deny all; }
    location /assets/ { try_files $uri =404; }
    location / { expires -1; try_files $uri $uri/ /index.html; }
}
HTTPS
nginx -t
systemctl reload nginx

note 'Проверяю HTTPS, HTML, ассеты, авторизацию и базу.'
web=(--fail --silent --show-error --max-time 15 --resolve 31.77.226.26:443:127.0.0.1)
curl "${web[@]}" https://31.77.226.26/ -o "$backup/index.html"
grep -q 'AetherMind' "$backup/index.html"
curl "${web[@]}" https://31.77.226.26/api/health -o "$backup/https-health.json"
python3 - "$backup/https-health.json" "$sha" <<'HEALTH'
import json,sys
d=json.load(open(sys.argv[1]))
assert d['status']=='ok' and d['app']=='aethermind' and d['commit']==sys.argv[2]
HEALTH
mapfile -t assets < <(grep -oE '/assets/[^" ]+\.(js|css)' "$backup/index.html" | sort -u)
((${#assets[@]}>=2))
for asset in "${assets[@]}" /assets/core.webp /assets/server.webp /assets/gpu.webp /assets/quantum.webp /assets/splash.json; do curl "${web[@]}" "https://31.77.226.26$asset" -o /dev/null; done
[[ $(curl -sS --max-time 15 --resolve 31.77.226.26:443:127.0.0.1 -o /dev/null -w '%{http_code}' https://31.77.226.26/api/me) == 401 ]]
systemctl is-active --quiet gpu-cert-renew.timer
if ((old_active||old_enabled)); then systemctl disable --now gpu-marketplace.service; fi
trap - ERR INT TERM
note 'Сайт запущен и проверен. Настраиваю кнопку и команды бота.'
python3 "$release/ops/bot-config.py"
printf '\nГОТОВО: https://31.77.226.26/\nКоммит: %s\nБэкап: %s\nСлужба: gpunode.service\nРежим: заявки; оплата и GPU-провайдер ещё не подключены.\n' "$sha" "$backup"
