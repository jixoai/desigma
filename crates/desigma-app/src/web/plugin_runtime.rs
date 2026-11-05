//! Sandboxed browser panels: all document access returns through the scoped SVG insertion API.
use crate::plugins::store::Bundle;
use std::sync::{atomic::AtomicBool, mpsc::SyncSender, Arc};
use wasm_bindgen::prelude::*;
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = desigmaBrowser, js_name = openPlugin, catch)]
    fn open_plugin(bundle: &str) -> Result<u32, JsValue>;
    #[wasm_bindgen(js_namespace = desigmaBrowser, js_name = closePlugin)]
    fn close_plugin(id: u32);
}
pub struct InsertRequest {
    pub svg: String,
    pub name: String,
    pub reply: SyncSender<Result<String, String>>,
    pub cancelled: Arc<AtomicBool>,
}
pub struct Runtime {
    id: u32,
}
impl Runtime {
    pub fn start(bundle: Bundle, _: egui::Context) -> Result<Self, String> {
        let files = bundle
            .files
            .iter()
            .map(|(name, bytes)| Ok((name.clone(), String::from_utf8(bytes.clone()).map_err(|e| e.to_string())?)))
            .collect::<Result<std::collections::BTreeMap<_, _>, String>>()?;
        let payload = serde_json::json!({"plugin":bundle.plugin,"panel":bundle.panel,"files":files,"network":bundle.network});
        open_plugin(&payload.to_string()).map(|id| Self { id }).map_err(|e| format!("{e:?}"))
    }
    pub fn id(&self) -> u32 {
        self.id
    }
    pub fn try_recv(&self) -> Option<InsertRequest> {
        None
    }
}
impl Drop for Runtime {
    fn drop(&mut self) {
        close_plugin(self.id);
    }
}
