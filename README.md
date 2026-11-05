# Desigma · WebAssembly editor

A design editor that runs entirely in your browser, built from [Desigma](https://github.com/deepfounder-ai/desigma)'s Rust document, layout and rendering engines. This fork maintains **only the WASM browser application** on `browser-wasm`.

[Browser setup and API](docs/browser.md) · [Upstream updates](docs/upstream-sync.md) · [Contributing](CONTRIBUTING.md) · [WASM CI](https://github.com/jixoai/desigma/actions/workflows/web.yml)

## What runs in the browser

- The original editor: frames, auto layout, components, variables, vector editing, prototypes, whiteboards, decks and motion.
- WebGPU rendering, with WebGL and CPU fallback.
- Local projects in IndexedDB, document loading on demand, incremental recovery saves and offline static assets.
- Worker imports and exports, including PNG, JPEG, SVG, PDF, GIF and WebM.
- **58 WebMCP tools**, sharing the live document and Undo history. A JavaScript API is available when the browser lacks native WebMCP.
- Sandboxed plugins and WebRTC collaboration, with invitation/reply links or an optional self-hosted signaling service.

Document operations run on the user's device. A static web server is enough to serve the editor; the optional signaling service only exchanges connection descriptions.

## Build and run

Install the pinned Rust toolchain from `rust-toolchain.toml`, Node 22+, Python 3.11+ and Binaryen (`wasm-opt`). Install the wasm-bindgen CLI version matching `Cargo.lock` (currently `0.2.129`).

```sh
git clone https://github.com/jixoai/desigma.git
cd desigma
git switch browser-wasm
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129 --locked
python3 scripts/build-web.py
python3 scripts/serve-web.py --port 8080
```

Open <http://127.0.0.1:8080>. `dist/` is the deployable static application. [Browser CI](https://github.com/jixoai/desigma/actions/workflows/web.yml) also provides a `desigma-browser` artifact for successful builds. Production hosting needs HTTPS and the correct WASM MIME type; see [deployment instructions](docs/browser.md#build-and-run).

## WebMCP

```js
const tools = window.desigma.tools();
const document = await window.desigma.call('desigma_get_document', {});
await window.desigma.call('desigma_create_node', {
  parent_id: document.pages[0].node_id,
  kind: 'rectangle',
  name: 'Card',
  width: 320,
  height: 180,
});
```

The adapter registers with `document.modelContext` where supported. Tool schemas ship in `dist/tools.json`; [the API guide](docs/browser.md#webmcp) covers permissions, document commands, exports, plugins and collaboration.

## Maintenance

`browser-wasm` is the default development branch. `main` is an unmodified mirror of upstream history, used for updates. It is not a second supported product branch.

Weekly upstream synchronization creates an isolated merge branch and draft PR, validates the WASM target and browser adapters, and preserves Git ancestry. Desktop CI, desktop installers and desktop releases are outside this fork's maintenance scope. Inherited shared Rust sources remain to make upstream integration practical; this fork does not promise desktop compatibility. The original project maintains desktop distributions.

```sh
python3 scripts/sync-upstream.py status --fetch
python3 scripts/sync-upstream.py prepare --worktree ../desigma-upstream
```

See [the synchronization guide](docs/upstream-sync.md) for conflict resolution and validation. The workflow never merges an upstream update automatically.

## Performance and limits

A local focused 5000-layer run measured 16.9 ms median frame intervals and 2.73 ms median CPU canvas preparation. These are measurements on one machine, not a sustained 60 FPS guarantee. [Measured results](docs/browser-performance.json) include the environment, storage behavior and limitations.

Browser storage quotas still apply. Some histories and assets remain in memory, older browsers may lack SIMD/WebGPU/WebMCP support, and cross-network collaboration can require STUN/TURN. The editor works best on desktop-sized browser windows. Export `.desigma` files for portable backups. See [browser.md](docs/browser.md) for the full compatibility notes.

## License and attribution

This fork builds on [deepfounder-ai/desigma](https://github.com/deepfounder-ai/desigma), with the upstream MIT OR Apache-2.0 licensing and attribution retained. Third-party fonts, libraries and plugin assets retain their respective licenses.
