"""Regression coverage for upstream merges restoring product copy or assets."""
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('branding', Path(__file__).resolve().parents[1] / 'check-branding.py')
branding = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(branding)


class BrandingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        names = list(branding.REQUIRED) + ['web/manifest.webmanifest', '.github/branding.json']
        names.extend(json.loads((branding.ROOT / '.github/branding.json').read_text())['icons'])
        for name in names:
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(branding.ROOT / name, target)

    def test_current_identity_allows_required_legal_and_compatibility_references(self):
        (self.root / 'LICENSE-MIT').write_text('Copyright (c) Deep Founder and the desigma contributors')
        (self.root / 'crates/desigma-app/src/io.rs').write_text('let uti = "ai.deepfounder.desigma.document";')
        (self.root / 'web/menu.js').write_text('const title = "FDE2E Desigma on GitHub";')
        self.assertEqual(branding.check(self.root), [])

    def test_upstream_links_in_new_application_files_are_rejected(self):
        path = self.root / 'web/new-help.js'
        path.write_text('const support = "https://github.com/deepfounder-ai/desigma/issues";')
        self.assertTrue(any('new-help.js:1' in error for error in branding.check(self.root)))

    def test_old_assets_and_distribution_materials_are_rejected(self):
        (self.root / 'web/icon.png').write_bytes(b'upstream artwork')
        (self.root / 'marketing').mkdir()
        errors = branding.check(self.root)
        self.assertTrue(any('web/icon.png' in error for error in errors))
        self.assertTrue(any('marketing' in error for error in errors))

    def test_restored_installed_app_name_is_rejected(self):
        (self.root / 'web/manifest.webmanifest').write_text('{"name":"Desigma","short_name":"Desigma"}')
        self.assertTrue(any('installed app name' in error for error in branding.check(self.root)))
