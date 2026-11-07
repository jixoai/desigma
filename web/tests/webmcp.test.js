import test from 'node:test';
import assert from 'node:assert/strict';
import { registerTools } from '../webmcp.js';
const tools = [{ name: 'desigma_edit', description: 'Edit a node', inputSchema: { type: 'object', properties: { id: { type: 'integer', minimum: 1 }, text: { type: 'string', maxLength: 10 } }, required: ['id'], additionalProperties: false }, annotations: { readOnlyHint: false } }];
test('registers current Document API with abortable lifecycle and input validation', async () => {
  const registered = [];
  const context = { async registerTool(tool, options) { registered.push({ tool, options }); } };
  const bridge = await registerTools({ tools, execute: async (_, args) => args, documentObject: { modelContext: context }, navigatorObject: {} });
  assert.equal(bridge.mode, 'document'); assert.equal(registered.length, 1);
  assert.deepEqual(await registered[0].tool.execute({ id: 3 }, {}), { id: 3 });
  await assert.rejects(bridge.call('desigma_edit', { id: 0 }));
  await assert.rejects(bridge.call('desigma_edit', { id: 2, surprise: true }));
  await assert.rejects(bridge.call('desigma_edit', { id: NaN }));
  await assert.rejects(bridge.call('missing', {}));
  bridge.dispose(); assert.equal(registered[0].options.signal.aborted, true);
  await assert.rejects(bridge.call('desigma_edit', { id: 1 }));
});
test('serializes mutations, snapshots inputs and skips aborted queued operations', async () => {
  const order = [];
  const bridge = await registerTools({ tools, execute: async (_, a) => { order.push(a.id); return a; }, documentObject: {}, navigatorObject: {} });
  assert.equal(bridge.mode, 'javascript');
  const input = { id: 1 }; const first = bridge.call('desigma_edit', input); input.id = 99;
  const ac = new AbortController(); const second = bridge.call('desigma_edit', { id: 2 }, { signal: ac.signal });
  ac.abort(); const rejected = assert.rejects(second, { name: 'AbortError' });
  const third = bridge.call('desigma_edit', { id: 3 });
  assert.deepEqual(await first, { id: 1 }); await rejected; await third;
  assert.deepEqual(order, [1, 3]); bridge.dispose();
});
test('supports early Navigator API and unregisters only owned tools', async () => {
  const removed = [];
  const context = { registerTool() {}, unregisterTool(name) { removed.push(name); } };
  const bridge = await registerTools({ tools, execute: async () => ({}), documentObject: {}, navigatorObject: { modelContext: context } });
  assert.equal(bridge.mode, 'navigator'); bridge.dispose(); assert.deepEqual(removed, ['desigma_edit']);
});
test('registration failure cleans up and remains visible to the caller', async () => {
  const signals = [];
  const context = { registerTool(_, { signal }) { signals.push(signal); if (signals.length === 2) throw new Error('denied'); } };
  await assert.rejects(registerTools({ tools: [...tools, { ...tools[0], name: 'other' }], execute: async () => ({}), documentObject: { modelContext: context }, navigatorObject: {} }), /denied/);
  assert.equal(signals[0].aborted, true);
});

test('one editor’s pending operation does not block another editor’s tool queue', { timeout: 2000 }, async t => {
  let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  const waiting = new Promise(resolve => { release = resolve; });
  t.after(release);
  const first = await registerTools({ tools, documentObject: {}, navigatorObject: {},
    execute: async () => { started(); await waiting; return 'A'; } });
  const second = await registerTools({ tools, documentObject: {}, navigatorObject: {}, execute: async () => 'B' });
  t.after(() => { first.dispose(); second.dispose(); });
  const a = first.call('desigma_edit', { id: 1 });
  await entered;
  assert.equal(await second.call('desigma_edit', { id: 2 }), 'B');
  release(); assert.equal(await a, 'A');
});
