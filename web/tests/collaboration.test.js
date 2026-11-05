import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransport } from '../collaboration.js';
async function event(transport, handle, type) {
  const until = Date.now() + 2000;
  while (Date.now() < until) {
    const found = transport.drain(handle).find(e => e.type === type);
    if (found) return found;
    await new Promise(r => setTimeout(r, 5));
  }
  throw new Error(`Missing ${type} event`);
}
test('two browser transports exchange binary edits, approval and disconnection', async t => {
  const host = createTransport(), guest = createTransport();
  const h = host.host('secret', true, 8);
  const room = host.ticket(h).split('.')[0];
  const g = guest.join(room, 'Guest', 'secret', null);
  t.after(() => { host.command(h, 'close'); guest.command(g, 'close'); });
  const request = await event(host, h, 'request');
  host.command(h, 'accept', request.request);
  const joined = await event(guest, g, 'joined');
  const bytes = new Uint8Array([0, 255, 1, 2]);
  host.send(h, joined.peer, bytes, false); bytes.fill(0);
  assert.deepEqual([...(await event(guest, g, 'message')).bytes], [0, 255, 1, 2]);
  guest.send(g, 0, new Uint8Array([8]), false);
  assert.equal((await event(host, h, 'message')).bytes[0], 8);
  host.command(h, 'kick', joined.peer);
  assert.equal((await event(guest, g, 'closed')).reason, 'kicked');
});
test('incorrect password is rejected before any document transfer', async t => {
  const host = createTransport(), guest = createTransport();
  const h = host.host('secret', false, 8), g = guest.join(host.ticket(h).split('.')[0], 'Guest', 'wrong', null);
  t.after(() => { host.command(h, 'close'); guest.command(g, 'close'); });
  assert.equal((await event(guest, g, 'refused')).error, 'password');
});
