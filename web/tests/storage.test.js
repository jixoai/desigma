import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserFileSystem } from '../storage.js';

async function store(t) {
  const fs = await new BrowserFileSystem({ name: `desigma-test-${crypto.randomUUID()}` }).init();
  t.after(async () => { await fs.flush(); fs.close(); });
  return fs;
}
test('save/atomic rename survives a database reopen, including empty directories', async t => {
  const fs = await store(t);
  fs.mkdir('/library/project/empty');
  fs.write('/library/project/.draft.tmp', new Uint8Array([1, 2, 3]));
  fs.rename('/library/project/.draft.tmp', '/library/project/design.desigma');
  await fs.flush();
  const reopened = await new BrowserFileSystem({ name: fs.name }).init();
  t.after(async () => { await reopened.flush(); reopened.close(); });
  assert.deepEqual([...reopened.read('/library/project/design.desigma')], [1, 2, 3]);
  assert.deepEqual(reopened.readDir('/library/project'), ['/library/project/design.desigma', '/library/project/empty']);
  assert.throws(() => reopened.read('/library/project/.draft.tmp'), { code: 'ENOENT' });
});
test('borrowed WASM memory is copied, and paths cannot escape the virtual root', async t => {
  const fs = await store(t);
  const bytes = new Uint8Array([4, 5, 6]);
  fs.write('/library/a', bytes); bytes[0] = 255;
  assert.equal(fs.read('/library/a')[0], 4);
  assert.throws(() => fs.write('../../outside', bytes), { code: 'EACCES' });
  assert.throws(() => fs.write('/missing/a', bytes), { code: 'ENOENT' });
  assert.throws(() => fs.write('/library', bytes), { code: 'EINVAL' });
});
test('directory rename/delete preserves descendants and rejects cycles', async t => {
  const fs = await store(t);
  fs.mkdir('/library/a/sub'); fs.write('/library/a/sub/data', new Uint8Array([7]));
  assert.throws(() => fs.rename('/library/a', '/library/a/sub/x'), { code: 'EINVAL' });
  fs.rename('/library/a', '/library/b');
  assert.equal(fs.read('/library/b/sub/data')[0], 7);
  assert.throws(() => fs.remove('/library/b', false), { code: 'EINVAL' });
  fs.remove('/library/b', true); await fs.flush();
  assert.throws(() => fs.stat('/library/b/sub/data'), { code: 'ENOENT' });
});
test('a failed transaction keeps dirty writes for retry and does not claim persistence', async t => {
  const fs = await store(t); await fs.flush();
  const database = fs.db;
  fs.db = { transaction() { throw new DOMException('Storage full', 'QuotaExceededError'); } };
  fs.write('/library/unsaved', new Uint8Array([9]));
  await assert.rejects(fs.flush(), { name: 'QuotaExceededError' });
  assert.equal(fs.pending.size, 1); assert.ok(fs.lastError);
  fs.db = database;
  fs.write('/library/unsaved', new Uint8Array([10]));
  await fs.flush();
  assert.equal(fs.pending.size, 0); assert.equal(fs.lastError, null);
  const reopened = await new BrowserFileSystem({ name: fs.name }).init();
  t.after(async () => { await reopened.flush(); reopened.close(); });
  assert.equal(reopened.read('/library/unsaved')[0], 10);
});
test('downloads and imports do not consume durable storage', async t => {
  const fs = await store(t);
  fs.write('/imports/example.fig', new Uint8Array([1]));
  fs.write('/downloads/example.png', new Uint8Array([2]));
  await fs.flush();
  const reopened = await new BrowserFileSystem({ name: fs.name }).init();
  t.after(async () => { await reopened.flush(); reopened.close(); });
  assert.throws(() => reopened.read('/imports/example.fig'), { code: 'ENOENT' });
  assert.throws(() => reopened.read('/downloads/example.png'), { code: 'ENOENT' });
});

test('tabs keep same-named imports and downloads separate while saving different projects', async t => {
  const first = await store(t);
  const second = await new BrowserFileSystem({ name: first.name }).init();
  t.after(async () => { await second.flush(); second.close(); });
  for (const [fs, id, byte] of [[first, 'a', 1], [second, 'b', 2]]) {
    fs.mkdir(`/library/projects/${id}/files`);
    fs.write(`/library/projects/${id}/files/design.desigma`, new Uint8Array([byte]));
    fs.write('/imports/design.svg', new Uint8Array([byte]));
    fs.write('/downloads/design.png', new Uint8Array([byte]));
  }
  await Promise.all([first.flush(), second.flush()]);
  assert.equal(first.read('/imports/design.svg')[0], 1);
  assert.equal(second.read('/imports/design.svg')[0], 2);
  assert.equal(first.read('/downloads/design.png')[0], 1);
  assert.equal(second.read('/downloads/design.png')[0], 2);
  const reopened = await new BrowserFileSystem({ name: first.name }).init(); t.after(() => reopened.close());
  assert.equal((await reopened.hydrate('/library/projects/a/files/design.desigma'))[0], 1);
  assert.equal((await reopened.hydrate('/library/projects/b/files/design.desigma'))[0], 2);
});

test('concurrent tabs cannot silently overwrite each other’s library manifests', async t => {
  const first = await store(t); first.write('/library/shared.json', new Uint8Array([0])); await first.flush();
  const second = await new BrowserFileSystem({ name: first.name }).init();
  t.after(() => { if (second.timer) clearTimeout(second.timer); second.close(); });
  second.write('/library/shared.json', new Uint8Array([2]));
  first.write('/library/shared.json', new Uint8Array([1])); await first.flush();
  await assert.rejects(second.flush(), { code: 'ECONFLICT' });
  assert.equal(second.read('/library/shared.json')[0], 2, 'unsaved local data remains available');
  assert.equal(second.pending.size, 1);
});

test('large library files reopen cold, hydrate on demand and evict clean cached bytes', async t => {
  const fs = await store(t);
  fs.mkdir('/library/projects/p/files');
  const a = '/library/projects/p/files/a.desigma', b = '/library/projects/p/files/b.desigma';
  fs.write(a, new Uint8Array(4096).fill(7)); fs.write(b, new Uint8Array(4096).fill(8)); await fs.flush();
  const reopened = await new BrowserFileSystem({ name: fs.name, cacheBytes: 4096 }).init();
  t.after(() => reopened.close());
  assert.equal(reopened.stats().residentBytes, 0);
  assert.equal(reopened.stat(a).size, 4096);
  assert.throws(() => reopened.read(a), { code: 'EAGAIN' });
  assert.equal((await reopened.hydrate(a))[0], 7);
  assert.equal((await reopened.hydrate(b))[0], 8);
  assert.throws(() => reopened.read(a), { code: 'EAGAIN' });
  assert.equal(reopened.stats().residentBytes, 4096);
  reopened.copy(a, '/library/projects/p/files/c.desigma');
  reopened.rename('/library/projects/p', '/library/projects/q'); await reopened.flush();
  assert.equal((await reopened.hydrate('/library/projects/q/files/c.desigma'))[0], 7);
});

test('a write during lazy hydration wins over stale disk bytes', async t => {
  const fs = await store(t), path = '/sessions/recovery.desigma'; fs.mkdir('/sessions');
  let release;
  fs.writeBlob(path, { size: 1, arrayBuffer: () => new Promise(resolve => { release = resolve; }) });
  const loading = fs.hydrate(path);
  fs.write(path, new Uint8Array([42])); release(new Uint8Array([1]).buffer);
  assert.equal((await loading)[0], 42);
  await fs.flush();
});
