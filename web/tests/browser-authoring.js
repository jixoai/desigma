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
  const fonts = await call('desigma_inspect_fonts', { families: ['Inter', 'Missing Diagnostic Font 49271'] });
  assert(fonts.requests.some(f => f.requested_family === 'Inter' && f.exact_family), 'Bundled renderer font missing');
  assert(fonts.requests.some(f => f.requested_family === 'Missing Diagnostic Font 49271' && !f.exact_family), 'Unavailable font reported as installed');
  const ids = (await call('desigma_allocate_node_ids', { count: 2 })).node_ids;
  const command = guide.master_example.commands[0].Insert;
  command.parent = componentPage;
  command.nodes[0].id = ids[0]; command.nodes[0].children = [ids[1]];
  command.nodes[1].id = ids[1]; command.nodes[1].parent = ids[0];
  const inserted = await call('desigma_apply_commands', { commands: [{ Insert: command }] });
  assert(inserted.inserted_roots[0].node_id === ids[0] && inserted.inserted_roots[0].parent_id === componentPage, 'Inserted root identity missing');
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
  const orphan = (await call('desigma_create_node', { parent_id: home, kind: 'text', name: 'Return label beside arrow', x: 70, y: 50, width: 120, height: 24, text: 'Return to edit' })).node.id;
  const probes = await call('desigma_inspect_prototype', { probe_node_ids: [label.id, orphan] });
  assert(probes.target_samples[0].ok && !probes.target_samples[1].ok, 'Explicit control probes missed the unwired label');
  assert(probes.warnings.some(w => w.code === 'probe_target_not_clickable' && w.node_id === orphan), 'Unwired label diagnostic missing');
  const child = (await call('desigma_get_node', { node_id: label.id })).node;
  child.prototype = wired.prototype;
  await call('desigma_apply_commands', { commands: [{ Update: { node: child } }] });
  const nested = await call('desigma_inspect_prototype', {});
  assert(!nested.warnings.some(w => w.code === 'click_sample_misses' && w.node_id === instance), 'Valid nested navigation reported as a blocked click');
  await call('desigma_undo', {});
  const cover = (await call('desigma_create_node', { parent_id: home, kind: 'rectangle', name: 'Late opaque card', x: 65, y: 45, width: 150, height: 40 })).node.id;
  await call('desigma_set_appearance', { node_id: cover, fill: '#FFFFFF' });
  const textReport = await call('desigma_inspect_text', { node_id: home, required_texts: ['Return to edit', 'Required missing copy'] });
  assert(!textReport.ok && textReport.missing_texts.includes('Required missing copy'), 'Required copy omission was not reported');
  assert(textReport.warnings.some(w => w.code === 'text_may_be_covered' && w.node_id === orphan && w.cover_node_id === cover), 'Late card text occlusion was not detected');
  await call('desigma_update_node', { node_id: cover, visible: false });
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
  const exported = await call('desigma_export_asset', { node_id: home, format: 'png', path: '/cache/authoring/nested/home.png', scale: 0.25 });
  assert(exported.exported && exported.bytes > 24, 'Nested export path failed');
  assert((await call('desigma_inspect_components', {})).unresolved_master_count === 0, 'Intact master was reported missing');
  await call('desigma_delete_node', { node_id: ids[0] });
  const broken = await call('desigma_inspect_components', {});
  assert(broken.master_count === 0 && broken.instance_count === 1 && broken.unresolved_master_count === 1, 'Deleted master was not detected');
  await call('desigma_undo', {});
  assert((await call('desigma_inspect_components', {})).unresolved_master_count === 0, 'Master recovery was not detected');
  const project = await call('desigma_create_project', { name: 'Authoring verification' });
  const saved = await call('desigma_save_to_project', { project_id: project.id, name: 'Authoring regression' });
  assert(saved.file_id && saved.path.endsWith(`/${saved.file_id}.desigma`) && saved.next_save.arguments.path === saved.path, 'Save did not return a concrete reusable file identity');
  await call(saved.next_save.tool, saved.next_save.arguments);
  const files = await call('desigma_list_files', {});
  assert(files.files.filter(f => f.project === project.id).length === 1, 'Saving again created another library file');
  await call('desigma_library_edit', { operation: 'trash_project', project_id: project.id });
  return { checks, home, review, instance, summary, preview, preview_ms,
    wrong_date_detected: !failed.passed, overlap_detected: !blocked.passed, correct_route_passed: passed.passed, downloads };
}
