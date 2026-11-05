#!/usr/bin/env python3
"""Reject accidental restoration of upstream product branding during engine merges."""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# Identity and provenance are reviewed changes, not rewritten by synchronization.
REQUIRED = {
    'README.md': '# FDE2E Desigma',
    'web/index.html': '<title>FDE2E Desigma — Browser editor</title>',
    'crates/desigma-app/src/theme.rs': 'APP_TITLE: &str = "FDE2E Desigma"',
    'crates/desigma-app/src/home/mod.rs': 'GITHUB_URL: &str = "https://github.com/jixoai/desigma"',
    'crates/desigma-app/src/plugins/store.rs': 'REPOSITORY: &str = "jixoai/desigma"',
    'crates/desigma-app/src/home/sidebar.rs': 'Icon::Link, "WebMCP"',
    'crates/desigma-app/src/panels/menus.rs': 'leaf("WebMCP…", "", Action::Mcp)',
    'Cargo.toml': 'repository = "https://github.com/jixoai/desigma"',
}
REMOVED = ('marketing', 'docs/images', 'packaging', 'scripts/windows', 'scripts/package.sh', 'scripts/package-macos.sh', 'scripts/package-windows-installer.sh')
# Legal sources and actual old measurement data stay intact; native UTI is a format ID.
EXEMPT = {'docs/browser-validation.json', 'docs/browser-performance.json'}
LEGACY_UTI = 'ai.deepfounder.desigma.document'
BAD_COPY = re.compile(r'deep[\s-]?founder|\bMarlow\b|About desigma|(?<!FDE2E )desigma on GitHub|desigma is a free, open-source design editor', re.I)


def check(root=ROOT):
    errors = []
    for name, expected in REQUIRED.items():
        path = root / name
        if not path.is_file() or expected not in path.read_text():
            errors.append(f'{name}: missing FDE2E product identity')
    for name in REMOVED:
        if (root / name).exists(): errors.append(f'{name}: removed upstream distribution material restored')
    paths = [root / name for name in ['README.md', 'CONTRIBUTING.md', 'TRADEMARKS.md', 'PLAN.md', 'Cargo.toml']]
    for folder in ['web', 'plugins', 'docs', 'crates/desigma-app/src', 'crates/desigma-app/assets/i18n']:
        paths.extend((root / folder).rglob('*'))
    for path in paths:
        name = path.relative_to(root).as_posix()
        if not path.is_file() or 'node_modules' in path.parts or name in EXEMPT or name == 'docs/upstream-sync.md': continue
        if path.suffix not in {'.rs', '.js', '.html', '.md', '.tsv', '.toml', '.json', '.webmanifest'}: continue
        for number, line in enumerate(path.read_text().splitlines(), 1):
            # This is a retained document type identifier, never a product/contact URL.
            if name == 'crates/desigma-app/src/io.rs': line = line.replace(LEGACY_UTI, '')
            if BAD_COPY.search(line): errors.append(f'{name}:{number}: upstream product copy or link')
    try:
        manifest = json.loads((root / 'web/manifest.webmanifest').read_text())
        if manifest['name'] != 'FDE2E Desigma' or manifest['short_name'] != 'FDE2E Desigma': errors.append('web/manifest.webmanifest: wrong installed app name')
        expected = json.loads((root / '.github/branding.json').read_text())['icons']
        for name, digest in expected.items():
            path = root / name
            if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != digest: errors.append(f'{name}: product icon differs from reviewed FDE2E asset')
    except (OSError, ValueError, KeyError) as error:
        errors.append(f'Brand configuration missing or invalid: {error}')
    return errors


if __name__ == '__main__':
    errors = check()
    if errors: raise SystemExit('\n'.join(errors))
    print('FDE2E Desigma branding and distribution scope verified.')
