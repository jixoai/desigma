// Synthetic 5,000-layer benchmark. Reports frame intervals and CPU canvas preparation,
// not GPU completion time. Run in an isolated fresh editor tab.
export async function benchmark({ count = 5000, samples = 120, api = window.desigma } = {}) {
  if (document.hidden) throw new Error('Activate this editor tab before measuring frame intervals');
  if (!Number.isInteger(count) || count < 1 || count > 20000) throw new Error('count must be 1..20000');
  const summary = values => {
    const sorted = [...values].sort((a,b) => a-b);
    return { median: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)], max: sorted.at(-1) };
  };
  await api.call('desigma_new_document', { name: `Benchmark ${count} layers`, discard_changes: true });
  const page = (await api.call('desigma_get_document', {})).pages[0].node_id;
  const templates = (await api.call('desigma_get_node_templates', {})).templates;
  const template = templates.find(node => node.kind === 'Rectangle');
  template.fills = [{ kind: { Solid: { r: .12, g: .56, b: .86, a: 1 } }, opacity: 1, visible: true, blend: 'Normal' }];
  template.corner_radii = [6,6,6,6];
  const buildMs = [];
  for (let offset = 0; offset < count; offset += 1000) {
    const ids = (await api.call('desigma_allocate_node_ids', { count: Math.min(1000,count-offset) })).node_ids;
    const commands = ids.map((id,index) => {
      const i = offset + index, node = structuredClone(template);
      node.id = id; node.name = `Card ${i}`; node.parent = page;
      node.size = { x: 64, y: 44 }; node.transform.tx = (i % 100) * 80; node.transform.ty = Math.floor(i / 100) * 60;
      return { Insert: { parent: page, index: i, nodes: [node] } };
    });
    const t = performance.now(); await api.call('desigma_apply_commands', { commands }); buildMs.push(performance.now()-t);
  }
  await api.call('desigma_set_view', { page_id: page, x: 0, y: 0, zoom: 1 });
  const panMs = [];
  for(let i=0;i<20;i++) { const t=performance.now(); await api.call('desigma_set_view',{ x:i*12,y:i*3 }); panMs.push(performance.now()-t); }
  const viewBefore = await api.call('desigma_get_view', {});
  const frames = [], render = [], foreground = []; let previous=performance.now();
  for(let i=0;i<samples+15;i++) {
    await api.call('desigma_set_view', { x: viewBefore.x + i * 12, y: viewBefore.y + i * 3 });
    await new Promise(requestAnimationFrame);
    const now=performance.now();if(i>15){frames.push(now-previous);render.push(api.stats().render_ms);foreground.push({visible:!document.hidden,focused:document.hasFocus()})}previous=now;
  }
  return { count, validForFrameRate: foreground.every(f=>f.visible&&f.focused), foreground, viewBefore, viewAfter: await api.call('desigma_get_view', {}), frameIntervalMs:summary(frames), canvasCpuMs:summary(render), toolPanMs:summary(panMs), batchMs:buildMs, stats:api.stats(), userAgent:navigator.userAgent, dpr:devicePixelRatio };
}
