#!/usr/bin/env python3
"""Exercise the distribution gate against accidental source/secret disclosure."""
import importlib.util
import tempfile
import shutil
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('distribution', Path(__file__).with_name('verify-distribution.py'))
distribution = importlib.util.module_from_spec(spec)
spec.loader.exec_module(distribution)


class DistributionTests(unittest.TestCase):
    def test_application_license_and_attribution_ship_together_without_stale_copies(self):
        for frontend in [False, True]:
            with self.subTest(frontend=frontend), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                paths = {name: root / (f'{name}.txt' if frontend else name) for name in ['LICENSE', 'NOTICE']}
                for name, path in paths.items():
                    shutil.copyfile(distribution.PROJECT_ROOT / name, path)
                distribution.verify_project_notices(root, frontend)
                for name, path in paths.items():
                    with self.subTest(notice=name):
                        path.write_text('Outdated proprietary license or attribution')
                        with self.assertRaises(RuntimeError): distribution.verify_project_notices(root, frontend)
                        path.unlink()
                        with self.assertRaises(RuntimeError): distribution.verify_project_notices(root, frontend)
                        shutil.copyfile(distribution.PROJECT_ROOT / name, path)

    def test_accepts_third_party_cpp_exports(self):
        distribution.verify_symbols('000000010042c46c T __ZN16llama_model_lfm25graphILb0EEC1ERK11llama_modelRK16llm_graph_params', 'no-tipe-text')

    def test_rejects_rust_and_swift_symbols(self):
        for symbol in ['__ZN4test3foo17h1234567890abcdefE', '__Rsv_example', '_$s4test3fooyyF']:
            with self.subTest(symbol=symbol), self.assertRaises(RuntimeError):
                distribution.verify_symbols('000000010042c46c T ' + symbol, 'no-tipe-desktop')

    def test_rejects_source_debug_and_secret_files(self):
        for relative in ['assets/app.js.map', 'src/main.rs', '.env.production', 'signing.PEM', 'debug.DSYM/Contents/Info.plist', 'tool.py', 'publish.ps1']:
            with self.subTest(relative=relative), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('not for distribution')
                with self.assertRaises(RuntimeError):
                    distribution.verify_files(root)

    def test_rejects_disguised_private_key_and_inline_source_map(self):
        for content in ['-----BEGIN PRIVATE KEY-----\nsecret', '//# sourceMappingURL=data:application/json;base64,e30=']:
            with self.subTest(content=content), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                (root / 'app.js').write_text(content)
                with self.assertRaises(RuntimeError):
                    distribution.verify_files(root)

    def test_accepts_minified_assets_and_third_party_notices(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'app.js').write_text('const a=1;')
            (root / 'THIRD-PARTY-LICENSES.txt').write_text('Original third-party notices')
            distribution.verify_files(root)


if __name__ == '__main__':
    unittest.main()
