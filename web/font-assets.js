// Preserve catalog family aliases when sending cached faces to the export
// worker. Binary CJK names can differ from the family used by the document.
export function collectWorkerFonts(fs) {
  return [...fs.entries].filter(([path, entry]) => /\.(ttf|otf)$/.test(path) && entry.bytes).map(([path, entry]) => {
    const metadata = fs.entries.get(path.replace(/\.(ttf|otf)$/, '.json'));
    let family;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(metadata?.bytes));
      if (typeof parsed.family === 'string' && parsed.family.trim() && parsed.family.length <= 256) family = parsed.family;
      const script = /^noto (?:sans|serif) (sc|jp|kr)$/i.exec(family ?? '')?.[1]?.toLowerCase();
      if (script && typeof parsed.source_url === 'string') {
        const source = new URL(parsed.source_url);
        const expected = { sc: 'chinese-simplified', jp: 'japanese', kr: 'korean' }[script];
        if (source.origin === 'https://cdn.jsdelivr.net' && /^\/(?:fontsource\/fonts\/|npm\/@fontsource\/)/.test(source.pathname)
          && !source.pathname.split('/').pop().startsWith(`${expected}-`)) return null;
      }
    } catch { /* User-supplied faces need no catalog sidecar. */ }
    return { key: `${path}:${entry.modified}:${metadata?.modified ?? 0}`, bytes: entry.bytes, family };
  }).filter(Boolean);
}
