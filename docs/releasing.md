# Distributing FDE2E Desigma

This fork distributes the browser application. The build output is `dist/`; there are no maintained desktop installers or desktop release workflows.

1. Start from a clean `browser-wasm` commit and pass `python3 scripts/sync-upstream.py check`.
2. Serve and verify the real editor: WebGPU/WebGL, document edits and Undo, library/recovery, exports, WebMCP and collaboration as applicable. Keep the browser performance evidence and known limitations current.
3. Use the `desigma-browser` artifact from [WASM CI](https://github.com/jixoai/desigma/actions/workflows/web.yml), or run `python3 scripts/build-web.py` locally. Preserve `dist/build.json` alongside the assets.
4. Serve the complete directory over HTTPS with `application/wasm` for `.wasm` and correct content encoding for compressed responses. See [browser hosting](browser.md#build-and-run). The repository does not publish a site automatically.

To package a local build without OS-specific installer tools:

```sh
python3 -c "import shutil; shutil.make_archive('desigma-browser', 'zip', 'dist')"
```

Do not commit the archive or `dist/`. The optional WebRTC signaling service has its own [deployment guide](../web/signaling/README.md); deploying the static editor does not deploy that service.

Ship the `plugins/` and `licenses/` directories with the complete build. Branding, provenance and the supported distribution scope are defined in [FORK.md](../FORK.md).
