#!/usr/bin/env python3
"""Check signed-release staging without uploading anything to GitHub."""
import importlib.util
import contextlib
import io
import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('release', Path(__file__).with_name('release-github.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
REPO = 'Darlingfxx02/no-tipe-releases'
PREFIX = f'https://api.github.com/repos/{REPO}/releases/assets/'


class ReleaseTests(unittest.TestCase):
    def test_developer_destination_is_private_and_never_the_stable_repo(self):
        repo = 'Darlingfxx02/no-tipe-dev-releases'
        for wrong in [REPO, 'Darlingfxx02/no-tipe']:
            with self.assertRaises(RuntimeError): release.verify_destination(wrong, channel='dev')
        remote = subprocess.CompletedProcess([], 0, 'git@github.com:Darlingfxx02/no-tipe.git', '')
        with patch.object(release.subprocess, 'run', return_value=remote):
            for public in [True, False]:
                metadata = subprocess.CompletedProcess([], 0, json.dumps({'private': not public}), '')
                with patch.object(release, 'run', return_value=metadata):
                    if public:
                        with self.assertRaises(RuntimeError): release.verify_destination(repo, allow_public=True, channel='dev')
                    else:
                        self.assertTrue(release.verify_destination(repo, channel='dev')['private'])

    def test_developer_build_preserves_stable_identity_and_has_separate_key(self):
        dev = release.build_config('dev', '0.1.10', True)
        stable = json.loads((release.ROOT / 'src-tauri/tauri.conf.json').read_text())
        self.assertEqual(dev['identifier'], 'app.no-tipe.desktop.dev')
        self.assertEqual(dev['productName'], 'No Type Dev')
        self.assertEqual(dev['mainBinaryName'], 'no-type-dev')
        self.assertEqual(dev['build']['features'], ['dev-channel'])
        self.assertNotEqual(dev['plugins']['updater']['pubkey'], stable['plugins']['updater']['pubkey'])
        self.assertEqual(stable['identifier'], 'app.no-tipe.desktop')
        current = json.loads((release.ROOT / 'src-tauri/tauri.dev.conf.json').read_text())['version']
        release.verify_source_version(current, channel='dev')
        with self.assertRaises(RuntimeError): release.verify_source_version('9.9.9', channel='dev')

    def test_release_requires_matching_frontend_native_and_bundle_versions(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'src-tauri').mkdir()
            (root / 'package.json').write_text(json.dumps({'version': '0.1.7'}))
            (root / 'src-tauri/tauri.conf.json').write_text(json.dumps({'version': '0.1.7'}))
            (root / 'src-tauri/Cargo.toml').write_text('[package]\nname = "no-tipe-desktop"\nversion = "0.1.7"\n')
            release.verify_source_version('0.1.7', root)
            with self.assertRaises(RuntimeError):
                release.verify_source_version('0.1.6', root)
            (root / 'src-tauri/Cargo.toml').write_text('[package]\nname = "no-tipe-desktop"\nversion = "0.1.6"\n')
            with self.assertRaises(RuntimeError):
                release.verify_source_version('0.1.7', root)

    def test_prebuilt_windows_installer_checks_version_hash_and_executable(self):
        with tempfile.TemporaryDirectory() as temporary:
            package = Path(temporary) / 'NoType_0.1.2_windows-x86_64-setup.exe'
            data = bytearray(128)
            data[:2] = b'MZ'
            data[60:64] = (64).to_bytes(4, 'little')
            data[64:68] = b'PE\x00\x00'
            package.write_bytes(data)
            digest = hashlib.sha256(data).hexdigest()
            self.assertEqual(release.verify_windows_package(package, '0.1.2', digest), package.resolve())
            for version, sha in [('0.1.1', digest), ('0.1.2', '0' * 64), ('0.1.2', None)]:
                with self.subTest(version=version, sha=sha), self.assertRaises(RuntimeError):
                    release.verify_windows_package(package, version, sha)
            for invalid in [b'not an installer', bytes(128), bytes(data[:64]) + b'bad!']:
                package.write_bytes(invalid)
                with self.assertRaises(RuntimeError):
                    release.verify_windows_package(package, '0.1.2', hashlib.sha256(invalid).hexdigest())

    def test_draft_is_found_when_the_tag_endpoint_returns_404(self):
        draft = {'id': 17, 'tag_name': 'v0.1.1', 'draft': True, 'assets': []}
        missing = subprocess.CompletedProcess([], 1, '', 'gh: Not Found (HTTP 404)')
        listing = subprocess.CompletedProcess([], 0, json.dumps([[draft]]), '')
        with patch.object(release.subprocess, 'run', side_effect=[missing, listing]):
            self.assertEqual(release.release_metadata(REPO, 'v0.1.1'), draft)
        with patch.object(release.subprocess, 'run', side_effect=[missing, listing]):
            self.assertIsNone(release.release_metadata(REPO, 'v0.1.2'))

    def test_windows_manifest_uses_private_asset_api_and_signature_contents(self):
        value = release.manifest('0.1.1', 'New build', 'windows-x86_64', 'signature\n', PREFIX + '12')
        self.assertEqual(value['platforms']['windows-x86_64'], {'signature': 'signature', 'url': PREFIX + '12'})
        release.validate_manifest(value, '0.1.1', REPO, [{'url': PREFIX + '12'}])

    def test_merging_windows_preserves_macos_and_rejects_other_version(self):
        previous = release.manifest('0.1.1', 'Notes', 'darwin-aarch64', 'mac signature', PREFIX + '11')
        value = release.manifest('0.1.1', 'Notes', 'windows-x86_64', 'win signature', PREFIX + '12', previous)
        self.assertEqual(set(value['platforms']), {'darwin-aarch64', 'windows-x86_64'})
        self.assertEqual(value['platforms']['darwin-aarch64'], previous['platforms']['darwin-aarch64'])
        self.assertNotIn('windows-x86_64', previous['platforms'])
        with self.assertRaises(RuntimeError):
            release.manifest('0.1.2', 'Notes', 'windows-x86_64', 'signature', PREFIX + '12', previous)

    def test_manifest_rejects_untrusted_or_missing_release_assets(self):
        for url in ['https://evil.test/package.exe', PREFIX + '12?redirect=other',
                    PREFIX.replace('https:', 'http:') + '12', PREFIX.replace(REPO, 'Darlingfxx02/no-tipe') + '12',
                    PREFIX.replace('api.github.com', 'user@api.github.com') + '12', PREFIX + '13']:
            with self.subTest(url=url):
                value = release.manifest('0.1.1', '', 'windows-x86_64', 'signature', url)
                with self.assertRaises(RuntimeError):
                    release.validate_manifest(value, '0.1.1', REPO, [{'url': PREFIX + '12'}])
        value = release.manifest('0.1.1', '', 'windows-x86_64', '', PREFIX + '12')
        with self.assertRaises(RuntimeError):
            release.validate_manifest(value, '0.1.1', REPO, [{'url': PREFIX + '12'}])

    def test_destination_rejects_source_and_public_repositories(self):
        with self.assertRaises(RuntimeError):
            release.verify_destination('Darlingfxx02/no-tipe')
        remote = subprocess.CompletedProcess([], 0, 'git@github.com:Darlingfxx02/no-tipe.git\n', '')
        metadata = subprocess.CompletedProcess([], 0, json.dumps({'private': False}), '')
        with patch.object(release.subprocess, 'run', return_value=remote), patch.object(release, 'run', return_value=metadata):
            with self.assertRaises(RuntimeError):
                release.verify_destination(REPO)
            self.assertEqual(release.verify_destination(REPO, allow_public=True), {'private': False})
            with self.assertRaises(RuntimeError):
                release.verify_destination('Darlingfxx02/no-tipe', allow_public=True)

    def stage(self, previous=None, publish=False, fail_upload=False):
        calls, uploaded = [], {}
        with tempfile.TemporaryDirectory() as temporary:
            package = Path(temporary) / 'setup.exe'
            package.write_bytes(b'installer bytes')
            signature = Path(str(package) + '.sig')
            signature.write_text('windows signature\n', encoding='utf-8')
            name = 'NoType_0.1.1_windows-x86_64-setup.exe'
            old = None if previous is None else {'draft': True, 'assets': [
                {'name': 'latest.json', 'url': PREFIX + '10'}, {'name': 'mac.app.tar.gz', 'url': PREFIX + '11'}]}
            after = {'draft': True, 'assets': [{'name': name, 'url': PREFIX + '12'},
                                              {'name': 'mac.app.tar.gz', 'url': PREFIX + '11'}]}

            def run(*args, **kwargs):
                calls.append(args)
                if args[:3] == ('gh', 'release', 'download'):
                    directory = Path(args[args.index('--dir') + 1])
                    (directory / 'latest.json').write_text(json.dumps(previous), encoding='utf-8')
                if args[:3] == ('gh', 'release', 'upload'):
                    if fail_upload:
                        raise subprocess.CalledProcessError(1, ['gh', 'release', 'upload'])
                    for value in args[4:args.index('--repo')]:
                        path = Path(value)
                        uploaded[path.name] = path.read_bytes()
                return subprocess.CompletedProcess([], 0, '', '')

            with contextlib.redirect_stdout(io.StringIO()), patch.object(release, 'verify_destination'), patch.object(release, 'release_metadata', side_effect=[old, after]), patch.object(release, 'run', side_effect=run):
                if fail_upload:
                    with self.assertRaises(subprocess.CalledProcessError):
                        release.upload_release(REPO, '0.1.1', 'Notes', 'windows-x86_64', package, signature, publish)
                else:
                    release.upload_release(REPO, '0.1.1', 'Notes', 'windows-x86_64', package, signature, publish)
        return calls, uploaded

    def test_new_windows_draft_does_not_publish(self):
        calls, uploaded = self.stage()
        self.assertTrue(any(call[:3] == ('gh', 'release', 'create') and '--draft' in call for call in calls))
        self.assertFalse(any(call[:3] == ('gh', 'release', 'edit') for call in calls))
        self.assertIn('NoType_0.1.1_windows-x86_64-setup.exe.sig', uploaded)
        value = json.loads(uploaded['latest.json'])
        self.assertEqual(value['platforms']['windows-x86_64']['url'], PREFIX + '12')

    def test_existing_draft_keeps_other_platform_before_publication(self):
        previous = release.manifest('0.1.1', 'Notes', 'darwin-aarch64', 'mac signature', PREFIX + '11')
        calls, uploaded = self.stage(previous, publish=True)
        self.assertFalse(any(call[:3] == ('gh', 'release', 'create') for call in calls))
        self.assertEqual(set(json.loads(uploaded['latest.json'])['platforms']), {'darwin-aarch64', 'windows-x86_64'})
        self.assertEqual(calls[-1][:3], ('gh', 'release', 'edit'))
        self.assertIn('--draft=false', calls[-1])

    def test_failed_upload_never_publishes(self):
        calls, uploaded = self.stage(publish=True, fail_upload=True)
        self.assertFalse(uploaded)
        self.assertFalse(any(call[:3] == ('gh', 'release', 'edit') for call in calls))

    def test_published_version_cannot_be_replaced(self):
        with patch.object(release, 'verify_destination'), patch.object(release, 'release_metadata', return_value={'draft': False}), patch.object(release, 'run') as run:
            with self.assertRaises(RuntimeError):
                release.upload_release(REPO, '0.1.1', '', 'windows-x86_64', Path('unused'), Path('unused.sig'), True)
            run.assert_not_called()

    def test_platform_resources_and_windows_install_modes(self):
        configs = release.ROOT / 'src-tauri'
        base = json.loads((configs / 'tauri.conf.json').read_text(encoding='utf-8'))
        mac = json.loads((configs / 'tauri.macos.conf.json').read_text(encoding='utf-8'))
        win = json.loads((configs / 'tauri.windows.conf.json').read_text(encoding='utf-8'))
        self.assertEqual(base['bundle']['license'], 'Apache-2.0')
        for name in ['LICENSE', 'NOTICE', 'THIRD-PARTY-NOTICES.md']:
            self.assertEqual(base['bundle']['resources'][f'../../{name}'], name)
        self.assertNotIn('platform/no-tipe-platform', base['bundle']['resources'])
        for resource in ['platform/no-tipe-platform', 'platform/libno-tipe-media.dylib', 'platform/mediaremote-run.pl', 'platform/MediaRemote-NOTICE.txt']:
            self.assertNotIn(resource, base['bundle']['resources'])
            self.assertIn(resource, mac['bundle']['resources'])
        self.assertEqual(win['bundle']['targets'], ['nsis'])
        self.assertEqual(win['bundle']['windows']['nsis']['installMode'], 'currentUser')
        self.assertEqual(win['plugins']['updater']['windows']['installMode'], 'passive')
        self.assertTrue(base['bundle']['createUpdaterArtifacts'])
        self.assertTrue(base['plugins']['updater']['requireSignedVersion'])


if __name__ == '__main__':
    unittest.main()
