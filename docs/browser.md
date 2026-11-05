# Browser editor (WebAssembly)

The desktop editor now also compiles to a static browser application. Document editing, layout, text shaping, GPU/CPU rendering, import, export, history and agent operations run on the user's device. Serving the files needs no application server, account, native helper or loopback bridge.

## Build and run

Use the pinned Rust toolchain from `rust-toolchain.toml`, Node 22+ for verification, Python 3.11+, Binaryen (`wasm-opt`), and the matching bindings CLI:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129 --locked
# macOS: brew install binaryen
# Ubuntu: sudo apt-get install binaryen
python3 scripts/build-web.py
python3 scripts/serve-web.py --port 8080
```

Open <http://127.0.0.1:8080>. `dist/` is the complete deployable application. The build checks the binding version against Cargo.lock, uses SIMD, LTO and one codegen unit, runs Binaryen, emits gzip variants and writes `build.json` and `tools.json`. `--no-opt` skips Binaryen for iteration; `--skip-build` packages an existing build. For JS/CSS-only changes after a completed optimized build, `--assets-only` refreshes assets and the service worker while preserving `dist/pkg/`. `WASM_BINDGEN=/path/to/wasm-bindgen` selects a locally installed matching CLI. A matching CLI under `target/web-tools/` is also detected automatically.

Serve production over HTTPS with `.wasm` as `application/wasm`, JavaScript as `text/javascript`, and gzip/Brotli content negotiation. The included `_headers` file supplies isolation headers for hosts that support that format; configure equivalent headers elsewhere. Do not serve `.gz` directly without `Content-Encoding: gzip`. The local Python server deliberately disables HTTP caching for development and serves uncompressed content.

Query options:

- `?fixture=showcase`, `?fixture=board`, `?fixture=deck`, `?fixture=motion` open the bundled examples.
- `?renderer=webgl` forces the compatibility path: egui on WebGL and the time-budgeted CPU tile renderer.
- `?fresh=1` starts a fresh recovery session; `?dev=1` disables service-worker registration.
- `?file=<library-file-id>` opens a library file in a new tab.

WebGPU is preferred; WebGL is used if WebGPU cannot initialize. SIMD-capable current browsers are required. The complete desktop UI is preserved and works best on desktop/tablet-sized screens. Touch input is supported by egui; this is not a separately redesigned phone interface.

## Local files and persistence

File → Open, drag and drop and the bottom Open file control accept `.desigma`, `.fig`, `.pen`, `.svg` and JSON. SVG drop inserts editable vectors. Image placement, variable JSON and native export controls use browser pickers/downloads. Large `.fig`/`.pen` files selected through the bottom control are parsed in a worker. Embedded assets work offline; external file references require embedding before import.

The platform layer keeps metadata and a synchronous working set for the existing Rust library, and persists only changed records to IndexedDB. Project documents, trash documents and recovery snapshots use Blob records: startup reads handles, then opens document bytes on demand. Clean document buffers use a 32 MiB LRU budget (one requested file may exceed it); dirty writes are retained until committed. Existing byte-array records migrate one file at a time on first launch. That first migration has an I/O cost; later launches avoid reading every document. File listings use kind metadata, with a small header probe for older files. Atomic renames commit in a single transaction. Failed/quota-exceeded transactions retain dirty bytes and show an error; Download .desigma remains available. Save operations explicitly await durable transactions. Cross-tab changes are broadcast; conflicting library writes are rejected instead of silently overwriting another tab. Recovery files are per tab, protected by Web Locks when available. Refresh restores the document; Undo history is intentionally session-local. Closing during an unfinished edit/save triggers the browser’s unsaved-work prompt; a forced page close can still interrupt an asynchronous save.

Projects, folders, thumbnails, trash, named versions, published component libraries, settings, plugin bundles and downloaded fonts use this storage. Downloads and temporary imports do not persist. Browser storage is origin-scoped: a different hostname/port is a different workspace. Clearing site data removes the workspace; export `.desigma` files for portable backups. Storage capacity remains the browser's quota.

After one successful online load, the service worker caches the static editor for offline use. New versions wait for existing tabs to close. No analytics or document upload is included. Fontsource and installed plugins' declared services need a connection on their first use; downloaded fonts and plugin bundles are cached locally.

## WebMCP

The catalog is shared with native MCP; browser operations target the live editor and share its Undo stack, layout and component propagation. The adapter prefers the November 2026 draft's `document.modelContext`, supports earlier `navigator.modelContext` implementations, and exposes an explicit JavaScript fallback without replacing either browser API.

```js
// Portable interface, also available when native WebMCP is absent:
const tools = window.desigma.tools();
const doc = await window.desigma.call('desigma_get_document', {});
const page = doc.pages[0].node_id;
await window.desigma.call('desigma_create_node', {
  parent_id: page, kind: 'rectangle', name: 'Card', width: 320, height: 180
});

// Current native WebMCP API:
const registered = await document.modelContext.getTools();
const tool = registered.find(t => t.name === 'desigma_get_document');
const result = JSON.parse(await document.modelContext.executeTool(tool, {}));
```

`tools.json` contains the exact compiled schemas. The surface includes:

| Capability | Tools |
| --- | --- |
| Read/edit layers and pages | Original native MCP tools, node templates, atomic native command batches |
| Layout, vectors, components, variants, ordering, text | `execute_action`, `apply_commands`, `get_node_templates` |
| Variables, shared styles, prototype flows/devices, comments, board sessions, guides | Native command batches and variable import/export |
| Viewport and selection | `get_view`, `set_view`, `get_selection`, `select_nodes` |
| Motion and presentation | Keyframes, presets, timeline, `present`, animation export |
| PNG/JPEG/SVG/PDF/GIF/WebM/PNG sequences and code | Export tools and native code generators |
| Projects, folders, trash, version history, published libraries | Project tools, `library_query`, `library_edit` |
| Plugins | List/install/open/stop |
| Collaboration | Share/join/end, status, invitation/reply links, optional automatic signaling, WebRTC offer/answer tools |
| Entire document including all native properties | `get_document_json`, `replace_document`, `apply_commands` |

Get `get_capabilities` and `get_node_templates` to discover the native command format. Reserve IDs with `allocate_node_ids` before Insert. `apply_commands` validates a scratch document, rejects duplicate IDs/cycles, and commits one shared undo step. `replace_document` resets history and requires an explicit discard flag when edits exist. Permanent library deletions require `confirm: true`. The adapter validates schemas, snapshots inputs, serializes calls, yields between calls and honors cancellation before mutations. Worker exports can be terminated on cancellation; completed mutations are not rolled back merely because the caller subsequently aborts.

Agent access defaults on for the browser app and can be disabled in Preferences or the Agent pill. The saved setting persists; calls then reject. No agent credentials or host filesystem access are exposed. Returned document content is marked untrusted. The current WebMCP spec is a draft and browser support varies; `window.desigma.mode` reports the selected interface.

## Performance

WebGPU reuses tessellation, visible-region indexes, textures and the last rendered frame. CPU fallback uses cached 256px tiles and a 6ms soft render budget (one tile may exceed it). Pan/zoom does not invalidate document geometry or save the document. Background recovery saving waits until input has been idle for 1.2 seconds. Snapshot serialization yields between batches, with a 4 ms / 64 KiB soft budget; embedded asset bytes are split into 8 KiB input slices. A revision change or an active edit cancels the partial snapshot; only a complete snapshot becomes the new recovery Blob. A single complex node or large metadata field can still exceed the soft budget. Private recovery snapshots are not broadcast to other tabs. Worker rendering/encoding isolates PNG/JPEG/SVG/PDF and animation exports from interface input; animation controls also use workers with progress/cancel. Library thumbnail rendering also uses the worker. An idle compute worker terminates after 30 seconds to release its WASM memory; the next export initializes a new worker. Font downloads are asynchronous.

Additional changes avoid copying embedded image/video bytes on every editing transaction, remove quadratic parent/child validation on flat documents, and serialize recovery snapshots compactly. The build retains deterministic rendering semantics; no fast-math flags are used. Browser memory is bounded by the document, working set, tile caches, queued transport limits and one lazily created compute worker. Project and recovery document bytes are lazy. Fonts, plugin bundles, thumbnails, named version snapshots and published-library snapshots still enter the working set; large histories and a single large live document can therefore consume significant memory. Storage diagnostics are available in `window.desigma.stats().storage`; these count JS file buffers, not total browser/WASM/GPU memory.

Reproduce the measurements in an isolated editor tab:

```js
await (await import('./tests/browser-smoke.js')).runSmoke();
await (await import('./tests/browser-benchmark.js')).benchmark({ count: 5000 });
window.desigma.stats();
window.desigma.metrics();
```

`docs/browser-performance.json` records the measured environment and results. The latest 5000-layer run kept the canvas focused for all 119 samples: frame intervals were 16.88 ms median / 24.19 ms p95 / 29.45 ms maximum; CPU canvas preparation was 2.73 ms median / 4.45 ms p95. Earlier approximately one-second intervals also occur in an unfocused no-edit animation-frame control. The benchmark records focus throughout and flags results unsuitable for frame-rate claims; keep the canvas focused until it completes. Historical measurements are retained in `browser-performance-history.json`. Frame interval is measured with browser animation frames during panning; `render_ms`/`gpu_compile_ms` measure CPU preparation, not GPU completion. Background compilation, power mode, resolution, effects, imported assets and hardware materially change results. Synthetic rectangles do not represent every complex design.

## Collaboration and plugins

Same-origin tabs communicate through BroadcastChannel. Cross-device peers use ordered WebRTC data channels with bounded, chunked binary frames. **Connect devices** in the footer provides two flows:

- With a configured signaling address, create an invitation and send the link to a guest. Opening it shows the destination server and requires an explicit Join action. Offers and answers exchange automatically. The host tab must remain open.
- With no signaling address, send an invitation link, receive a reply link from the guest, and paste the reply into the original host tab. Pending connections expire after two minutes.

The optional self-hosted service in `web/signaling/` relays only connection descriptions, keeps rooms in memory, checks configured origins and invitation secrets, and bounds messages, peers and room lifetime. See [its setup guide](../web/signaling/README.md). It is not deployed automatically. The editor remains a static application; the service is optional for connection setup.

WebMCP exposes the same flows through `desigma_create_collaboration_link` and `desigma_accept_collaboration_link` (58 tools total). The lower-level `create_peer_offer` / `accept_peer_offer` / `accept_peer_answer` tools remain available. Accepting an answer means connection setup started, not that the guest has already joined. Check `get_collaboration` or `desigmaNet.status()` for actual state.

Optional `ice_servers` supply STUN/TURN where direct networking is unavailable; configure each device. Signaling alone does not traverse every NAT or firewall. No public TURN service is selected. Native iroh/QUIC tickets remain incompatible with browser tickets. Passwords, host approval and viewer/editor roles continue through the existing collaboration core. Same-machine WebRTC with BroadcastChannel disabled is tested; remote internet connectivity still needs validation with your deployment and networks.

Plugins use opaque-origin sandboxed iframes with declared network origins, isolated local storage and a scoped SVG insertion bridge. Session identity and source window are checked; switching documents or stopping the plugin revokes access. Existing schema-2 bundles from the repository registry work; arbitrary native plugin execution is not introduced.

Native OS operations have browser equivalents where appropriate: clipboard APIs, browser downloads, browser tabs, browser storage and service-worker updates. Native desktop installation, OS integration, local TCP listeners and automatic desktop binary updates have no browser equivalent and are excluded. Video codecs retain the pure-Rust build's existing support; optional native OpenH264 is not compiled into WASM.

## Checks

```sh
npm ci --prefix web --ignore-scripts
npm test --prefix web
cargo clippy --locked -p desigma-app --lib --target wasm32-unknown-unknown --no-default-features -- -D warnings
cargo test --workspace --locked
cargo fmt --all --check
```

`.github/workflows/web.yml` checks the WASM target, browser adapters, build artifact and a 12MiB gzip budget. Existing native CI remains enabled. The browser smoke script exercises real native WebMCP where supported, Undo/Redo, atomic failures, exports and persistent projects. Local verification results are recorded in `browser-validation.json`.

WebMCP API reference: <https://webmachinelearning.github.io/webmcp/> (draft checked 2026-11-05).
