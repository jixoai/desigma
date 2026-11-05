// Use an isolated synthetic database. Measures retained file bytes, not total browser RAM.
export async function storageBenchmark({ name = `desigma-storage-bench-${crypto.randomUUID()}`, files = 24, bytesPerFile = 2 * 1024 * 1024, seed = true } = {}) {
  const { BrowserFileSystem } = await import('../storage.js');
  if (seed) {
    const seed = await new BrowserFileSystem({ name }).init();
    seed.mkdir('/library/projects/bench/files');
    const bytes = new Uint8Array(bytesPerFile).fill(37);
    for (let i = 0; i < files; i++) seed.write(`/library/projects/bench/files/${i}.desigma`, bytes);
    await seed.flush(); seed.close();
  }
  const started = performance.now();
  const fs = await new BrowserFileSystem({ name }).init();
  const openMs = performance.now() - started;
  const residentBytes = [...fs.entries.values()].reduce((sum, entry) => sum + (entry.bytes?.byteLength || 0), 0);
  const target = '/library/projects/bench/files/0.desigma', t = performance.now();
  const bytes = fs.hydrate ? await fs.hydrate(target) : fs.read(target);
  if (bytes.length !== bytesPerFile || bytes[0] !== 37 || bytes.at(-1) !== 37) throw new Error('Loaded file differs from stored file');
  const result = { name, files, storedBytes: files * bytesPerFile, residentBytesBeforeOpen: residentBytes, openMs, hydrateMs: performance.now() - t, stats: fs.stats?.() };
  fs.close(); return result;
}
