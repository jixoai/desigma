import test from 'node:test';
import assert from 'node:assert/strict';
import { invitationLink, readInvitation, signalingUrl } from '../invitations.js';
test('connection links roundtrip without sending secrets as URL query parameters', () => {
  const invite = { kind: 'invite', version: 1, ticket: `${'1'.repeat(32)}.0`, key: 'a'.repeat(64), server: 'wss://signal.example/' };
  const link = invitationLink(invite, 'https://editor.example/work/?fixture=demo');
  assert.equal(new URL(link).search, ''); assert.equal(new URL(link).pathname, '/work/');
  assert.deepEqual(readInvitation(link), invite);
});
test('rejects malformed links, non-WebSocket destinations and wrong signal versions', () => {
  for (const server of ['https://signal.example', 'ws://signal.example', 'wss://user:pass@signal.example']) assert.throws(() => signalingUrl(server));
  assert.equal(signalingUrl('ws://127.0.0.1:8787'), 'ws://127.0.0.1:8787/');
  assert.throws(() => readInvitation('https://editor.example/#connect=abc'));
  assert.throws(() => readInvitation(invitationLink({ kind: 'offer', signal: { version: 9 } }, 'https://editor.example')));
});
