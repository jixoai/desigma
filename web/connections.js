import { invitationLink, readInvitation, signalingUrl, SignalingClient } from './invitations.js';

export function createConnections({ transport, call, onStatus = () => {}, base = () => location.href }) {
  let signaling, ice = [], offers = new Map(), queue = Promise.resolve();
  const close = () => { signaling?.close(); signaling = null; offers.clear(); };
  const token = () => crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  function client(handler) { return new SignalingClient({ onMessage: handler, onStatus }); }
  return {
    close,
    async create({ server = '', ice_servers = [], password, approval = false, role = 'editor' } = {}) {
      if (server) server = signalingUrl(server);
      ice = ice_servers;
      if (!transport.status().hosting) await call('desigma_share_document', { ...(password ? { password } : {}), approval, role });
      close();
      const { room, ticket } = transport.status();
      if (!room) throw new Error('Open a document and start sharing first.');
      if (!server) {
        const signal = await transport.createOffer(ice);
        return { link: invitationLink({ kind: 'offer', signal }, base()), reply_required: true };
      }
      const key = token();
      const active = client(message => {
        queue = queue.catch(() => {}).then(async () => {
          if (signaling !== active) return;
          if (message.type === 'guest') {
            const offer = await transport.createOffer(ice); offers.set(message.peer, offer.offerId);
            active.send({ type: 'offer', peer: message.peer, signal: offer });
          } else if (message.type === 'answer' && offers.get(message.peer) === message.signal?.offerId) {
            await transport.acceptAnswer(message.signal); offers.delete(message.peer);
          }
        });
        return queue;
      });
      signaling = active;
      await active.connect(server, { type: 'host', room, key });
      return { link: invitationLink({ kind: 'invite', version: 1, ticket, key, server }, base()), reply_required: false };
    },
    async accept({ link, name = 'Guest', password = '', discard_changes = false, ice_servers = [] }) {
      const data = readInvitation(link);
      if (data.kind === 'answer') {
        await transport.acceptAnswer(data.signal);
        return { status: 'connecting', reply_required: false };
      }
      const ticket = data.kind === 'invite' ? data.ticket : `${data.signal.room}.${data.signal.password ? 1 : 0}`;
      await call('desigma_join_document', { link: `desigma://web/${ticket}`, name, password, discard_changes });
      close(); ice = ice_servers;
      if (data.kind === 'offer') {
        const answer = await transport.acceptOffer(data.signal, ice);
        return { status: 'waiting_for_host', link: invitationLink({ kind: 'answer', signal: answer }, base()), reply_required: true };
      }
      const active = client(async message => {
        if (message.type !== 'offer' || message.signal?.room !== ticket.split('.')[0]) return;
        const answer = await transport.acceptOffer(message.signal, ice);
        active.send({ type: 'answer', signal: answer });
        onStatus('Connecting to the host…');
      });
      signaling = active;
      await active.connect(data.server, { type: 'join', room: ticket.split('.')[0], key: data.key });
      return { status: 'connecting', reply_required: false };
    },
  };
}
