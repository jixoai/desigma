//! Browser file dialogs enqueue the result; saves become downloads through virtual storage.
use std::path::PathBuf;
use wasm_bindgen::prelude::*;
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = desigmaBrowser, js_name = pickFiles)]
    fn pick_files(kind: &str, extensions: &str, multiple: bool);
}
#[derive(Default)]
pub struct FileDialog {
    name: String,
    kind: String,
    extensions: Vec<String>,
}
impl FileDialog {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn add_filter(mut self, name: &str, exts: &[impl AsRef<str>]) -> Self {
        if self.kind.is_empty() {
            self.kind = name.into();
        }
        self.extensions.extend(exts.iter().map(|e| format!(".{}", e.as_ref())));
        self
    }
    pub fn set_file_name(mut self, name: impl AsRef<str>) -> Self {
        self.name = name.as_ref().into();
        self
    }
    #[allow(dead_code)]
    pub fn set_title(self, _: &str) -> Self {
        self
    }
    pub fn pick_file(self) -> Option<PathBuf> {
        pick_files(&self.kind, &self.extensions.join(","), false);
        None
    }
    pub fn pick_files(self) -> Option<Vec<PathBuf>> {
        pick_files(&self.kind, &self.extensions.join(","), true);
        None
    }
    pub fn save_file(self) -> Option<PathBuf> {
        let name = std::path::Path::new(&self.name).file_name()?.to_string_lossy();
        Some(PathBuf::from("/downloads").join(name.as_ref()))
    }
    #[allow(dead_code)]
    pub fn pick_folder(self) -> Option<PathBuf> {
        Some(PathBuf::from("/downloads"))
    }
}
