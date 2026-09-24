#!/usr/bin/env bash
# Deploy the separate stage-1 GitHub commit from Termux. Never moves main.
set -Eeuo pipefail
umask 077
trap 'printf "\nОбновление VPS не подтверждено (строка %s).\n" "$LINENO" >&2' ERR

repo="$HOME/gpunode"
remote='https://github.com/joxydev/gpunode.git'
branch='codex/ton-attach-canary'
base='5ff98badcb3e5788bb4cc8d5628bda4f8d211aa6'
[[ -d $repo/.git ]] || { printf 'Сначала скачайте репозиторий: git clone %s ~/gpunode\n' "$remote" >&2; exit 1; }
for tool in git ssh scp sha256sum; do command -v "$tool" >/dev/null || { printf 'Установите %s в Termux.\n' "$tool" >&2; exit 1; }; done
key="$HOME/.ssh/joxy_senko"
[[ -f $key ]] || { printf 'SSH-ключ отсутствует: %s\n' "$key" >&2; exit 1; }
cd "$repo"
[[ $(git remote get-url origin) == "$remote" ]] || { echo 'Неверный origin.' >&2; exit 1; }
git fetch origin main "$branch"
main=$(git rev-parse origin/main)
sha=$(git rev-parse "origin/$branch")
[[ $main == "$base" || $main == "$sha" ]] || { echo 'GitHub main изменился: нужна проверка совместимости до деплоя.' >&2; exit 1; }
[[ $(git rev-parse "$sha^") == "$base" ]] || { echo 'Ветка не основана на ожидаемом коммите.' >&2; exit 1; }
git show "$sha:backend/src/ton/jetton.ts" | grep -Fq 'buildJettonTransfer' || { echo 'Коммит не содержит нужный Jetton builder.' >&2; exit 1; }
git show "$sha:ops/ton-deploy.sh" | grep -Fq 'TON_JETTON_ATTACH_SMOKE_OWNER_GRAM=0.05' || { echo 'В релизе отсутствует owner canary.' >&2; exit 1; }

stage=$(mktemp -d "$HOME/gpunode-ton-attach.XXXXXXXX")
trap 'rm -f -- "$stage/source.tar.gz" "$stage/ton-deploy.sh"; rmdir -- "$stage" 2>/dev/null || true' EXIT
git archive --format=tar.gz --prefix="gpunode-$sha/" "$sha" > "$stage/source.tar.gz"
digest=$(sha256sum "$stage/source.tar.gz" | cut -d' ' -f1)
remote_dir="/home/joxy/aethermind-upload.$(date -u +%s)$RANDOM"
server='joxy@31.77.226.26'
printf 'Коммит %s. На VPS сначала пройдут сборка и проверки. Введите пароль SSH-ключа и sudo.\n' "$sha"
ssh -o ConnectTimeout=20 -i "$key" "$server" "mkdir -m 700 '$remote_dir'"
scp -o ConnectTimeout=20 -i "$key" "$stage/source.tar.gz" "$server:$remote_dir/source.tar.gz"
git show "$sha:ops/ton-deploy.sh" > "$stage/ton-deploy.sh"
scp -o ConnectTimeout=20 -i "$key" "$stage/ton-deploy.sh" "$server:$remote_dir/ton-deploy.sh"
ssh -tt -o ConnectTimeout=20 -i "$key" "$server" "sudo bash '$remote_dir/ton-deploy.sh' '$remote_dir/source.tar.gz' '$sha' '$digest'; rc=\$?; rm -f -- '$remote_dir/source.tar.gz' '$remote_dir/ton-deploy.sh'; rmdir -- '$remote_dir'; exit \$rc"
printf '\nVPS обновлён: https://31.77.226.26/ . Проверьте перевод с аккаунта владельца и сохраните trace.\n'
