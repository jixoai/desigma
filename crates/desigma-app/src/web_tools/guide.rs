use desigma_doc::*;
use serde_json::{json, Value};

fn object(properties: Value, required: &[&str]) -> Value {
    json!({"type":"object","properties":properties,"required":required,"additionalProperties":false})
}

pub fn command_schema() -> Value {
    let id = json!({"type":"integer","minimum":1});
    let index = json!({"type":"integer","minimum":0});
    let node = json!({"type":"object","description":"Full native Node from get_node_templates or get_node. Nested native values are validated by Rust with field paths."});
    let nodes = json!({"type":"array","minItems":1,"maxItems":100000,"items":node});
    let mut variants = Vec::new();
    for (name, properties, required) in [
        ("Insert", json!({"parent":id,"index":index,"nodes":nodes}), vec!["parent", "index", "nodes"]),
        ("InsertPage", json!({"index":index,"nodes":nodes}), vec!["index", "nodes"]),
        ("Remove", json!({"id":id}), vec!["id"]),
        ("RemovePage", json!({"id":id}), vec!["id"]),
        ("Reparent", json!({"id":id,"parent":id,"index":index}), vec!["id", "parent", "index"]),
        ("Update", json!({"node":node}), vec!["node"]),
        (
            "SetFlows",
            json!({"flows":{"type":"array","items":object(json!({"name":{"type":"string"},"description":{"type":"string"},"page":id,"start":id}), &["name","description","page","start"])}}),
            vec!["flows"],
        ),
        ("SetStyles", json!({"styles":{"type":"object"},"style_meta":{"type":"object"}}), vec!["styles", "style_meta"]),
        ("SetComments", json!({"comments":{"type":"array"}}), vec!["comments"]),
        ("SetLibraryState", json!({"state":{"type":"object"},"library_page":{"type":["integer","null"]}}), vec!["state"]),
        ("SetGuides", json!({"page":id,"guides":{"type":"array"}}), vec!["page", "guides"]),
        ("SetPrototypeDevice", json!({"device":{"type":"object"}}), vec!["device"]),
        ("SetVariables", json!({"variables":{"type":"object"},"collections":{"type":"object"}}), vec!["variables", "collections"]),
        ("SetBoardSession", json!({"session":{"type":"object"}}), vec!["session"]),
        ("SetNodeMotion", json!({"node":id,"motion":{"type":"object"}}), vec!["node", "motion"]),
        ("SetTimeline", json!({"page":id,"settings":{"type":"object"}}), vec!["page", "settings"]),
    ] {
        variants.push(object(json!({name:object(properties, &required)}), &[name]));
    }
    json!({"oneOf":variants})
}

pub fn guide(topic: &str) -> Result<Value, String> {
    let commands = || {
        let mut frame = Node::frame(NodeId(100), Rect::new(0.0, 0.0, 390.0, 844.0));
        frame.name = "Screen".into();
        frame.children = vec![NodeId(101)];
        let mut label = Node::text(NodeId(101), Rect::new(24.0, 24.0, 342.0, 32.0), "示例文字", TextStyle::default());
        label.parent = Some(frame.id);
        json!({"schema_scope":"Command envelopes. Nested Node properties use the serialized templates; Rust reports their exact parse path.",
            "command_schema":command_schema(),
            "insert_example":{"commands":[{"Insert":{"parent":1,"index":0,"nodes":[frame,label]}}]},
            "rules":["Replace example IDs with allocate_node_ids results and a real parent ID.",
                "Each Insert contains exactly ONE root and its descendants, root first. Sibling roots need separate Insert commands in the SAME batch.",
                "Every descendant needs parent equal to its immediate parent's ID, and each parent's children must list those IDs.",
                "index=0 inserts behind existing siblings; append at the parent's child_count to place above them.",
                "Update takes a complete node and preserves parent/children. Use Reparent for hierarchy changes.",
                "Read returned IDs and names. Do not derive semantic node IDs from array positions.",
                "One successful apply_commands call is one Undo step. Validate the actual result, then save."]})
    };
    let components = || {
        let mut master = Node::frame(NodeId(100), Rect::new(0.0, 0.0, 240.0, 52.0));
        master.name = "Primary button".into();
        master.kind = NodeKind::Component(FrameProps::default());
        master.fills = vec![Paint::solid(Color::from_hex("#B4593B").unwrap())];
        master.children = vec![NodeId(101)];
        master.component.props.push(ComponentPropDef { name: "Label".into(), kind: PropKind::Text, default: PropValue::Text("继续".into()) });
        let mut label = Node::text(NodeId(101), Rect::new(16.0, 14.0, 208.0, 24.0), "继续", TextStyle::default());
        label.parent = Some(master.id);
        label.constraints.horizontal = Constraint::Stretch;
        if let NodeKind::Text(t) = &mut label.kind {
            t.auto_resize = TextAutoResize::None;
            t.style.align_h = TextAlignH::Center;
        }
        label.component.bindings.insert(OverrideField::Characters, "Label".into());
        json!({"master_example":{"commands":[{"Insert":{"parent":1,"index":0,"nodes":[master,label]}}]},
            "instance_example":{"tool":"desigma_create_instance","arguments":{"component_id":100,"parent_id":1,"x":24,"y":100,"width":342,"height":52,"properties":{"Label":"确认预约"}}},
            "rules":["create_instance copies visuals, mirrored children, source links and property bindings using the editor's component engine.",
                "Use Stretch constraints or auto layout Fill on label children when the instance can resize. Fixed-width children remain fixed by design.",
                "Each property must be defined on the master (component.props) and bound on the appropriate child (component.bindings).",
                "Changing a master updates linked instances; instance overrides and edits remain undoable."]})
    };
    let prototype = || {
        json!({
        "reaction_example":Reaction { trigger:Trigger::OnClick, actions:vec![Action::Navigate { dest:NodeId(200),preserve_scroll:false }],transition:None },
        "flow_example":Flow { name:"Main flow".into(), description:"Start here".into(), page:NodeId(1), start:NodeId(100) },
        "set_variable_example":Action::SetVariable { variable:"selected_date".into(),value:Expression::Literal(ExprValue::String("2026-11-22".into())) },
        "test_example":{"start_node_id":100,"steps":[{"node_id":101,"expect_frame_id":200,"expect_texts":["2026-11-22"]}]},
            "prototype_template":PrototypeProps::default(),
            "rules":["Read get_node; initialize omitted node.prototype from prototype_template, replace reactions, then Update the full node. SetFlows replaces the flow list.",
            "Bind the interaction to the control's container. Put its text, icon and background INSIDE that container; sibling overlays block background-only reactions.",
            "Back needs runtime history. A flow that starts at an error/full state needs explicit Navigate destinations for its exits.",
            "Use variables/bindings or separate state frames for different selections. Two choices linked to one static summary do NOT preserve distinct values.",
            "inspect_prototype reports actual node names and sampled hit targets. A stored reaction is not a passing interaction test.",
            "test_prototype clicks through the same player and hit testing as Present, on a private document copy. Assert both destination frames and visible text for every branch and return path.",
            "Coordinates are local to the displayed frame, NOT canvas or browser coordinates. node_id clicks the node's center and may hit an overlapping sibling; the result reports this."]})
    };
    let text = || {
        json!({"auto_layout_template":AutoLayout::default(),"text_template":TextProps::default(),
        "rules":["Text auto_resize=None keeps the specified box. Height keeps width and grows height; WidthAndHeight recomputes both dimensions.",
            "Use fixed width with Height or None for centered button labels and paragraphs. A narrow fixed box can wrap Chinese one glyph per line.",
            "Container clipping can hide overflowing text. Inspect render_preview at 1x and allow enough line height/space.",
            "Browser fonts come from bundled assets or open font downloads, not the host operating system. Font substitutions do not guarantee identical metrics.",
            "Use render_preview to receive a PNG directly without any download wait; use export_asset for an explicit downloadable deliverable."]})
    };
    match topic {
        "all" => Ok(json!({"commands":commands(),"components":components(),"prototype":prototype(),"text":text()})),
        "commands" => Ok(commands()),
        "components" => Ok(components()),
        "prototype" => Ok(prototype()),
        "text" => Ok(text()),
        _ => Err("Unknown guide topic".into()),
    }
}
