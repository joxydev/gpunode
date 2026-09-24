#!/data/data/com.termux/files/usr/bin/bash
# Deploy USDT on TON integration; VPS runs migrations and full isolated checks.
set -Eeuo pipefail
trap 'printf "\nДеплой не подтверждён (строка %s). Проверьте сообщение выше.\n" "$LINENO" >&2' ERR

repo="$HOME/gpunode"
[[ -d "$repo/.git" ]] || { echo 'Сначала выполните скрипт 38 для GitHub.' >&2; exit 1; }
cd "$repo"
[[ -z $(git status --porcelain) ]] || { echo 'Есть незакоммиченные изменения. Деплой отменён.' >&2; exit 1; }
[[ $(git remote get-url origin) == https://github.com/joxydev/gpunode.git ]] || { echo 'Неверный origin.' >&2; exit 1; }
git fetch origin main
sha=$(git rev-parse HEAD)
[[ $sha == $(git rev-parse origin/main) ]] || { echo 'Коммит отличается от GitHub main. Сначала выполните скрипт 38.' >&2; exit 1; }
test -f backend/prisma/migrations/202609230002_test_cycle/migration.sql
test -f docs/TEST_ORDER_CYCLE.md
test -f frontend/public/assets/cosmic-field.svg
test -f frontend/src/space-layout.css
test -f backend/prisma/migrations/202609240001_ton_usdt_deposits/migration.sql
test -f frontend/public/tonconnect-manifest.json
test -f ops/ton-deploy.sh

for tool in ssh scp sha256sum; do
  command -v "$tool" >/dev/null || { echo "Требуется $tool: pkg install openssh coreutils" >&2; exit 1; }
done
key="$HOME/.ssh/joxy_senko"
[[ -f $key ]] || { echo "Не найден SSH-ключ $key" >&2; exit 1; }

stage=$(mktemp -d "$HOME/gpunode-ton.XXXXXXXX")
trap 'rm -f -- "$stage/source.tar.gz"; rmdir -- "$stage" 2>/dev/null || true' EXIT
git archive --format=tar.gz --prefix="gpunode-$sha/" "$sha" > "$stage/source.tar.gz"
digest=$(sha256sum "$stage/source.tar.gz" | cut -d' ' -f1)
nonce="$(date -u +%s)$RANDOM"
remote_dir="/home/joxy/aethermind-upload.$nonce"
server='joxy@31.77.226.26'
printf 'Передаю коммит %s на VPS. Введите пароль SSH-ключа, затем sudo и TON Center API key (скрытый ввод, если ещё не задан).\n' "$sha"
ssh -o ConnectTimeout=20 -i "$key" "$server" "mkdir -m 700 '$remote_dir'"
scp -o ConnectTimeout=20 -i "$key" "$stage/source.tar.gz" "$repo/ops/ton-deploy.sh" "$server:$remote_dir/"
ssh -tt -o ConnectTimeout=20 -i "$key" "$server" "sudo bash '$remote_dir/ton-deploy.sh' '$remote_dir/source.tar.gz' '$sha' '$digest'; rc=\$?; rm -f -- '$remote_dir/source.tar.gz' '$remote_dir/ton-deploy.sh'; rmdir -- '$remote_dir'; exit \$rc"
printf '\nОбновление проверено на VPS: https://31.77.226.26/\n'
