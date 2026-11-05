import { validateSignal } from './collaboration.js';

export function signalingUrl(value) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'wss:' && !(local && url.protocol === 'ws:')) || url.username || url.password || url.hash) throw new Error('Use a wss:// signaling address (ws:// is allowed on localhost).');
  return url.href;
}
export function invitationLink(value, base = location.href) {
  const url = new URL(base); url.search = ''; url.hash = '';
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (bytes.length > 48000) throw new Error('Connection link is too large');
  url.hash = 'connect=' + btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  return url.href;
}
export function readInvitation(link) {
  const url = new URL(link);
  const encoded = new URLSearchParams(url.hash.slice(1)).get('connect');
  if (!encoded || encoded.length > 64000 || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('Paste a valid Desigma connection link.');
  let data;
  try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(encoded.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0)))); }
  catch { throw new Error('The connection link is damaged or incomplete. Copy the full link again.'); }
  if (data.kind === 'offer' || data.kind === 'answer') validateSignal(data.signal, data.kind);
  else if (data.kind === 'invite') {
    if (data.version !== 1 || !/^[a-f0-9]{32}\.[01]$/.test(data.ticket) || !/^[a-f0-9]{64}$/.test(data.key)) throw new Error('Invalid invitation');
    data.server = signalingUrl(data.server);
  } else throw new Error('Unsupported connection link');
  return data;
}

// Only connection descriptions reach this service. Document data uses WebRTC.
export class SignalingClient {
  constructor({ onMessage = () => {}, onStatus = () => {}, WebSocketClass = WebSocket } = {}) {
    this.onMessage = onMessage; this.onStatus = onStatus; this.WebSocketClass = WebSocketClass;
  }
  connect(server, registration) {
    this.close();
    const socket = new this.WebSocketClass(signalingUrl(server)); this.socket = socket;
    return new Promise((resolve, reject) => {
      let ready = false;
      const fail = message => { clearTimeout(timer); reject(new Error(message)); };
      const timer = setTimeout(() => { socket.close(); fail('Signaling connection timed out. Check the server address.'); }, 10000);
      socket.onopen = () => socket.send(JSON.stringify(registration));
      socket.onmessage = event => {
        try {
          if (typeof event.data !== 'string' || event.data.length > 65536) throw new Error('Invalid signaling message');
          const message = JSON.parse(event.data);
          if (message.type === 'error') { if (!ready) { socket.close(); fail(message.message); } else this.onStatus(message.message); }
          else if (message.type === 'ready') { ready = true; clearTimeout(timer); resolve(); }
          else Promise.resolve(this.onMessage(message)).catch(error => this.onStatus(error.message));
        } catch (error) { if (!ready) fail(error.message); else this.onStatus(error.message); }
      };
      socket.onerror = () => { if (!ready) fail('Cannot reach the signaling server. Check its address and allowed origins.'); };
      socket.onclose = () => { clearTimeout(timer); if (!ready) fail('The signaling server closed the connection.'); else this.onStatus('Signaling disconnected. Existing peers stay connected; create a new link for new guests.'); };
    });
  }
  send(message) {
    if (this.socket?.readyState !== 1) throw new Error('Signaling is disconnected. Create a new invitation.');
    this.socket.send(JSON.stringify(message));
  }
  close() { if (this.socket) { this.socket.onclose = null; this.socket.close(); this.socket = null; } }
}
