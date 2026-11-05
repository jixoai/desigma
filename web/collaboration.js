// Document synchronization remains in Rust. This adapter only carries bounded binary frames.
const MAX_FRAME = 64 * 1024 * 1024;
const MAX_QUEUED = 128 * 1024 * 1024;
const VERSION = 1;
export function validateSignal(value, type) {
  if (!value || value.version !== VERSION || !/^[a-f0-9]{32}$/.test(value.offerId) || value.description?.type !== type ||
      typeof value.description.sdp !== 'string' || value.description.sdp.length > 32768 ||
      (type === 'offer' && !/^[a-f0-9]{32}$/.test(value.room))) throw new Error(`Invalid or unsupported connection ${type}`);
  return value;
}
export function createTransport(wake = () => {}, onClose = () => {}) {
  const sessions = new Map();
  let sequence = 0;
  const id = () => crypto.randomUUID().replaceAll('-', '');
  const push = (session, event) => {
    if (session.closed && event.type !== 'closed') return;
    const size = event.bytes?.byteLength || 0;
    if (size > MAX_FRAME || session.queued + size > MAX_QUEUED || session.events.length >= 1024) {
      close(session, 'backlog'); return;
    }
    if (event.type === 'presence') {
      const old = session.events.findIndex(e => e.type === 'presence' && e.peer === event.peer);
      if (old !== -1) { session.queued -= session.events[old].bytes.byteLength; session.events.splice(old, 1); }
    }
    session.events.push(event); session.queued += size; wake();
  };
  function publish(session, message) {
    if (session.closed) return;
    const envelope = { ...message, version: VERSION, from: session.client };
    const rtc = message.to && session.rtc.get(message.to);
    if (rtc) { rtc.send(envelope); return; }
    if (session.remote && !session.isHost) { session.remote.send(envelope); return; }
    session.channel.postMessage(envelope);
  }
  function accept(session, request, allowed) {
    const pending = session.pending.get(request);
    if (!pending) return;
    session.pending.delete(request);
    if (!allowed) { publish(session, { type: 'refused', to: pending.from, error: 'denied' }); return; }
    const peer = ++session.nextPeer;
    session.peers.set(peer, pending);
    publish(session, { type: 'accepted', to: pending.from, peer });
    push(session, { type: 'joined', peer, name: pending.name });
  }
  function receive(session, message) {
    if (!message || typeof message !== 'object' || session.closed || message.from === session.client || (message.to && message.to !== session.client)) return;
    if (message.version !== VERSION || typeof message.from !== 'string' || message.from.length > 64) return;
    if (session.isHost) {
      if (message.type === 'join') {
        const existing = [...session.peers].find(([, p]) => p.from === message.from);
        if (existing) { publish(session, { type: 'accepted', to: message.from, peer: existing[0] }); return; }
        if ([...session.pending.values()].some(p => p.from === message.from)) return;
        const name = String(message.name || 'Guest').replace(/[\x00-\x1f]/g, '').slice(0, 80);
        let error;
        if (session.password && message.password !== session.password) error = 'password';
        else if (session.peers.size + session.pending.size >= session.maxPeers) error = 'full';
        if (error) { publish(session, { type: 'refused', to: message.from, error }); push(session, { type: 'refused', name, error }); return; }
        const request = ++session.nextRequest;
        session.pending.set(request, { from: message.from, name, resume: typeof message.resume === 'string' ? message.resume.slice(0, 128) : null });
        if (session.approval && !session.trusted.has(message.resume)) push(session, { type: 'request', request, name });
        else accept(session, request, true);
      } else {
        const entry = [...session.peers].find(([, p]) => p.from === message.from);
        if (!entry) return;
        const [peer] = entry;
        if (message.type === 'leave') { session.peers.delete(peer); push(session, { type: 'left', peer }); }
        else if (['message', 'presence'].includes(message.type) && message.bytes instanceof Uint8Array) push(session, { type: message.type, peer, bytes: message.bytes });
      }
    } else {
      if (session.hostClient && session.hostClient !== message.from) return;
      if (message.type === 'accepted') {
        session.hostClient = message.from; session.lastHost = performance.now();
        if (!session.joined) { session.joined = true; clearInterval(session.retry); push(session, { type: 'joined', peer: message.peer }); }
      } else if (message.type === 'refused') { clearInterval(session.retry); push(session, { type: 'refused', error: message.error }); }
      else if (session.joined) {
        session.lastHost = performance.now();
        if (message.type === 'closed') { push(session, { type: 'closed', reason: message.reason }); close(session, 'left', false); }
        else if (['message', 'presence'].includes(message.type) && message.bytes instanceof Uint8Array) push(session, { type: message.type, bytes: message.bytes });
      }
    }
  }
  function make(room, isHost) {
    const session = { id: ++sequence, room, isHost, client: id(), events: [], queued: 0, closed: false,
      peers: new Map(), pending: new Map(), trusted: new Set(), rtc: new Map(), nextPeer: 0, nextRequest: 0,
      channel: new BroadcastChannel(`desigma-collab-v1:${room}`), lastHost: performance.now() };
    session.channel.onmessage = e => receive(session, e.data);
    sessions.set(session.id, session);
    session.heartbeat = setInterval(() => {
      if (session.isHost) for (const p of session.peers.values()) publish(session, { type: 'heartbeat', to: p.from });
      else if (session.joined && performance.now() - session.lastHost > 20000) { push(session, { type: 'closed', reason: 'lost', message: 'The host stopped responding' }); close(session, 'left', false); }
    }, 4000);
    return session;
  }
  function close(session, reason, notify = true) {
    if (!session || session.closed) return;
    if (notify) {
      if (session.isHost) for (const peer of session.peers.values()) publish(session, { type: 'closed', to: peer.from, reason: 'ended' });
      else publish(session, { type: 'leave', to: session.hostClient });
    }
    session.closed = true; session.channel.close(); clearInterval(session.retry); clearInterval(session.heartbeat);
    for (const link of session.rtc.values()) link.close();
    session.remote?.close();
    onClose();
    if (notify) sessions.delete(session.id);
  }
  const get = key => { const session = sessions.get(key); if (!session || session.closed) throw new Error('Collaboration session has ended'); return session; };
  const api = {
    status() {
      const s = [...sessions.values()].find(s => !s.closed);
      return s ? { hosting: s.isHost, joined: !!s.joined, room: s.room, ticket: `${s.room}.${s.password ? 1 : 0}`, peers: s.peers.size,
        connections: [...new Set([...s.rtc.values(), s.remote].filter(Boolean))].map(link => link.connection.connectionState) } : { hosting: false, joined: false, peers: 0, connections: [] };
    },
    link(ticket) { const url = new URL(location.href); url.search = ""; url.hash = `join=${ticket}`; return url.href; },
    host(password, approval, maxPeers) {
      const session = make(id(), true); Object.assign(session, { password, approval, maxPeers: Math.min(32, maxPeers) });
      push(session, { type: 'ready' }); return session.id;
    },
    join(room, name, password, resume) {
      if (!/^[a-f0-9]{32}$/i.test(room)) throw new Error('Invalid browser session');
      const session = make(room, false);
      session.hello = { type: 'join', name, password, resume };
      publish(session, session.hello);
      session.retry = setInterval(() => {
        if (performance.now() - session.lastHost > 120000) { clearInterval(session.retry); push(session, { type: 'refused', error: 'timeout' }); }
        else publish(session, session.hello);
      }, 1000);
      return session.id;
    },
    drain(key) { const s = sessions.get(key); if (!s) return []; const events = s.events; s.events = []; s.queued = 0; if (s.closed) sessions.delete(key); return events; },
    send(key, peer, bytes, presence) {
      const session = get(key);
      if (bytes.byteLength > MAX_FRAME) throw new Error('Collaboration frame exceeds 64 MiB');
      const to = session.isHost ? session.peers.get(peer)?.from : session.hostClient;
      if (!to) throw new Error('Peer is not connected');
      publish(session, { type: presence ? 'presence' : 'message', to, bytes: new Uint8Array(bytes).slice() });
    },
    ticket(key) { const s = get(key); return `${s.room}.${s.password ? 1 : 0}`; },
    token(key, peer) { return get(key).peers.get(peer)?.resume; },
    command(key, command, arg) {
      const s = sessions.get(key); if (!s) return;
      if (command === 'close') close(s, 'left');
      else if (command === 'accept' || command === 'deny') accept(s, arg, command === 'accept');
      else if (command === 'allow') s.trusted.add(arg);
      else if (command === 'revoke') s.trusted.delete(arg);
      else if (command === 'kick') {
        const peer = s.peers.get(arg); if (peer) publish(s, { type: 'closed', to: peer.from, reason: 'kicked' });
        s.peers.delete(arg); push(s, { type: 'left', peer: arg });
      }
    },
    // A manual SDP exchange works without any application server. A configured STUN/TURN
    // server can be supplied by the user to traverse networks that disallow direct candidates.
    async createOffer(iceServers = []) {
      const s = [...sessions.values()].find(s => s.isHost && !s.closed);
      if (!s) throw new Error('Start sharing the document first');
      if (new Set(s.rtc.values()).size >= s.maxPeers) throw new Error('Too many pending or connected peers. End sharing to reset.');
      const connection = new RTCPeerConnection({ iceServers });
      const channel = connection.createDataChannel('desigma-v1');
      const link = bindChannel(s, connection, channel);
      const offerId = id(); s.rtc.set(offerId, link);
      try {
        await connection.setLocalDescription(await connection.createOffer());
        await gather(connection);
      } catch (error) { link.close(); throw error; }
      return { version: VERSION, offerId, room: s.room, password: !!s.password, description: connection.localDescription.toJSON() };
    },
    async acceptOffer(offer, iceServers = []) {
      validateSignal(offer, 'offer');
      const s = [...sessions.values()].find(s => !s.isHost && s.room === offer.room);
      if (!s) throw new Error('Join the offer’s browser session before accepting it');
      s.remote?.close();
      const connection = new RTCPeerConnection({ iceServers });
      connection.ondatachannel = e => { s.remote = bindChannel(s, connection, e.channel); e.channel.addEventListener('open', () => publish(s, s.hello), { once: true }); };
      try {
        await connection.setRemoteDescription(offer.description);
        await connection.setLocalDescription(await connection.createAnswer());
        await gather(connection);
      } catch (error) { connection.close(); throw error; }
      return { version: VERSION, offerId: offer.offerId, description: connection.localDescription.toJSON() };
    },
    async acceptAnswer(answer) {
      validateSignal(answer, 'answer');
      const link = [...sessions.values()].find(s => s.isHost)?.rtc.get(answer.offerId);
      if (!link) throw new Error('Offer expired or belongs to another session');
      await link.connection.setRemoteDescription(answer.description);
    },
  };
  function bindChannel(session, connection, channel) {
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = 256 * 1024;
    let outgoing = [], queued = 0, partial = null;
    function flush() {
      while (outgoing.length && channel.readyState === 'open' && channel.bufferedAmount < 512 * 1024) {
        const packet = outgoing.shift(); queued -= packet.byteLength; channel.send(packet);
      }
    }
    const link = {
      connection,
      send(message) {
        const { bytes, ...head } = message;
        const json = new TextEncoder().encode(JSON.stringify(head));
        const size = 4 + json.length + (bytes?.byteLength || 0);
        if (size > MAX_FRAME + 4096 || queued + size > MAX_QUEUED) throw new Error('WebRTC peer is too slow');
        const packet = new Uint8Array(size); new DataView(packet.buffer).setUint32(0, json.length); packet.set(json, 4); if (bytes) packet.set(bytes, 4 + json.length);
        // Ordered reliable chunks never exceed conservative cross-browser SCTP limits.
        for (let offset = 0; offset < size; offset += 16000) {
          const data = packet.subarray(offset, offset + 16000);
          const chunk = new Uint8Array(data.length + 8); const view = new DataView(chunk.buffer);
          view.setUint32(0, size); view.setUint32(4, offset); chunk.set(data, 8); outgoing.push(chunk); queued += chunk.byteLength;
        }
        flush();
      },
      close() {
        if (link.closed) return;
        link.closed = true;
        clearTimeout(expiry); outgoing = []; partial = null;
        const clients = new Set();
        for (const [key, value] of session.rtc) if (value === link) { clients.add(key); session.rtc.delete(key); }
        if (!session.closed && session.isHost) {
          for (const [peer, value] of session.peers) if (clients.has(value.from)) { session.peers.delete(peer); push(session, { type: 'left', peer }); }
          for (const [request, value] of session.pending) if (clients.has(value.from)) session.pending.delete(request);
        }
        channel.close(); connection.close();
      },
    };
    const expiry = setTimeout(() => { if (channel.readyState !== 'open') link.close(); }, 120000);
    channel.addEventListener('open', () => clearTimeout(expiry), { once: true });
    channel.addEventListener('close', () => {
      link.close();
      if (!session.closed && !session.isHost && session.remote === link) {
        push(session, { type: 'closed', reason: 'lost', message: 'The peer connection closed' });
        close(session, 'left', false);
      }
    });
    connection.addEventListener('connectionstatechange', () => {
      if (connection.connectionState !== 'failed') return;
      link.close();
      if (!session.isHost) push(session, { type: 'closed', reason: 'lost', message: 'Direct connection failed. Check your network or configure TURN.' });
    });
    channel.onbufferedamountlow = flush;
    channel.addEventListener('open', flush);
    channel.onmessage = event => {
      try {
        if (!(event.data instanceof ArrayBuffer) || event.data.byteLength < 8) throw new Error('Malformed WebRTC frame');
        const view = new DataView(event.data); const size = view.getUint32(0), offset = view.getUint32(4);
        if (size > MAX_FRAME + 4096 || size < 4) throw new Error('WebRTC frame too large');
        if (offset === 0) { if (partial) throw new Error('Overlapping WebRTC frames'); partial = { data: new Uint8Array(size), offset: 0 }; }
        const data = new Uint8Array(event.data, 8);
        if (!partial || offset !== partial.offset || offset + data.length > size || partial.data.length !== size) throw new Error('Invalid WebRTC chunk sequence');
        partial.data.set(data, offset); partial.offset += data.length;
        if (partial.offset === size) {
          const packet = partial.data; partial = null;
          const length = new DataView(packet.buffer).getUint32(0);
          if (length > 4096 || length + 4 > packet.length) throw new Error('Invalid WebRTC header');
          const message = JSON.parse(new TextDecoder().decode(packet.subarray(4, 4 + length)));
          if (packet.length > 4 + length) message.bytes = packet.subarray(4 + length);
          if (session.isHost && message.type === 'join') session.rtc.set(message.from, link);
          receive(session, message);
        }
      } catch (error) { link.close(); push(session, { type: 'closed', reason: 'lost', message: error.message }); }
    };
    return link;
  }
  async function gather(connection) {
    if (connection.iceGatheringState === 'complete') return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { connection.removeEventListener('icegatheringstatechange', change); reject(new Error('ICE gathering timed out')); }, 15000);
      function change() { if (connection.iceGatheringState === 'complete') { clearTimeout(timer); connection.removeEventListener('icegatheringstatechange', change); resolve(); } }
      connection.addEventListener('icegatheringstatechange', change);
    });
  }
  return api;
}
