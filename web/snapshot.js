// Serialize between browser tasks so input and paint can proceed during large saves.
// The Rust cursor rejects any revision change; only a complete, consistent Blob commits.
const yieldTask = () => globalThis.scheduler?.yield ? scheduler.yield() : new Promise(resolve => setTimeout(resolve, 0));
export async function captureSnapshot(handle, { signal, onChunk = () => {} } = {}) {
  signal?.throwIfAborted();
  const began = performance.now();
  const parts = [handle.snapshot_begin()];
  onChunk(performance.now() - began);
  while (true) {
    await yieldTask();
    signal?.throwIfAborted();
    const t = performance.now();
    const bytes = handle.snapshot_next();
    onChunk(performance.now() - t);
    if (bytes == null) break;
    parts.push(bytes);
  }
  return new Blob(parts, { type: 'application/json' });
}
