use super::{call, editable, parse};
use crate::app::App;
use desigma_doc::*;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;

pub fn inspect_components(doc: &Document) -> Value {
    let mut masters = Vec::new();
    let mut instances = Vec::new();
    let mut warnings = Vec::new();
    let mut instance_count = 0;
    let mut unresolved = 0;
    let mut master_count = 0;
    for n in doc.nodes.values() {
        if matches!(n.kind, NodeKind::Component(_)) {
            master_count += 1;
            if masters.len() < 1000 {
                masters.push(json!({"node_id":n.id,"name":n.name,"properties":n.component.props}));
            }
        }
        if let NodeKind::Instance { component, component_key, .. } = &n.kind {
            instance_count += 1;
            let master = component.and_then(|id| doc.get(id)).filter(|n| matches!(n.kind, NodeKind::Component(_)));
            if master.is_none() {
                unresolved += 1;
                if warnings.len() < 1000 {
                    warnings.push(json!({"code":"unresolved_master","node_id":n.id,"name":n.name,"component_id":component,"component_key":component_key}));
                }
            }
            if instances.len() < 1000 {
                instances.push(
                    json!({"node_id":n.id,"name":n.name,"component_id":component,"master_present":master.is_some(),"master_name":master.map(|n|&n.name)}),
                );
            }
        }
        if let Some(source) = n.component.source {
            if !doc.nodes.contains_key(&source) && warnings.len() < 1000 {
                warnings.push(json!({"code":"unresolved_mirror_source","node_id":n.id,"name":n.name,"source_id":source}));
            }
        }
    }
    json!({"master_count":master_count,"instance_count":instance_count,"unresolved_master_count":unresolved,
        "masters":masters,"instances":instances,"warnings":warnings,"truncated":instance_count>1000||master_count>1000||warnings.len()>=1000,
        "verification":"Checks master/source references, not visual equivalence. Preserve masters when rebuilding a component sheet; detach intentionally if a reusable relationship is no longer wanted."})
}

pub fn instance_schema() -> Value {
    json!({
        "component_id":{"type":"integer","minimum":1},
        "parent_id":{"type":"integer","minimum":1},
        "name":{"type":"string","minLength":1,"maxLength":1024},
        "x":{"type":"number","minimum":-1000000,"maximum":1000000},
        "y":{"type":"number","minimum":-1000000,"maximum":1000000},
        "width":{"type":"number","exclusiveMinimum":0,"maximum":1000000},
        "height":{"type":"number","exclusiveMinimum":0,"maximum":1000000},
        "properties":{"type":"object","description":"Property name to plain string (Text/Variant), boolean, or component ID (InstanceSwap). Read the master's component.props first."}
    })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct InstanceArgs {
    component_id: NodeId,
    parent_id: NodeId,
    name: Option<String>,
    #[serde(default)]
    x: f32,
    #[serde(default)]
    y: f32,
    width: Option<f32>,
    height: Option<f32>,
    #[serde(default)]
    properties: BTreeMap<String, Value>,
}

pub fn create_instance(app: &mut App, ctx: &egui::Context, args: Value) -> Result<Value, String> {
    editable(app)?;
    let a: InstanceArgs = parse(args)?;
    if ![a.x, a.y].iter().all(|v| v.is_finite() && v.abs() <= 1_000_000.0)
        || [a.width, a.height].into_iter().flatten().any(|v| !v.is_finite() || v <= 0.0 || v > 1_000_000.0)
    {
        return Err("Instance position or size is outside the supported finite range".into());
    }
    if a.name.as_ref().is_some_and(|s| s.trim().is_empty() || s.len() > 1024) {
        return Err("name must contain 1..1024 bytes".into());
    }
    if a.properties.len() > 256 || a.properties.iter().any(|(k, v)| k.len() > 1024 || v.as_str().is_some_and(|s| s.len() > 100_000)) {
        return Err("At most 256 properties; property names <=1024 bytes and text values <=100000 bytes".into());
    }
    let comp = app.doc.get(a.component_id).ok_or("Unknown component_id")?;
    if !matches!(comp.kind, NodeKind::Component(_)) {
        return Err("component_id must identify a Component master, not a set, frame or instance".into());
    }
    let definitions = prop_defs(&app.doc, a.component_id);
    let mut values = Vec::new();
    for (key, value) in a.properties {
        let def = definitions.iter().find(|d| d.name == key).ok_or_else(|| format!("Unknown component property {key:?}"))?;
        let parsed = match (&def.kind, value) {
            (PropKind::Text, Value::String(s)) => Some(PropValue::Text(s)),
            (PropKind::Boolean, Value::Bool(b)) => Some(PropValue::Bool(b)),
            (PropKind::Variant { options }, Value::String(s)) if options.contains(&s) => Some(PropValue::Variant(s)),
            (PropKind::InstanceSwap { .. }, Value::Number(n)) => {
                n.as_u64().map(NodeId).filter(|id| app.doc.get(*id).is_some_and(|n| matches!(n.kind, NodeKind::Component(_)))).map(PropValue::Instance)
            }
            _ => None,
        }
        .ok_or_else(|| format!("Invalid value for component property {key:?} ({:?})", def.kind))?;
        values.push((key, parsed));
    }
    // Allocate and construct only in a scratch document. Validation failures cannot
    // leave half an instance, consume live IDs, or change the editor's Undo stack.
    let mut staged = app.doc.clone_without_images();
    let insert = desigma_doc::create_instance(&mut staged, a.component_id, a.parent_id, Vec2::new(a.x, a.y));
    let Command::Insert { nodes, index, .. } = &insert else {
        return Err("parent_id must be a container outside the component's subtree".into());
    };
    let id = nodes[0].id;
    let index = *index;
    insert.apply(&mut staged).map_err(|e| e.to_string())?;
    for (key, value) in values {
        let command = set_instance_prop(&mut staged, id, &key, Some(value));
        command.apply(&mut staged).map_err(|e| e.to_string())?;
    }
    if let Some(name) = a.name {
        staged.get_mut(id).unwrap().name = name;
        staged.get_mut(id).unwrap().component.overrides.insert(OverrideField::Name);
    }
    if a.width.is_some() || a.height.is_some() {
        let root = staged.get(id).unwrap();
        let size = Vec2::new(a.width.unwrap_or(root.size.x), a.height.unwrap_or(root.size.y));
        let transform = root.transform;
        desigma_engine::apply_resize(&mut staged, &mut desigma_engine::edit::Edit::new(), id, size, transform, false);
        staged.get_mut(id).unwrap().component.overrides.insert(OverrideField::Size);
    }
    fn collect(doc: &Document, id: NodeId, nodes: &mut Vec<Node>) {
        let n = doc.get(id).unwrap();
        nodes.push(n.clone());
        for child in &n.children {
            collect(doc, *child, nodes);
        }
    }
    let mut nodes = Vec::new();
    collect(&staged, id, &mut nodes);
    call(app, ctx, "desigma_apply_commands", json!({"commands":[{"Insert":{"parent":a.parent_id,"index":index,"nodes":nodes}}]}))?;
    let mut actual = Vec::new();
    collect(&app.doc, id, &mut actual);
    Ok(json!({"node_id":id,"component_id":a.component_id,"undo_steps":1,
        "nodes":actual.iter().map(|n|json!({"node_id":n.id,"name":n.name,"parent_id":n.parent,"source_id":n.component.source,"width":n.size.x,"height":n.size.y})).collect::<Vec<_>>() }))
}
