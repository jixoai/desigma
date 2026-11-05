//! Browser transport. Binary frames stay typed arrays; no base64 or JSON expansion.
//! The JS adapter supports same-origin tabs and optional WebRTC peer connections.
use crate::{JoinError, NetError, Network, PeerId};
use wasm_bindgen::prelude::*;
pub const PROTOCOL_VERSION: u32 = 1;
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = desigmaNet, js_name = host, catch)]
    fn host_start(password: Option<String>, approval: bool, max_peers: u32) -> Result<u32, JsValue>;
    #[wasm_bindgen(js_namespace = desigmaNet, js_name = join, catch)]
    fn guest_start(room: &str, name: &str, password: Option<String>, resume: Option<String>) -> Result<u32, JsValue>;
    #[wasm_bindgen(js_namespace = desigmaNet, js_name = drain)]
    fn drain(id: u32) -> js_sys::Array;
    #[wasm_bindgen(js_namespace = desigmaNet, js_name = send, catch)]
    fn send(id: u32, peer: u32, bytes: &[u8], presence: bool) -> Result<(), JsValue>;
    #[wasm_bindgen(js_namespace = desigmaNet, js_name = command)]
    fn command(id: u32, name: &str, arg: &JsValue);
    #[wasm_bindgen(js_namespace = desigmaNet, js_name = ticket)]
    fn ticket(id: u32) -> String;
    #[wasm_bindgen(js_namespace = desigmaNet, js_name = link)]
    fn browser_link(ticket: &str) -> String;
    #[wasm_bindgen(js_namespace = desigmaNet, js_name = token)]
    fn token(id: u32, peer: u32) -> Option<String>;
}
fn err(e: JsValue) -> NetError {
    NetError::Io(format!("{e:?}"))
}
fn get(v: &JsValue, key: &str) -> JsValue {
    js_sys::Reflect::get(v, &key.into()).unwrap_or(JsValue::NULL)
}
fn string(v: &JsValue, key: &str) -> String {
    get(v, key).as_string().unwrap_or_default()
}
fn number(v: &JsValue, key: &str) -> u32 {
    get(v, key).as_f64().unwrap_or_default() as u32
}
fn bytes(v: &JsValue) -> Vec<u8> {
    js_sys::Uint8Array::new(&get(v, "bytes")).to_vec()
}
fn join_error(v: &JsValue) -> JoinError {
    match string(v, "error").as_str() {
        "password" => JoinError::WrongPassword,
        "denied" => JoinError::Denied,
        "full" => JoinError::Full,
        "timeout" => JoinError::Timeout,
        _ => JoinError::Connect(string(v, "message")),
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Ticket {
    pub room: String,
    pub password_required: bool,
}
impl Ticket {
    pub fn parse(text: &str) -> Result<Self, NetError> {
        let flat = text.trim();
        let body = flat.split("#join=").nth(1).or_else(|| flat.strip_prefix("desigma://web/")).unwrap_or(flat);
        let (room, pw) = body.split_once('.').unwrap_or((body, "0"));
        if room.len() != 32 || !room.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(NetError::Ticket("expected a browser session link".into()));
        }
        Ok(Self { room: room.into(), password_required: pw == "1" })
    }
    pub fn to_link(&self) -> String {
        browser_link(&self.encode())
    }
    pub fn encode(&self) -> String {
        format!("{}.{}", self.room, u8::from(self.password_required))
    }
}
#[derive(Clone, Debug)]
pub struct HostOptions {
    pub password: Option<String>,
    pub require_approval: bool,
    pub network: Network,
    pub max_peers: usize,
    pub version: u32,
}
impl Default for HostOptions {
    fn default() -> Self {
        Self { password: None, require_approval: false, network: Network::Internet, max_peers: 32, version: 1 }
    }
}
#[derive(Debug)]
pub enum HostEvent {
    Ready(Ticket),
    Failed(String),
    JoinRequest { request: u64, name: String },
    PeerJoined { peer: PeerId, name: String },
    PeerLeft { peer: PeerId },
    Message { peer: PeerId, bytes: Vec<u8> },
    Presence { peer: PeerId, bytes: Vec<u8> },
    JoinRefused { name: String, error: JoinError },
}
pub struct Host(u32);
impl Host {
    pub fn start(opts: HostOptions) -> Result<Self, NetError> {
        host_start(opts.password, opts.require_approval, opts.max_peers as u32).map(Self).map_err(err)
    }
    pub fn set_wake(&self, _wake: Box<dyn Fn() + Send + Sync>) {}
    pub fn drain(&self) -> Vec<HostEvent> {
        drain(self.0)
            .iter()
            .filter_map(|v| {
                let peer = number(&v, "peer");
                Some(match string(&v, "type").as_str() {
                    "ready" => HostEvent::Ready(self.ticket()?),
                    "failed" => HostEvent::Failed(string(&v, "message")),
                    "request" => HostEvent::JoinRequest { request: number(&v, "request") as u64, name: string(&v, "name") },
                    "joined" => HostEvent::PeerJoined { peer, name: string(&v, "name") },
                    "left" => HostEvent::PeerLeft { peer },
                    "message" => HostEvent::Message { peer, bytes: bytes(&v) },
                    "presence" => HostEvent::Presence { peer, bytes: bytes(&v) },
                    "refused" => HostEvent::JoinRefused { name: string(&v, "name"), error: join_error(&v) },
                    _ => return None,
                })
            })
            .collect()
    }
    pub fn ticket(&self) -> Option<Ticket> {
        Ticket::parse(&ticket(self.0)).ok()
    }
    pub fn respond(&self, id: u64, accept: bool) {
        command(self.0, if accept { "accept" } else { "deny" }, &(id as f64).into());
    }
    pub fn send(&self, peer: u32, b: Vec<u8>) -> Result<(), NetError> {
        send(self.0, peer, &b, false).map_err(err)
    }
    pub fn send_presence(&self, peer: u32, b: &[u8]) -> Result<(), NetError> {
        send(self.0, peer, b, true).map_err(err)
    }
    pub fn kick(&self, peer: u32) {
        command(self.0, "kick", &peer.into());
    }
    pub fn shutdown(&self) {
        command(self.0, "close", &JsValue::NULL);
    }
    pub fn join_token(&self, peer: u32) -> Option<String> {
        token(self.0, peer)
    }
    pub fn allow_resume(&self, token: &str) {
        command(self.0, "allow", &token.into());
    }
    pub fn revoke_resume(&self, token: &str) {
        command(self.0, "revoke", &token.into());
    }
}
impl Drop for Host {
    fn drop(&mut self) {
        self.shutdown();
    }
}
#[derive(Clone, Debug)]
pub struct GuestOptions {
    pub network: Network,
    pub version: u32,
}
impl Default for GuestOptions {
    fn default() -> Self {
        Self { network: Network::Internet, version: 1 }
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DisconnectReason {
    Kicked,
    HostEnded,
    Left,
    Lost(String),
}
#[derive(Debug)]
pub enum GuestEvent {
    Joined { peer: PeerId },
    JoinFailed(JoinError),
    Message(Vec<u8>),
    Presence(Vec<u8>),
    Disconnected(DisconnectReason),
}
pub struct Guest(u32);
impl Guest {
    pub fn join_resume(t: &Ticket, name: &str, password: Option<&str>, _: GuestOptions, resume: Option<String>) -> Result<Self, NetError> {
        guest_start(&t.room, name, password.map(str::to_string), resume).map(Self).map_err(err)
    }
    pub fn set_wake(&self, _wake: Box<dyn Fn() + Send + Sync>) {}
    pub fn drain(&self) -> Vec<GuestEvent> {
        drain(self.0)
            .iter()
            .filter_map(|v| {
                Some(match string(&v, "type").as_str() {
                    "joined" => GuestEvent::Joined { peer: number(&v, "peer") },
                    "refused" => GuestEvent::JoinFailed(join_error(&v)),
                    "message" => GuestEvent::Message(bytes(&v)),
                    "presence" => GuestEvent::Presence(bytes(&v)),
                    "closed" => GuestEvent::Disconnected(match string(&v, "reason").as_str() {
                        "kicked" => DisconnectReason::Kicked,
                        "ended" => DisconnectReason::HostEnded,
                        "left" => DisconnectReason::Left,
                        _ => DisconnectReason::Lost(string(&v, "message")),
                    }),
                    _ => return None,
                })
            })
            .collect()
    }
    pub fn send(&self, b: Vec<u8>) -> Result<(), NetError> {
        send(self.0, 0, &b, false).map_err(err)
    }
    pub fn send_presence(&self, b: &[u8]) -> Result<(), NetError> {
        send(self.0, 0, b, true).map_err(err)
    }
    pub fn leave(&self) {
        command(self.0, "close", &JsValue::NULL);
    }
}
impl Drop for Guest {
    fn drop(&mut self) {
        self.leave();
    }
}
