// Optional, ephemeral rendezvous service. It never handles document frames or assets.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';

export function createSignalingServer({ origins = [], maxRooms = 256, maxClients = 1024, ttl = 2 * 60 * 60 * 1000 } = {}) {
  const rooms = new Map(), clients = new Set();
  const server = createServer((req, res) => { res.writeHead(req.url === '/health' ? 200 : 404, { 'content-type': 'text/plain' }); res.end(req.url === '/health' ? 'ok\n' : 'not found\n'); });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    if (!origins.includes(req.headers.origin) || clients.size >= maxClients || req.url !== '/') { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  const send = (ws, data) => { if (ws.readyState === 1) { if (ws.bufferedAmount > 256 * 1024) ws.close(1008, 'slow peer'); else ws.send(JSON.stringify(data)); } };
  const reject = (ws, message) => { send(ws, { type: 'error', message }); ws.close(1008, message); };
  const validKey = key => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key);
  const signalOK = (signal, type) => signal?.version === 1 && /^[a-f0-9]{32}$/.test(signal.offerId) && signal.description?.type === type && typeof signal.description.sdp === 'string' && signal.description.sdp.length <= 32768;
  wss.on('connection', ws => {
    clients.add(ws);
    let member, windowAt = Date.now(), count = 0;
    const registrationTimer = setTimeout(() => reject(ws, 'registration timeout'), 10000); registrationTimer.unref();
    ws.on('error', () => {});
    ws.on('message', (bytes, binary) => {
      try {
        if (Date.now() - windowAt > 10000) { windowAt = Date.now(); count = 0; }
        if (binary || ++count > 40) return reject(ws, 'message limit');
        const message = JSON.parse(bytes.toString());
        if (!member) {
          if (!/^[a-f0-9]{32}$/.test(message.room) || !validKey(message.key)) return reject(ws, 'invalid registration');
          if (message.type === 'host') {
            if (rooms.has(message.room) || rooms.size >= maxRooms) return reject(ws, 'room unavailable');
            const room = { host: ws, key: message.key, guests: new Map(), created: Date.now() };
            rooms.set(message.room, room); member = { room, id: message.room, host: true };
          } else if (message.type === 'join') {
            const room = rooms.get(message.room);
            if (!room || !timingSafeEqual(Buffer.from(room.key), Buffer.from(message.key)) || room.guests.size >= 32) return reject(ws, 'Invitation expired or unavailable. Ask the host for a new link.');
            const peer = randomBytes(16).toString('hex'); room.guests.set(peer, ws); member = { room, id: message.room, peer };
          } else return reject(ws, 'register first');
          clearTimeout(registrationTimer); send(ws, { type: 'ready' });
          if (!member.host) send(member.room.host, { type: 'guest', peer: member.peer });
          return;
        }
        if (member.host && message.type === 'offer' && signalOK(message.signal, 'offer') && message.signal.room === member.id) {
          const guest = member.room.guests.get(message.peer); if (guest) send(guest, { type: 'offer', signal: message.signal });
        } else if (!member.host && message.type === 'answer' && signalOK(message.signal, 'answer')) {
          send(member.room.host, { type: 'answer', peer: member.peer, signal: message.signal });
        } else reject(ws, 'unsupported signaling message');
      } catch { reject(ws, 'malformed message'); }
    });
    ws.on('close', () => {
      clearTimeout(registrationTimer); clients.delete(ws);
      if (!member) return;
      if (member.host) { rooms.delete(member.id); for (const guest of member.room.guests.values()) guest.close(1000, 'host left'); }
      else member.room.guests.delete(member.peer);
    });
  });
  const expiry = setInterval(() => { for (const room of rooms.values()) if (Date.now() - room.created > ttl) room.host.close(1000, 'invitation expired'); }, Math.min(ttl, 30000)); expiry.unref();
  return { server, rooms, async close() { clearInterval(expiry); for (const ws of clients) ws.terminate(); await new Promise(resolve => wss.close(resolve)); if (server.listening) await new Promise(resolve => server.close(resolve)); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const origins = (process.env.DESIGMA_ORIGINS || 'http://127.0.0.1:8080,http://localhost:8080').split(',').map(s => s.trim());
  const port = Number(process.env.DESIGMA_SIGNAL_PORT || 8787);
  const app = createSignalingServer({ origins });
  app.server.listen(port, process.env.DESIGMA_SIGNAL_HOST || '127.0.0.1', () => console.log(`Desigma signaling on ${port}; allowed origins: ${origins.join(', ')}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close().then(() => process.exit(0)));
}
