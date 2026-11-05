//! Synchronous working set backed by asynchronous IndexedDB transactions in `web/storage.js`.
//! Initialization must finish before constructing the editor. Changes are persisted atomically
//! in batches; JavaScript exposes `flush()` to await durable storage before reporting a save.
use std::{
    ffi::OsString,
    io::{self, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};
use wasm_bindgen::prelude::*;
use web_time::{SystemTime, UNIX_EPOCH};

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = desigmaFs, js_name = read, catch)]
    fn js_read(path: &str) -> Result<Vec<u8>, JsValue>;
    #[wasm_bindgen(js_namespace = desigmaFs, js_name = write, catch)]
    fn js_write(path: &str, data: &[u8]) -> Result<(), JsValue>;
    #[wasm_bindgen(js_namespace = desigmaFs, js_name = mkdir, catch)]
    fn js_mkdir(path: &str) -> Result<(), JsValue>;
    #[wasm_bindgen(js_namespace = desigmaFs, js_name = remove, catch)]
    fn js_remove(path: &str, recursive: bool) -> Result<(), JsValue>;
    #[wasm_bindgen(js_namespace = desigmaFs, js_name = rename, catch)]
    fn js_rename(from: &str, to: &str) -> Result<(), JsValue>;
    #[wasm_bindgen(js_namespace = desigmaFs, js_name = copy, catch)]
    fn js_copy(from: &str, to: &str) -> Result<f64, JsValue>;
    #[wasm_bindgen(js_namespace = desigmaFs, js_name = kind)]
    fn js_kind(path: &str) -> Option<String>;
    #[wasm_bindgen(js_namespace = desigmaFs, js_name = stat, catch)]
    fn js_stat(path: &str) -> Result<JsValue, JsValue>;
    #[wasm_bindgen(js_namespace = desigmaFs, js_name = readDir, catch)]
    fn js_read_dir(path: &str) -> Result<js_sys::Array, JsValue>;
}
fn path(p: impl AsRef<Path>) -> String {
    p.as_ref().to_string_lossy().into_owned()
}
fn error(e: JsValue) -> io::Error {
    let code = js_sys::Reflect::get(&e, &"code".into()).ok().and_then(|v| v.as_string());
    let kind = match code.as_deref() {
        Some("ENOENT") => io::ErrorKind::NotFound,
        Some("EEXIST") => io::ErrorKind::AlreadyExists,
        Some("EACCES") => io::ErrorKind::PermissionDenied,
        Some("EINVAL") => io::ErrorKind::InvalidInput,
        Some("EAGAIN") => io::ErrorKind::WouldBlock,
        _ => io::ErrorKind::Other,
    };
    io::Error::new(kind, js_sys::Reflect::get(&e, &"message".into()).ok().and_then(|v| v.as_string()).unwrap_or_else(|| format!("{e:?}")))
}
pub fn read(p: impl AsRef<Path>) -> io::Result<Vec<u8>> {
    js_read(&path(p)).map_err(error)
}
pub fn document_kind(p: impl AsRef<Path>) -> Option<String> {
    js_kind(&path(p))
}
pub fn read_to_string(p: impl AsRef<Path>) -> io::Result<String> {
    String::from_utf8(read(p)?).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}
pub fn write(p: impl AsRef<Path>, bytes: impl AsRef<[u8]>) -> io::Result<()> {
    js_write(&path(p), bytes.as_ref()).map_err(error)
}
pub fn create_dir_all(p: impl AsRef<Path>) -> io::Result<()> {
    js_mkdir(&path(p)).map_err(error)
}
pub fn create_dir(p: impl AsRef<Path>) -> io::Result<()> {
    if metadata(&p).is_ok() {
        return Err(io::ErrorKind::AlreadyExists.into());
    }
    create_dir_all(p)
}
pub fn remove_file(p: impl AsRef<Path>) -> io::Result<()> {
    js_remove(&path(p), false).map_err(error)
}
pub fn remove_dir(p: impl AsRef<Path>) -> io::Result<()> {
    js_remove(&path(p), false).map_err(error)
}
pub fn remove_dir_all(p: impl AsRef<Path>) -> io::Result<()> {
    js_remove(&path(p), true).map_err(error)
}
pub fn rename(a: impl AsRef<Path>, b: impl AsRef<Path>) -> io::Result<()> {
    js_rename(&path(a), &path(b)).map_err(error)
}
pub fn copy(a: impl AsRef<Path>, b: impl AsRef<Path>) -> io::Result<u64> {
    js_copy(&path(a), &path(b)).map(|n| n as u64).map_err(error)
}
pub fn exists(p: impl AsRef<Path>) -> io::Result<bool> {
    match metadata(p) {
        Ok(_) => Ok(true),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e),
    }
}
pub fn canonicalize(p: impl AsRef<Path>) -> io::Result<PathBuf> {
    metadata(&p)?;
    let mut out = PathBuf::from("/");
    for part in p.as_ref().components() {
        match part {
            std::path::Component::Normal(s) => out.push(s),
            std::path::Component::ParentDir => {
                out.pop();
            }
            _ => {}
        }
    }
    Ok(out)
}
#[derive(Clone, Debug)]
pub struct Metadata {
    directory: bool,
    len: u64,
    modified: SystemTime,
}
impl Metadata {
    pub fn is_dir(&self) -> bool {
        self.directory
    }
    pub fn is_file(&self) -> bool {
        !self.directory
    }
    pub fn len(&self) -> u64 {
        self.len
    }
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }
    pub fn modified(&self) -> io::Result<SystemTime> {
        Ok(self.modified)
    }
    pub fn file_type(&self) -> FileType {
        FileType(self.directory)
    }
}
pub fn metadata(p: impl AsRef<Path>) -> io::Result<Metadata> {
    let v = js_stat(&path(p)).map_err(error)?;
    let get = |key: &str| js_sys::Reflect::get(&v, &key.into()).unwrap_or(JsValue::NULL);
    Ok(Metadata {
        directory: get("directory").as_bool().unwrap_or(false),
        len: get("size").as_f64().unwrap_or(0.0) as u64,
        modified: UNIX_EPOCH + std::time::Duration::from_millis(get("modified").as_f64().unwrap_or(0.0).max(0.0) as u64),
    })
}
pub fn symlink_metadata(p: impl AsRef<Path>) -> io::Result<Metadata> {
    metadata(p)
}
#[derive(Clone, Copy, Debug)]
pub struct FileType(bool);
impl FileType {
    pub fn is_dir(&self) -> bool {
        self.0
    }
    pub fn is_file(&self) -> bool {
        !self.0
    }
    pub fn is_symlink(&self) -> bool {
        false
    }
}
pub struct DirEntry(PathBuf);
impl DirEntry {
    pub fn path(&self) -> PathBuf {
        self.0.clone()
    }
    pub fn file_name(&self) -> OsString {
        self.0.file_name().unwrap_or_default().to_owned()
    }
    pub fn metadata(&self) -> io::Result<Metadata> {
        metadata(&self.0)
    }
    pub fn file_type(&self) -> io::Result<FileType> {
        Ok(self.metadata()?.file_type())
    }
}
pub type ReadDir = std::vec::IntoIter<io::Result<DirEntry>>;
pub fn read_dir(p: impl AsRef<Path>) -> io::Result<ReadDir> {
    Ok(js_read_dir(&path(p)).map_err(error)?.iter().filter_map(|v| v.as_string()).map(|p| Ok(DirEntry(p.into()))).collect::<Vec<_>>().into_iter())
}
pub struct File {
    path: PathBuf,
    data: io::Cursor<Vec<u8>>,
    writable: bool,
    dirty: std::cell::Cell<bool>,
}
impl File {
    pub fn open(p: impl AsRef<Path>) -> io::Result<Self> {
        Ok(Self { path: p.as_ref().to_owned(), data: io::Cursor::new(read(p)?), writable: false, dirty: std::cell::Cell::new(false) })
    }
    pub fn create(p: impl AsRef<Path>) -> io::Result<Self> {
        write(&p, [])?;
        Ok(Self { path: p.as_ref().to_owned(), data: io::Cursor::new(Vec::new()), writable: true, dirty: std::cell::Cell::new(false) })
    }
    pub fn metadata(&self) -> io::Result<Metadata> {
        metadata(&self.path)
    }
    pub fn sync_all(&self) -> io::Result<()> {
        if self.writable && self.dirty.get() {
            write(&self.path, self.data.get_ref())?;
            self.dirty.set(false);
        }
        Ok(())
    }
    pub fn sync_data(&self) -> io::Result<()> {
        self.sync_all()
    }
    pub fn set_modified(&self, _time: SystemTime) -> io::Result<()> {
        self.sync_all()
    }
}
impl Read for File {
    fn read(&mut self, b: &mut [u8]) -> io::Result<usize> {
        self.data.read(b)
    }
}
impl Write for File {
    fn write(&mut self, b: &[u8]) -> io::Result<usize> {
        if !self.writable {
            return Err(io::ErrorKind::PermissionDenied.into());
        }
        self.dirty.set(true);
        self.data.write(b)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.sync_all()
    }
}
impl Seek for File {
    fn seek(&mut self, p: SeekFrom) -> io::Result<u64> {
        self.data.seek(p)
    }
}
impl Drop for File {
    fn drop(&mut self) {
        let _ = self.sync_all();
    }
}
#[derive(Default)]
pub struct OpenOptions {
    write: bool,
    create: bool,
    create_new: bool,
    append: bool,
    truncate: bool,
}
impl OpenOptions {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn read(&mut self, _: bool) -> &mut Self {
        self
    }
    pub fn write(&mut self, v: bool) -> &mut Self {
        self.write = v;
        self
    }
    pub fn create(&mut self, v: bool) -> &mut Self {
        self.create = v;
        self
    }
    pub fn create_new(&mut self, v: bool) -> &mut Self {
        self.create_new = v;
        self
    }
    pub fn append(&mut self, v: bool) -> &mut Self {
        self.append = v;
        self
    }
    pub fn truncate(&mut self, v: bool) -> &mut Self {
        self.truncate = v;
        self
    }
    pub fn open(&self, p: impl AsRef<Path>) -> io::Result<File> {
        let present = exists(&p)?;
        if self.create_new && present {
            return Err(io::ErrorKind::AlreadyExists.into());
        }
        let mut f = if self.truncate || (!present && (self.create || self.create_new)) { File::create(p)? } else { File::open(p)? };
        f.writable = self.write || self.append;
        if self.append {
            f.seek(SeekFrom::End(0))?;
        }
        Ok(f)
    }
}
