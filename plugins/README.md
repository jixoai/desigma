# FDE2E Desigma plugins

Open **Plugins → Install plugin** to install the included **FDE2E Shapes** bundle. It inserts six editable vector primitives, works offline and supports the editor's Undo history.

Default manifest: `https://github.com/jixoai/desigma/blob/browser-wasm/plugins/shapes/manifest.json`.

The default manifest resolves to the Shapes version shipped with the static build. Use a commit SHA in the URL to request a specific remote revision. Other manifests must live in this repository under `plugins/<name>/manifest.json`. GitHub and corresponding raw URLs are accepted; arbitrary repositories, credentials, ports, query strings and path traversal are rejected.

Schema 2 declares the panel, assets and permissions. Installation only validates and stores the bundle. Opening starts an opaque-origin sandbox; closing it revokes document access. Each bundle must include its own LICENSE. Existing installed bundles are not renamed or removed by a product branding update.
