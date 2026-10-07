#!/usr/bin/env python3
"""Bind public release flags to all three services; expose only allowed values."""
import argparse
import json
import os
import pathlib
import re
import shlex
import subprocess
import sys
import tempfile

OPS = pathlib.Path(__file__).resolve().parent
FLAGS = json.loads((OPS / 'public-runtime-flags.json').read_text())
UNITS = ('gpunode.service', 'gpunode-ton-watcher.service', 'gpunode-epoch-settle.service')
DROPIN = 'zzzz-aethermind-public-runtime.conf'


def expected_flags(commit):
    if not re.fullmatch('[0-9a-f]{40}', commit):
        raise ValueError('Invalid release commit')
    return {**FLAGS, 'APP_COMMIT': commit}


def atomic_write(path, content, mode, uid=None, gid=None):
    path = pathlib.Path(path)
    fd, name = tempfile.mkstemp(dir=path.parent, prefix=path.name + '.')
    try:
        with os.fdopen(fd, 'w') as file:
            file.write(content)
        os.chmod(name, mode)
        if uid is not None:
            os.chown(name, uid, gid)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def rewrite_runtime(source):
    # Canonicalize managed assignments, including old whitespace/export forms.
    output = []
    for line in source.splitlines():
        match = re.match(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=', line)
        if not match or match[1] not in FLAGS:
            output.append(line)
    output.extend(key + '=' + value for key, value in FLAGS.items())
    return '\n'.join(output) + '\n'


def kept_unsets(source):
    controlled = {*FLAGS, 'APP_COMMIT'}
    return [item for item in shlex.split(source) if item.split('=', 1)[0] not in controlled]


def systemd_quote(value):
    # Unit directives expand specifiers; preserve literal '%' in retained values.
    return json.dumps(value.replace('%', '%%'), ensure_ascii=True)


def render_dropin(envfile, flagfile, node, checker, unset):
    for path in (envfile, flagfile, node, checker):
        if not re.fullmatch(r'/[A-Za-z0-9_./-]+', str(path)):
            raise ValueError('Unexpected service path')
    lines = ['# Managed by AetherMind public runtime', '[Service]',
             f'EnvironmentFile={envfile}', f'EnvironmentFile={flagfile}',
             'UnsetEnvironment=']
    remaining = kept_unsets(unset)
    if remaining:
        lines.append('UnsetEnvironment=' + ' '.join(map(systemd_quote, remaining)))
    lines.append(f'ExecStartPre={node} {checker}')
    return '\n'.join(lines) + '\n'


def property_value(unit, name):
    return subprocess.check_output(['systemctl', 'show', unit, '-p', name, '--value'],
                                   text=True, stderr=subprocess.PIPE, timeout=10).strip()


def environment_paths(source):
    return re.findall(r'(\S+) \(ignore_errors=(?:yes|no)\)', source)


def assert_configuration(unit, envfile, flagfile):
    paths = environment_paths(property_value(unit, 'EnvironmentFiles'))
    if paths[-2:] != [envfile, flagfile]:
        raise RuntimeError(f'{unit}: another EnvironmentFile overrides public runtime')
    unset = shlex.split(property_value(unit, 'UnsetEnvironment'))
    if any(item.split('=', 1)[0] in {*FLAGS, 'APP_COMMIT'} for item in unset):
        raise RuntimeError(f'{unit}: public runtime flag is removed by UnsetEnvironment')


def process_flags(raw):
    allowed = {*FLAGS, 'APP_COMMIT'}
    result = {}
    for item in raw.split(b'\0'):
        key, sep, value = item.partition(b'=')
        decoded = key.decode('utf8', errors='replace')
        if sep and decoded in allowed:
            result[decoded] = value.decode('utf8', errors='replace')
    return result


def safe_flags(values):
    allowed_values = {'true', 'false', 'public', 'disabled', 'canary', FLAGS['OFFER_PUBLISHED_AT']}
    return {key: value if value in allowed_values or
            (key == 'APP_COMMIT' and re.fullmatch('[0-9a-f]{40}', value)) else '[unexpected]'
            for key, value in values.items()}


def inspect_process(unit, commit=None):
    pid = property_value(unit, 'MainPID')
    values = {}
    if pid.isdecimal() and int(pid) > 0:
        values = process_flags(pathlib.Path(f'/proc/{pid}/environ').read_bytes())
    print(unit + ': ' + json.dumps(safe_flags(values), sort_keys=True), flush=True)
    if commit is not None:
        expected = expected_flags(commit)
        mismatch = [key for key, value in expected.items() if values.get(key) != value]
        if mismatch:
            raise RuntimeError(unit + ': incorrect live environment: ' + ', '.join(mismatch))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=('install', 'verify', 'inspect', 'live'))
    parser.add_argument('--envfile', default='/srv/apps/gpunode/shared/runtime.env')
    parser.add_argument('--flagfile', default='/srv/apps/gpunode/shared/public-release.env')
    parser.add_argument('--commit')
    parser.add_argument('--node')
    args = parser.parse_args()
    if args.action == 'install':
        if os.geteuid() != 0:
            raise RuntimeError('Root required to install public runtime')
        flags = expected_flags(args.commit or '')
        checker = OPS / 'public-runtime-check.mjs'
        # Gather inherited removals before changing any service files.
        inherited = {unit: property_value(unit, 'UnsetEnvironment') for unit in UNITS}
        envfile = pathlib.Path(args.envfile)
        stat = envfile.stat()
        atomic_write(envfile, rewrite_runtime(envfile.read_text()), stat.st_mode & 0o777,
                     stat.st_uid, stat.st_gid)
        atomic_write(args.flagfile, ''.join(f'{key}={value}\n' for key, value in flags.items()),
                     0o600, 0, 0)
        for unit in UNITS:
            directory = pathlib.Path('/etc/systemd/system') / (unit + '.d')
            directory.mkdir(mode=0o755, parents=True, exist_ok=True)
            atomic_write(directory / DROPIN,
                         render_dropin(args.envfile, args.flagfile, args.node, checker,
                                       inherited[unit]), 0o644, 0, 0)
    elif args.action == 'verify':
        for unit in UNITS:
            assert_configuration(unit, args.envfile, args.flagfile)
        print('Systemd public runtime bindings: API, TON watcher and Epoch OK')
    else:
        for unit in UNITS[:2]:
            inspect_process(unit, args.commit if args.action == 'live' else None)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, RuntimeError, OSError, subprocess.SubprocessError) as error:
        # Error text never contains environment contents or database credentials.
        if isinstance(error, (ValueError, RuntimeError)):
            print(str(error), file=sys.stderr)
        else:
            print('Public runtime inspection/installation failed: ' + type(error).__name__,
                  file=sys.stderr)
        raise SystemExit(1)
