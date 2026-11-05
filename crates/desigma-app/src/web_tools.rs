//! Browser tools share the editor's transactions, component propagation and undo history.
use crate::{app::App, bridge::AppHost};
use desigma_doc::{Command, NodeId};
#[cfg(target_arch = "wasm32")]
use desigma_doc::{ImageScaleMode, Paint, PaintKind};
use desigma_mcp::engine::{self, Host};
use desigma_platform::PathExt as _;
use serde::Deserialize;
use serde_json::{json, Value};

fn tool(name: &str, description: &str, properties: Value, required: &[&str], read_only: bool) -> Value {
    json!({"name":format!("desigma_{name}"),"description":description,
        "inputSchema":{"type":"object","properties":properties,"required":required,"additionalProperties":false},
        "annotations":{"readOnlyHint":read_only,"destructiveHint":!read_only,"openWorldHint":false}})
}

pub fn catalog() -> Value {
    let mut tools = desigma_mcp::catalog::tools();
    for t in &mut tools {
        if let Some(path) = t.pointer_mut("/inputSchema/properties/path") {
            path["description"] = json!(
                "Absolute path in browser storage, such as /imports/design.fig, /library/design.desigma or /downloads/design.png. No host filesystem access."
            );
        }
    }
    tools.extend([
        tool("get_node_templates", "Return valid native node templates for every supported layer kind. Replace template id=0 with allocate_node_ids, set geometry/properties, and Insert through apply_commands. Page templates use InsertPage.", json!({}), &[], true),
        tool("replace_document", "Replace the complete document from native JSON, including document kind and embedded assets. This resets Undo; refuses unsaved edits unless discard_changes=true. Use apply_commands for ordinary undoable edits.", json!({"document":{"type":"object"},"discard_changes":{"type":"boolean"}}), &["document"], false),
        tool("library_query", "Read library file metadata, trash, version history or published component libraries.", json!({"operation":{"type":"string","enum":["file","trash","versions","shared_libraries","shared_snapshot"]},"file_id":{"type":"string"},"library_id":{"type":"string"},"version":{"type":"integer","minimum":1}}), &["operation"], true),
        tool("library_edit", "Manage browser projects, folders, files, versions and published libraries. Removing projects/files moves them to Trash. empty_trash and delete_version are permanent and require confirm=true. Library operations are persisted independently of the editor Undo stack.", json!({"operation":{"type":"string","enum":["rename_project","trash_project","create_folder","rename_folder","move_folder","rename_file","duplicate_file","move_file","star_file","trash_file","restore","empty_trash","save_version","rename_version","delete_version","publish","unpublish","restore_library"]},"project_id":{"type":"string"},"file_id":{"type":"string"},"folder_id":{"type":"string"},"parent_id":{"type":"string"},"library_id":{"type":"string"},"name":{"type":"string","maxLength":1024},"label":{"type":"string","maxLength":1024},"description":{"type":"string","maxLength":100000},"starred":{"type":"boolean"},"version":{"type":"integer","minimum":1},"confirm":{"type":"boolean"}}), &["operation"], false),
        tool("get_capabilities", "Describe the browser editor's full command, action and format surface.", json!({}), &[], true),
        tool("get_document_json", "Read the complete native document including nodes, variables, components, prototypes, comments, decks, motion and embedded assets. Prefer list_nodes/get_node for large documents.", json!({}), &[], true),
        tool("apply_commands", "Apply native document commands atomically as one undo step. Supports every node kind/property, variables, styles, components, prototypes, comments, board sessions, guides and motion. Read get_capabilities for the command format; get_node returns a node suitable for Update. Invalid batches leave the document unchanged.", json!({"commands":{"type":"array","minItems":1,"maxItems":1000,"items":{"type":"object"}}}), &["commands"], false),
        tool("execute_action", "Run an editor action on the current selection using the same dispatcher as menus and keyboard shortcuts. Actions that need information open the normal editor dialog.", json!({"action":{"type":"string","enum":actions().iter().map(|(n,_)|n).collect::<Vec<_>>()}}), &["action"], false),
        tool("get_view", "Read current page, viewport, selection, renderer and measured canvas render time.", json!({}), &[], true),
        tool("set_view", "Switch pages and set pan/zoom. Bounds are in document coordinates.", json!({"page_id":{"type":"integer","minimum":1},"x":{"type":"number"},"y":{"type":"number"},"zoom":{"type":"number","minimum":0.02,"maximum":256}}), &[], false),
        tool("allocate_node_ids", "Reserve IDs for native Insert/InsertPage commands; never invent IDs or reuse existing ones.", json!({"count":{"type":"integer","minimum":1,"maximum":1000}}), &["count"], false),
        tool("export_document", "Return the native .desigma document or variables JSON as text, ready to save or download.", json!({"format":{"type":"string","enum":["desigma","variables"]}}), &["format"], true),
        tool("import_variables", "Merge Figma variables JSON using the editor's variable transaction and reflow bound nodes.", json!({"json":{"type":"string","maxLength":8388608}}), &["json"], false),
        tool("export_asset", "Export a node as PNG, JPEG or SVG, or deck slides as PDF, entirely inside the browser. Writes to browser storage; /downloads starts a browser download.", json!({"node_id":{"type":"integer","minimum":1},"format":{"type":"string","enum":["png","jpg","svg","pdf"]},"path":{"type":"string"},"scale":{"type":"number","minimum":0.25,"maximum":4},"all_slides":{"type":"boolean"}}), &["format","path"], false),
        tool("create_project", "Create a project in this browser's persistent library.", json!({"name":{"type":"string","minLength":1,"maxLength":1024}}), &["name"], false),
        tool("save_to_project", "Save the live document in a browser library project and enable autosave.", json!({"project_id":{"type":"string"},"name":{"type":"string","minLength":1,"maxLength":1024}}), &["project_id","name"], false),
        tool("list_projects", "List projects and folders from the persistent browser library.", json!({}), &[], true),
        tool("share_document", "Start a browser collaboration session. Same-origin tabs join directly; cross-device peers exchange WebRTC offers and answers. Edits and presence remain in the browser.", json!({"password":{"type":"string","maxLength":256},"approval":{"type":"boolean"},"role":{"type":"string","enum":["editor","viewer"]}}), &[], false),
        tool("join_document", "Join a browser collaboration ticket. The host document replaces the current document after acceptance; explicitly set discard_changes when leaving unsaved work.", json!({"link":{"type":"string"},"name":{"type":"string","maxLength":80},"password":{"type":"string","maxLength":256},"discard_changes":{"type":"boolean"}}), &["link","name"], false),
        tool("get_collaboration", "Read current collaboration role, pending requests and peer counts.", json!({}), &[], true),
        tool("end_collaboration", "Stop sharing or leave a session; keep the current document as a local copy.", json!({}), &[], false),
        tool("create_peer_offer", "Create a WebRTC connection offer for the current shared document, without an application server. Give the returned offer to the guest; optional ICE servers can provide STUN/TURN traversal.", json!({"ice_servers":{"type":"array","maxItems":4,"items":{"type":"object"}}}), &[], false),
        tool("accept_peer_offer", "Accept a host's WebRTC offer after join_document. Return the answer to the host. Peers must exchange the offer/answer through a trusted channel.", json!({"offer":{"type":"object"},"ice_servers":{"type":"array","maxItems":4,"items":{"type":"object"}}}), &["offer"], false),
        tool("accept_peer_answer", "Complete a WebRTC connection using a guest's answer to create_peer_offer.", json!({"answer":{"type":"object"}}), &["answer"], false),
        tool("create_collaboration_link", "Create a device invitation for the live document. Optional wss signaling server enables automatic connection; otherwise the guest returns a reply link. Existing host permissions are preserved. No document data goes through signaling.", json!({"server":{"type":"string","maxLength":2048},"ice_servers":{"type":"array","maxItems":4,"items":{"type":"object"}},"password":{"type":"string","maxLength":256},"approval":{"type":"boolean"},"role":{"type":"string","enum":["editor","viewer"]}}), &[], false),
        tool("accept_collaboration_link", "Accept a device invitation or a guest reply link. Joining replaces the document after host acceptance; explicitly set discard_changes to leave unsaved work. Without signaling, returns a reply link for the host.", json!({"link":{"type":"string","maxLength":70000},"name":{"type":"string","maxLength":80},"password":{"type":"string","maxLength":256},"discard_changes":{"type":"boolean"},"ice_servers":{"type":"array","maxItems":4,"items":{"type":"object"}}}), &["link"], false),
        tool("list_plugins", "List installed browser plugin bundles and the running panel.", json!({}), &[], true),
        tool("install_plugin", "Install and validate an FDE2E Desigma plugin from jixoai/desigma into browser storage.", json!({"url":{"type":"string","maxLength":2048}}), &["url"], false),
        tool("open_plugin", "Open an installed plugin in an isolated browser panel with its declared permissions.", json!({"id":{"type":"string","maxLength":100}}), &["id"], false),
        tool("stop_plugin", "Close the running plugin and revoke its document access.", json!({}), &[], false),
        tool("present", "Start or stop presentation of the selected frame, prototype or deck.", json!({"active":{"type":"boolean"}}), &["active"], false),
    ]);
    for definition in &mut tools {
        if definition["name"] == "desigma_library_edit" {
            definition["annotations"]["consequentialHint"] = json!(true);
        }
        if matches!(
            definition["name"].as_str(),
            Some(
                "desigma_install_plugin"
                    | "desigma_share_document"
                    | "desigma_join_document"
                    | "desigma_create_peer_offer"
                    | "desigma_accept_peer_offer"
                    | "desigma_accept_peer_answer"
                    | "desigma_create_collaboration_link"
                    | "desigma_accept_collaboration_link"
            )
        ) {
            definition["annotations"]["openWorldHint"] = json!(true);
        }
    }
    json!(tools)
}

fn parse<T: serde::de::DeserializeOwned>(v: Value) -> Result<T, String> {
    serde_json::from_value(v).map_err(|e| e.to_string())
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Commands {
    commands: Vec<Command>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct View {
    page_id: Option<u64>,
    x: Option<f32>,
    y: Option<f32>,
    zoom: Option<f32>,
}
fn editable(app: &mut App) -> Result<(), String> {
    if app.home.is_some()
        || app.history.viewing.is_some()
        || app.proto.present.is_some()
        || app.dialog.is_some()
        || app.scrub.is_some()
        || !matches!(app.canvas.inter, crate::canvas::Interaction::None)
        || app.canvas.pen.is_some()
        || app.canvas.builder.is_some()
        || app.canvas.vedit.is_some()
    {
        return Err("Editor is busy: finish the current edit and return to the document".into());
    }
    crate::canvas::interact::finish_text(app, true);
    Ok(())
}
fn text<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    args[key].as_str().filter(|s| !s.trim().is_empty()).ok_or_else(|| format!("{key} must be a nonempty string"))
}
fn library(app: &App) -> Result<&desigma_library::Library, String> {
    app.lib.as_ref().ok_or_else(|| "Browser library is not open".into())
}

pub fn call(app: &mut App, ctx: &egui::Context, name: &str, mut args: Value) -> Result<Value, String> {
    if !args.is_object() {
        return Err("Arguments must be an object".into());
    }
    // Opening/creating documents is also available from the browser library screen.
    // Preserve that screen if the existing bridge validators reject the operation.
    if app.home.is_some() && name == "desigma_join_document" {
        let home = app.home.take();
        let result = call(app, ctx, name, args);
        if result.is_err() {
            app.home = home;
        }
        return result;
    }
    if app.home.is_some() && matches!(name, "desigma_open_file" | "desigma_new_document") {
        let home = app.home.take();
        let result = app.bridge_call(name, args);
        if result.is_err() {
            app.home = home;
        }
        return result;
    }
    match name {
        "desigma_get_node_templates" => Ok(node_templates()),
        "desigma_replace_document" => {
            editable(app)?;
            if app.hist.can_undo() && args["discard_changes"].as_bool() != Some(true) {
                return Err("Save current changes first, or explicitly set discard_changes=true".into());
            }
            let doc: desigma_doc::Document = parse(args["document"].clone())?;
            engine::validate_document(&doc)?;
            if doc.pages.is_empty() {
                return Err("Document needs a page".into());
            }
            app.replace_document(doc, None);
            app.home = None;
            app.bridge_call("desigma_get_document", json!({}))
        }
        "desigma_library_query" => library_query(app, args),
        "desigma_library_edit" => library_edit(app, args),
        "desigma_get_capabilities" => Ok(
            json!({"runtime":"wasm","document_schema":"desigma-doc serde JSON", "commands":["Insert","Remove","Reparent","Update","InsertPage","RemovePage","SetFlows","SetStyles","SetComments","SetLibraryState","SetGuides","SetPrototypeDevice","SetVariables","SetBoardSession","SetNodeMotion","SetTimeline"],
            "example":{"commands":[{"Update":{"node":"full node object returned by desigma_get_node; edit its properties and submit here"}}]},
            "formats":{"import":["desigma","fig","pen","svg","Figma REST JSON","PNG","JPEG","WebP"],"export":["desigma","png","jpg","svg","pdf","gif","webm","png-zip","css","tailwind","react","swiftui","compose"]},
            "actions":actions().iter().map(|(n,_)|n).collect::<Vec<_>>(),"max_layers":100000,"storage":"IndexedDB","network_transport":"browser"}),
        ),
        "desigma_get_document_json" => serde_json::to_value(&app.doc).map_err(|e| e.to_string()),
        "desigma_apply_commands" => {
            editable(app)?;
            let a: Commands = parse(args)?;
            if a.commands.is_empty() || a.commands.len() > 1000 {
                return Err("Provide 1..1000 commands".into());
            }
            let cmd = Command::Batch(a.commands);
            let mut staged = app.doc.clone_without_images();
            stage_commands(&mut staged, &cmd)?;
            engine::validate_document(&staged)?;
            for node in staged.nodes.values() {
                let t = node.transform;
                if [t.a, t.b, t.c, t.d, t.tx, t.ty, node.size.x, node.size.y, node.stroke.weight].iter().any(|v| !v.is_finite() || v.abs() > 1_000_000.0)
                    || node.size.x < 0.0
                    || node.size.y < 0.0
                    || !(0.0..=1.0).contains(&node.opacity)
                    || node.corner_radii.iter().any(|r| !r.is_finite() || !(0.0..=1_000_000.0).contains(r))
                {
                    return Err("Node geometry is outside the supported finite range".into());
                }
            }
            if staged.pages.is_empty() {
                return Err("A document needs at least one page".into());
            }
            let variable_edit = if staged.variables != app.doc.variables || staged.variable_collections != app.doc.variable_collections {
                let store = desigma_doc::VariableStore::from_doc(&staged);
                let removed = app.doc.variables.keys().filter(|id| !store.variables.contains_key(*id)).cloned().collect::<Vec<_>>();
                let changed = desigma_engine::variables::changed_variables(&app.doc, &store, &removed);
                let nodes = desigma_engine::variables::bound_nodes(&staged, &changed);
                let before = staged.nodes.clone();
                desigma_engine::variables::reflow_bound(&mut staged, &changed, &nodes);
                before
                    .into_iter()
                    .filter_map(|(id, old)| staged.get(id).filter(|n| **n != old).map(|n| Command::Update { node: Box::new(n.clone()) }))
                    .collect::<Vec<_>>()
            } else {
                Vec::new()
            };
            let cmd = if variable_edit.is_empty() { cmd } else { Command::Batch(std::iter::once(cmd).chain(variable_edit).collect()) };
            AppHost(app).exec(cmd)?;
            app.sanitize();
            app.fonts.load_for(&app.doc);
            Ok(json!({"changed":true,"undo_steps":1,"node_count":app.doc.nodes.len()}))
        }
        "desigma_execute_action" => {
            let action = text(&args, "action")?;
            let (_, action) = actions().into_iter().find(|(n, _)| *n == action).ok_or("Unknown editor action")?;
            editable(app)?;
            crate::panels::menus::run(app, ctx, action);
            Ok(json!({"executed":true,"selection":app.selection,"dialog_open":app.dialog.is_some()}))
        }
        "desigma_get_view" => Ok(
            json!({"page_id":app.page,"x":app.view.offset.x,"y":app.view.offset.y,"zoom":app.view.zoom,"selection":app.selection,"gpu":app.canvas.gpu.active(),"render_ms":app.canvas.last_render_ms}),
        ),
        "desigma_set_view" => {
            editable(app)?;
            let a: View = parse(args)?;
            if let Some(id) = a.page_id {
                if !app.doc.pages.contains(&NodeId(id)) {
                    return Err("Unknown page".into());
                }
            }
            for v in [a.x, a.y].into_iter().flatten() {
                if !v.is_finite() || v.abs() > 1_000_000.0 {
                    return Err("Viewport coordinates must be finite and within +/-1000000".into());
                }
            }
            if a.zoom.is_some_and(|z| !z.is_finite() || !(crate::theme::ZOOM_MIN..=crate::theme::ZOOM_MAX).contains(&z)) {
                return Err("Zoom is outside the editor's supported range".into());
            }
            if let Some(id) = a.page_id {
                app.page = NodeId(id);
                app.selection.clear();
                app.canvas.reset_interaction();
                app.changed();
            }
            if let Some(x) = a.x {
                app.view.offset.x = x;
            }
            if let Some(y) = a.y {
                app.view.offset.y = y;
            }
            if let Some(z) = a.zoom {
                app.view.zoom = z;
            }
            ctx.request_repaint();
            call(app, ctx, "desigma_get_view", json!({}))
        }
        "desigma_allocate_node_ids" => {
            let n = args["count"].as_u64().filter(|n| (1..=1000).contains(n)).ok_or("count must be 1..1000")?;
            let ids = (0..n).map(|_| AppHost(app).alloc_id()).collect::<Result<Vec<_>, _>>()?;
            Ok(json!({"node_ids":ids}))
        }
        "desigma_export_document" => {
            let format = text(&args, "format")?;
            let data = match format {
                "desigma" => app.doc.to_json().map_err(|e| e.to_string())?,
                "variables" => desigma_fig::export_variables_json(&app.doc).to_string(),
                _ => return Err("Unsupported document format".into()),
            };
            Ok(json!({"format":format,"text":data}))
        }
        "desigma_import_variables" => {
            editable(app)?;
            let n = app.import_variables_text(text(&args, "json")?)?;
            Ok(json!({"imported":n}))
        }
        "desigma_create_project" => {
            let n = text(&args, "name")?;
            if n.len() > 1024 {
                return Err("Name exceeds 1024 bytes".into());
            }
            serde_json::to_value(library(app)?.create_project(n).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
        }
        "desigma_list_projects" => Ok(json!({"projects":library(app)?.list_projects()})),
        "desigma_save_to_project" => {
            editable(app)?;
            app.save_to_library_as(text(&args, "project_id")?, None, text(&args, "name")?);
            if let Some(toast) = &app.toast {
                if toast.error {
                    return Err(toast.text.clone());
                }
            }
            Ok(json!({"saved":true}))
        }
        "desigma_list_files" => {
            let lib = library(app)?;
            let files = lib
                .all_files()
                .into_iter()
                .map(|f| {
                    let path = lib.root().join("projects").join(&f.project).join("files").join(format!("{}.desigma", f.id));
                    let mut v = json!(f);
                    v["path"] = json!(path);
                    v
                })
                .collect::<Vec<_>>();
            Ok(json!({"files":files}))
        }
        "desigma_share_document" => {
            editable(app)?;
            let role = if args["role"].as_str() == Some("viewer") { desigma_collab::Role::Viewer } else { desigma_collab::Role::Editor };
            app.start_sharing(ctx, args["password"].as_str().map(str::to_string), args["approval"].as_bool().unwrap_or(false), role);
            call(app, ctx, "desigma_get_collaboration", json!({}))
        }
        "desigma_join_document" => {
            editable(app)?;
            if app.hist.can_undo() && args["discard_changes"].as_bool() != Some(true) {
                return Err("Save the current document first, or explicitly set discard_changes=true".into());
            }
            app.join_session(ctx, text(&args, "link")?, text(&args, "name")?, args["password"].as_str().unwrap_or(""))?;
            Ok(json!({"joining":true}))
        }
        "desigma_get_collaboration" => {
            Ok(json!({"hosting":app.collab.host.is_some(),"joining":app.collab.joining.is_some(),"guest":app.collab.guest.is_some(),
            "link":app.collab.host.as_ref().and_then(|h|h.link.link()),"peers":app.collab.host.as_ref().map_or(0,|h|h.peers.len()),
            "requests":app.collab.requests.iter().map(|r|json!({"id":r.id,"name":r.name})).collect::<Vec<_>>()}))
        }
        "desigma_end_collaboration" => {
            app.end_collab();
            Ok(json!({"ended":true}))
        }
        "desigma_list_plugins" => {
            let root = library(app)?.root();
            let installed = crate::plugins::store::list(root)?;
            Ok(json!({"plugins":installed,"running":app.plugins.running_id,"pending":app.plugins.pending,"error":app.plugins.error}))
        }
        "desigma_install_plugin" => {
            crate::plugins::store::validate_url(text(&args, "url")?)?;
            app.plugins.url = text(&args, "url")?.into();
            app.install_plugin(ctx);
            Ok(json!({"installing":true}))
        }
        "desigma_open_plugin" => {
            app.open_plugins();
            app.plugins.open = false;
            let plugin = app.plugins.installed.iter().find(|p| Some(p.id.as_str()) == args["id"].as_str()).cloned().ok_or("Plugin is not installed")?;
            app.start_plugin(&plugin, ctx)?;
            Ok(json!({"opened":true}))
        }
        "desigma_stop_plugin" => {
            app.stop_plugin();
            Ok(json!({"stopped":true}))
        }
        "desigma_create_peer_offer" | "desigma_accept_peer_offer" | "desigma_accept_peer_answer" => {
            Err("This operation is handled by the browser WebRTC adapter".into())
        }
        "desigma_present" => {
            if args["active"].as_bool().ok_or("active must be boolean")? {
                editable(app)?;
                app.start_present();
            } else {
                app.proto.present = None;
            }
            ctx.request_repaint();
            Ok(json!({"active":app.proto.present.is_some()}))
        }
        "desigma_export_asset" => export_asset(app, args),
        "desigma_import_svg" => {
            if args.get("svg").is_none() {
                if let Some(path) = args.get("path").and_then(Value::as_str) {
                    let svg = desigma_platform::fs::read_to_string(path).map_err(|e| e.to_string())?;
                    args["svg"] = json!(svg);
                    args.as_object_mut().unwrap().remove("path");
                }
            }
            app.bridge_call(name, args)
        }
        _ => app.bridge_call(name, args),
    }
}

fn export_asset(app: &App, args: Value) -> Result<Value, String> {
    let format = text(&args, "format")?;
    let path = text(&args, "path")?;
    if !std::path::Path::new(path).v_is_absolute() {
        return Err("Use an absolute browser storage path".into());
    }
    if std::path::Path::new(path).extension().and_then(|e| e.to_str()) != Some(format) {
        return Err(format!("Export path must end in .{format}"));
    }
    let scale = args.get("scale").and_then(Value::as_f64).unwrap_or(1.0) as f32;
    if !(0.25..=4.0).contains(&scale) {
        return Err("scale must be 0.25..4".into());
    }
    let bytes = if format == "pdf" {
        app.deck_pdf_bytes(args["all_slides"].as_bool().unwrap_or(true))?
    } else {
        let id = NodeId(args["node_id"].as_u64().ok_or("node_id is required")?);
        if app.doc.get(id).is_none() {
            return Err("Unknown node".into());
        }
        let doc = app.export_doc();
        let (w, h) = desigma_export::render_size(&doc, id, scale).ok_or("Cannot render node")?;
        if format != "svg" && w as u64 * h as u64 > 16_777_216 {
            return Err("Export exceeds 16 megapixels; reduce scale".into());
        }
        let format = match format {
            "png" => desigma_export::ExportFormat::Png,
            "jpg" => desigma_export::ExportFormat::Jpg,
            "svg" => desigma_export::ExportFormat::Svg,
            _ => return Err("Unsupported export format".into()),
        };
        desigma_export::ExportSetting { format, scale: desigma_export::ExportScale::Factor(scale) }.render(&doc, id)
    };
    desigma_platform::fs::write(path, &bytes).map_err(|e| e.to_string())?;
    Ok(json!({"path":path,"bytes":bytes.len(),"format":format}))
}

#[cfg(target_arch = "wasm32")]
pub fn set_image_fill(app: &mut App, bytes: Vec<u8>) -> Result<(), String> {
    let (bytes, _, _) = crate::canvas::interact::prepare_image(bytes)?;
    let key = format!("browser-image-{}", desigma_library::new_id());
    app.doc.images.insert(key.clone(), bytes);
    let ids = app.selection.clone();
    app.edit_nodes(&ids, |n| {
        n.fills = vec![Paint { kind: PaintKind::Image { image_ref: key.clone(), scale_mode: ImageScaleMode::Fill }, ..Paint::solid(desigma_doc::Color::WHITE) }]
    });
    Ok(())
}

fn actions() -> Vec<(&'static str, crate::panels::menus::Action)> {
    use crate::panels::menus::Action::*;
    vec![
        ("language_english", SetLanguage(crate::i18n::Lang::En)),
        ("language_chinese", SetLanguage(crate::i18n::Lang::ZhCn)),
        ("new_design", New),
        ("new_board", NewBoard),
        ("new_deck", NewDeck),
        ("save", Save),
        ("save_as", SaveAs),
        ("select_all", SelectAll),
        ("select_inverse", SelectInverse),
        ("select_children", SelectChildren),
        ("select_parent", SelectParent),
        ("select_matching", SelectMatching),
        ("delete", Delete),
        ("duplicate", Duplicate),
        ("group", Group),
        ("ungroup", Ungroup),
        ("frame_selection", FrameSelection),
        ("auto_layout", AutoLayout),
        ("fit_all", FitAll),
        ("fit_selection", FitSelection),
        ("zoom_100", Zoom100),
        ("zoom_in", ZoomIn),
        ("zoom_out", ZoomOut),
        ("bring_forward", BringForward),
        ("send_backward", SendBackward),
        ("bring_to_front", BringToFront),
        ("send_to_back", SendToBack),
        ("create_component", CreateComponent),
        ("detach", Detach),
        ("combine_variants", CombineVariants),
        ("go_to_main", GoToMain),
        ("reset_instance", ResetInstance),
        ("copy", Copy),
        ("paste", Paste),
        ("pixel_grid", TogglePixelGrid),
        ("rulers", ToggleRulers),
        ("layout_grids", ToggleLayoutGrids),
        ("snap_pixel", ToggleSnapPixel),
        ("text_bold", TextBold),
        ("text_italic", TextItalic),
        ("text_underline", TextUnderline),
        ("text_size_up", TextSizeUp),
        ("text_size_down", TextSizeDown),
        ("bullet_list", TextBulletList),
        ("numbered_list", TextNumberedList),
        ("align_left", Align(crate::ops::Align::Left)),
        ("align_center", Align(crate::ops::Align::HCenter)),
        ("align_right", Align(crate::ops::Align::Right)),
        ("align_top", Align(crate::ops::Align::Top)),
        ("align_middle", Align(crate::ops::Align::VCenter)),
        ("align_bottom", Align(crate::ops::Align::Bottom)),
        ("boolean_union", Boolean(desigma_doc::BooleanOp::Union)),
        ("boolean_subtract", Boolean(desigma_doc::BooleanOp::Subtract)),
        ("boolean_intersect", Boolean(desigma_doc::BooleanOp::Intersect)),
        ("boolean_exclude", Boolean(desigma_doc::BooleanOp::Exclude)),
        ("distribute", Distribute),
        ("flatten", Flatten),
        ("outline_stroke", OutlineStroke),
        ("edit_vertices", EditVertices),
        ("join_vertices", VectorJoin),
        ("split_path", VectorSplit),
        ("simplify_path", VectorSimplify),
        ("plugins", Plugins),
        ("files", BackToFiles),
        ("save_to_library", SaveToLibrary),
        ("share", Share),
        ("join_session", JoinSession),
        ("version_history", ToggleVersionHistory),
        ("save_version", SaveVersion),
        ("mark_ready", MarkReadyForDev),
        ("mark_completed", MarkCompleted),
        ("clear_dev_status", ClearDevStatus),
    ]
}

/// Never allow a temporarily cyclic graph: later native commands traverse parents.
/// Inserted subtrees are self-contained and cannot overwrite existing IDs.
fn stage_commands(doc: &mut desigma_doc::Document, command: &Command) -> Result<(), String> {
    let Command::Batch(commands) = command else { return Err("Expected a command batch".into()) };
    for command in commands {
        match command {
            Command::Batch(_) => return Err("Nested batches are not supported; use the top-level commands array".into()),
            Command::Insert { nodes, .. } | Command::InsertPage { nodes, .. } => {
                let parent = if let Command::Insert { parent, .. } = command { Some(*parent) } else { None };
                let root = nodes.first().ok_or("Insert needs a subtree")?;
                if parent.is_none() != matches!(root.kind, desigma_doc::NodeKind::Page { .. }) {
                    return Err("Page roots must use InsertPage".into());
                }
                let mut by_id = std::collections::BTreeMap::new();
                for node in nodes {
                    if node.id.0 == 0 || doc.get(node.id).is_some() || by_id.insert(node.id, node).is_some() {
                        return Err("Insert IDs must be fresh and unique".into());
                    }
                }
                let mut seen = std::collections::BTreeSet::new();
                let mut stack = vec![(root.id, 0usize)];
                while let Some((id, depth)) = stack.pop() {
                    if depth > 255 || !seen.insert(id) {
                        return Err("Inserted subtree contains a cycle or duplicate child".into());
                    }
                    let node = by_id.get(&id).ok_or("Inserted subtree references a missing child")?;
                    if !node.kind.is_container() && !node.children.is_empty() {
                        return Err("Only containers can have children".into());
                    }
                    for child in &node.children {
                        if by_id.get(child).is_none_or(|n| n.parent != Some(id)) {
                            return Err("Inserted subtree has inconsistent parent links".into());
                        }
                        stack.push((*child, depth + 1));
                    }
                }
                if seen.len() != nodes.len() {
                    return Err("Insert contains unreachable nodes".into());
                }
                if let Some(parent) = parent {
                    if doc.get(parent).is_none_or(|n| !n.kind.is_container()) {
                        return Err("Insert parent is not a container".into());
                    }
                }
            }
            Command::Update { node } => {
                let old = doc.get(node.id).ok_or("Unknown node")?;
                if !node.kind.is_container() && !old.children.is_empty() {
                    return Err("Cannot turn a container with children into a leaf".into());
                }
                if matches!(old.kind, desigma_doc::NodeKind::Page { .. }) != matches!(node.kind, desigma_doc::NodeKind::Page { .. }) {
                    return Err("Cannot change page/root kind".into());
                }
            }
            Command::SetGuides { page, .. } | Command::SetTimeline { page, .. } => {
                if !doc.pages.contains(page) {
                    return Err("Unknown page".into());
                }
            }
            _ => {}
        }
        command.clone().apply(doc).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn node_templates() -> Value {
    use desigma_doc::NodeKind::*;
    let kinds = vec![
        Page { background: desigma_doc::Color::WHITE },
        Frame(Default::default()),
        Group,
        Section,
        Rectangle,
        Ellipse(Default::default()),
        Line,
        Polygon { count: 3 },
        Star { count: 5, inner_ratio: 0.5 },
        Vector { paths: Vec::new(), network: None },
        Text(Default::default()),
        BooleanOp(desigma_doc::BooleanOp::Union),
        Component(Default::default()),
        ComponentSet(Default::default()),
        Instance { frame: Default::default(), component: None, component_key: None },
        Sticky(Default::default()),
        Connector(Default::default()),
        ShapeWithText(Default::default()),
        Stamp { kind: "heart".into() },
        BoardSection(Default::default()),
        Table(Default::default()),
        TableCell(Default::default()),
        CodeBlock(Default::default()),
    ];
    json!({"templates":kinds.into_iter().map(|kind| { let mut node=desigma_doc::Node::new(NodeId(0),kind);node.size=desigma_doc::Vec2::new(100.0,100.0);node }).collect::<Vec<_>>()})
}
fn identifier<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    let id = text(args, key)?;
    if id.len() > 128 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
        return Err(format!("{key} is not a library ID"));
    }
    Ok(id)
}
fn library_query(app: &App, args: Value) -> Result<Value, String> {
    let lib = library(app)?;
    match text(&args, "operation")? {
        "file" => Ok(json!(lib.file(identifier(&args, "file_id")?).map_err(|e| e.to_string())?)),
        "trash" => Ok(json!(lib.list_trash())),
        "versions" => Ok(json!(lib.list_versions(identifier(&args, "file_id")?))),
        "shared_libraries" => Ok(json!(lib.list_libraries().map_err(|e| e.to_string())?)),
        "shared_snapshot" => {
            Ok(json!(lib.load_snapshot(identifier(&args, "library_id")?, args["version"].as_u64().map(|v| v as u32)).map_err(|e| e.to_string())?))
        }
        _ => Err("Unknown library query".into()),
    }
}
fn library_edit(app: &mut App, args: Value) -> Result<Value, String> {
    let lib = library(app)?.clone();
    let operation = text(&args, "operation")?;
    for key in ["project_id", "file_id", "folder_id", "parent_id", "library_id"] {
        if args.get(key).is_some() {
            identifier(&args, key)?;
        }
    }
    if matches!(operation, "empty_trash" | "delete_version") && args["confirm"].as_bool() != Some(true) {
        return Err("Permanent deletion requires confirm=true".into());
    }
    let detaches = app.lib_file.as_ref().is_some_and(|f| {
        (operation == "trash_file" && args["file_id"].as_str() == Some(f.id.as_str()))
            || (operation == "trash_project" && args["project_id"].as_str() == Some(f.project_id.as_str()))
    });
    if detaches {
        if app.collab.active() {
            return Err("End collaboration before trashing the open file".into());
        }
        app.flush_autosave();
    }
    let name = || text(&args, "name");
    let file = || identifier(&args, "file_id");
    let project = || identifier(&args, "project_id");
    let folder = || identifier(&args, "folder_id");
    let version =
        || args["version"].as_u64().and_then(|v| u32::try_from(v).ok()).filter(|v| *v > 0).ok_or_else(|| "version must be a positive integer".to_string());
    let label = args["label"].as_str().map(str::to_string);
    let description = args["description"].as_str().unwrap_or("");
    let mut output = json!({"changed":true});
    let result: desigma_library::Result<()> = match operation {
        "rename_project" => lib.rename_project(project()?, name()?),
        "trash_project" => lib.delete_project(project()?),
        "create_folder" => lib.create_folder(project()?, args["parent_id"].as_str(), name()?).map(|f| output = json!(f)),
        "rename_folder" => lib.rename_folder(project()?, folder()?, name()?),
        "move_folder" => lib.move_folder(project()?, folder()?, args["parent_id"].as_str()),
        "rename_file" => lib.rename_file(file()?, name()?),
        "duplicate_file" => lib.duplicate_file(file()?).map(|f| output = json!(f)),
        "move_file" => lib.move_file(file()?, project()?, args["folder_id"].as_str()),
        "star_file" => lib.star(file()?, args["starred"].as_bool().ok_or("starred must be boolean")?),
        "trash_file" => lib.trash_file(file()?),
        "restore" => lib.restore(file()?),
        "empty_trash" => lib.empty_trash(),
        "save_version" => lib.save_version_described(file()?, &app.doc, label, Some(description.into()), false).map(|v| output = json!(v)),
        "rename_version" => lib.rename_version(file()?, version()?, label, Some(description.into())),
        "delete_version" => lib.delete_version(file()?, version()?),
        "publish" => lib.publish_library(file()?, &app.doc, description).map(|v| output = json!(v)),
        "unpublish" => lib.unpublish(identifier(&args, "library_id")?),
        "restore_library" => lib.restore_library(identifier(&args, "library_id")?),
        _ => return Err("Unknown library operation".into()),
    };
    result.map_err(|e| e.to_string())?;
    if detaches {
        app.lib_file = None;
        app.file_path = None;
        app.history.reset();
    }
    if let Some(home) = app.home.as_mut() {
        home.refresh(&lib);
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn app() -> App {
        let mut doc = desigma_doc::Document::new("Browser tools");
        let page = doc.add_page("Page");
        let id = doc.alloc_id();
        doc.insert(page, desigma_doc::Node::rectangle(id, desigma_doc::Rect::new(1.0, 2.0, 100.0, 80.0))).unwrap();
        App::new(doc)
    }
    #[test]
    fn invalid_batch_never_changes_the_live_document_or_undo_stack() {
        let mut app = app();
        let before = app.doc.to_json().unwrap();
        let id = app.doc.get(app.page).unwrap().children[0];
        let mut node = app.doc.get(id).unwrap().clone();
        node.name = "Should not leak".into();
        let args = json!({"commands":[{"Update":{"node":node}},{"Remove":{"id":999999}}]});
        assert!(call(&mut app, &egui::Context::default(), "desigma_apply_commands", args).is_err());
        assert_eq!(app.doc.to_json().unwrap(), before);
        assert_eq!(app.hist.undo_len(), 0);
    }
    #[test]
    fn full_node_commands_share_the_editor_undo_and_redo() {
        let mut app = app();
        let ctx = egui::Context::default();
        let id = app.doc.get(app.page).unwrap().children[0];
        let mut node = app.doc.get(id).unwrap().clone();
        node.corner_radii = [24.0; 4];
        node.name = "Updated".into();
        call(&mut app, &ctx, "desigma_apply_commands", json!({"commands":[{"Update":{"node":node}}]})).unwrap();
        assert_eq!(app.hist.undo_len(), 1);
        assert_eq!(app.doc.get(id).unwrap().name, "Updated");
        call(&mut app, &ctx, "desigma_undo", json!({})).unwrap();
        assert_ne!(app.doc.get(id).unwrap().name, "Updated");
        call(&mut app, &ctx, "desigma_redo", json!({})).unwrap();
        assert_eq!(app.doc.get(id).unwrap().corner_radii, [24.0; 4]);
    }
    #[test]
    fn invalid_view_updates_are_atomic_and_do_not_move_the_canvas() {
        let mut app = app();
        let ctx = egui::Context::default();
        let before = call(&mut app, &ctx, "desigma_get_view", json!({})).unwrap();
        assert!(call(&mut app, &ctx, "desigma_set_view", json!({"x":10,"zoom":-1})).is_err());
        assert_eq!(call(&mut app, &ctx, "desigma_get_view", json!({})).unwrap(), before);
    }
    #[test]
    fn insert_cannot_overwrite_a_node_or_create_a_cycle_before_a_later_command() {
        let mut app = app();
        let ctx = egui::Context::default();
        let page = app.page;
        let id = app.doc.get(page).unwrap().children[0];
        let node = app.doc.get(id).unwrap().clone();
        let before = app.doc.to_json().unwrap();
        assert!(call(&mut app, &ctx, "desigma_apply_commands", json!({"commands":[{"Insert":{"parent":page,"index":0,"nodes":[node]}}]})).is_err());
        let mut cycle = desigma_doc::Node::frame(NodeId(1000), desigma_doc::Rect::new(0.0, 0.0, 100.0, 100.0));
        cycle.parent = Some(cycle.id);
        cycle.children.push(cycle.id);
        assert!(call(
            &mut app,
            &ctx,
            "desigma_apply_commands",
            json!({"commands":[{"Insert":{"parent":page,"index":0,"nodes":[cycle]}},{"Reparent":{"id":1000,"parent":id,"index":0}}]})
        )
        .is_err());
        assert_eq!(app.doc.to_json().unwrap(), before);
    }

    #[test]
    fn new_document_from_library_opens_the_editor_and_failed_open_keeps_library() {
        let mut app = app();
        let ctx = egui::Context::default();
        app.home = Some(crate::home::Home::new());
        assert!(call(&mut app, &ctx, "desigma_open_file", json!({"path":"/no-such-browser-test.desigma"})).is_err());
        assert!(app.home.is_some());
        call(&mut app, &ctx, "desigma_new_document", json!({"name":"From library"})).unwrap();
        assert!(app.home.is_none());
        assert_eq!(app.doc.name, "From library");
    }

    #[test]
    fn browser_catalog_contains_every_native_tool_once() {
        let browser = catalog();
        let browser = browser.as_array().unwrap();
        let mut names = std::collections::BTreeSet::new();
        for tool in browser {
            assert!(names.insert(tool["name"].as_str().unwrap()));
            assert_eq!(tool["inputSchema"]["type"], "object");
        }
        for tool in desigma_mcp::catalog::tools() {
            assert!(names.contains(tool["name"].as_str().unwrap()));
        }
    }
}
