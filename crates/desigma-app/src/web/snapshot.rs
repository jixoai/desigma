//! Incremental native JSON serialization. Each call borrows the current document for a
//! bounded batch; the caller must discard all chunks when the document revision changes.
use desigma_doc::{Document, NodeId};
use std::ops::Bound::{Excluded, Unbounded};

pub struct Snapshot {
    pub revision: u64,
    node: Option<NodeId>,
    image: Option<String>,
    offset: usize,
    stage: u8,
}

impl Snapshot {
    pub fn begin(doc: &mut Document, revision: u64) -> serde_json::Result<(Self, Vec<u8>)> {
        // Move the two large maps out for the small metadata serialization. No asset or
        // layer is cloned; restore both maps before propagating any serialization error.
        let nodes = std::mem::take(&mut doc.nodes);
        let images = std::mem::take(&mut doc.images);
        let metadata = serde_json::to_value(&*doc);
        doc.nodes = nodes;
        doc.images = images;
        let mut metadata = metadata?;
        let fields = metadata.as_object_mut().expect("document is an object");
        fields.remove("nodes");
        fields.remove("images");
        let mut bytes = serde_json::to_vec(&metadata)?;
        bytes.pop();
        bytes.extend_from_slice(b",\"nodes\":{");
        Ok((Self { revision, node: None, image: None, offset: 0, stage: 0 }, bytes))
    }

    pub fn next(&mut self, doc: &Document) -> serde_json::Result<Option<Vec<u8>>> {
        if self.stage == 3 {
            return Ok(None);
        }
        let start = web_time::Instant::now();
        let mut out = Vec::with_capacity(64 * 1024);
        while out.len() < 64 * 1024 && start.elapsed().as_secs_f64() < 0.004 {
            match self.stage {
                0 => {
                    let next = doc.nodes.range((self.node.map_or(Unbounded, Excluded), Unbounded)).next();
                    if let Some((id, node)) = next {
                        if self.node.is_some() {
                            out.push(b',');
                        }
                        serde_json::to_writer(&mut out, &id.0.to_string())?;
                        out.push(b':');
                        serde_json::to_writer(&mut out, node)?;
                        self.node = Some(*id);
                    } else {
                        out.extend_from_slice(b"},\"images\":{");
                        self.stage = 1;
                    }
                }
                1 => {
                    let next = doc.images.range::<String, _>((self.image.as_ref().map_or(Unbounded, Excluded), Unbounded)).next();
                    if let Some((key, _)) = next {
                        if self.image.is_some() {
                            out.push(b',');
                        }
                        serde_json::to_writer(&mut out, key)?;
                        out.extend_from_slice(b":[");
                        self.image = Some(key.clone());
                        self.offset = 0;
                        self.stage = 2;
                    } else {
                        out.extend_from_slice(b"}}");
                        self.stage = 3;
                        break;
                    }
                }
                2 => {
                    let bytes = &doc.images[self.image.as_ref().unwrap()];
                    let end = (self.offset + 8192).min(bytes.len());
                    if end > self.offset {
                        if self.offset > 0 {
                            out.push(b',');
                        }
                        let chunk = serde_json::to_vec(&bytes[self.offset..end])?;
                        out.extend_from_slice(&chunk[1..chunk.len() - 1]);
                    }
                    self.offset = end;
                    if end == bytes.len() {
                        out.push(b']');
                        self.stage = 1;
                    }
                }
                _ => break,
            }
        }
        Ok(Some(out))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn chunked_snapshot_roundtrips_nodes_assets_and_private_id_counter() {
        let mut doc = Document::new("Metadata with \"nodes\":{} and Unicode 图");
        let page = doc.add_page("Page");
        for _ in 0..800 {
            let id = doc.alloc_id();
            doc.insert(page, desigma_doc::Node::rectangle(id, desigma_doc::Rect::new(1., 2., 3., 4.))).unwrap();
        }
        doc.images.insert("a\"b".into(), (0..100_000).map(|n| n as u8).collect());
        doc.images.insert("empty".into(), vec![]);
        let original = serde_json::to_value(&doc).unwrap();
        let (mut snapshot, mut out) = Snapshot::begin(&mut doc, 17).unwrap();
        assert_eq!(snapshot.revision, 17);
        let mut chunks = 0;
        while let Some(bytes) = snapshot.next(&doc).unwrap() {
            out.extend(bytes);
            chunks += 1;
        }
        assert!(chunks > 3);
        assert!(serde_json::to_value(&doc).unwrap() == original, "snapshot must leave the live document intact");
        let mut restored = Document::from_json(std::str::from_utf8(&out).unwrap()).unwrap();
        assert!(serde_json::to_value(&restored).unwrap() == original, "all document fields must roundtrip, including f32 values");
        assert_eq!(restored.alloc_id(), doc.alloc_id());
    }
}
