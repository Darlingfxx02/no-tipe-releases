#!/usr/bin/env python3
"""Exercise the bundle rename and rollback without touching installed apps."""
import contextlib
import importlib.util
import io
import plistlib
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('installer', Path(__file__).with_name('install-macos.py'))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)
SIGNATURE = 'designated => identifier "app.no-tipe.desktop" and anchor apple generic and certificate leaf = H"1234"'


class RenameTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.app = self.root / 'Applications/No Type.app'
        self.old = self.root / 'Applications/No Tipe.app'
        self.source = self.root / 'build/No Type.app'
        self.agents = self.root / 'LaunchAgents'
        self.agents.mkdir()
        self.make_bundle(self.source, b'new executable')
        self.running = False
        self.fail_launch = False
        self.opened = []
        for name, value in [('APP', self.app), ('PREDECESSOR_APPS', (self.old,)), ('LAUNCH_AGENTS', self.agents)]:
            item = patch.object(installer, name, value)
            item.start()
            self.addCleanup(item.stop)
        for item in [patch.object(installer, 'verify', side_effect=self.verify),
                     patch.object(installer, 'run', side_effect=self.fake_run),
                     patch.object(installer, 'cleanup'),
                     patch.object(installer.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)),
                     patch('time.sleep')]:
            item.start()
            self.addCleanup(item.stop)

    def make_bundle(self, path, contents, signature=SIGNATURE):
        binary = path / 'Contents/MacOS/no-tipe-desktop'
        binary.parent.mkdir(parents=True)
        binary.write_bytes(contents)
        (path / 'Contents/Info.plist').write_bytes(plistlib.dumps({
            'CFBundleIdentifier': installer.IDENTIFIER,
            'CFBundleExecutable': binary.name,
            'test-signature': signature,
        }))

    def verify(self, path, allow_legacy=False):
        return plistlib.loads((path / 'Contents/Info.plist').read_bytes())['test-signature']

    def fake_run(self, *args, **kwargs):
        output = ''
        if args[0] == 'ditto':
            shutil.copytree(args[1], args[2])
        elif args[0] == 'ps' and self.running:
            output = f'999999 {installer.executable(self.app)}\n'
        elif args[0] == 'open':
            self.opened.append(args[1])
            if self.fail_launch:
                (self.agents / 'No Type.plist').write_bytes(b'failed new entry')
                raise RuntimeError('Launch failed')
            self.running = True
        return subprocess.CompletedProcess(args, 0, output, '')

    def install(self):
        with contextlib.redirect_stdout(io.StringIO()):
            installer.install(self.source)

    def test_rename_keeps_one_app_and_retires_only_its_old_login_item(self):
        self.make_bundle(self.old, b'old executable')
        data = self.root / 'user-data.sqlite3'
        data.write_bytes(b'library remains intact')
        agent = self.agents / 'No Tipe.plist'
        agent.write_bytes(plistlib.dumps({'Label': 'No Tipe', 'ProgramArguments': [str(installer.executable(self.old))]}))
        self.install()
        self.assertEqual(installer.executable(self.app).read_bytes(), b'new executable')
        self.assertFalse(self.old.exists())
        self.assertFalse(agent.exists())
        self.assertEqual(data.read_bytes(), b'library remains intact')
        self.assertEqual(list(self.app.parent.iterdir()), [self.app])

    def test_failed_launch_restores_both_preexisting_bundles_and_login_item(self):
        self.make_bundle(self.app, b'current executable')
        self.make_bundle(self.old, b'predecessor executable')
        login = self.agents / 'No Type.plist'
        login.write_bytes(b'previous login entry')
        self.fail_launch = True
        with self.assertRaisesRegex(RuntimeError, 'Launch failed'):
            self.install()
        self.assertEqual(installer.executable(self.app).read_bytes(), b'current executable')
        self.assertEqual(installer.executable(self.old).read_bytes(), b'predecessor executable')
        self.assertEqual(login.read_bytes(), b'previous login entry')

    def test_failed_first_move_never_deletes_the_installed_app(self):
        self.make_bundle(self.app, b'current executable')
        original = Path.rename
        def rename(path, destination):
            if path == self.app:
                raise PermissionError('Cannot move installed app')
            return original(path, destination)
        with patch.object(Path, 'rename', rename), self.assertRaises(PermissionError):
            self.install()
        self.assertEqual(installer.executable(self.app).read_bytes(), b'current executable')

    def test_changed_certificate_is_rejected_before_any_installed_bundle_moves(self):
        self.make_bundle(self.old, b'old executable', SIGNATURE.replace('1234', '5678'))
        with self.assertRaisesRegex(RuntimeError, 'Signing identity changed'):
            self.install()
        self.assertEqual(installer.executable(self.old).read_bytes(), b'old executable')
        self.assertFalse(self.app.exists())

    def test_unrelated_login_item_with_the_same_name_is_not_retired(self):
        agent = self.agents / 'No Tipe.plist'
        agent.write_bytes(plistlib.dumps({'Label': 'No Tipe', 'ProgramArguments': ['/unrelated/program']}))
        installer.retire_predecessor_login_item()
        self.assertTrue(agent.exists())


class ChannelIsolationTests(unittest.TestCase):
    def tearDown(self):
        installer.configure_channel('stable')

    def test_developer_cleanup_keeps_stable_bundles_and_has_no_predecessor(self):
        installer.configure_channel('dev')
        self.assertEqual(installer.APP, Path('/Applications/No Type Dev.app'))
        self.assertEqual(installer.PREDECESSOR_APPS, ())
        self.assertEqual(installer.MANAGED_IDENTIFIERS, {'app.no-tipe.desktop.dev'})
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name, identity in [('No Type', 'app.no-tipe.desktop'), ('No Type Dev', 'app.no-tipe.desktop.dev')]:
                contents = root / (name + '.app') / 'Contents'
                contents.mkdir(parents=True)
                (contents / 'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier': identity}))
            result = subprocess.CompletedProcess([], 0, '', '')
            with patch.object(installer, 'MANAGED', [root]), patch.object(installer, 'run', return_value=result), patch.object(installer.subprocess, 'run', return_value=result), contextlib.redirect_stdout(io.StringIO()):
                installer.cleanup()
            self.assertTrue((root / 'No Type.app').is_dir())
            self.assertFalse((root / 'No Type Dev.app').exists())

    def test_developer_install_refuses_a_stable_bundle_before_codesign(self):
        installer.configure_channel('dev')
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'Contents').mkdir()
            (root / 'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier': 'app.no-tipe.desktop'}))
            with patch.object(installer, 'run') as run, self.assertRaisesRegex(RuntimeError, 'Unexpected application identifier'):
                installer.verify(root, allow_legacy=True)
            run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
