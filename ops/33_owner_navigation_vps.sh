#!/data/data/com.termux/files/usr/bin/bash
# Deploy the published owner-panel fix through the existing atomic VPS workflow.
set -Eeuo pipefail
trap 'printf "\nОбновление VPS не подтверждено (строка %s).\n" "$LINENO" >&2' ERR

repo="$HOME/gpunode"
[[ -d "$repo/.git" ]] || { echo 'Сначала выполните скрипт 32.' >&2; exit 1; }
cd "$repo"
[[ -f ops/31_language_vps.sh ]] || { echo 'Не найден действующий скрипт развёртывания.' >&2; exit 1; }
grep -Fq 'setItems([]);setTotal(0);setHasMore(false);' frontend/src/OwnerPanel.tsx || { echo 'Исправление панели владельца отсутствует. Сначала выполните скрипт 32.' >&2; exit 1; }
printf 'Отправляю на VPS опубликованный коммит с исправлением переключения вкладок.\n'
bash ops/31_language_vps.sh
printf '\nПроверьте: Управление → Заявки → Пользователи. Полностью закройте и снова откройте Mini App.\n'
