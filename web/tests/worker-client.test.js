import test from 'node:test';
import assert from 'node:assert/strict';
import { ComputeWorker } from '../worker-client.js';
class FakeWorker extends EventTarget {
  static instances = [];
  constructor() { super(); FakeWorker.instances.push(this); }
  postMessage(request) { this.request = request; }
  complete(result) { this.dispatchEvent(new MessageEvent('message', { data: { id: this.request.id, result } })); }
  terminate() { this.terminated = true; }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
test('idle workers release WASM memory and are recreated for the next export', async t => {
  const previous = globalThis.Worker; globalThis.Worker = FakeWorker; t.after(() => { globalThis.Worker = previous; });
  const compute = new ComputeWorker({ idleTimeout: 5 }); t.after(() => compute.dispose());
  const first = compute.run('export', {}); await tick(); const worker = compute.worker;
  worker.complete(new Uint8Array([1])); assert.equal((await first)[0], 1);
  await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(worker.terminated, true); assert.equal(compute.worker, null);
  const next = compute.run('export', {}); await tick(); assert.notEqual(compute.worker, worker);
  compute.worker.complete(new Uint8Array([2])); assert.equal((await next)[0], 2);
});
test('cancellation rejects active work and leaves queued exports usable', async t => {
  const previous = globalThis.Worker; globalThis.Worker = FakeWorker; t.after(() => { globalThis.Worker = previous; });
  const compute = new ComputeWorker(); t.after(() => compute.dispose());
  const controller = new AbortController(), request = compute.run('export', {}, { signal: controller.signal });
  const rejected = assert.rejects(request, { name: 'AbortError' }); await tick(); controller.abort(); await rejected;
  const next = compute.run('export', {}); await tick(); compute.worker.complete(new Uint8Array([9])); assert.equal((await next)[0], 9);
  const pending = compute.run('export', {}); const disposed = assert.rejects(pending, { name: 'AbortError' }); await tick(); compute.dispose(); await disposed;
});
