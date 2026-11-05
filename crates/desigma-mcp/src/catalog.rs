//! Transport-independent MCP tool catalog.
use serde_json::json;
pub fn tools() -> Vec<serde_json::Value> {
    let mut raw = crate::engine::tools();
    for (name, description, properties, required) in [
        ("desigma_open_file", "Open a .desigma, .fig, .pen (Pencil), SVG or Figma REST JSON file inside the workspace: in the editor when its agent bridge is on, otherwise into the isolated file session. Refuses while the session (or the editor) has unsaved edits; ask the user to save, or pass discard_changes=true to throw them away. Call desigma_list_files for the path.", json!({"path":{"type":"string"},"discard_changes":{"type":"boolean","default":false}}), vec!["path"]),
        ("desigma_save_file", "Save the document as a .desigma file inside the workspace (in the editor: a copy; its own file path is unchanged). By default the file must not exist yet; pass overwrite=true to replace an existing .desigma file atomically, e.g. the `path` desigma_get_document reports. Parent directory must exist.", json!({"path":{"type":"string"},"overwrite":{"type":"boolean","default":false}}), vec!["path"]),
        ("desigma_delete_page", "Delete a page and everything on it. Refuses to delete the last remaining page.", json!({"node_id":{"type":"integer","minimum":1}}), vec!["node_id"]),
        ("desigma_new_document", "Start a blank document with one page. Refuses while the session (or the editor) has unsaved edits; ask the user to save, or pass discard_changes=true to throw them away.", json!({"name":{"type":"string","minLength":1,"maxLength":1024},"discard_changes":{"type":"boolean","default":false}}), vec!["name"]),
    ] {
        raw.push(json!({"name":name,"description":description,"inputSchema":{"type":"object","properties":properties,"required":required,"additionalProperties":false},"annotations":{"readOnlyHint":false,"destructiveHint":name != "desigma_save_file","idempotentHint":false,"openWorldHint":false}}));
    }
    let id = json!({"type":"integer","minimum":1,"description":"Desigma numeric node ID; obtain from list_nodes/get_document."});
    raw.push(json!({"name":"desigma_list_files","description":"Design files this user can open. Each entry's path is inside the workspace and is valid for desigma_open_file. Library files are the Desigma library. shared/ is a copy of a file opened from outside the library, and only while the agent bridge is on.","inputSchema":{"type":"object","properties":{},"required":[],"additionalProperties":false},"annotations":{"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false}}));
    raw.push(json!({"name":"desigma_get_selection","description":"Layers currently selected in the running editor. Requires the editor's agent bridge; errors in a file session.","inputSchema":{"type":"object","properties":{},"required":[],"additionalProperties":false},"annotations":{"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false}}));
    raw.push(json!({"name":"desigma_select_nodes","description":"Select layers in the running editor and scroll/zoom to them (reveal=true). Requires the agent bridge.","inputSchema":{"type":"object","properties":{"node_ids":{"type":"array","items":id,"minItems":1,"maxItems":500},"reveal":{"type":"boolean","default":true}},"required":["node_ids"],"additionalProperties":false},"annotations":{"readOnlyHint":false,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false}}));
    raw
}
