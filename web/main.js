import init, { start } from './pkg/desigma_app.js';
import { BrowserFileSystem } from './storage.js';
import { registerTools } from './webmcp.js';
import { createTransport } from './collaboration.js';
import { ComputeWorker } from './worker-client.js';
import { createPluginHost } from './plugins.js';
import { captureSnapshot } from './snapshot.js';
import { createConnections } from './connections.js';
import { mountSharing } from './sharing.js';
const compute = new ComputeWorker();

const $ = id => document.getElementById(id);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const began = performance.now();
let handle, fs, bridge, connections, sharing, savedRevision = null, saveTimer, saving = false;
let sessionPath, saveTask, snapshotTail = Promise.resolve();
function snapshot(options = {}) {
  const task = snapshotTail.catch(() => {}).then(() => captureSnapshot(handle, options));
  snapshotTail = task;
  return task;
}
let lastInputAt = 0;
for (const event of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'input']) {
  window.addEventListener(event, () => { lastInputAt = performance.now(); }, { capture: true, passive: true });
}
const metrics = { startedAt: began, readyMs: null, calls: [], saves: [], longTasks: [] };
try { new PerformanceObserver(list => { for (const e of list.getEntries()) metrics.longTasks.push({ start: e.startTime, duration: e.duration }); if (metrics.longTasks.length > 200) metrics.longTasks.splice(0, metrics.longTasks.length - 200); }).observe({ type: 'longtask', buffered: true }); } catch {}
function notice(error) { $('notice-message').textContent = error?.message ?? String(error); $('notice').hidden = false; }
$('dismiss-notice').onclick = () => { $('notice').hidden = true; };
$('retry').onclick = () => location.reload();
function download(name, bytes) {
  if (!bytes?.byteLength || /\.(tmp|part)$/.test(name) || name.startsWith('.')) return;
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
async function persist(force = false) {
  if (!handle) return;
  if (saveTask) { await saveTask; if (force) return persist(true); return; }
  const stats = JSON.parse(handle.stats());
  if (stats.home || (!force && (stats.busy || performance.now() - lastInputAt < 1200 || savedRevision === stats.revision))) return;
  saving = true;
  saveTask = Promise.resolve().then(async () => {
    const t = performance.now();
    $('storage-status').textContent = 'Saving…';
    try {
      let chunkMaxMs = 0;
      const blob = await snapshot({ onChunk: ms => { chunkMaxMs = Math.max(chunkMaxMs, ms); } });
      fs.writeBlob(sessionPath, blob);
      await fs.flush();
      savedRevision = stats.revision;
      $('storage-status').textContent = JSON.parse(handle.stats()).revision === savedRevision ? 'Saved on this device' : 'Changes waiting to save';
      metrics.saves.push({ duration: performance.now() - t, bytes: blob.size, chunkMaxMs });
      if (metrics.saves.length > 100) metrics.saves.shift();
    } catch (error) {
      if (String(error).includes('SNAPSHOT_CHANGED')) {
        $('storage-status').textContent = 'Changes waiting to save';
        if (force) throw new Error('The document changed during saving. Finish editing and save again.');
        return;
      }
      $('storage-status').textContent = 'Save failed — download a copy';
      notice(error);
      throw error;
    } finally { saving = false; saveTask = null; }
  });
  return saveTask;
}

async function loadFiles(kind, extensions, multiple) {
  const input = document.createElement('input'); input.type = 'file'; input.accept = extensions; input.multiple = multiple;
  input.onchange = async () => {
    try {
      for (const file of input.files) {
        if (file.size > 256 * 1024 * 1024) throw new Error('File exceeds the browser import limit of 256 MiB.');
        const path = `/imports/${file.name.replaceAll('/', '_').replaceAll('\\', '_')}`;
        fs.write(path, new Uint8Array(await file.arrayBuffer()));
        if (kind === 'Design files' && /\.(fig|pen)$/i.test(file.name)) {
          const extension = file.name.split('.').pop().toLowerCase();
          const json = await compute.run('import', { bytes: fs.read(path), extension, name: file.name });
          const converted = path + '.desigma'; fs.write(converted, encoder.encode(json)); handle.import_file(converted, kind);
        } else handle.import_file(path, kind);
      }
      await persist(true);
    } catch (error) { notice(error); }
  };
  input.click();
}
const cachedDownloads = new Map();
async function hydrateLibraryFile(id) {
  const path = [...fs.entries.keys()].find(path => path.endsWith(`/files/${id}.desigma`));
  if (path) await fs.hydrate(path);
}
const exportJobs = new Map(); let exportSerial = 0;
function workerFonts() { return [...fs.entries].filter(([path]) => path.endsWith('.ttf') || path.endsWith('.otf')).map(([path,entry]) => ({ key: path + ':' + entry.modified, bytes:entry.bytes })); }

globalThis.desigmaBrowser = {
  thumbnail: document => compute.run('thumbnail', { document, fonts: workerFonts() }),
  deferOpen(path, id) {
    if (fs.entries.get(path)?.bytes) return false;
    fs.hydrate(path).then(() => handle.open_library(id)).catch(notice);
    return true;
  },
  openLink(url) {
    const target = new URL(url, location.href);
    if (!['http:', 'https:', 'mailto:'].includes(target.protocol)) throw new Error('Unsupported link');
    window.open(target.href, '_blank', 'noopener,noreferrer');
  },
  showFiles(path) {
    const section = document.createElement('section'); section.className = 'plugin-panel';
    const header = document.createElement('header'), title = document.createElement('strong'), close = document.createElement('button');
    title.textContent = 'Browser files'; close.textContent = 'Close'; close.onclick = () => section.remove(); header.append(title, close); section.append(header);
    const list = document.createElement('div'); list.className = 'file-list'; section.append(list);
    const show = path => {
      list.replaceChildren(); const heading = document.createElement('p'); heading.textContent = path; list.append(heading);
      if (path !== '/') { const up=document.createElement('button'); up.textContent='Parent folder'; up.onclick=()=>show(path.slice(0,path.lastIndexOf('/')) || '/'); list.append(up); }
      for (const file of fs.readDir(path)) { const button = document.createElement('button'); button.textContent = file.split('/').pop(); button.onclick = async () => { try { if (fs.stat(file).directory) show(file); else download(file.split('/').pop(), await fs.hydrate(file)); } catch (error) { notice(error); } }; list.append(button); }
    }; show(path); document.body.append(section);
  },
  pickFiles: loadFiles,
  queueExport(document, name, argumentsJson) {
    const args=JSON.parse(argumentsJson);
    notice('Exporting in the background…');
    compute.run('export',{document,name,args,fonts:workerFonts()}).then(async bytes=>{
      fs.write(args.path,bytes);await fs.flush();notice(`Exported ${args.path.split('/').pop()}`);
    }).catch(notice);
  },
  beginExport(document, argumentsJson) {
    const id = ++exportSerial, controller = new AbortController(), args = JSON.parse(argumentsJson);
    const job = { controller, progress: [0,1] };
    job.promise = compute.run('export', { document, name: 'ui_animation', args, fonts: workerFonts() }, { signal: controller.signal, onProgress: progress => { job.progress = progress; handle?.repaint(); } })
      .then(async bytes => { fs.write(args.path, bytes); await fs.flush(); return bytes.length; });
    // Rust attaches the actual result handler after this synchronous call returns.
    job.promise.catch(() => {}); exportJobs.set(id, job); return id;
  },
  waitExport: id => exportJobs.get(id).promise.finally(() => exportJobs.delete(id)),
  cancelExport: id => exportJobs.get(id)?.controller.abort(new DOMException('export cancelled', 'AbortError')),
  exportProgress: id => exportJobs.get(id)?.progress || [1,1],
  async fetchBytes(url, maximum) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new Error('Font downloads require HTTPS');
    const response = await fetch(parsed, { credentials: 'omit', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Download failed (${response.status})`);
    if (Number(response.headers.get('content-length')) > maximum) throw new Error('Font download is too large');
    const reader = response.body.getReader(); const chunks = []; let total = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > maximum) { await reader.cancel(); throw new Error('Font download is too large'); } chunks.push(value); }
    const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  },
  copyText: text => navigator.clipboard.writeText(text).catch(notice),
  async copyImage(bytes, width, height) {
    try {
      const canvas = new OffscreenCanvas(width, height);
      canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(bytes), width, height), 0, 0);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } catch (error) { notice(error); }
  },
  downloadCached(url) { const bytes = cachedDownloads.get(url); if (!bytes) throw new Error(`Download is not ready: ${url}`); return bytes; },
};
const plugins = createPluginHost({ fetchBytes: globalThis.desigmaBrowser.fetchBytes, cache: cachedDownloads,
  insertSvg: async (id, svg, name) => { const result = handle.insert_plugin_svg(id, svg, name); await persist(true); return result; },
  onError: notice, storage: () => fs });
Object.assign(globalThis.desigmaBrowser, { preparePlugin: plugins.prepare, openPlugin: plugins.open, closePlugin: plugins.close });
globalThis.desigmaNet = createTransport(() => handle?.repaint(), () => connections?.close());

async function boot() {
  if (!globalThis.isSecureContext) throw new Error('Open the editor over HTTPS or localhost to use browser storage and graphics.');
  fs = await new BrowserFileSystem({ onError: notice, onDownload: download, onReady: () => handle?.repaint() }).init();
  globalThis.desigmaFs = Object.fromEntries(['read', 'write', 'stat', 'readDir', 'mkdir', 'remove', 'rename', 'copy', 'kind'].map(name => [name, fs[name].bind(fs)]));
  fs.mkdir('/sessions');
  const params = new URLSearchParams(location.search);
  let recovery;
  let sessionId;
  try { sessionId = !params.has('fresh') && !params.has('fixture') && sessionStorage.getItem('desigma-session'); } catch {}
  sessionId ||= crypto.randomUUID();
  // A duplicate tab may copy sessionStorage; Web Locks keeps recovery files independent.
  if (navigator.locks) {
    async function claim(id) {
      return new Promise(resolve => {
        navigator.locks.request(`desigma-session:${id}`, { ifAvailable: true }, lock => {
          resolve(!!lock);
          if (lock) return new Promise(release => window.addEventListener('pagehide', release, { once: true }));
        }).catch(() => resolve(false));
      });
    }
    if (!await claim(sessionId)) { sessionId = crypto.randomUUID(); await claim(sessionId); }
  }
  try { sessionStorage.setItem('desigma-session', sessionId); } catch {}
  sessionPath = `/sessions/${sessionId}.desigma`;
  if (!params.has('fixture') && !params.has('fresh') && !params.has('file')) {
    const sessions = fs.readDir('/sessions').filter(path => path.endsWith('.desigma')).sort((a, b) => fs.stat(b).modified - fs.stat(a).modified);
    recovery = fs.entries.has(sessionPath) ? sessionPath : sessions[0];
  }
  if (recovery) await fs.hydrate(recovery);
  if (params.has('file')) await hydrateLibraryFile(params.get('file'));
  $('loading-message').textContent = 'Loading the design engine…';
  // Streaming compilation avoids retaining a second full copy of the WASM binary in JS.
  await init();
  $('loading-message').textContent = 'Preparing your canvas…';
  let canvas = $('canvas');
  const useGpu = !!navigator.gpu && params.get('renderer') !== 'webgl';
  try { handle = await start(canvas, params.get('fixture') || undefined, recovery, useGpu, params.get('file') || undefined); }
  catch (error) {
    if (!useGpu) throw error;
    console.warn('WebGPU initialization failed; trying WebGL2', error);
    const replacement = canvas.cloneNode(); canvas.replaceWith(replacement); canvas = replacement;
    handle = await start(canvas, params.get('fixture') || undefined, recovery, false, params.get('file') || undefined);
  }
  const tools = JSON.parse(handle.tools());
  connections = createConnections({ transport: desigmaNet,
    call: (name, args) => JSON.parse(handle.user_collaboration(name, JSON.stringify(args))),
    onStatus: message => sharing?.status(message) });
  bridge = await registerTools({ tools, execute: async (name, args, options) => {
    const t = performance.now();
    options.signal?.throwIfAborted();
    if (name === 'desigma_open_file') {
      if (args.file_id) await hydrateLibraryFile(args.file_id);
      if (args.path && fs.entries.has(fs.normalize(args.path))) await fs.hydrate(args.path);
    }
    let result;
    if (['desigma_create_collaboration_link', 'desigma_accept_collaboration_link'].includes(name)) {
      if (!JSON.parse(handle.stats()).agents) throw new Error('Agent access is disabled');
      result = await connections[name === 'desigma_create_collaboration_link' ? 'create' : 'accept'](args);
    } else if (['desigma_create_peer_offer', 'desigma_accept_peer_offer', 'desigma_accept_peer_answer'].includes(name)) {
      if (!JSON.parse(handle.stats()).agents) throw new Error('Agent access is disabled');
      const method = { desigma_create_peer_offer: 'createOffer', desigma_accept_peer_offer: 'acceptOffer', desigma_accept_peer_answer: 'acceptAnswer' }[name];
      result = name === 'desigma_create_peer_offer' ? await desigmaNet[method](args.ice_servers || [])
        : name === 'desigma_accept_peer_offer' ? await desigmaNet[method](args.offer, args.ice_servers || [])
        : (await desigmaNet[method](args.answer), { status: 'connecting' });
    } else if (['desigma_export_image', 'desigma_export_animation', 'desigma_export_asset'].includes(name)) {
      if (!JSON.parse(handle.stats()).agents) throw new Error('Agent access is disabled');
      const path = fs.normalize(args.path);
      const format = name === 'desigma_export_image' ? 'png' : args.format;
      const extension = ['png-zip','png-frames','zip'].includes(format) || (name === 'desigma_export_animation' && format === 'png') ? 'zip' : format;
      if (!path.toLowerCase().endsWith('.' + extension)) throw new Error(`Export path must end in .${extension}`);
      if (!args.path.startsWith('/')) throw new Error('Use an absolute browser storage path');
      const bytes = await compute.run('export', { document: await snapshot(options), name, args, fonts: workerFonts() }, options);
      options.signal?.throwIfAborted();
      fs.write(path, bytes);
      await fs.flush();
      result = { path, bytes: bytes.byteLength, exported: true };
    } else {
      result = JSON.parse(handle.call(name, JSON.stringify(args)));
      if (!options.definition.annotations?.readOnlyHint && !['desigma_set_view','desigma_select_nodes','desigma_present','desigma_allocate_node_ids'].includes(name) && !(name === 'desigma_execute_action' && /^(fit_|zoom_|select_|copy$|pixel_grid$|rulers$|layout_grids$|snap_pixel$)/.test(args.action))) {
        try { await persist(true); } catch (error) { result.persistence = { saved: false, error: error.message }; }
      }
    }
    metrics.calls.push({ name, duration: performance.now() - t });
    if (metrics.calls.length > 200) metrics.calls.shift();
    return result;
  } });
  globalThis.desigma = Object.freeze({
    version: 1,
    mode: bridge.mode,
    tools: bridge.tools,
    call: bridge.call,
    stats: () => ({ ...JSON.parse(handle.stats()), storage: fs.stats(), wasmBytes: performance.getEntriesByType('resource').find(e => e.name.endsWith('_bg.wasm'))?.decodedBodySize, readyMs: metrics.readyMs }),
    metrics: () => structuredClone(metrics),
    save: () => persist(true),
    download: async () => download(`${JSON.parse(handle.stats()).name || 'Untitled'}.desigma`, new Uint8Array(await (await snapshot()).arrayBuffer())),
  });
  $('agent-status').textContent = `Agent tools · ${tools.length}`;
  $('agent-description').textContent = bridge.mode === 'javascript'
    ? 'This browser has no native WebMCP API. Agents can use window.desigma.tools() and window.desigma.call(name, arguments).'
    : `${tools.length} tools registered with ${bridge.mode}.modelContext.`;
  $('open-file').disabled = false; $('download').disabled = false;
  sharing = mountSharing({ connections, transport: desigmaNet,
    end: () => JSON.parse(handle.user_collaboration('desigma_end_collaboration', '{}')) });
  $('open-file').onclick = () => loadFiles('Design files', '.desigma,.fig,.pen,.json,.svg', false);
  $('download').onclick = () => globalThis.desigma.download().catch(notice);
  $('loading').hidden = true;
  metrics.readyMs = performance.now() - began;
  document.documentElement.dataset.ready = 'true';
  canvas.focus();
  await persist(true).catch(() => {});
  saveTimer = setInterval(() => {
    if (document.hidden) return;
    try {
      const stats = JSON.parse(handle.stats());
      $('renderer-status').textContent = `${stats.gpu ? 'WebGPU' : 'WebGL / CPU'} · ${stats.nodes.toLocaleString()} layers`;
      persist().catch(() => {});
    } catch (error) { notice(error); }
  }, 1200);
  if ('serviceWorker' in navigator && !params.has('dev')) {
    navigator.serviceWorker.register('./sw.js', { type: 'module' }).catch(console.warn);
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(true).catch(() => {}); });
  window.addEventListener('pagehide', () => { persist(true).catch(() => {}); });
  window.addEventListener('hashchange', () => { if (location.hash.startsWith('#join=')) { try { handle.receive_link(location.href); } catch (error) { notice(error); } } });
  window.addEventListener('beforeunload', event => {
    let unsaved = false;
    try { const stats=JSON.parse(handle.stats()); unsaved=stats.busy || (!stats.home && stats.revision!==savedRevision); } catch {}
    if (saving || fs.pending.size || fs.lastError || unsaved) { event.preventDefault(); event.returnValue = ''; }
  });
}
boot().catch(error => {
  console.error(error);
  $('loading').hidden = true;
  $('failure').hidden = false;
  $('failure-message').textContent = error?.message || String(error);
});
