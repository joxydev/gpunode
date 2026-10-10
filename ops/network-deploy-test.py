#!/usr/bin/env python3
"""Local deployment fixtures; no production services or database are used."""
import datetime
import hashlib
import json
import importlib.util
import pathlib
import subprocess
import sys
import tempfile
import unittest

OPS = pathlib.Path(__file__).resolve().parent
catalog_spec = importlib.util.spec_from_file_location('network_catalog', OPS / 'network-catalog-check.py')
catalog_check = importlib.util.module_from_spec(catalog_spec)
catalog_spec.loader.exec_module(catalog_check)


def run(name, *args):
    return subprocess.run([sys.executable, str(OPS / name), *map(str, args)], capture_output=True, text=True)


class DeployFixtures(unittest.TestCase):
    def catalog_fixture(self, root, limits=(1, 1, 1)):
        rows = []
        for (ident, values), limit in zip(catalog_check.EXPECTED.items(), limits):
            _, price, days, base, compound, reference, _ = values
            rows.append([ident, price, str(days), base, compound, reference,
                         't', 'f', 't', '95', '83', str(limit), '12'])
        file = root / 'catalog.txt'
        file.write_text('\n'.join('|'.join(row) for row in rows) + '\n')
        return file, rows

    def test_catalog_legacy_limits_are_allowed_only_before_migration(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            file, _ = self.catalog_fixture(root, (5, 3, 2))
            original = file.read_bytes()
            with self.assertRaisesRegex(ValueError, "Node Alpha: max_per_user='5', ожидается 1"):
                catalog_check.validate(file)
            messages = catalog_check.validate(file, allow_legacy_limits=True)
            self.assertEqual(sum('прежний max_per_user=' in line for line in messages), 3)
            self.assertEqual(file.read_bytes(), original)
            file, _ = self.catalog_fixture(root)
            self.assertEqual(len(catalog_check.validate(file)), 3)

    def test_catalog_compares_exact_numbers_and_reports_every_mismatch(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            file, rows = self.catalog_fixture(root)
            rows[0][1], rows[0][3], rows[0][4] = '50', '1.5000', '1.8'
            file.write_text('\n'.join('|'.join(row) for row in rows))
            self.assertEqual(len(catalog_check.validate(file)), 3)
            rows[0][1], rows[1][3], rows[2][5] = '50.01', '2.51', 'unapproved'
            file.write_text('\n'.join('|'.join(row) for row in rows))
            result = run('network-catalog-check.py', file, '--allow-legacy-limits')
            self.assertNotEqual(result.returncode, 0)
            for expected in ("price_usdt='50.01'", "daily_yield_percent='2.51'", "contract_reference='unapproved'"):
                self.assertIn(expected, result.stderr)

    def test_catalog_preserves_and_checks_inventory_even_with_legacy_limits(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            file, rows = self.catalog_fixture(root, (5, 3, 2))
            for field, invalid in ((10, '84'), (9, '-1'), (10, '-1'), (12, '-1'), (11, '0'), (8, 'other'), (1, 'NaN'), (4, 'Infinity')):
                with self.subTest(field=field, invalid=invalid):
                    original = rows[0][field]
                    rows[0][field] = invalid
                    file.write_text('\n'.join('|'.join(row) for row in rows))
                    before = file.read_bytes()
                    self.assertNotEqual(run('network-catalog-check.py', file, '--allow-legacy-limits').returncode, 0)
                    self.assertEqual(file.read_bytes(), before)
                    rows[0][field] = original

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
