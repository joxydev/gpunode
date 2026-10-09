#!/usr/bin/env python3
"""Regression checks for inherited service flags, not production database fixtures."""
import importlib.util
import pathlib
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('public_runtime', pathlib.Path(__file__).with_name('public-runtime.py'))
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class PublicRuntimeTest(unittest.TestCase):
    def test_managed_assignments_are_unique_and_secrets_preserved(self):
        source = ('SESSION_SECRET=keep-this-private\nENABLE_ACCRUAL=false\n'
                  ' export ENABLE_ACCRUAL = false\n ENABLE_PURCHASES=false\n'
                  'ENABLE_COMPOUND=false\n# ENABLE_ACCRUAL=false\n')
        updated = runtime.rewrite_runtime(source)
        self.assertEqual(updated.count('\nENABLE_ACCRUAL=true\n'), 1)
        self.assertNotIn('export ENABLE_ACCRUAL', updated)
        self.assertIn('SESSION_SECRET=keep-this-private\n', updated)
        self.assertIn('ENABLE_COMPOUND=true\n', updated)
        self.assertNotIn('ENABLE_COMPOUND=false\n', updated)
        self.assertEqual(runtime.rewrite_runtime(updated), updated)

    def test_last_files_override_inherited_pause_files(self):
        properties = {
            'EnvironmentFiles': '/old.env (ignore_errors=no) /pause.env (ignore_errors=yes) '
                                '/runtime.env (ignore_errors=no) /flags.env (ignore_errors=no)',
            'UnsetEnvironment': 'PRIVATE_DEBUG ONLY_TEST=private',
        }
        with patch.object(runtime, 'property_value', side_effect=lambda _unit, key: properties[key]):
            runtime.assert_configuration('gpunode.service', '/runtime.env', '/flags.env')
            properties['EnvironmentFiles'] += ' /later-pause.env (ignore_errors=no)'
            with self.assertRaisesRegex(RuntimeError, 'another EnvironmentFile'):
                runtime.assert_configuration('gpunode.service', '/runtime.env', '/flags.env')

    def test_dropin_preserves_unrelated_removals_and_requires_preflight(self):
        output = runtime.render_dropin('/runtime.env', '/flags.env', '/opt/node', '/srv/check.mjs',
                                       'ENABLE_ACCRUAL ENABLE_PURCHASES=false PRIVATE_DEBUG ONLY_TEST=private')
        self.assertIn('EnvironmentFile=/runtime.env\nEnvironmentFile=/flags.env\n', output)
        self.assertIn('UnsetEnvironment=\nUnsetEnvironment="PRIVATE_DEBUG" "ONLY_TEST=private"\n', output)
        self.assertNotIn('ENABLE_ACCRUAL', output)
        self.assertIn('ExecStartPre=/opt/node /srv/check.mjs\n', output)

    def test_unset_reintroduced_later_is_detected(self):
        def value(_unit, key):
            return ('/runtime.env (ignore_errors=no) /flags.env (ignore_errors=no)' if key == 'EnvironmentFiles'
                    else 'PRIVATE_DEBUG ENABLE_ACCRUAL=false')
        with patch.object(runtime, 'property_value', side_effect=value):
            with self.assertRaisesRegex(RuntimeError, 'UnsetEnvironment'):
                runtime.assert_configuration('gpunode.service', '/runtime.env', '/flags.env')

    def test_process_diagnostics_never_show_secrets(self):
        raw = b'BOT_TOKEN=secret\0DATABASE_URL=postgresql://secret\0ENABLE_ACCRUAL=false\0ENABLE_PURCHASES=secret\0'
        parsed = runtime.process_flags(raw)
        self.assertEqual(runtime.safe_flags(parsed), {'ENABLE_ACCRUAL': 'false', 'ENABLE_PURCHASES': '[unexpected]'})

    def test_private_atomic_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / 'flags.env'
            runtime.atomic_write(path, 'ENABLE_ACCRUAL=true\n', 0o600)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(path.read_text(), 'ENABLE_ACCRUAL=true\n')
            self.assertEqual(list(path.parent.iterdir()), [path])


if __name__ == '__main__':
    unittest.main()
