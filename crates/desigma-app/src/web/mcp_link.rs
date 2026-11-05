//! Browser agent access uses WebMCP, not desktop application configuration files.
use crate::app::App;
pub fn show(app: &mut App, ctx: &egui::Context) {
    if !app.mcp_dialog {
        return;
    }
    let mut open = true;
    egui::Window::new("WebMCP").open(&mut open).resizable(false).default_width(400.0).show(ctx, |ui| {
        ui.label("Browser agents can inspect and edit this document using WebMCP. Their changes share your Undo history.");
        ui.add_space(12.0);
        let enabled = app.bridge.bridge.is_some();
        if ui.button(if enabled { "Disable agent access" } else { "Enable agent access" }).clicked() {
            app.toggle_agent_bridge(ctx);
        }
        ui.label("Browsers without native WebMCP can use window.desigma.tools() and window.desigma.call(name, arguments).");
        if ui.button("Copy JavaScript example").clicked() {
            ctx.copy_text("await window.desigma.call('desigma_get_document', {})".into());
        }
    });
    app.mcp_dialog = open;
}
