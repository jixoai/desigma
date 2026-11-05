# FDE2E Desigma browser collaboration

Document synchronization runs in the browser. The host keeps the session's authoritative document; guests receive the current snapshot and subsequent operations through WebRTC. Same-origin tabs can also use BroadcastChannel. The existing shared Rust collaboration engine preserves permissions, comments and editing behavior.

## Connect devices

1. Open a document and choose **Connect devices** in the bottom bar.
2. Choose guest access, an optional password and whether host approval is required.
3. Create an invitation link and share it with the guest.
4. Without a signaling service, the guest returns a reply link for the host to accept. With a configured signaling service, opening the invitation starts automatic negotiation.
5. Keep the host tab open. Use the canvas Share menu to approve guests and change access; **End connection** disconnects the session.

Joining can replace the guest's current document, so save or download it first. Do not share active invitation links publicly. Connection setup is asynchronous; check the connection status before assuming a guest has joined.

## Deployment

The static editor needs HTTPS. For automatic negotiation, run the optional [self-hosted signaling service](../web/signaling/README.md), set its allowed origins and enter its `wss://` address under **Connection settings**. The service relays connection descriptions and does not store design documents.

Some networks require STUN / TURN. Configure servers on each device; no public relay is selected automatically. Validate your deployment across the networks you plan to support. Background tab throttling, browser suspension and the host closing its tab can interrupt a live session.

## WebMCP

`desigma_create_collaboration_link`, `desigma_accept_collaboration_link` and `desigma_get_collaboration` expose the same flows to agents. Host/guest roles, passwords and approval apply to both UI and tool calls. Browser tickets are separate from inherited native transport tickets.

See [browser.md](browser.md#collaboration-and-plugins) for transport details and the complete browser API. The standalone native server and desktop link handlers are outside the maintained WASM product.
