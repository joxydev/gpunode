"""Root-only interactive provisioning. Reads secrets from a real TTY, never stdin."""
import getpass
import grp
import json
import os
import pathlib
import re
import secrets
import subprocess
import sys
import urllib.request

if os.geteuid() != 0:
    raise SystemExit('Run settings through sudo.')
os.chdir('/')
envpath = pathlib.Path('/srv/apps/gpunode/shared/runtime.env')

def prompt(label):
    with open('/dev/tty', 'w') as out:
        out.write(label); out.flush()
    with open('/dev/tty', 'r') as inp:
        value = inp.readline()
    if not value:
        raise SystemExit('Нет интерактивного ввода. Запускайте через ssh -t.')
    return value.strip()

def telegram(token, method, payload=None):
    try:
        req = urllib.request.Request('https://api.telegram.org/bot'+token+'/'+method,
            data=json.dumps(payload or {}).encode(), headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(req, timeout=25) as response:
            result = json.load(response)
        if not result.get('ok'):
            raise ValueError()
        return result['result']
    except Exception:
        raise SystemExit('Telegram API недоступен или токен неверен. Токен не выводится.') from None

def query(sql):
    result = subprocess.run(['runuser','-u','postgres','--','psql','-v','ON_ERROR_STOP=1','-At','postgres'],
        input=sql,text=True,capture_output=True,cwd='/')
    if result.returncode:
        raise SystemExit('Ошибка настройки PostgreSQL. Проверьте его службу; секреты скрыты.')
    return result.stdout.strip()

values = {}
if envpath.exists():
    values = dict(line.split('=',1) for line in envpath.read_text().splitlines() if line and not line.startswith('#'))
    print('Использую сохранённые настройки gpunode (старый GPU Marketplace не читаю).')
token = values.get('BOT_TOKEN') or getpass.getpass('Токен бота из BotFather (скрыт): ')
if not re.fullmatch(r'[0-9]+:[A-Za-z0-9_-]{30,}',token):
    raise SystemExit('Неверный формат токена.')
bot = telegram(token,'getMe')
owner = values.get('OWNER_TELEGRAM_ID') or prompt('Ваш числовой Telegram ID: ')
if not re.fullmatch(r'[1-9][0-9]{0,15}',owner) or int(owner)==bot['id']:
    raise SystemExit('Укажите ID вашего аккаунта, а не ID бота.')
print('Бот: @'+bot['username']+'; владелец ID: '+owner)
emailfile=pathlib.Path('/etc/gpunode/acme-email')
email=emailfile.read_text().strip() if emailfile.exists() else prompt('Email для HTTPS-сертификата: ')
if not re.fullmatch(r'[A-Za-z0-9._+%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}',email):
    raise SystemExit('Неверный email.')
if not values:
    if query("SELECT datname FROM pg_database WHERE datname='aethermind_v1';") or query("SELECT rolname FROM pg_roles WHERE rolname='aethermind_v1';"):
        raise SystemExit('База или роль aethermind_v1 существует без настроек. Остановка без перезаписи.')
    password=secrets.token_hex(32)
    values={'NODE_ENV':'production','PORT':'3100','DATABASE_URL':f'postgresql://aethermind_v1:{password}@127.0.0.1:5432/aethermind_v1','SESSION_SECRET':secrets.token_hex(48),'BOT_WEBHOOK_SECRET':secrets.token_hex(32)}
    # Persist recovery credentials before DB creation; reruns recover only the dedicated role/database.
    values.update(BOT_TOKEN=token,OWNER_TELEGRAM_ID=owner,BOT_USERNAME=bot['username'],PUBLIC_URL='https://31.77.226.26')
    tmp=envpath.with_suffix('.pending')
    tmp.write_text(''.join(k+'='+v+'\n' for k,v in values.items()))
    os.chmod(tmp,0o640);os.chown(tmp,0,grp.getgrnam('deploy').gr_gid)
    tmp.replace(envpath)
values.update(BOT_TOKEN=token,OWNER_TELEGRAM_ID=owner,BOT_USERNAME=bot['username'],PUBLIC_URL='https://31.77.226.26')
from urllib.parse import urlparse
parsed=urlparse(values['DATABASE_URL'])
if parsed.username!='aethermind_v1' or parsed.hostname!='127.0.0.1' or parsed.path!='/aethermind_v1' or not re.fullmatch('[a-f0-9]{64}',parsed.password or ''):
    raise SystemExit('Неожиданный DATABASE_URL: остановка без изменения БД.')
if not query("SELECT rolname FROM pg_roles WHERE rolname='aethermind_v1';"):
    query("CREATE ROLE aethermind_v1 LOGIN PASSWORD '"+parsed.password+"' NOSUPERUSER NOCREATEDB NOCREATEROLE;")
if not query("SELECT datname FROM pg_database WHERE datname='aethermind_v1';"):
    query('CREATE DATABASE aethermind_v1 OWNER aethermind_v1;')
envpath.write_text(''.join(k+'='+v+'\n' for k,v in values.items()))
os.chmod(envpath,0o640);os.chown(envpath,0,grp.getgrnam('deploy').gr_gid)
emailfile.write_text(email+'\n');os.chmod(emailfile,0o600)
print('Секреты сохранены вне репозитория.')
