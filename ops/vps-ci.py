#!/usr/bin/env python3
"""Run migrations and the real HTTP suite on disposable PostgreSQL."""
import os
import pathlib
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tempfile

release = pathlib.Path(sys.argv[1]).resolve()
if os.geteuid() == 0:
    raise SystemExit('Run VPS CI as the unprivileged deploy user')
if not (release / 'backend/dist/main.js').is_file():
    raise SystemExit('Build the release before integration tests')

bins = sorted(
    pathlib.Path('/usr/lib/postgresql').glob('*/bin/initdb'),
    key=lambda path: int(path.parent.parent.name),
)
if not bins:
    raise SystemExit('PostgreSQL server binaries not found')
pg = bins[-1].parent

def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]

ci_root = pathlib.Path(tempfile.mkdtemp(prefix='gpunode-ci-', dir='/var/tmp'))
data = ci_root / 'data'
started = False
env = {key: os.environ[key] for key in ('PATH', 'HOME', 'LANG') if key in os.environ}
env.update({'NODE_OPTIONS': '--max-old-space-size=256', 'PGCONNECT_TIMEOUT': '10'})

def run(args, timeout=180):
    child = subprocess.Popen([str(item) for item in args], cwd=release, env=env, start_new_session=True)
    try:
        code = child.wait(timeout=timeout)
        if code:
            raise subprocess.CalledProcessError(code, args)
    except BaseException:
        try:
            os.killpg(child.pid, signal.SIGTERM)
            child.wait(timeout=5)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            pass
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        child.wait()
        raise

def interrupted(_signum, _frame):
    raise KeyboardInterrupt('VPS CI interrupted')

for sig in (signal.SIGTERM, signal.SIGHUP):
    signal.signal(sig, interrupted)

try:
    password = secrets.token_hex(24)
    password_file = ci_root / 'password'
    password_file.write_text(password + '\n')
    password_file.chmod(0o600)
    db_port, api_port = free_port(), free_port()
    while api_port == db_port:
        api_port = free_port()
    run([pg / 'initdb', '-D', data, '-U', 'aether_ci', '--pwfile=' + str(password_file), '--auth-local=trust', '--auth-host=scram-sha-256', '--encoding=UTF8', '--no-locale'])
    run([pg / 'pg_ctl', '-D', data, '-l', ci_root / 'postgres.log', '-w', '-t', '30', '-o', f'-h 127.0.0.1 -p {db_port} -k {ci_root} -c shared_buffers=16MB -c max_connections=12 -c work_mem=2MB', 'start'])
    started = True
    run([pg / 'createdb', '-h', ci_root, '-p', str(db_port), '-U', 'aether_ci', 'aethermind_ci'])
    env.update({
        'DATABASE_URL': f'postgresql://aether_ci:{password}@127.0.0.1:{db_port}/aethermind_ci',
        'CI_INTEGRATION': '1',
        'CI_PORT': str(api_port),
        'BOT_TOKEN': '123456:TEST_TOKEN_NOT_A_REAL_CREDENTIAL',
        'BOT_USERNAME': 'aethermind_ci_bot',
        'OWNER_TELEGRAM_ID': '11111',
        'SESSION_SECRET': secrets.token_hex(32),
        'BOT_WEBHOOK_SECRET': secrets.token_hex(24),
        'PUBLIC_URL': 'https://example.invalid',
        'APP_COMMIT': 'vps-ci-' + secrets.token_hex(16),
    })
    run(['npm', 'run', 'db:migrate'])
    run(['node', '--check', 'ops/integration.mjs'])
    run(['node', 'ops/integration.mjs'])
    print('VPS CI PASSED: migrations + Nest/Prisma HTTP suite on isolated PostgreSQL.', flush=True)
finally:
    if started or (data / 'postmaster.pid').exists():
        result = subprocess.run([str(pg / 'pg_ctl'), '-D', str(data), '-m', 'immediate', '-w', '-t', '15', 'stop'], env=env, timeout=25)
        if result.returncode != 0:
            raise SystemExit('Temporary PostgreSQL could not stop; retained: ' + str(ci_root))
    shutil.rmtree(ci_root)
