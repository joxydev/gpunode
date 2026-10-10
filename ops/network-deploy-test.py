#!/usr/bin/env python3
"""Local deployment fixtures; no production services or database are used."""
import datetime
import hashlib
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

OPS = pathlib.Path(__file__).resolve().parent


def run(name, *args):
    return subprocess.run([sys.executable, str(OPS / name), *map(str, args)], capture_output=True, text=True)


class DeployFixtures(unittest.TestCase):
    def test_publication_is_current_immutable_and_seven_utc_days(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            registry, flags = root / 'publication.json', root / 'flags.env'
            flags.write_text('ENABLE_PURCHASES=true\nNETWORK_PUBLISHED_AT=outdated\n')
            digest = 'a' * 64
            before = datetime.datetime.now(datetime.timezone.utc)
            first = run('network-publication.py', registry, flags, 'fixture-version', digest)
            self.assertEqual(first.returncode, 0, first.stderr)
            record = json.loads(registry.read_text())
            published = datetime.datetime.fromisoformat(record['publishedAt'].replace('Z', '+00:00'))
            effective = datetime.datetime.fromisoformat(record['effectiveAt'].replace('Z', '+00:00'))
            self.assertLessEqual(before - datetime.timedelta(seconds=1), published)
            self.assertLessEqual(published, datetime.datetime.now(datetime.timezone.utc))
            self.assertEqual(effective - published, datetime.timedelta(days=7))
            saved = registry.read_bytes(), flags.read_bytes()
            self.assertEqual(run('network-publication.py', registry, flags, 'fixture-version', digest).returncode, 0)
            self.assertEqual(saved, (registry.read_bytes(), flags.read_bytes()))
            self.assertNotEqual(run('network-publication.py', registry, flags, 'other-version', digest).returncode, 0)
            self.assertEqual(saved, (registry.read_bytes(), flags.read_bytes()))
            self.assertEqual(flags.stat().st_mode & 0o777, 0o600)

    def test_nginx_preserves_other_hosts_and_is_repeatable(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            enabled, backup = root / 'enabled', root / 'backup'
            enabled.mkdir(); backup.mkdir()
            other = 'server { server_name unrelated.invalid; root /srv/other; location / { try_files $uri =404; } }\n'
            app = 'server {\n root /srv/apps/gpunode/current/frontend/dist;\n # a comment with }\n add_header X-Fixture "brace { inside quotes";\n location / { try_files $uri /index.html; }\n}\n'
            config = enabled / 'app.conf'
            config.write_text(other + app)
            first = run('network-nginx.py', backup, enabled)
            self.assertEqual(first.returncode, 0, first.stderr)
            updated = config.read_text()
            self.assertTrue(updated.startswith(other))
            self.assertEqual(updated.count('BEGIN AETHERMIND NETWORK DOCUMENTS'), 1)
            self.assertIn('location = /documents/public-offer-aethermind.pdf { return 410; }', updated)
            self.assertIn('location ^~ /contracts/ { return 404; }', updated)
            self.assertEqual(run('network-nginx.py', backup, enabled).returncode, 0)
            self.assertEqual(config.read_text(), updated)

    def test_nginx_keeps_a_restore_manifest_before_partial_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            enabled, backup = root / 'enabled', root / 'backup'
            enabled.mkdir(); backup.mkdir()
            good = enabled / 'a.conf'; bad = enabled / 'z.conf'
            good.write_text('server { root /srv/apps/gpunode/current/frontend/dist; }')
            bad.write_text('server { root /srv/apps/gpunode/current/frontend/dist; location = /documents/public-offer-aethermind.pdf { return 403; } }')
            original = good.read_bytes()
            self.assertNotEqual(run('network-nginx.py', backup, enabled).returncode, 0)
            changes = json.loads((backup / 'nginx-changes.json').read_text())
            self.assertEqual(len(changes), 1)
            self.assertEqual(pathlib.Path(changes[0]['backup']).read_bytes(), original)

    def test_runtime_values_are_literal_and_output_is_redacted(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            env = root / 'runtime.env'
            marker = root / 'should-not-exist'
            env.write_text('SESSION_SECRET="$(touch ' + str(marker) + ')"\nPLAIN=first\n')
            flags = root / 'flags.env'; flags.write_text('PLAIN=second\n')
            result = run('run-runtime.py', root, env, flags, '--', sys.executable, '-c', 'import os; print(os.environ["SESSION_SECRET"]); print(os.environ["PLAIN"])')
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout, '[REDACTED]\nsecond\n')
            self.assertFalse(marker.exists())

    def test_remote_rejects_invalid_digest_before_deployment(self):
        remote = OPS / 'network-deploy-remote.sh'
        digest = hashlib.sha256(remote.read_bytes()).hexdigest()
        result = subprocess.run(['bash', str(remote), '/invalid/archive', '0' * 40, '0' * 64, digest], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('VPS: установка', result.stdout)


if __name__ == '__main__':
    unittest.main()
