// Run on a fresh test origin with external font hosts blocked. Edits only its own document.
export async function chineseFontsRegression(api = window.desigma) {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  await api.call('desigma_new_document', { name: '中文字体回归检查', discard_changes: true });
  await api.call('desigma_execute_action', { action: 'language_english' });
  const page = (await api.call('desigma_get_document', {})).pages[0].node_id;
  await api.call('desigma_create_node', { parent_id: page, kind: 'frame', name: '中文画板 · 离线', x: 0, y: 0, width: 760, height: 360 });
  const frame = (await api.call('desigma_list_nodes', { query: '中文画板 · 离线' })).nodes[0].node_id;
  await api.call('desigma_set_appearance', { node_id: frame, fill: '#FFFFFF' });
  await api.call('desigma_create_node', { parent_id: frame, kind: 'text', name: '中文图层 · 普通文字', text: '中文图层 · 设计与回忆\n开始使用，静音查看。\n文件、页面、图层、导出', x: 32, y: 32, width: 696, height: 260 });
  const text = (await api.call('desigma_list_nodes', { query: '中文图层 · 普通文字' })).nodes[0].node_id;
  await api.call('desigma_set_text_style', { node_id: text, font_family: 'Inter', font_size: 36, line_height: 64 });
  await api.call('desigma_set_appearance', { node_id: text, fill: '#182B23' });
  await api.call('desigma_select_nodes', { node_ids: [frame] });
  await api.call('desigma_execute_action', { action: 'fit_selection' });
  const svg = await api.call('desigma_export_asset', { node_id: frame, format: 'svg', path: '/cache/chinese-font-regression.svg' });
  const png = await api.call('desigma_export_asset', { node_id: frame, format: 'png', path: '/cache/chinese-font-regression.png' });
  check(svg.bytes > 2000 && png.bytes > 2000, 'Chinese export unexpectedly empty');
  // UI glyphs are verified from screenshots; this does not claim a DOM check on an egui canvas.
  await api.save();
  return { frame, text, exports: { svg: svg.bytes, png: png.bytes }, fonts: 'Inter + bundled CJK; external font hosts blocked by harness' };
}
