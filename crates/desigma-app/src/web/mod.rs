use wasm_bindgen::prelude::*;
pub mod dialogs;
pub mod fonts;

use crate::shell::Shell;
use std::{cell::RefCell, rc::Rc};

#[wasm_bindgen]
pub struct WebHandle {
    runner: eframe::WebRunner,
    ctx: Rc<RefCell<Option<egui::Context>>>,
    snapshot: RefCell<Option<crate::web_snapshot::Snapshot>>,
}

#[wasm_bindgen]
pub async fn start(
    canvas: web_sys::HtmlCanvasElement,
    fixture: Option<String>,
    recovery: Option<String>,
    webgpu: bool,
    open_id: Option<String>,
) -> Result<WebHandle, JsValue> {
    console_error_panic_hook::set_once();
    if let Some(path) = recovery.as_deref() {
        crate::io::load_path(std::path::Path::new(path)).map_err(JsValue::from)?;
    }
    let restoring = recovery.is_some();
    let runner = eframe::WebRunner::new();
    let ctx = Rc::new(RefCell::new(None));
    let capture = ctx.clone();
    let options = eframe::WebOptions { renderer: if webgpu { eframe::Renderer::Wgpu } else { eframe::Renderer::Glow }, ..Default::default() };
    runner
        .start(
            canvas,
            options,
            Box::new(move |cc| {
                *capture.borrow_mut() = Some(cc.egui_ctx.clone());
                // Keep native logical sizes; eframe tracks the browser device pixel ratio.
                cc.egui_ctx.set_zoom_factor(1.0);
                let opts = crate::cli::Options {
                    open_id,
                    join: web_sys::window()
                        .and_then(|w| w.location().hash().ok())
                        .and_then(|hash| hash.strip_prefix("#join=").map(|s| format!("desigma://web/{s}"))),
                    fixture: Some(fixture.unwrap_or_else(|| "showcase".into())),
                    file: recovery.map(Into::into),
                    ..Default::default()
                };
                let mut shell = Shell::new(cc, opts);
                if restoring {
                    shell.app.stop_watching();
                    shell.app.file_path = None;
                }

                let enabled = shell.app.lib.as_ref().and_then(|l| crate::comments::settings::load_flag(l.root(), crate::bridge::FLAG)) != Some(false);
                if enabled {
                    shell.app.start_bridge(&cc.egui_ctx).map_err(std::io::Error::other)?;
                }
                Ok(Box::new(shell))
            }),
        )
        .await?;
    Ok(WebHandle { runner, ctx, snapshot: RefCell::new(None) })
}

#[wasm_bindgen]
impl WebHandle {
    /// Browser controls stay usable when agent access is disabled.
    pub fn user_collaboration(&self, name: &str, arguments: &str) -> Result<String, JsValue> {
        if !matches!(name, "desigma_share_document" | "desigma_join_document" | "desigma_end_collaboration" | "desigma_get_collaboration") {
            return Err("Unsupported collaboration control".into());
        }
        let args = serde_json::from_str(arguments).map_err(|e| e.to_string())?;
        let mut shell = self.runner.app_mut::<Shell>().ok_or("Editor is busy")?;
        let ctx = self.ctx.borrow();
        let result = crate::web_tools::call(&mut shell.app, ctx.as_ref().ok_or("Editor has not started")?, name, args).map_err(JsValue::from)?;
        self.repaint();
        Ok(result.to_string())
    }
    pub fn snapshot_begin(&self) -> Result<Vec<u8>, JsValue> {
        let mut shell = self.runner.app_mut::<Shell>().ok_or("Editor is busy or stopped")?;
        crate::decks::ui::flush_notes(&mut shell.app);
        let revision = shell.app.document_revision;
        let (snapshot, bytes) = crate::web_snapshot::Snapshot::begin(&mut shell.app.doc, revision).map_err(|e| e.to_string())?;
        *self.snapshot.borrow_mut() = Some(snapshot);
        Ok(bytes)
    }
    pub fn snapshot_next(&self) -> Result<Option<Vec<u8>>, JsValue> {
        let shell = self.runner.app_mut::<Shell>().ok_or("Editor is busy or stopped")?;
        let mut state = self.snapshot.borrow_mut();
        let snapshot = state.as_mut().ok_or("Snapshot has not started")?;
        if snapshot.revision != shell.app.document_revision
            || shell.app.canvas.text.is_some()
            || shell.app.scrub.is_some()
            || !matches!(shell.app.canvas.inter, crate::canvas::Interaction::None)
        {
            *state = None;
            return Err("SNAPSHOT_CHANGED".into());
        }
        let chunk = snapshot.next(&shell.app.doc).map_err(|e| e.to_string())?;
        if chunk.is_none() {
            *state = None;
        }
        Ok(chunk)
    }
    pub fn open_library(&self, id: &str) -> Result<(), JsValue> {
        let mut shell = self.runner.app_mut::<Shell>().ok_or("Editor is busy")?;
        shell.app.open_library_file(id);
        self.repaint();
        Ok(())
    }
    pub fn tools(&self) -> String {
        crate::web_tools::catalog().to_string()
    }
    pub fn call(&self, name: &str, arguments: &str) -> Result<String, JsValue> {
        if arguments.len() > 32 * 1024 * 1024 {
            return Err("Tool arguments exceed 32 MiB".into());
        }
        let args = serde_json::from_str(arguments).map_err(|e| JsValue::from_str(&e.to_string()))?;
        let mut shell = self.runner.app_mut::<Shell>().ok_or("Editor is busy or stopped")?;
        if shell.app.bridge.bridge.is_none() {
            return Err("WebMCP is disabled. Enable agent access in Preferences.".into());
        }
        let ctx = self.ctx.borrow();
        let ctx = ctx.as_ref().ok_or("Editor has not started")?;
        let result = crate::web_tools::call(&mut shell.app, ctx, name, args).map_err(|e| JsValue::from_str(&e))?;
        if let Some(bridge) = &shell.app.bridge.bridge {
            if let Ok(mut last) = bridge.last_call.lock() {
                *last = Some(name.into());
            }
        }
        ctx.request_repaint();
        Ok(result.to_string())
    }
    pub fn snapshot(&self) -> Result<String, JsValue> {
        let mut shell = self.runner.app_mut::<Shell>().ok_or("Editor is busy or stopped")?;
        crate::decks::ui::flush_notes(&mut shell.app);
        serde_json::to_string(&shell.app.doc).map_err(|e| e.to_string().into())
    }
    pub fn stats(&self) -> Result<String, JsValue> {
        let shell = self.runner.app_mut::<Shell>().ok_or("Editor is busy or stopped")?;
        let app = &shell.app;
        Ok(serde_json::json!({"name":app.doc.name,"nodes":app.doc.nodes.len(),"revision":app.document_revision,
            "undo":app.hist.undo_len(),"dirty":app.canvas.dirty,"render_ms":app.canvas.last_render_ms,"gpu_compile_ms":app.canvas.gpu.last_compile_ms,"gpu":app.canvas.gpu.active(),
            "agents":app.bridge.bridge.is_some(),"busy":app.scrub.is_some() || app.canvas.text.is_some() || !matches!(app.canvas.inter, crate::canvas::Interaction::None),
            "home":app.home.is_some(),"collaborating":app.collab.active(),"zoom":app.view.zoom}).to_string())
    }
    pub fn import_file(&self, path: &str, kind: &str) -> Result<(), JsValue> {
        let mut shell = self.runner.app_mut::<Shell>().ok_or("Editor is busy or stopped")?;
        let app = &mut shell.app;
        let path = std::path::Path::new(path);
        match kind {
            "Variables JSON" => app.import_variables_file(path),
            "Images" | "Images and video" => {
                let bytes = desigma_platform::fs::read(path).map_err(|e| e.to_string())?;
                let center = app.view.to_page(app.canvas_rect.min, app.canvas_rect.center());
                let name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("Image");
                if kind == "Images" {
                    crate::web_tools::set_image_fill(app, bytes).map_err(JsValue::from)?;
                } else if path.extension().and_then(|s| s.to_str()).is_some_and(crate::video::is_video_extension) {
                    crate::canvas::interact::place_video_bytes(app, center, name, bytes);
                } else if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("svg")) {
                    let text = String::from_utf8(bytes).map_err(|e| e.to_string())?;
                    crate::clipboard::drop_svg(app, &text, name, None, 0);
                } else {
                    crate::canvas::interact::place_image_bytes(app, center, name, bytes);
                }
            }
            _ if app.home.is_some() => {
                let lib = app.lib.clone().ok_or("No browser library")?;
                let target = app.home_target().or_else(|| app.home.as_ref().and_then(|h| h.snap.projects.first().map(|p| (p.id.clone(), None))));
                let (project, folder) = match target {
                    Some(t) => t,
                    None => (lib.create_project("My project").map_err(|e| e.to_string())?.id, None),
                };
                app.import_into_library(&[path.to_path_buf()], &project, folder.as_deref());
            }
            _ => app.request_open(crate::instance::Open::File(path.to_path_buf())),
        }
        self.repaint();
        Ok(())
    }
    pub fn insert_plugin_svg(&self, session: u32, svg: &str, name: &str) -> Result<String, JsValue> {
        let mut shell = self.runner.app_mut::<Shell>().ok_or("Editor is busy")?;
        if shell.app.plugins.runtime.as_ref().is_none_or(|r| r.id() != session) {
            return Err("Plugin session ended".into());
        }
        let result = shell.app.insert_plugin_svg(svg, name).map_err(JsValue::from)?;
        self.repaint();
        Ok(result)
    }
    pub fn install_plugin(&self, url: &str) -> Result<(), JsValue> {
        crate::plugins::store::validate_url(url).map_err(JsValue::from)?;
        let mut shell = self.runner.app_mut::<Shell>().ok_or("Editor is busy")?;
        shell.app.plugins.url = url.into();
        shell.app.install_plugin(self.ctx.borrow().as_ref().ok_or("Editor has not started")?);
        Ok(())
    }
    pub fn open_plugin(&self, id: &str) -> Result<(), JsValue> {
        let mut shell = self.runner.app_mut::<Shell>().ok_or("Editor is busy")?;
        let plugin = shell.app.plugins.installed.iter().find(|p| p.id == id).cloned().ok_or("Plugin is not installed")?;
        shell.app.start_plugin(&plugin, self.ctx.borrow().as_ref().ok_or("Editor has not started")?).map_err(JsValue::from)
    }
    pub fn register_font(&self, bytes: Vec<u8>) {
        desigma_export::register_font(bytes.clone());
        desigma_render::register_font(bytes);
        if let Some(mut shell) = self.runner.app_mut::<Shell>() {
            shell.app.changed();
        }
        self.repaint();
    }
    pub fn receive_link(&self, link: &str) -> Result<(), JsValue> {
        desigma_net::Ticket::parse(link).map_err(|e| e.to_string())?;
        let mut shell = self.runner.app_mut::<Shell>().ok_or("Editor is busy")?;
        shell.app.request_open(crate::instance::Open::Link(link.into()));
        self.repaint();
        Ok(())
    }
    pub fn repaint(&self) {
        if let Some(ctx) = self.ctx.borrow().as_ref() {
            ctx.request_repaint();
        }
    }
    pub fn stop(&self) {
        self.runner.destroy();
    }
}

pub mod clipboard {
    pub struct Clipboard;
    pub struct ImageData<'a> {
        pub width: usize,
        pub height: usize,
        pub bytes: std::borrow::Cow<'a, [u8]>,
    }
    impl Clipboard {
        pub fn new() -> Result<Self, String> {
            Ok(Self)
        }
        pub fn set_text(&mut self, text: String) -> Result<(), String> {
            super::copy_text(&text);
            Ok(())
        }
        pub fn set_image(&mut self, data: ImageData<'_>) -> Result<(), String> {
            super::copy_image(&data.bytes, data.width as u32, data.height as u32);
            Ok(())
        }
    }
}
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = desigmaBrowser, js_name = deferOpen)]
    pub fn defer_open(path: &str, id: &str) -> bool;
    #[wasm_bindgen(js_namespace = desigmaBrowser, js_name = copyText)]
    fn copy_text(text: &str);
    #[wasm_bindgen(js_namespace = desigmaBrowser, js_name = copyImage)]
    fn copy_image(bytes: &[u8], width: u32, height: u32);
    #[wasm_bindgen(js_namespace = desigmaBrowser, js_name = downloadCached, catch)]
    fn cached(url: &str) -> Result<Vec<u8>, JsValue>;
}
pub fn download_cached(url: &str) -> Result<Vec<u8>, String> {
    cached(url).map_err(|e| format!("{e:?}"))
}

/// CPU rendering/encoding entry point for a dedicated Worker. It never constructs a UI.
#[wasm_bindgen]
pub fn worker_export(document: &str, name: &str, arguments: &str) -> Result<Vec<u8>, JsValue> {
    let doc = desigma_doc::Document::from_json(document).map_err(|e| e.to_string())?;
    desigma_mcp::engine::validate_document(&doc).map_err(JsValue::from)?;
    let args: serde_json::Value = serde_json::from_str(arguments).map_err(|e| e.to_string())?;
    let engine = desigma_mcp::engine::Engine { doc, history: Default::default() };
    let id = args["node_id"].as_u64().map(desigma_doc::NodeId);
    let scale = args["scale"].as_f64().unwrap_or(1.0) as f32;
    let result: Result<Vec<u8>, String> = match name {
        "ui_animation" => {
            let node = id.ok_or("node_id is required")?;
            let options = desigma_export::anim::AnimExport {
                format: desigma_export::anim::AnimFormat::parse(args["format"].as_str().unwrap_or("gif")).ok_or("Invalid animation format")?,
                fps: args["fps"].as_u64().unwrap_or(0) as u32,
                scale,
                background: serde_json::from_value(args["background"].clone()).map_err(|e| e.to_string())?,
                gif_dither: args["gif_dither"].as_bool().unwrap_or(false),
                webm_quality: args["webm_quality"].as_u64().unwrap_or(85) as u8,
                webm_speed: args["webm_speed"].as_u64().unwrap_or(9) as u8,
            };
            let mut progress = |p: desigma_export::anim::Progress| {
                worker_progress(p.done, p.total);
                true
            };
            desigma_export::anim::export_animation(&engine.doc, node, &options, &engine.doc.name, Some(&mut progress)).map_err(|e| e.to_string())
        }
        "desigma_export_animation" => {
            let a: desigma_mcp::motion::ExportAnimArgs = serde_json::from_value(args).map_err(|e| e.to_string())?;
            desigma_mcp::motion::export(&engine, &a).map(|(bytes, _)| bytes)
        }
        "desigma_export_image" => desigma_mcp::engine::export_image(&engine, id.ok_or("node_id is required")?.0, scale).map(|(bytes, _, _)| bytes),
        "desigma_export_asset" => {
            let format = args["format"].as_str().ok_or("format is required")?;
            if format == "pdf" {
                let slides: Vec<_> = if args["all_slides"].as_bool().unwrap_or(true) {
                    engine
                        .doc
                        .pages
                        .iter()
                        .filter_map(|p| engine.doc.get(*p))
                        .flat_map(|p| p.children.iter().copied())
                        .filter(|id| engine.doc.get(*id).is_some_and(|n| n.slide.is_some()))
                        .collect()
                } else {
                    vec![id.ok_or("node_id is required for a single slide")?]
                };
                desigma_export::export_pdf(&engine.doc, &slides)
            } else {
                let id = id.ok_or("node_id is required")?;
                if engine.doc.get(id).is_none() {
                    return Err("Unknown node".into());
                }
                if !(0.25..=4.0).contains(&scale) {
                    return Err("scale must be 0.25..4".into());
                }
                let doc = desigma_doc::apply_bound_variables(&engine.doc);
                let (w, h) = desigma_export::render_size(&doc, id, scale).ok_or("Cannot render node")?;
                if format != "svg" && w as u64 * h as u64 > 16_777_216 {
                    return Err("Export exceeds 16 megapixels".into());
                }
                match format {
                    "png" => Ok(desigma_export::export_png(&doc, id, scale)),
                    "jpg" => Ok(desigma_export::export_jpg(&doc, id, scale, 90)),
                    "svg" => Ok(desigma_export::export_svg(&doc, id, &Default::default()).into_bytes()),
                    _ => Err("Unknown export format".into()),
                }
            }
        }
        _ => Err("Unsupported worker operation".into()),
    };
    result.map_err(JsValue::from)
}

#[wasm_bindgen]
pub fn worker_import(bytes: &[u8], extension: &str, name: &str) -> Result<String, JsValue> {
    let doc = match extension {
        "fig" => desigma_fig::import_fig(bytes).map_err(|e| e.to_string())?,
        "pen" => desigma_pen::import_with(bytes, &Default::default()).map_err(|e| e.to_string())?.document,
        "svg" => {
            let text = std::str::from_utf8(bytes).map_err(|e| e.to_string())?;
            let mut doc = desigma_doc::Document::new(name);
            let page = doc.add_page("Page 1");
            desigma_svg::import_svg_named_with(text, name, &mut doc, page, desigma_doc::Vec2::ZERO, &Default::default()).map_err(|e| e.to_string())?;
            doc
        }
        "json" => {
            let text = std::str::from_utf8(bytes).map_err(|e| e.to_string())?;
            match desigma_fig::import_rest_json(text) {
                Ok(doc) => doc,
                Err(_) => desigma_doc::Document::from_json(text).map_err(|e| e.to_string())?,
            }
        }
        _ => desigma_doc::Document::from_json(std::str::from_utf8(bytes).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?,
    };
    desigma_mcp::engine::validate_document(&doc).map_err(JsValue::from)?;
    doc.to_json().map_err(|e| e.to_string().into())
}

#[wasm_bindgen]
pub fn worker_register_font(bytes: Vec<u8>) {
    desigma_export::register_font(bytes.clone());
    desigma_render::register_font(bytes);
}

#[wasm_bindgen]
pub fn worker_thumbnail(document: &str) -> Result<Vec<u8>, JsValue> {
    let doc = desigma_doc::Document::from_json(document).map_err(|e| e.to_string())?;
    Ok(crate::home::thumb::thumbnail_png(&doc).unwrap_or_default())
}
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = desigmaBrowser, js_name = thumbnail)]
    fn thumbnail_js(document: &str) -> js_sys::Promise;
}
pub async fn render_thumbnail(document: &str) -> Result<Vec<u8>, JsValue> {
    let value = wasm_bindgen_futures::JsFuture::from(thumbnail_js(document)).await?;
    Ok(js_sys::Uint8Array::new(&value).to_vec())
}

#[wasm_bindgen]
pub fn tool_catalog() -> String {
    crate::web_tools::catalog().to_string()
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = desigmaBrowser, js_name = preparePlugin)]
    fn prepare_plugin_js(url: &str) -> js_sys::Promise;
}
pub async fn prepare_plugin(url: &str) -> Result<(), String> {
    wasm_bindgen_futures::JsFuture::from(prepare_plugin_js(url)).await.map(|_| ()).map_err(|e| format!("{e:?}"))
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = desigmaBrowser, js_name = beginExport)]
    pub fn begin_export(document: &str, args: &str) -> u32;
    #[wasm_bindgen(js_namespace = desigmaBrowser, js_name = waitExport)]
    fn wait_export_js(id: u32) -> js_sys::Promise;
    #[wasm_bindgen(js_namespace = desigmaBrowser, js_name = cancelExport)]
    pub fn cancel_export(id: u32);
    #[wasm_bindgen(js_namespace = desigmaBrowser, js_name = exportProgress)]
    fn export_progress_js(id: u32) -> js_sys::Array;
    #[wasm_bindgen(js_namespace = desigmaCompute, js_name = progress)]
    fn worker_progress(done: u32, total: u32);
}
pub async fn wait_export(id: u32) -> Result<usize, String> {
    wasm_bindgen_futures::JsFuture::from(wait_export_js(id)).await.map(|v| v.as_f64().unwrap_or(0.0) as usize).map_err(|e| format!("{e:?}"))
}
pub fn export_progress(id: u32) -> (u32, u32) {
    let a = export_progress_js(id);
    (a.get(0).as_f64().unwrap_or(0.0) as u32, a.get(1).as_f64().unwrap_or(1.0) as u32)
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = desigmaBrowser, js_name = openLink, catch)]
    pub fn open_link(url: &str) -> Result<(), JsValue>;
    #[wasm_bindgen(js_namespace = desigmaBrowser, js_name = showFiles, catch)]
    pub fn show_files(path: &str) -> Result<(), JsValue>;
}
pub fn open_window(id: &str) -> Result<(), String> {
    let window = web_sys::window().ok_or("Browser window is unavailable")?;
    let base = window.location().href().map_err(|_| "Cannot read browser location")?;
    let mut url = url::Url::parse(&base).map_err(|e| e.to_string())?;
    url.set_query(None);
    url.set_fragment(None);
    url.query_pairs_mut().append_pair("file", id);
    open_link(url.as_str()).map_err(|e| format!("{e:?}"))
}

#[wasm_bindgen]
pub fn sample_document(fixture: &str) -> Result<String, JsValue> {
    let doc = match fixture {
        "showcase" => crate::showcase::document(),
        "board" => crate::board::demo::document(),
        "deck" => crate::decks::demo::document(),
        "motion" => crate::showcase::motion_document(),
        "empty" => {
            let mut doc = desigma_doc::Document::new("Untitled");
            doc.add_page("Page 1");
            doc
        }
        _ => return Err("Unknown fixture".into()),
    };
    doc.to_json().map_err(|e| e.to_string().into())
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = desigmaBrowser, js_name = queueExport)]
    fn queue_export_js(document: &str, name: &str, args: &str);
}
pub fn queue_export(doc: &desigma_doc::Document, name: &str, args: serde_json::Value) {
    if let Ok(document) = serde_json::to_string(doc) {
        queue_export_js(&document, name, &args.to_string());
    }
}
