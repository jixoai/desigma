//! WebMCP calls use the live WebRunner handle, so no loopback server or secrets are needed.
use serde_json::Value;
use std::{
    path::Path,
    sync::{atomic::AtomicBool, mpsc::SyncSender, Arc, Mutex},
};
pub const DISCOVERY_FILE: &str = "webmcp.json";
pub struct BridgeRequest {
    pub name: String,
    pub args: Value,
    pub reply: SyncSender<Result<Value, String>>,
    pub cancelled: Arc<AtomicBool>,
}
pub struct Bridge {
    pub last_call: Arc<Mutex<Option<String>>>,
}
impl Bridge {
    pub fn start(_: Option<&Path>, _: &str, _: Option<&Path>, _: egui::Context) -> Result<Self, String> {
        Ok(Self { last_call: Arc::default() })
    }
    pub fn try_recv(&self) -> Option<BridgeRequest> {
        None
    }
    pub fn update_document(&self, _: &str, _: Option<&Path>) {}
}
pub fn remove_stale(_: &Path) {}
