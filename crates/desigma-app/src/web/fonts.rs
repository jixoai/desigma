//! Asynchronous Fontsource loading with the same selection, license and cache rules as native.
use desigma_fonts::{FontCache, FontError, FontReport, FontRequest, LoadedFont, Sidecar};
use std::collections::{BTreeSet, HashSet};
use wasm_bindgen::prelude::*;
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = desigmaBrowser, js_name = fetchBytes)]
    fn fetch_bytes(url: &str, maximum: u32) -> js_sys::Promise;
}
async fn fetch(url: &str, maximum: u32) -> Result<Vec<u8>, FontError> {
    let value = wasm_bindgen_futures::JsFuture::from(fetch_bytes(url, maximum)).await.map_err(|e| FontError::Metadata(format!("{e:?}")))?;
    Ok(js_sys::Uint8Array::new(&value).to_vec())
}
async fn resolve(cache: &FontCache, req: &FontRequest) -> Result<Vec<u8>, FontError> {
    if let Some(bytes) = cache.cached(req) {
        return Ok(bytes);
    }
    let bytes = fetch(&desigma_fonts::fontsource::metadata_url(&req.family), 2 * 1024 * 1024).await?;
    let meta = desigma_fonts::fontsource::FontMeta::parse(&String::from_utf8_lossy(&bytes))?;
    if !meta.is_open() {
        return Err(FontError::NotOpenSource { family: meta.family, license: meta.license });
    }
    let pick = meta.pick(req.weight, req.italic)?;
    let bytes = fetch(&pick.url, 20 * 1024 * 1024).await?;
    if bytes.len() < 12 || !matches!(&bytes[..4], [0, 1, 0, 0] | b"OTTO" | b"true" | b"ttcf") {
        return Err(FontError::Metadata("Downloaded font is not TTF/OTF".into()));
    }
    cache.store(
        req,
        &bytes,
        &Sidecar { family: meta.family, license: meta.license, requested_weight: req.weight, weight: pick.weight, italic: pick.italic, source_url: pick.url },
    )?;
    Ok(bytes)
}
pub async fn load(requests: BTreeSet<FontRequest>, installed: HashSet<String>) -> FontReport {
    let mut report = FontReport::default();
    let cache = FontCache::new();
    // Each face is cached; sequential downloads bound peak memory for large CJK fonts.
    for req in requests {
        let family = desigma_fonts::substitute(&req.family).unwrap_or(&req.family).to_string();
        let effective = FontRequest::new(family.clone(), req.weight, req.italic);
        if desigma_fonts::bundled_for(&effective).is_some() {
            report.bundled.push(req);
        } else if installed.contains(&req.family) {
            report.skipped.push(req);
        } else {
            match resolve(&cache, &effective).await {
                Ok(data) => report.loaded.push(LoadedFont { request: req, family, data }),
                Err(error) => report.failed.push((req, error)),
            }
        }
    }
    report
}
