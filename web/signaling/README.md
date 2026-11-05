# Optional connection service

The editor and document synchronization run in browsers. This small service only relays WebRTC offers and answers so guests can join by opening a link. It keeps rooms in memory and accepts no document or asset messages.

```sh
npm ci --prefix web/signaling --ignore-scripts
npm start --prefix web/signaling
```

For local testing, open `http://127.0.0.1:8080` and set **Connect devices → Connection settings → Signaling server** to `ws://127.0.0.1:8787`. Create an invitation, open it in another tab, and join. To verify WebRTC independently, disable BroadcastChannel in the guest before loading the editor.

For cross-device use, serve the editor over HTTPS and put this service behind a reverse proxy with TLS and WebSocket upgrade support. Set the editor's exact origin in `DESIGMA_ORIGINS` (comma-separated), then enter the public `wss://` service URL in the editor. The WebSocket endpoint is `/`; `/health` is a plain-text health probe. The default bind address is `127.0.0.1`; `DESIGMA_SIGNAL_HOST` and `DESIGMA_SIGNAL_PORT` override it. No public service is deployed or selected automatically.

Each invitation carries a random 256-bit secret in the URL fragment. Guests need that secret; the service rejects unconfigured origins, oversized messages and unknown message types, limits clients/rooms/guests, expires rooms after two hours, and discards rooms when hosts disconnect. This is an ephemeral rendezvous service, not an account or authorization system. Run behind your normal network/proxy access controls. Do not log invitation payloads. Anyone with a current link can request to join; enable the editor's password and approval controls when needed.

Signaling does not provide NAT traversal. Supply STUN/TURN configuration through **Connection settings** on each device if the network requires it. TURN credentials should be short-lived and are not placed in invitation links. A TURN relay carries encrypted WebRTC traffic; document handling still happens in browsers.

Closing the connection service leaves established WebRTC peers connected. Create a new invitation after reconnecting the service. With no service configured, the editor uses an invitation link and a reply link; both tabs must stay open and pending offers expire after two minutes. Native iroh tickets remain separate.

```sh
npm test --prefix web/signaling
```
