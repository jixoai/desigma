import test from 'node:test';
import assert from 'node:assert/strict';
import { openSession } from '../session.js';

const firstId = '10000000-0000-4000-8000-000000000001';
const secondId = '20000000-0000-4000-8000-000000000002';
const path = id => `/sessions/${id}.desigma`;
function storage(value) {
  return { getItem: () => value, setItem: (_, next) => { value = next; } };
}
function lockManager() {
  const held = new Set();
  return { async request(name, options, callback) {
    assert.equal(options.ifAvailable, true);
    if (held.has(name)) return callback(null);
    held.add(name);
    try { return await callback({ name }); } finally { held.delete(name); }
  } };
}
function settings(overrides = {}) {
  return { fs: { entries: new Map([[path(firstId), {}]]) }, params: new URLSearchParams(),
    storage: storage(), locks: lockManager(), events: new EventTarget(), uuid: () => secondId, ...overrides };
}

test('a new tab never restores another tab’s existing draft', async t => {
  const session = await openSession(settings()); t.after(session.dispose);
  assert.equal(session.id, secondId);
  assert.equal(session.recovery, undefined);
});

test('refresh restores this tab even when another draft was saved more recently', async t => {
  const session = await openSession(settings({ storage: storage(firstId),
    fs: { entries: new Map([[path(firstId), { modified: 1 }], [path(secondId), { modified: 99 }]]) } }));
  t.after(session.dispose);
  assert.equal(session.recovery, path(firstId));
});

test('a duplicated tab with copied sessionStorage forks without loading its owner’s draft', async t => {
  const locks = lockManager();
  const first = await openSession(settings({ locks, storage: storage(firstId) })); t.after(first.dispose);
  const second = await openSession(settings({ locks, storage: storage(firstId) })); t.after(second.dispose);
  assert.equal(first.id, firstId);
  assert.equal(second.id, secondId);
  assert.equal(second.recovery, undefined);
});

test('fresh, fixtures and explicit files do not load the previous draft', async t => {
  for (const query of ['fresh=1', 'fixture=showcase', 'file=saved-file']) {
    const session = await openSession(settings({ storage: storage(firstId), params: new URLSearchParams(query) }));
    t.after(session.dispose);
    assert.equal(session.recovery, undefined);
    assert.equal(session.id, query.startsWith('file=') ? firstId : secondId);
  }
});

test('missing own draft, invalid identity and unavailable storage never fall back to another tab', async t => {
  for (const local of [storage('30000000-0000-4000-8000-000000000003'), storage('../other'),
    { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }]) {
    const session = await openSession(settings({ storage: local })); t.after(session.dispose);
    assert.equal(session.recovery, undefined);
  }
});

test('without Web Locks copied storage cannot make two tabs share a recovery path', async t => {
  const first = await openSession(settings({ locks: null, storage: storage(firstId) })); t.after(first.dispose);
  const second = await openSession(settings({ locks: null, storage: storage(firstId),
    uuid: () => '30000000-0000-4000-8000-000000000003' })); t.after(second.dispose);
  assert.notEqual(first.path, second.path);
  assert.equal(first.recovery, undefined);
  assert.equal(second.recovery, undefined);
});

test('closing a page releases ownership and rejects late writes from the old session', async t => {
  const locks = lockManager(), events = new EventTarget();
  const first = await openSession(settings({ locks, events, storage: storage(firstId) }));
  first.assertActive();
  events.dispatchEvent(new Event('pagehide'));
  assert.throws(first.assertActive, /session has closed/);
  await Promise.resolve();
  const reopened = await openSession(settings({ locks, storage: storage(firstId) })); t.after(reopened.dispose);
  assert.equal(reopened.id, firstId);
  assert.equal(reopened.recovery, path(firstId));
});

test('a broken lock service does not silently start an unprotected recovery writer', async () => {
  await assert.rejects(openSession(settings({ locks: { request: async () => { throw new Error('lock failure'); } } })), /lock failure/);
});
