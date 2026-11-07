// Run only in a disposable editor tab. Exercises the compiled WebMCP tools,
// worker preview, native components, and the real prototype player together.
export async function runAuthoringChecks(call) {
  let checks = 0;
  const assert = (ok, message) => { if (!ok) throw new Error(message); checks++; };
  await call('desigma_new_document', { name: 'Authoring regression', discard_changes: true });
  const doc = await call('desigma_get_document', {});
  const page = doc.pages[0].node_id;
  const componentPage = (await call('desigma_create_page', { name: 'Components' })).page_id;
  const guide = await call('desigma_get_editing_guide', { topic: 'components' });
  const ids = (await call('desigma_allocate_node_ids', { count: 2 })).node_ids;
  const command = guide.master_example.commands[0].Insert;
  command.parent = componentPage;
  command.nodes[0].id = ids[0]; command.nodes[0].children = [ids[1]];
  command.nodes[1].id = ids[1]; command.nodes[1].parent = ids[0];
  await call('desigma_apply_commands', { commands: [{ Insert: command }] });
  const home = (await call('desigma_create_node', { parent_id: page, kind: 'frame', name: 'Home', width: 390, height: 844 })).node.id;
  const review = (await call('desigma_create_node', { parent_id: page, kind: 'frame', name: 'Review', x: 460, width: 390, height: 844 })).node.id;
  const result = await call('desigma_create_instance', {
    component_id: ids[0], parent_id: home, name: 'Choose next day', x: 24, y: 100, width: 342, properties: { Label: '选择 11月22日' },
  });
  const instance = result.node_id;
  const inst = (await call('desigma_get_node', { node_id: instance })).node;
  const label = (await call('desigma_get_node', { node_id: inst.children[0] })).node;
  assert(label.kind.Text.content === '选择 11月22日', 'Property override missing');
  assert(label.size.x === 310, 'Resize did not respect Stretch constraints');
  await call('desigma_undo', {});
  assert(!(await call('desigma_list_nodes', { parent_id: home })).nodes.length, 'Instance Undo was not atomic');
  await call('desigma_redo', {});
  await call('desigma_set_appearance', { node_id: ids[0], fill: '#4F6B57' });
  const synced = (await call('desigma_get_node', { node_id: instance })).node;
  assert(JSON.stringify(synced.fills) === JSON.stringify((await call('desigma_get_node', { node_id: ids[0] })).node.fills), 'Master visual edits did not propagate');
  assert((await call('desigma_get_node', { node_id: label.id })).node.kind.Text.content === '选择 11月22日', 'Master sync lost the instance override');
  const summary = (await call('desigma_create_node', { parent_id: review, kind: 'text', name: 'Summary', x: 24, y: 30, width: 342, height: 32, text: '11月21日 · ¥536' })).node.id;
  const wired = (await call('desigma_get_node', { node_id: instance })).node;
  wired.prototype = { fixed_children: [], overflow: 'None', videos: [],
    reactions: [{ trigger: 'OnClick', actions: [{ Navigate: { dest: review, preserve_scroll: false } }], transition: null }] };
  await call('desigma_apply_commands', { commands: [{ Update: { node: wired } }] });
  const before = await call('desigma_get_document_json', {});
  const failed = await call('desigma_test_prototype', { start_node_id: home, steps: [{ node_id: instance, expect_frame_id: review, expect_texts: ['11月22日'] }] });
  assert(!failed.passed && failed.steps[0].missing_texts.includes('11月22日'), 'Wrong date was not detected');
  const observed = await call('desigma_test_prototype', { start_node_id: home, steps: [{ node_id: instance }] });
  assert(!observed.passed && !observed.steps[0].asserted, 'Unasserted navigation was marked verified');
  assert(JSON.stringify(before) === JSON.stringify(await call('desigma_get_document_json', {})), 'Test modified the live document');
  await call('desigma_update_node', { node_id: summary, text: '11月22日 · ¥536' });
  const passed = await call('desigma_test_prototype', { start_node_id: home, steps: [{ node_id: instance, expect_frame_id: review, expect_texts: ['11月22日', '¥536'] }] });
  assert(passed.passed, 'Correct route did not pass');
  assert(passed.steps[0].hit.node_id === label.id && passed.steps[0].reaction.node_id === instance, 'Click bypassed real label hit testing');
  const blocker = (await call('desigma_create_node', { parent_id: home, kind: 'rectangle', name: 'Sibling overlay', x: 24, y: 100, width: 342, height: 52 })).node.id;
  const blocked = await call('desigma_test_prototype', { start_node_id: home, steps: [{ node_id: instance, expect_frame_id: review }] });
  assert(!blocked.passed && blocked.steps[0].hit.node_id === blocker, 'Sibling overlay was clicked through');
  const report = await call('desigma_inspect_prototype', {});
  assert(report.warnings.some(w => w.code === 'click_sample_misses'), 'Missed click not diagnosed');
  await call('desigma_update_node', { node_id: blocker, visible: false });
  let downloads = 0;
  const originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download) downloads++; return originalClick.call(this); };
  let preview;
  const started = performance.now();
  try { preview = await call('desigma_render_preview', { node_id: home, scale: 1 }); }
  finally { HTMLAnchorElement.prototype.click = originalClick; }
  assert(preview.mime_type === 'image/png' && preview.data_url.startsWith('data:image/png;base64,'), 'No PNG preview');
  assert(preview.width === 390 && preview.height === 844, 'Incorrect preview dimensions');
  assert(downloads === 0, 'Preview triggered a download');
  const preview_ms = performance.now() - started;
  assert((await call('desigma_inspect_components', {})).unresolved_master_count === 0, 'Intact master was reported missing');
  await call('desigma_delete_node', { node_id: ids[0] });
  const broken = await call('desigma_inspect_components', {});
  assert(broken.master_count === 0 && broken.instance_count === 1 && broken.unresolved_master_count === 1, 'Deleted master was not detected');
  await call('desigma_undo', {});
  assert((await call('desigma_inspect_components', {})).unresolved_master_count === 0, 'Master recovery was not detected');
  return { checks, home, review, instance, summary, preview, preview_ms,
    wrong_date_detected: !failed.passed, overlap_detected: !blocked.passed, correct_route_passed: passed.passed, downloads };
}
