#!/usr/bin/env python3
"""Reproducible static WASM build. Requires the Rust wasm target and matching wasm-bindgen CLI."""
import argparse
import gzip
import hashlib
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def run(*args, **kwargs):
    print('+', ' '.join(map(str, args)), flush=True)
    subprocess.run(list(map(str, args)), cwd=ROOT, check=True, **kwargs)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--skip-build', action='store_true', help='Package an already compiled web-release WASM')
    parser.add_argument('--assets-only', action='store_true', help='Refresh browser assets and service worker, reusing existing optimized dist/pkg bindings (JS/CSS-only changes)')
    parser.add_argument('--no-opt', action='store_true', help='Skip Binaryen optimization for iteration')
    parser.add_argument('--bindgen', default=os.environ.get('WASM_BINDGEN', 'wasm-bindgen'))
    parser.add_argument('--out-dir', type=Path, default=ROOT/'dist', help='Static output directory; use a separate directory while agents use an existing build')
    args = parser.parse_args()
    dist = args.out_dir.resolve()
    locked = re.search(r'name = "wasm-bindgen"\nversion = "([^"]+)"', (ROOT/'Cargo.lock').read_text())[1]
    try: installed = subprocess.check_output([args.bindgen, '--version'], text=True).strip().split()[-1]
    except (FileNotFoundError, subprocess.CalledProcessError): installed = None
    if installed != locked and args.bindgen == 'wasm-bindgen':
        # A project-local CLI avoids replacing another project's global binding tool.
        executable = 'wasm-bindgen.exe' if os.name == 'nt' else 'wasm-bindgen'
        for candidate in (ROOT/'target/web-tools').glob(f'wasm-bindgen-{locked}-*/{executable}'):
            version = subprocess.check_output([str(candidate), '--version'], text=True).strip().split()[-1]
            if version == locked:
                args.bindgen = str(candidate)
                installed = version
                break
    if installed != locked:
        parser.error(f'Install matching CLI: cargo install wasm-bindgen-cli --version {locked} --locked (or set WASM_BINDGEN)')
    if args.assets_only and not (dist/'pkg/desigma_app_bg.wasm').is_file():
        parser.error(f'--assets-only requires a previously completed WASM build in {dist}/pkg')
    if not args.skip_build and not args.assets_only:
        env = os.environ.copy()
        env['RUSTFLAGS'] = (env.get('RUSTFLAGS', '') + ' -C target-feature=+simd128').strip()
        run('cargo','build','--locked','-p','desigma-app','--lib','--target','wasm32-unknown-unknown','--no-default-features','--profile','web-release',env=env)
    dist.mkdir(parents=True, exist_ok=True)
    for path in (ROOT/'web').iterdir():
        if path.suffix in {'.js','.css','.html','.png','.webmanifest'} or path.name == '_headers': shutil.copy2(path, dist/path.name)
    # Ship the maintained plugin package and attribution with the editor for offline use.
    if (dist/'plugins').exists(): shutil.rmtree(dist/'plugins')
    shutil.copytree(ROOT/'plugins/shapes', dist/'plugins/shapes')
    if (dist/'licenses').exists(): shutil.rmtree(dist/'licenses')
    (dist/'licenses').mkdir()
    for name in ['LICENSE-MIT', 'LICENSE-APACHE', 'THIRD_PARTY_NOTICES.md', 'FORK.md']:
        shutil.copy2(ROOT/name, dist/'licenses'/name)
    shutil.copy2(ROOT/'crates/desigma-fonts/assets/inter/OFL.txt', dist/'licenses/Inter-OFL.txt')
    shutil.copy2(ROOT/'crates/desigma-fonts/assets/cjk/OFL.txt', dist/'licenses/FDE2E-UI-CJK-OFL.txt')
    shutil.copy2(ROOT/'crates/desigma-fonts/assets/cjk/README.md', dist/'licenses/FDE2E-UI-CJK-NOTICE.md')
    shutil.copy2(ROOT/'crates/desigma-app/assets/icons/lucide/LICENSE', dist/'licenses/Lucide-LICENSE')
    (dist/'tests').mkdir(exist_ok=True)
    for path in (ROOT/'web/tests').glob('browser-*.js'): shutil.copy2(path,dist/'tests'/path.name)
    if not args.assets_only:
        run(args.bindgen, ROOT/'target/wasm32-unknown-unknown/web-release/desigma_app.wasm','--target','web','--out-dir',dist/'pkg','--out-name','desigma_app','--no-typescript')
    wasm = dist/'pkg/desigma_app_bg.wasm'
    if not args.no_opt and not args.assets_only:
        optimizer = shutil.which('wasm-opt')
        if not optimizer: parser.error('wasm-opt is required for production builds; install Binaryen or pass --no-opt')
        # Keep Rust's modern WASM features and optimize hot paths without fast-math.
        run(optimizer,'-O3','--enable-simd','--enable-bulk-memory','--enable-nontrapping-float-to-int','--enable-mutable-globals','--enable-sign-ext',wasm,'-o',wasm.with_suffix('.opt.wasm'))
        wasm.with_suffix('.opt.wasm').replace(wasm)
    # Emit the exact schemas compiled into this build, without starting the UI.
    node_script = "import {readFileSync} from 'node:fs'; const {default:init,tool_catalog}=await import(process.argv[1]); await init({module_or_path:readFileSync(process.argv[2])}); process.stdout.write(tool_catalog());"
    catalog = subprocess.check_output(['node', '--input-type=module', '-e', node_script, (dist/'pkg/desigma_app.js').as_uri(), str(dist/'pkg/desigma_app_bg.wasm')], cwd=ROOT, text=True)
    (dist/'tools.json').write_text(json.dumps(json.loads(catalog),indent=2)+'\n')
    assets = sorted(p for p in dist.rglob('*') if p.is_file() and p.suffix not in {'.gz','.br'} and p.name not in {'sw.js','build.json','_headers'} and 'tests' not in p.relative_to(dist).parts)
    build_id = hashlib.sha256(b''.join(p.read_bytes() for p in assets)).hexdigest()[:16]
    urls = ['./' + p.relative_to(dist).as_posix() for p in assets]
    sw = f'''const CACHE = 'desigma-{build_id}';
const ASSETS = {json.dumps(urls)};
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('desigma-') && k !== CACHE).map(k => caches.delete(k))))));
self.addEventListener('fetch', e => {{
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(async c => {{
    const url = new URL(e.request.url); url.search = ''; url.hash = '';
    if (e.request.mode === 'navigate') return fetch(e.request).catch(() => c.match('./index.html'));
    return (await c.match(url.href)) || fetch(e.request);
  }}));
}});
'''
    (dist/'sw.js').write_text(sw)
    for path in [*assets, dist/'sw.js']:
        if path.suffix in {'.wasm','.js','.css','.html','.json'}:
            with gzip.GzipFile(filename='', mode='wb', fileobj=path.with_suffix(path.suffix+'.gz').open('wb'), mtime=0, compresslevel=9) as compressed: compressed.write(path.read_bytes())
    report = {'build':build_id,'wasm_bytes':wasm.stat().st_size,'wasm_gzip_bytes':wasm.with_suffix('.wasm.gz').stat().st_size,'assets':len(assets)}
    (dist/'build.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
    print('Serve: python3 scripts/serve-web.py')

if __name__ == '__main__': main()
