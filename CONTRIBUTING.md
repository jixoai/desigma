# Contributing to FDE2E Desigma

FDE2E Desigma maintains the browser application on `browser-wasm`. Shared Rust sources remain in this tree to keep engine updates manageable; desktop compatibility, installers and releases are outside this fork’s support scope. Sources and licensing are documented in [FORK.md](FORK.md).

## Build and run

Use the pinned Rust toolchain and WASM target from `rust-toolchain.toml`, Node 22+, Python 3.11+, Binaryen, and the wasm-bindgen CLI matching `Cargo.lock`.

```sh
python3 scripts/build-web.py
python3 scripts/serve-web.py --port 8080
```

Open <http://127.0.0.1:8080/?dev=1>. See [browser.md](docs/browser.md) for tool installation, fixtures, WebMCP and optional signaling. No native windowing SDK is needed to build the WASM application.

## Validate changes

```sh
python3 scripts/sync-upstream.py scope
python3 scripts/check-branding.py
cargo fmt --all --check
cargo clippy --locked -p desigma-app --lib --target wasm32-unknown-unknown --no-default-features -- -D warnings
npm ci --prefix web --ignore-scripts
npm test --prefix web
npm ci --prefix web/signaling --ignore-scripts
npm test --prefix web/signaling
python3 -m unittest discover -s scripts/tests -v
python3 scripts/build-web.py
```

`python3 scripts/sync-upstream.py check` runs the same local validation and optimized build. The browser workflow checks the WASM build, browser adapters, sync behavior, maintenance scope, product branding and compressed bundle budget. It uploads the complete static application as `desigma-browser`.

For behavior changes, run the browser smoke and relevant recovery/storage/benchmark scripts in an isolated editor tab. Verify WebGPU and WebGL fallback when rendering changes, and keep the canvas focused throughout frame measurements. Check real browser interactions and document recovery before approving upstream sync PRs. The current browser scripts and examples are documented in [browser.md](docs/browser.md#checks).

## Code boundaries

Keep document, editing, layout, rendering and import/export behavior in the existing shared Rust engines. Edits must use transactions and the Undo stack. Browser-specific storage, networking, dialogs, plugins and task scheduling belong in `desigma-platform`, `desigma-app/src/web/` and `web/`.

Use `desigma_platform::fs`, `PathExt` and `web_time` in browser-reachable code. Gate inherited native libraries by target. Keep MCP schema changes compatible with the shared catalog and browser dispatcher. Do not introduce a second document model or a reduced editor just for the browser.

Format the files you change, keep rendering deterministic, and add behavior tests for consequential changes. Preserve the licenses and attribution of test documents and assets; do not commit private design files or generated build output.

## Product design ownership

Design explorations for other products belong in those products’ repositories. Keep candidate status and Owner decisions explicit; a prototype check or Git commit does not approve a design. Store editable sources, attribution and a small set of review previews there, and rebuild large exports outside Git.

Use minimal licensed fixtures when an editor regression needs a design example. Generic fixes to fonts, rendering, storage and WebMCP remain in Desigma, with the evidence and attribution needed to maintain them.

## Upstream updates and commits

Use feature branches based on `browser-wasm`. `main` is only an upstream mirror. Read [upstream-sync.md](docs/upstream-sync.md) before merging upstream, especially changes to the original entry point, platform calls or dependency locks.

Keep commit subjects short and concrete. Preserve upstream ancestry with merge commits for synchronization PRs. Never force-push the published maintenance branch. Keep `Cargo.lock` and npm lock files committed; update adapters and tests alongside schema or storage changes.

## Distribution

The maintained output is `dist/`, served as a static HTTPS application. Successful WASM CI runs upload that directory. See [browser distribution](docs/releasing.md) for validation and packaging. This fork has no desktop release workflow.
