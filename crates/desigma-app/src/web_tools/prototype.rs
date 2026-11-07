use super::parse;
use crate::{
    app::App,
    proto::player::{hit_layer, rect_in_frame, top_level_frames, Player, When},
};
use desigma_doc::*;
use serde::Deserialize;
use serde_json::{json, Value};

pub fn test_schema() -> Value {
    json!({"start_node_id":{"type":"integer","minimum":1},"steps":{"type":"array","minItems":1,"maxItems":100,"items":{
    "type":"object","additionalProperties":false,
        "description":"Use node_id OR both x/y to click. With neither, wait_ms advances the clock. Supply expect_frame_id or expect_texts to verify the result; unasserted steps are observations and cannot pass. Text checks node content, not pixel visibility.",
    "properties":{
        "node_id":{"type":"integer","minimum":1},"x":{"type":"number"},"y":{"type":"number"},
        "wait_ms":{"type":"integer","minimum":0,"maximum":60000},
        "expect_frame_id":{"type":"integer","minimum":1},
        "expect_texts":{"type":"array","maxItems":50,"items":{"type":"string","maxLength":2000}}
    }}}})
}

fn identity(doc: &Document, id: Option<NodeId>) -> Value {
    id.and_then(|id| doc.get(id)).map(|n| json!({"node_id":n.id,"name":n.name,"parent_id":n.parent})).unwrap_or(Value::Null)
}

fn frame_exists(doc: &Document, id: NodeId) -> bool {
    doc.get(id).and_then(|n| n.parent).is_some_and(|page| top_level_frames(doc, page).contains(&id))
}

fn targets(actions: &[Action], out: &mut Vec<NodeId>, depth: usize) {
    if depth > 8 {
        return;
    }
    for a in actions {
        match a {
            Action::Navigate { dest, .. } | Action::OpenOverlay { dest, .. } | Action::SwapOverlay { dest } => out.push(*dest),
            Action::Conditional { branches, otherwise } => {
                for (_, a) in branches {
                    targets(a, out, depth + 1);
                }
                targets(otherwise, out, depth + 1);
            }
            _ => {}
        }
    }
}

fn has_back(actions: &[Action]) -> bool {
    actions.iter().any(|a| matches!(a, Action::Back))
}

pub fn inspect(app: &App, args: Value) -> Result<Value, String> {
    let page = args.get("page_id").map(|v| v.as_u64().map(NodeId).ok_or("page_id must be an integer")).transpose()?;
    if page.is_some_and(|p| !app.doc.pages.contains(&p)) {
        return Err("Unknown page_id".into());
    }
    let doc = &app.doc;
    let mut warnings = Vec::new();
    let mut interactions = Vec::new();
    // One clone for the whole inspection. Membership checks stay logarithmic
    // even for documents with many pages/frames.
    let frames =
        doc.pages.iter().filter(|p| page.is_none_or(|want| want == **p)).flat_map(|p| top_level_frames(doc, *p)).collect::<std::collections::BTreeSet<_>>();
    if let Some(start) = frames.first() {
        let player = Player::new(doc, *start);
        for node in player.doc.nodes.values().filter(|n| !n.prototype.reactions.is_empty()) {
            let Some(frame) = player.top_frame_of(node.id).filter(|f| frames.contains(f)) else { continue };
            if interactions.len() >= 1000 {
                break;
            }
            let bounds = rect_in_frame(&player.doc, node.id, frame);
            let mut dests = Vec::new();
            for r in &node.prototype.reactions {
                targets(&r.actions, &mut dests, 0);
            }
            for dest in &dests {
                if !frame_exists(doc, *dest) {
                    warnings.push(json!({"code":"invalid_destination","node_id":node.id,"destination_id":dest}));
                }
            }
            let clickable = node.prototype.reactions.iter().any(|r| r.trigger == Trigger::OnClick);
            let mut samples = Vec::new();
            if clickable {
                for (x, y) in [(0.5, 0.5), (0.15, 0.15), (0.85, 0.85)] {
                    let p = Vec2::new(bounds.x + bounds.w * x, bounds.y + bounds.h * y);
                    let hit = hit_layer(&player.doc, frame, p, Vec2::ZERO);
                    let reaction = hit.and_then(|id| player.find_reactive(id, When::Click));
                    samples.push(
                        json!({"x":p.x,"y":p.y,"hit":identity(&player.doc,hit),"reaction":identity(&player.doc,reaction),"matches":reaction==Some(node.id)}),
                    );
                }
                if samples.iter().any(|s| s["matches"] == false) {
                    warnings.push(json!({"code":"click_sample_misses","node_id":node.id,"name":node.name,"hint":"Inspect sampled hits. Text/icons should be children of the reactive container. Samples outside the initial viewport can also miss."}));
                }
                if bounds.w < 44.0 || bounds.h < 44.0 {
                    warnings.push(json!({"code":"small_click_target","node_id":node.id,"width":bounds.w,"height":bounds.h}));
                }
                if doc.flows.iter().any(|f| f.start == frame) && node.prototype.reactions.iter().any(|r| has_back(&r.actions)) {
                    warnings.push(json!({"code":"back_at_flow_start","node_id":node.id,"frame_id":frame,"hint":"Back cannot leave a freshly started flow without history. Provide an explicit Navigate exit."}));
                }
            }
            interactions.push(json!({"node":identity(doc,Some(node.id)),"frame":identity(doc,Some(frame)),"bounds":bounds,
                "reactions":node.prototype.reactions,"destinations":dests.iter().map(|id|identity(doc,Some(*id))).collect::<Vec<_>>(),"click_samples":samples}));
        }
    }
    for flow in doc.flows.iter().filter(|f| page.is_none_or(|p| p == f.page)) {
        if !top_level_frames(doc, flow.page).contains(&flow.start) {
            warnings.push(json!({"code":"invalid_flow_start","flow":flow.name,"start":flow.start,"page":flow.page}));
        }
    }
    Ok(json!({"flows":doc.flows.iter().filter(|f|page.is_none_or(|p|p==f.page)).collect::<Vec<_>>(),
        "interactions":interactions,"warnings":warnings,"limit":1000,"truncated":interactions.len()>=1000,
        "verification":"Static diagnostics and sampled hits only. Run test_prototype with expected frames/text for all choices and returns; inspect render_preview for clipping and appearance."}))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TestArgs {
    start_node_id: NodeId,
    steps: Vec<Step>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Step {
    node_id: Option<NodeId>,
    x: Option<f32>,
    y: Option<f32>,
    wait_ms: Option<u32>,
    expect_frame_id: Option<NodeId>,
    #[serde(default)]
    expect_texts: Vec<String>,
}

fn texts(player: &Player) -> Vec<String> {
    fn walk(doc: &Document, id: NodeId, out: &mut Vec<String>, budget: &mut usize) {
        let Some(n) = doc.get(id).filter(|n| n.visible && n.opacity > 0.0) else { return };
        if *budget == 0 || out.len() >= 200 {
            return;
        }
        if let NodeKind::Text(t) = &n.kind {
            let text: String = t.content.chars().take((*budget).min(2000)).collect();
            *budget = budget.saturating_sub(text.chars().count());
            out.push(text);
        }
        for c in &n.children {
            walk(doc, *c, out, budget);
        }
    }
    let mut out = Vec::new();
    let mut budget = 12000;
    for f in player.visible_frames() {
        walk(&player.doc, f, &mut out, &mut budget);
    }
    out
}

pub fn test(app: &App, args: Value) -> Result<Value, String> {
    let a: TestArgs = parse(args)?;
    if !frame_exists(&app.doc, a.start_node_id) {
        return Err("start_node_id must be a visible page-level frame".into());
    }
    if a.steps.is_empty() || a.steps.len() > 100 {
        return Err("Provide 1..100 steps".into());
    }
    for (i, s) in a.steps.iter().enumerate() {
        if (s.node_id.is_some() && (s.x.is_some() || s.y.is_some()))
            || s.x.is_some() != s.y.is_some()
            || (s.node_id.is_none() && s.x.is_none() && s.wait_ms.is_none())
            || s.wait_ms.is_some_and(|t| t > 60000)
            || [s.x, s.y].into_iter().flatten().any(|v| !v.is_finite() || v.abs() > 1_000_000.0)
            || s.expect_texts.len() > 50
            || s.expect_texts.iter().any(|s| s.len() > 8000)
        {
            return Err(format!("steps[{i}]: provide node_id OR x/y, or a bounded wait_ms; invalid step arguments"));
        }
    }
    let mut player = Player::new(&app.doc, a.start_node_id);
    let mut results = Vec::new();
    let mut passed = true;
    for (i, s) in a.steps.into_iter().enumerate() {
        let before = player.current;
        let mut problem = None;
        let frame = player.overlays.last().map_or(player.current, |o| o.frame);
        let point = if let Some(id) = s.node_id {
            if player.top_frame_of(id) != Some(frame) {
                problem = Some("Requested node is not in the current topmost frame".to_string());
                None
            } else {
                let r = rect_in_frame(&player.doc, id, frame);
                let fixed = player.doc.get(frame).is_some_and(|f| f.prototype.fixed_children.iter().any(|c| *c == id || player.doc.is_ancestor(*c, id)));
                let scroll = if fixed { Vec2::ZERO } else { player.scroll_of(frame) };
                Some(Vec2::new(r.x + r.w / 2.0 - scroll.x, r.y + r.h / 2.0 - scroll.y))
            }
        } else {
            s.x.zip(s.y).map(|(x, y)| Vec2::new(x, y))
        };
        let hit = point.and_then(|p| hit_layer(&player.doc, frame, p, player.scroll_of(frame)));
        let reaction = hit.and_then(|id| player.find_reactive(id, When::Click));
        let hit_info = identity(&player.doc, hit);
        let reaction_info = identity(&player.doc, reaction);
        if point.is_some() {
            if reaction.is_none() {
                problem = Some("Click hit no OnClick reaction; inspect the hit node and parent hierarchy".into());
            }
            player.pointer_down(hit);
            player.pointer_up(hit, false);
        }
        // Advance virtual time, never wall-clock sleep. Timers/transitions use the
        // same player; callers can specify explicit waits when timing matters.
        player.tick(player.now + s.wait_ms.unwrap_or(1000) as f64 / 1000.0);
        let text = texts(&player);
        let asserted = s.expect_frame_id.is_some() || !s.expect_texts.is_empty();
        let missing: Vec<_> = s.expect_texts.into_iter().filter(|want| !text.iter().any(|t| t.contains(want))).collect();
        let effects = std::mem::take(&mut player.effects).iter().map(|e| format!("{e:?}")).collect::<Vec<_>>();
        let ok = asserted
            && problem.is_none()
            && s.expect_frame_id.is_none_or(|id| id == player.current)
            && missing.is_empty()
            && player.errors.is_empty()
            && effects.is_empty();
        passed &= ok;
        results.push(json!({"step":i,"passed":ok,"asserted":asserted,"from_frame_id":before,"frame":identity(&player.doc,Some(player.current)),
            "requested_node_id":s.node_id,"point":point,"hit":hit_info,"reaction":reaction_info,"problem":problem,
            "expected_frame_id":s.expect_frame_id,"missing_texts":missing,"frame_text":text,
            "back_depth":player.back.len(),"variables":player.variable_rows().iter().map(|v|json!({"id":v.id,"name":v.name,"value":v.value,"changed":v.changed})).collect::<Vec<_>>(),
            "errors":player.errors,"blocked_external_effects":effects}));
    }
    Ok(json!({"passed":passed,"steps":results,"live_document_changed":false,
        "scope":"Real player hit testing on a scratch document. frame_text checks node content, not pixel visibility or clipping. External URL effects are blocked and fail the step; visual QA remains required."}))
}
