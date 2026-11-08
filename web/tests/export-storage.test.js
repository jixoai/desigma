import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { BrowserFileSystem } from '../storage.js';
import { exportPath, writeExport } from '../export-storage.js';

async function storage(t, onDownload = () => {}) {
  const fs = await new BrowserFileSystem({ name: `export-${crypto.randomUUID()}`, onDownload }).init();
  t.after(async () => { await fs.flush(); fs.close(); });
  return fs;
}

test('nested exports create folders and download only the leaf once; library exports persist', async t => {
  const downloads = [];
  const fs = await storage(t, (name, bytes) => downloads.push({ name, bytes }));
  const bytes = new Uint8Array([137,80,78,71,1,2,3]);
  const path = '/downloads/project/mobile/home.png';
  assert.deepEqual(await writeExport(fs, path, bytes), { path, bytes: bytes.length, exported: true });
  assert.deepEqual(fs.read(path), bytes);
  assert.deepEqual(downloads, [{ name: 'home.png', bytes }]);
  const libraryPath = '/library/export/project/home.png';
  await writeExport(fs, libraryPath, bytes);
  const reopened = await new BrowserFileSystem({ name: fs.name }).init();
  t.after(async () => { await reopened.flush(); reopened.close(); });
  assert.deepEqual(await reopened.hydrate(libraryPath), bytes);
  assert.equal(reopened.entries.has(path), false, 'Downloads remain private to the exporting tab');
});

test('invalid or conflicting export paths fail before rendering or changing storage', async t => {
  const fs = await storage(t);
  fs.write('/downloads/occupied', new Uint8Array([42]));
  const keys = [...fs.entries.keys()];
  assert.throws(() => exportPath(fs, 'relative.png'), /absolute/);
  assert.throws(() => exportPath(fs, '/../../outside.png'), /escapes/);
  assert.throws(() => exportPath(fs, '/downloads'), /must be a file/);
  assert.throws(() => exportPath(fs, '/downloads/occupied/sub/image.png'), /occupies export folder/);
  assert.deepEqual([...fs.entries.keys()], keys);
  assert.deepEqual(fs.read('/downloads/occupied'), new Uint8Array([42]));
});

test('cancelled export does not create directories or trigger a download', async t => {
  const fs = await storage(t, () => assert.fail('Cancelled export downloaded a file'));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(writeExport(fs, '/downloads/cancelled/image.png', new Uint8Array([1]), controller.signal), { name: 'AbortError' });
  assert.equal(fs.entries.has('/downloads/cancelled'), false);
});
