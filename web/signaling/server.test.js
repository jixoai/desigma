import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createSignalingServer } from './server.js';
const origin = 'https://editor.example';
async function setup(t) {
  const app = createSignalingServer({ origins: [origin] });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); t.after(() => app.close());
  const url = `ws://127.0.0.1:${app.server.address().port}`;
  const connect = async (customOrigin = origin) => {
    const ws = new WebSocket(url, { origin: customOrigin }), messages = [], waiters = [];
    ws.on('message', bytes => { const m = JSON.parse(bytes); const next = waiters.shift(); if (next) next(m); else messages.push(m); });
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    ws.sendJSON = data => ws.send(JSON.stringify(data));
    ws.next = () => messages.length ? Promise.resolve(messages.shift()) : new Promise(resolve => waiters.push(resolve));
    return ws;
  };
  return { app, connect };
}
test('signaling authenticates invitations, relays only SDP, and releases closed rooms', { timeout: 10000 }, async t => {
  const { app, connect } = await setup(t), room = '1'.repeat(32), key = '2'.repeat(64);
  const host = await connect(); host.sendJSON({ type: 'host', room, key }); assert.equal((await host.next()).type, 'ready');
  const wrong = await connect(); wrong.sendJSON({ type: 'join', room, key: '3'.repeat(64) }); assert.equal((await wrong.next()).type, 'error');
  const guest = await connect(); guest.sendJSON({ type: 'join', room, key }); assert.equal((await guest.next()).type, 'ready');
  const { peer } = await host.next();
  const signal = { version: 1, offerId: '4'.repeat(32), room, description: { type: 'offer', sdp: 'v=0' } };
  host.sendJSON({ type: 'offer', peer, signal }); assert.deepEqual((await guest.next()).signal, signal);
  const answer = { ...signal, description: { type: 'answer', sdp: 'v=0' } };
  guest.sendJSON({ type: 'answer', signal: answer }); assert.deepEqual(await host.next(), { type: 'answer', peer, signal: answer });
  guest.sendJSON({ type: 'document', document: 'must not relay' }); assert.equal((await guest.next()).type, 'error');
  await new Promise(resolve => { host.once('close', resolve); host.close(); });
  assert.equal(app.rooms.size, 0);
});
test('server rejects unconfigured origins and oversized messages', { timeout: 10000 }, async t => {
  const { connect } = await setup(t);
  await assert.rejects(connect('https://unapproved.example'), /403/);
  const ws = await connect();
  const closed = new Promise(resolve => ws.once('close', resolve));
  ws.send('x'.repeat(70000)); await closed;
});
