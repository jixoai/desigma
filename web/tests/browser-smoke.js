// Run inside a served browser: await (await import('./tests/browser-smoke.js')).runSmoke()
// Use a fresh tab: this suite edits its own test document and leaves it open for inspection.
export async function runSmoke(api = window.desigma) {
  const results = [];
  const check = (condition, message) => { if (!condition) throw new Error(message); results.push(message); };
  await api.call('desigma_new_document', { name: 'Browser smoke test', discard_changes: true });
  const doc = await api.call('desigma_get_document', {}), page = doc.pages[0].node_id;
  await api.call('desigma_create_node', { parent_id: page, kind: 'rectangle', name: 'Browser card', width: 160, height: 90 });
  const id = (await api.call('desigma_list_nodes', { query: 'Browser card' })).nodes[0].node_id;
  await api.call('desigma_set_appearance', { node_id: id, fill: '#22cc88', corner_radius: 12 });
  check((await api.call('desigma_get_node', { node_id: id })).node.corner_radii[0] === 12, 'Appearance edit');
  await api.call('desigma_undo', {});
  check((await api.call('desigma_get_node', { node_id: id })).node.corner_radii[0] === 0, 'Shared Undo');
  await api.call('desigma_redo', {});
  check((await api.call('desigma_get_node', { node_id: id })).node.corner_radii[0] === 12, 'Shared Redo');
  const original = (await api.call('desigma_get_node', { node_id: id })).node;
  const changed = structuredClone(original); changed.name = 'Must roll back';
  let rejected = false;
  try { await api.call('desigma_apply_commands', { commands: [{ Update: { node: changed } }, { Remove: { id: 9999999 } }] }); } catch { rejected = true; }
  check(rejected && (await api.call('desigma_get_node', { node_id: id })).node.name === original.name, 'Invalid batch rolls back');
  for (const format of ['png', 'jpg', 'svg']) {
    const result = await api.call('desigma_export_asset', { node_id: id, format, path: `/cache/browser-smoke.${format}` });
    check(result.bytes > 0, `${format.toUpperCase()} Worker export`);
  }
  await api.call('desigma_set_timeline', { page_id: page, duration_ms: 300, fps: 10, loop: true });
  await api.call('desigma_add_keyframe', { node_id: id, property: 'opacity', time_ms: 0, value: 0 });
  await api.call('desigma_add_keyframe', { node_id: id, property: 'opacity', time_ms: 300, value: 1 });
  for (const format of ['gif', 'webm']) {
    const result = await api.call('desigma_export_animation', { node_id: id, format, path: `/cache/browser-smoke.${format}`, fps: 10 });
    check(result.bytes > 0, `${format.toUpperCase()} Worker animation export`);
  }
  const project = await api.call('desigma_create_project', { name: 'Browser smoke project' });
  await api.call('desigma_save_to_project', { project_id: project.id, name: 'Browser smoke file' });
  const files = await api.call('desigma_list_files', {});
  const savedFile = files.files.find(file => file.project === project.id && file.name === 'Browser smoke file' && file.path.endsWith('.desigma'));
  check(!!savedFile, 'Persistent project library');
  await api.call('desigma_new_document', { name: 'Open regression', discard_changes: true });
  await api.call('desigma_open_file', { path: savedFile.path, discard_changes: true });
  check(api.stats().name === 'Browser smoke file', 'Absolute browser path opens a library file');
  let relativeRejected = false;
  try { await api.call('desigma_open_file', { path: 'relative.desigma', discard_changes: true }); } catch { relativeRejected = true; }
  check(relativeRejected && api.stats().name === 'Browser smoke file', 'Relative path rejected without replacing the document');
  const context = document.modelContext || navigator.modelContext;
  if (context?.getTools) {
    const tools = await context.getTools();
    const tool = tools.find(tool => tool.name === 'desigma_get_document');
    check(!!tool, 'Native WebMCP registration');
    const value = JSON.parse(await context.executeTool(tool, {}));
    check(value.name === 'Browser smoke file', 'Native WebMCP executes live editor');
  }
  await api.save();
  return { passed: results, stats: api.stats() };
}
