import test from 'node:test';
import assert from 'node:assert/strict';
import { captureSnapshot } from '../snapshot.js';

test('chunked snapshots yield to input and preserve binary/Unicode JSON', async () => {
  const encoder = new TextEncoder(); let inputRan = false, next = 0;
  setTimeout(() => { inputRan = true; }, 0);
  const result = await captureSnapshot({
    snapshot_begin: () => encoder.encode('{"name":"图",'),
    snapshot_next: () => { assert.ok(inputRan); return next++ ? null : encoder.encode('"images":{"a":[0,255]}}'); },
  });
  assert.deepEqual(JSON.parse(await result.text()), { name: '图', images: { a: [0, 255] } });
});
test('interrupted snapshots never return a partially serialized document', async () => {
  await assert.rejects(captureSnapshot({ snapshot_begin: () => new Uint8Array([123]), snapshot_next: () => { throw new Error('SNAPSHOT_CHANGED'); } }), /SNAPSHOT_CHANGED/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(captureSnapshot({ snapshot_begin: () => assert.fail('must not start') }, { signal: controller.signal }), { name: 'AbortError' });
});
