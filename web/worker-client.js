// One lazily created worker bounds CPU/memory use and keeps encoding off the UI thread.
export class ComputeWorker {
  constructor({ idleTimeout = 30000 } = {}) { this.worker = null; this.pending = null; this.serial = 0; this.tail = Promise.resolve(); this.idleTimeout = idleTimeout; this.idleTimer = null; }
  run(operation, payload, { signal, timeout = 300000, onProgress } = {}) {
    const request = this.tail.catch(() => {}).then(() => this.execute(operation, payload, signal, timeout, onProgress));
    this.tail = request;
    return request;
  }
  execute(operation, payload, signal, timeout, onProgress) {
    signal?.throwIfAborted();
    clearTimeout(this.idleTimer);
    this.worker ??= new Worker(new URL('./worker.js', import.meta.url), { type: 'module', name: 'desigma-compute' });
    const worker = this.worker;
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (error, result, terminate = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        worker.removeEventListener('message', message); worker.removeEventListener('error', failed);
        this.pending = null;
        if (terminate) { worker.terminate(); this.worker = null; }
        else this.idleTimer = setTimeout(() => { if (!this.pending && this.worker === worker) { worker.terminate(); this.worker = null; } }, this.idleTimeout);
        if (error) reject(error); else resolve(result);
      };
      const abort = () => done(signal.reason || new DOMException('Cancelled', 'AbortError'), null, true);
      const message = event => { if (event.data.id !== id) return; if (event.data.progress) { onProgress?.(event.data.progress); return; } done(event.data.error ? new Error(event.data.error) : null, event.data.result); };
      const failed = event => done(new Error(event.message || 'Compute worker stopped'), null, true);
      const timer = setTimeout(() => done(new Error('Operation timed out; use a smaller export or lower resolution'), null, true), timeout);
      worker.addEventListener('message', message); worker.addEventListener('error', failed); signal?.addEventListener('abort', abort, { once: true });
      this.pending = { id, cancel: () => done(new DOMException('Worker disposed', 'AbortError'), null, true) };
      // Input buffers remain owned by the editor; output buffers transfer without copying.
      try { worker.postMessage({ id, operation, payload }); } catch (error) { done(error, null, true); }
    });
  }
  dispose() { clearTimeout(this.idleTimer); this.pending?.cancel(); this.worker?.terminate(); this.worker = null; }
}
