//! Platform services. Native builds use the standard library unchanged.
#[cfg(not(target_arch = "wasm32"))]
pub use std::fs;
#[cfg(target_arch = "wasm32")]
pub mod fs;

/// Explicit path queries are important: std's Path queries cannot see browser storage.
pub trait PathExt {
    fn v_is_absolute(&self) -> bool;
    fn v_exists(&self) -> bool;
    fn v_is_dir(&self) -> bool;
    fn v_is_file(&self) -> bool;
    fn v_canonicalize(&self) -> std::io::Result<std::path::PathBuf>;
}
impl PathExt for std::path::Path {
    fn v_is_absolute(&self) -> bool {
        #[cfg(target_arch = "wasm32")]
        {
            self.to_str().is_some_and(|path| path.starts_with('/'))
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.is_absolute()
        }
    }
    fn v_exists(&self) -> bool {
        fs::metadata(self).is_ok()
    }
    fn v_is_dir(&self) -> bool {
        fs::metadata(self).is_ok_and(|m| m.is_dir())
    }
    fn v_is_file(&self) -> bool {
        fs::metadata(self).is_ok_and(|m| m.is_file())
    }
    fn v_canonicalize(&self) -> std::io::Result<std::path::PathBuf> {
        fs::canonicalize(self)
    }
}
impl PathExt for std::path::PathBuf {
    fn v_is_absolute(&self) -> bool {
        self.as_path().v_is_absolute()
    }
    fn v_exists(&self) -> bool {
        self.as_path().v_exists()
    }
    fn v_is_dir(&self) -> bool {
        self.as_path().v_is_dir()
    }
    fn v_is_file(&self) -> bool {
        self.as_path().v_is_file()
    }
    fn v_canonicalize(&self) -> std::io::Result<std::path::PathBuf> {
        self.as_path().v_canonicalize()
    }
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_name = setTimeout)]
    fn next_task(callback: &js_sys::Function, delay: i32);
}

/// Short background jobs yield to the browser before running. Heavy import/export jobs use
/// dedicated web workers at the browser entry point instead.
#[cfg(target_arch = "wasm32")]
pub fn spawn(f: impl FnOnce() + 'static) {
    wasm_bindgen_futures::spawn_local(async move {
        let turn = js_sys::Promise::new(&mut |resolve, _| next_task(&resolve, 0));
        let _ = wasm_bindgen_futures::JsFuture::from(turn).await;
        f();
    });
}
#[cfg(not(target_arch = "wasm32"))]
pub use std::thread::spawn;

#[cfg(not(target_arch = "wasm32"))]
pub fn process_id() -> u32 {
    std::process::id()
}
#[cfg(target_arch = "wasm32")]
pub fn process_id() -> u32 {
    0
}

#[cfg(not(target_arch = "wasm32"))]
pub fn temp_dir() -> std::path::PathBuf {
    std::env::temp_dir()
}
#[cfg(target_arch = "wasm32")]
pub fn temp_dir() -> std::path::PathBuf {
    "/cache".into()
}
