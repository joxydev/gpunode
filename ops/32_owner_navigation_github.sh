#!/data/data/com.termux/files/usr/bin/bash
# Self-contained owner-panel fix for the published AetherMind main branch.
set -Eeuo pipefail
trap 'printf "\nПубликация не подтверждена (строка %s).\n" "$LINENO" >&2' ERR

base='d03a7461fc9be3f09781d58b5351f5b6ea288545'
expected='0433252fb9acee487c7d01800e39ae26b394aebc64d8e3904d746bb0fd68cf0e'
repo="$HOME/gpunode"
url='https://github.com/joxydev/gpunode.git'
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[[ -f "$source_dir/33_owner_navigation_vps.sh" ]] || { echo 'Положите скрипты 32 и 33 в одну директорию.' >&2; exit 1; }
command -v git >/dev/null || pkg install -y git
command -v sha256sum >/dev/null || pkg install -y coreutils

if [[ ! -d "$repo/.git" ]]; then
  [[ ! -e "$repo" ]] || { echo "Каталог $repo существует и не является git-репозиторием." >&2; exit 1; }
  git clone "$url" "$repo"
fi
cd "$repo"
[[ $(git remote get-url origin) == "$url" ]] || { echo 'Проверьте origin: требуется joxydev/gpunode.' >&2; exit 1; }
[[ -z $(git status --porcelain) ]] || { echo 'Есть локальные изменения. Сохраните их перед обновлением.' >&2; exit 1; }
git fetch origin main
git switch main
remote_sha=$(git rev-parse origin/main)
if git show origin/main:frontend/src/OwnerPanel.tsx | grep -Fq 'setItems([]);setTotal(0);setHasMore(false);'; then
  git merge --ff-only origin/main
  printf '\nИсправление уже опубликовано: %s. Запустите скрипт 33.\n' "$(git rev-parse HEAD)"
  exit 0
fi
[[ $remote_sha == "$base" ]] || { echo 'GitHub main изменился. Применять патч к неизвестному коммиту нельзя.' >&2; exit 1; }
if [[ $(git rev-parse HEAD) != "$base" ]]; then
  if git cat-file -e HEAD:ops/33_owner_navigation_vps.sh 2>/dev/null && git merge-base --is-ancestor origin/main HEAD; then
    if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then gh auth setup-git >/dev/null; fi
    git push origin main
    printf '\nОпубликован ранее собранный коммит %s.\n' "$(git rev-parse HEAD)"
    exit 0
  fi
  echo 'Локальная ветка отличается от проверенной базы. Автоматическое обновление остановлено.' >&2; exit 1
fi

patch_file=$(mktemp "$HOME/gpunode-owner.XXXXXXXX.patch")
trap 'rm -f -- "$patch_file"' EXIT
cat > "$patch_file" <<'AETHER_OWNER_PATCH'
diff --git a/frontend/src/OwnerPanel.tsx b/frontend/src/OwnerPanel.tsx
index 312d474..473b865 100644
--- a/frontend/src/OwnerPanel.tsx
+++ b/frontend/src/OwnerPanel.tsx
@@ -41,7 +41,16 @@ export default function OwnerPanel({onRefresh}:{onRefresh:()=>Promise<void>}){
  }
  useEffect(()=>{setItems([]);setUserDetail(null);setTicketDetail(null);void load();return()=>{version.current++}},[section,page,submittedQuery,status,category,payment]);
  useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState==='visible'&&(section==='overview'||section==='tickets'))void load(false)},20000);return()=>clearInterval(timer)},[section,page,status,category,payment]);
- function select(next:string){if(next===section||saving.current)return;setStatus('');setCategory('');setPayment('');setPage(0);setSection(next)}
+ function select(next:string){
+  if(next===section||saving.current)return;
+  // Clear the previous section in the same event as the tab change. Effects run
+  // after render; keeping request rows for that first users render crashes on name.slice().
+  version.current++;
+  setItems([]);setTotal(0);setHasMore(false);
+  setUserDetail(null);setTicketDetail(null);
+  setLoading(true);setError('');
+  setStatus('');setCategory('');setPayment('');setPage(0);setSection(next);
+ }
  async function requestChange(id:string,body:unknown){
   if(saving.current)return;saving.current=true;setBusy(true);setError('');setNotice('');
   try{await api('/admin/requests/'+id,body,'PATCH');setNotice(t('Заявка обновлена.'));await load(false);await onRefresh()}catch(e){setError((e as Error).message)}finally{saving.current=false;setBusy(false)}
AETHER_OWNER_PATCH
printf '%s  %s\n' "$expected" "$patch_file" | sha256sum --check --status || { echo 'Контрольная сумма исправления не совпала.' >&2; exit 1; }
git apply --check "$patch_file"
git branch "backup/before-owner-nav-$(date -u +%Y%m%dT%H%M%SZ)"
git apply "$patch_file"
cp -- "$source_dir/32_owner_navigation_github.sh" ops/32_owner_navigation_github.sh
cp -- "$source_dir/33_owner_navigation_vps.sh" ops/33_owner_navigation_vps.sh
bash -n ops/32_owner_navigation_github.sh ops/33_owner_navigation_vps.sh
git add frontend/src/OwnerPanel.tsx ops/32_owner_navigation_github.sh ops/33_owner_navigation_vps.sh
git diff --cached --check
git commit -m 'fix: clear owner lists before switching sections'
if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then gh auth setup-git >/dev/null; fi
git push origin main
printf '\nГОТОВО: GitHub обновлён, коммит %s.\nТеперь выполните bash "%s/33_owner_navigation_vps.sh".\n' "$(git rev-parse HEAD)" "$source_dir"
