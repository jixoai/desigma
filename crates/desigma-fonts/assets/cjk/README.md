# FDE2E UI CJK

Offline fallback shared by the WASM editor UI, document canvas, thumbnails and export worker. The original Inter faces remain first for Latin text. The fallback is present in every UI language so Chinese file/page/layer names display even with English menus.

- Family: `FDE2E UI CJK`, regular 400; derived from Noto Sans SC, SIL OFL 1.1. Copyright and license remain in `OFL.txt` and the font name table. Renamed to distinguish the modified subset.
- Source: Google Fonts Noto Sans SC, pinned commit and SHA-256 in `source.json`.
- Coverage: 7,946 Unicode mappings, selected by the fixed `unicode-ranges.json` from Fontsource's `noto-sans-sc@5.3.1/chinese-simplified-400-normal.ttf`. Covers every character in the current `zh-CN.tsv`, common Simplified Chinese, some Traditional Chinese, kana and punctuation. It is not a complete Unicode Han font; uncommon characters and language-specific typefaces still need an appropriate document font.
- Transform: instantiate weight 400, subset glyphs without drawing changes, rename family. Result: 2,664,668 bytes, SHA-256 `441b008d087edbf6c19dad71e15e588ad931818db1d9dfaa702fca56c4e7f298`.
- Reproduce with Python + `fonttools==4.68.0`: `python scripts/prepare-cjk-font.py`. `--source /path/to/NotoSansSC.ttf` reuses a source file only if its hash matches.

The static fallback adds roughly 1.6 MiB compressed instead of bundling the full 17 MiB variable source or downloading several faces during startup. The exact final WASM budget is checked by the web build. Only the WASM font bundle includes it; native upstream system-font loading remains independent.
