// Exercise a real save while an agent edits; verify that only complete JSON commits.
export async function recoveryRegression(api = window.desigma) {
  const before = api.stats();
  const page = (await api.call('desigma_get_document', {})).pages[0].node_id;
  const interrupted = api.save().then(() => ({ completed: true }), error => ({ rejected: String(error) }));
  await Promise.resolve();
  const name = `Recovery during edit ${crypto.randomUUID()}`;
  const edit = () => api.call('desigma_create_node', { parent_id: page, kind: 'rectangle', name, width: 20, height: 20 });
  if (globalThis.scheduler?.postTask) await scheduler.postTask(edit, { priority: 'user-blocking' });
  else await edit();
  const concurrent = await interrupted;
  await api.save();
  const sessionId = sessionStorage.getItem('desigma-session');
  const db = await new Promise((resolve, reject) => { const request = indexedDB.open('desigma-browser-v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  const entry = await new Promise((resolve, reject) => { const request = db.transaction('files').objectStore('files').get(`/sessions/${sessionId}.desigma`); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  db.close();
  const recovered = JSON.parse(entry.blob ? await entry.blob.text() : new TextDecoder().decode(entry.bytes));
  if (!Object.values(recovered.nodes).some(node => node.name === name)) throw new Error('Recovery snapshot lost the latest edit');
  if (Object.keys(recovered.nodes).length !== api.stats().nodes) throw new Error('Recovery node count differs from live document');
  return { beforeNodes: before.nodes, recoveredNodes: Object.keys(recovered.nodes).length, concurrent, lastSave: api.metrics().saves.at(-1), name };
}
