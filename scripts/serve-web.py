#!/usr/bin/env python3
"""Static-only local server: correct WASM MIME, isolation headers, no application backend."""
import argparse
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.wasm': 'application/wasm', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json'}
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'credentialless')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Permissions-Policy', 'tools=(self)')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8080)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--dir', default=str(Path(__file__).resolve().parents[1] / 'dist'))
    args = parser.parse_args()
    if not Path(args.dir, 'pkg', 'desigma_app_bg.wasm').is_file():
        parser.error('Build first with python3 scripts/build-web.py')
    server = ThreadingHTTPServer((args.host, args.port), functools.partial(Handler, directory=args.dir))
    print(f'FDE2E Desigma: http://{args.host}:{args.port}', flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: server.server_close()
