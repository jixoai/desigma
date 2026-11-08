//! Bounded authoring diagnostics. These report measurable risks, not a visual
//! or business acceptance verdict; agents still need to inspect the preview.
use super::parse;
use crate::app::App;
use desigma_doc::*;
use serde::Deserialize;
use serde_json::{json, Value};

pub fn fonts(app: &App, args: Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Args {
        #[serde(default)]
        families: Vec<String>,
    }
    let a: Args = parse(args)?;
    if a.families.len() > 100 || a.families.iter().any(|f| f.trim().is_empty() || f.len() > 1024) {
        return Err("Provide at most 100 nonempty font family names (<=1024 bytes each)".into());
    }
    let mut requests = desigma_fonts::requests_for(&app.doc);
    requests.extend(a.families.into_iter().map(|f| desigma_fonts::FontRequest::new(f, 400, false)));
    let count = requests.len();
    let requests = requests
        .into_iter()
        .take(1000)
        .map(|r| {
            let resolved = desigma_render::resolve_font(&r.family, r.weight, r.italic);
            json!({"requested_family":r.family,"weight":r.weight,"italic":r.italic,
            "resolved_family":resolved.as_ref().map(|f|&f.family),"exact_family":resolved.as_ref().is_some_and(|f|f.family.eq_ignore_ascii_case(&r.family)),
            "bundled":resolved.as_ref().is_some_and(|f|f.bundled)})
        })
        .collect::<Vec<_>>();
    Ok(json!({"loading":app.fonts.is_loading(),"available_families":desigma_render::available_families(),
        "requests":requests,"truncated":count>1000,
        "bundled_families":desigma_fonts::bundled().iter().map(|f|f.family).collect::<std::collections::BTreeSet<_>>(),
        "scope":"Renderer font database, not document.fonts or host OS fonts. resolved_family is the primary face; glyphs missing in it may use script fallbacks. A requested family name does not prove it is installed. Recheck after loading finishes; inspect rendered glyphs."}))
}

pub fn text_schema() -> Value {
    json!({"node_id":{"type":"integer","minimum":1},
        "required_texts":{"type":"array","maxItems":50,"items":{"type":"string","minLength":1,"maxLength":2000},
        "description":"Literal required business copy in visible descendant text. Checks presence, not semantic correctness or pixel visibility."}})
}

#[derive(Clone)]
struct Area {
    inverse: Affine,
    size: Vec2,
    corners: [f32; 4],
}
impl Area {
    fn of(n: &Node, world: Affine) -> Option<Self> {
        Some(Self { inverse: world.invert()?, size: n.size, corners: n.corner_radii })
    }
    fn contains(&self, point: Vec2) -> bool {
        let p = self.inverse.apply(point);
        if !Rect::new(0.0, 0.0, self.size.x, self.size.y).contains(p) {
            return false;
        }
        for (i, right, bottom) in [(0, false, false), (1, true, false), (2, true, true), (3, false, true)] {
            let r = self.corners[i].min(self.size.x / 2.0).min(self.size.y / 2.0).max(0.0);
            let x = if right { self.size.x - p.x } else { p.x };
            let y = if bottom { self.size.y - p.y } else { p.y };
            if x < r && y < r && (x - r).powi(2) + (y - r).powi(2) > r * r {
                return false;
            }
        }
        true
    }
}

struct Entry {
    id: NodeId,
    world: Affine,
    clips: Vec<Area>,
    opacity: f32,
}
struct Cover {
    order: usize,
    id: NodeId,
    area: Area,
    color: Color,
}

fn solid(paints: &[Paint]) -> Option<Color> {
    let mut visible = paints.iter().filter(|p| p.visible && p.opacity > 0.0);
    let p = visible.next()?;
    if visible.next().is_some() || p.opacity < 0.999 || p.blend != BlendMode::Normal {
        return None;
    }
    match p.kind {
        PaintKind::Solid(c) if c.a >= 0.999 => Some(c),
        _ => None,
    }
}

fn contrast(a: Color, b: Color) -> f32 {
    let luminance = |c: Color| {
        let linear = |v: f32| if v <= 0.04045 { v / 12.92 } else { ((v + 0.055) / 1.055).powf(2.4) };
        linear(c.r) * 0.2126 + linear(c.g) * 0.7152 + linear(c.b) * 0.0722
    };
    let (a, b) = (luminance(a), luminance(b));
    (a.max(b) + 0.05) / (a.min(b) + 0.05)
}

pub fn inspect_text(app: &App, args: Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Args {
        node_id: NodeId,
        #[serde(default)]
        required_texts: Vec<String>,
    }
    let a: Args = parse(args)?;
    if a.required_texts.len() > 50 || a.required_texts.iter().any(|s| s.is_empty() || s.len() > 8000) {
        return Err("Provide at most 50 nonempty required_texts (<=8000 bytes each)".into());
    }
    let doc = &app.doc;
    let root = doc.get(a.node_id).ok_or("Unknown node_id")?;
    let parent = root.parent.map(|p| doc.world_transform(p)).unwrap_or(Affine::IDENTITY);
    let mut inherited_clips = Vec::new();
    let mut inherited_opacity = 1.0;
    let mut ancestor = root.parent;
    while let Some(id) = ancestor {
        let n = resolve_node(doc, doc.get(id).ok_or("Missing ancestor")?);
        inherited_opacity *= if n.visible { n.opacity } else { 0.0 };
        if n.kind.frame_props().is_some_and(|f| f.clips_content) {
            if let Some(area) = Area::of(&n, doc.world_transform(id)) {
                inherited_clips.push(area);
            }
        }
        ancestor = n.parent;
    }
    let mut entries = Vec::new();
    let mut stack = vec![(root.id, parent, inherited_clips, inherited_opacity)];
    let mut skipped_masks = 0;
    while let Some((id, parent, mut clips, opacity)) = stack.pop() {
        if entries.len() >= 5000 {
            stack.push((id, parent, clips, opacity));
            break;
        }
        let Some(raw) = doc.get(id) else { continue };
        let n = resolve_node(doc, raw);
        if !n.visible || n.opacity <= 0.0 || opacity <= 0.0 {
            continue;
        }
        let world = parent * n.transform;
        let opacity = opacity * n.opacity;
        entries.push(Entry { id, world, clips: clips.clone(), opacity });
        if n.kind.frame_props().is_some_and(|f| f.clips_content) {
            if let Some(area) = Area::of(&n, world) {
                clips.push(area);
            }
        }
        // A mask affects following siblings. Do not make opaque-box claims in
        // that region; previews remain authoritative for mask compositing.
        let children = n.children.iter().take_while(|id| !doc.get(**id).is_some_and(|n| n.is_mask)).copied().collect::<Vec<_>>();
        skipped_masks += n.children.len() - children.len();
        for id in children.into_iter().rev() {
            stack.push((id, world, clips.clone(), opacity));
        }
    }
    let covers = entries
        .iter()
        .enumerate()
        .filter_map(|(order, entry)| {
            let n = resolve_node(doc, doc.get(entry.id)?);
            if entry.opacity < 0.999
                || !matches!(n.blend, BlendMode::Normal | BlendMode::PassThrough)
                || !n.effects.is_empty()
                || !matches!(n.kind, NodeKind::Rectangle | NodeKind::Frame(_) | NodeKind::Component(_) | NodeKind::Instance { .. } | NodeKind::Section)
            {
                return None;
            }
            Some(Cover { order, id: n.id, area: Area::of(&n, entry.world)?, color: solid(&n.fills)? })
        })
        .collect::<Vec<_>>();
    let cover_orders = covers.iter().map(|c| c.order).collect::<std::collections::BTreeSet<_>>();
    let uncertain_backgrounds = entries
        .iter()
        .enumerate()
        .filter_map(|(order, entry)| {
            if cover_orders.contains(&order) {
                return None;
            }
            let n = resolve_node(doc, doc.get(entry.id)?);
            let paints = |paints: &[Paint]| paints.iter().any(|p| p.visible && p.opacity > 0.0 && !matches!(p.kind, PaintKind::Solid(c) if c.a<=0.0));
            let painted = paints(&n.fills)
                || !n.effects.is_empty()
                || matches!(&n.kind, NodeKind::Text(t) if !t.content.trim().is_empty() && (paints(&t.style.fills)||!t.runs.is_empty()));
            painted.then(|| Area::of(&n, entry.world).map(|area| (order, area))).flatten()
        })
        .collect::<Vec<_>>();
    let mut warnings = Vec::new();
    let mut texts = Vec::new();
    let mut content = Vec::new();
    let mut remaining = 100_000usize;
    let mut truncated = !stack.is_empty();
    for (order, entry) in entries.iter().enumerate() {
        let n = resolve_node(doc, doc.get(entry.id).unwrap());
        let NodeKind::Text(t) = &n.kind else { continue };
        if texts.len() >= 500 || t.content.len() > remaining {
            truncated = true;
            break;
        }
        remaining -= t.content.len();
        content.push(t.content.clone());
        let outlines = desigma_render::text_outlines(t, n.size);
        let ink = outlines
            .iter()
            .filter(|o| !o.fills.is_empty())
            .map(|o| {
                let r = o.path.bounds();
                Rect::new(r.x(), r.y(), r.width(), r.height())
            })
            .reduce(|a, b| a.union(&b));
        let mut node_warnings = Vec::new();
        if let Some(ink) = ink {
            if ink.x < -1.0 || ink.y < -1.0 || ink.x + ink.w > n.size.x + 1.0 || ink.y + ink.h > n.size.y + 1.0 {
                node_warnings.push(json!({"code":"text_ink_outside_box","ink_bounds":ink,"box_size":n.size}));
            }
            let points = [0.1, 0.5, 0.9]
                .into_iter()
                .flat_map(|y| [0.1, 0.5, 0.9].map(move |x| entry.world.apply(Vec2::new(ink.x + ink.w * x, ink.y + ink.h * y))))
                .collect::<Vec<_>>();
            if points.iter().any(|p| entry.clips.iter().any(|c| !c.contains(*p))) {
                node_warnings.push(json!({"code":"text_may_be_clipped"}));
            }
            let contains = |c: &Cover, p: &Vec2| c.area.contains(*p) && entries[c.order].clips.iter().all(|clip| clip.contains(*p));
            if let Some(cover) = covers.iter().rev().filter(|c| c.order > order).find(|c| points.iter().any(|p| contains(c, p))) {
                node_warnings.push(json!({"code":"text_may_be_covered","cover_node_id":cover.id,
                    "cover_name":doc.get(cover.id).map(|n|&n.name),"covered_samples":points.iter().filter(|p|contains(cover,p)).count(),"sample_count":points.len()}));
            }
            // Only claim a numeric ratio on a uniform opaque foreground/background.
            if entry.opacity >= 0.999 && t.runs.is_empty() {
                let background_at = |p: &Vec2| covers.iter().rev().find(|c| c.order < order && contains(c, p));
                let background = background_at(&points[0]).filter(|bg| {
                    points.iter().all(|p| background_at(p).is_some_and(|c| c.id == bg.id))
                        && !uncertain_backgrounds.iter().any(|(index, area)| {
                            *index > bg.order
                                && *index < order
                                && points.iter().any(|p| area.contains(*p) && entries[*index].clips.iter().all(|clip| clip.contains(*p)))
                        })
                });
                if let (Some(fg), Some(bg)) = (solid(&t.style.fills), background) {
                    let ratio = contrast(fg, bg.color);
                    let minimum = if t.style.font_size >= 24.0 || t.style.font_size >= 18.666 && t.style.font_weight >= 700 { 3.0 } else { 4.5 };
                    if ratio + 0.001 < minimum {
                        node_warnings.push(json!({"code":"low_text_contrast","ratio":ratio,"minimum":minimum,"foreground":fg.to_hex(),"background":bg.color.to_hex(),"background_node_id":bg.id}));
                    }
                }
            }
        }
        for mut w in node_warnings {
            w["node_id"] = json!(n.id);
            w["name"] = json!(n.name);
            w["text"] = json!(t.content.chars().take(200).collect::<String>());
            warnings.push(w);
        }
        texts.push(json!({"node_id":n.id,"name":n.name,"text":t.content.chars().take(500).collect::<String>(),"ink_bounds":ink,"box_size":n.size}));
    }
    let missing = a.required_texts.into_iter().filter(|required| !content.iter().any(|text| text.contains(required))).collect::<Vec<_>>();
    Ok(json!({"ok":warnings.is_empty()&&missing.is_empty()&&!truncated&&skipped_masks==0,
        "warning_count":warnings.len(),"warnings":warnings,"missing_texts":missing,"texts":texts,"checked_text_count":texts.len(),
        "truncated":truncated,"skipped_mask_nodes":skipped_masks,"fonts_loading":app.fonts.is_loading(),
        "scope":"Glyph bounds from the renderer; samples detect possible clipping/occlusion by later opaque rectangular layers. Contrast is checked only on opaque solid colors. Masks, gradients, effects and business semantics need visual/manual review. required_texts checks content only. Run per frame, inspect render_preview, and recheck after fonts finish loading."}))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> App {
        let mut doc = Document::new("Text diagnostics");
        let page = doc.add_page("Page");
        let mut frame = Node::frame(NodeId(10), Rect::new(0.0, 0.0, 390.0, 844.0));
        frame.fills = vec![Paint::solid(Color::WHITE)];
        doc.insert(page, frame).unwrap();
        let label = Node::text(NodeId(11), Rect::new(24.0, 100.0, 250.0, 40.0), "People", TextStyle::default());
        doc.insert(NodeId(10), label).unwrap();
        App::new(doc)
    }

    #[test]
    fn text_diagnostics_find_late_opaque_cover_and_missing_copy_without_edits() {
        let mut app = fixture();
        let mut cover = Node::rectangle(NodeId(12), Rect::new(20.0, 95.0, 300.0, 60.0));
        cover.name = "Selected slot".into();
        cover.fills = vec![Paint::solid(Color::WHITE)];
        app.doc.insert(NodeId(10), cover).unwrap();
        let before = app.doc.to_json().unwrap();
        let r = inspect_text(&app, json!({"node_id":10,"required_texts":["People","One piece per person"]})).unwrap();
        assert_eq!(r["ok"], false);
        assert_eq!(r["missing_texts"], json!(["One piece per person"]));
        assert!(r["warnings"].as_array().unwrap().iter().any(|w| w["code"] == "text_may_be_covered" && w["node_id"] == 11 && w["cover_node_id"] == 12));
        assert_eq!(before, app.doc.to_json().unwrap());
        assert!(!app.hist.can_undo());
        app.doc.get_mut(NodeId(12)).unwrap().opacity = 0.0;
        let r = inspect_text(&app, json!({"node_id":10,"required_texts":["People"]})).unwrap();
        assert_eq!(r["ok"], true, "{r}");
    }

    #[test]
    fn text_diagnostics_distinguish_clipping_low_contrast_and_transparent_covers() {
        let mut app = fixture();
        let n = app.doc.get_mut(NodeId(11)).unwrap();
        let NodeKind::Text(t) = &mut n.kind else { unreachable!() };
        t.style.fills = vec![Paint::solid(Color::from_hex("#A99B8C").unwrap())];
        let mut cover = Node::rectangle(NodeId(12), Rect::new(20.0, 95.0, 300.0, 60.0));
        cover.fills = vec![];
        app.doc.insert(NodeId(10), cover).unwrap();
        let r = inspect_text(&app, json!({"node_id":10})).unwrap();
        let warnings = r["warnings"].as_array().unwrap();
        assert!(!warnings.iter().any(|w| w["code"] == "text_may_be_covered"));
        let ratio = warnings.iter().find(|w| w["code"] == "low_text_contrast").unwrap()["ratio"].as_f64().unwrap();
        assert!((ratio - 2.71).abs() < 0.02);
        let frame = app.doc.get_mut(NodeId(10)).unwrap();
        frame.size.y = 102.0;
        let NodeKind::Frame(props) = &mut frame.kind else { unreachable!() };
        props.clips_content = true;
        let r = inspect_text(&app, json!({"node_id":10})).unwrap();
        assert!(r["warnings"].as_array().unwrap().iter().any(|w| w["code"] == "text_may_be_clipped"));
    }

    #[test]
    fn font_report_distinguishes_requested_family_from_installed_face() {
        let app = fixture();
        let r = fonts(&app, json!({"families":["Unavailable Font Diagnostic 49271","Inter"]})).unwrap();
        let requests = r["requests"].as_array().unwrap();
        let absent = requests.iter().find(|r| r["requested_family"] == "Unavailable Font Diagnostic 49271").unwrap();
        assert_eq!(absent["exact_family"], false);
        assert_eq!(absent["resolved_family"], "Inter");
        let inter = requests.iter().find(|r| r["requested_family"] == "Inter").unwrap();
        assert_eq!(inter["exact_family"], true);
        assert_eq!(inter["bundled"], true);
    }

    #[test]
    fn text_diagnostics_do_not_claim_solid_contrast_over_gradients_or_visible_hidden_text() {
        let mut app = fixture();
        let n = app.doc.get_mut(NodeId(11)).unwrap();
        let NodeKind::Text(t) = &mut n.kind else { unreachable!() };
        t.style.fills = vec![Paint::solid(Color::from_hex("#A99B8C").unwrap())];
        let mut backdrop = Node::rectangle(NodeId(12), Rect::new(20.0, 95.0, 300.0, 60.0));
        backdrop.fills = vec![Paint {
            kind: PaintKind::LinearGradient {
                handles: [Vec2::ZERO, Vec2::new(1.0, 0.0), Vec2::new(0.0, 1.0)],
                stops: vec![GradientStop { pos: 0.0, color: Color::WHITE }, GradientStop { pos: 1.0, color: Color::BLACK }],
            },
            ..Paint::solid(Color::WHITE)
        }];
        app.doc.insert(NodeId(10), backdrop).unwrap();
        app.doc.reparent(NodeId(12), NodeId(10), 0).unwrap();
        let r = inspect_text(&app, json!({"node_id":10})).unwrap();
        assert!(!r["warnings"].as_array().unwrap().iter().any(|w| w["code"] == "low_text_contrast"));
        app.doc.get_mut(NodeId(10)).unwrap().visible = false;
        let r = inspect_text(&app, json!({"node_id":11,"required_texts":["People"]})).unwrap();
        assert_eq!(r["checked_text_count"], 0);
        assert_eq!(r["missing_texts"], json!(["People"]));
    }
}
