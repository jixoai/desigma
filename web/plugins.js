export const DEFAULT_PLUGIN_URL = 'https://github.com/jixoai/desigma/blob/browser-wasm/plugins/shapes/manifest.json';

// Match the Rust registry boundary before downloading any untrusted assets.
export function canonicalPluginUrl(input) {
  const url = new URL(input.trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || input.includes('%') || input.includes('\\') || input.split('/').some(p => p === '.' || p === '..')) throw new Error('Invalid plugin URL');
  const parts = url.pathname.slice(1).split('/');
  if (url.hostname === 'github.com' && parts.length === 7 && parts[2] === 'blob') parts.splice(2, 1);
  else if (url.hostname !== 'raw.githubusercontent.com' || parts.length !== 6) throw new Error('Use a plugin manifest from jixoai/desigma');
  const safe = part => /^[\w.-]{1,100}$/.test(part) && part !== '.' && part !== '..';
  if (parts[0] !== 'jixoai' || parts[1] !== 'desigma' || !safe(parts[2]) || parts[3] !== 'plugins' || !safe(parts[4]) || parts[5] !== 'manifest.json') throw new Error('Use a plugin manifest from jixoai/desigma');
  return `https://raw.githubusercontent.com/${parts.join('/')}`;
}

// Isolate installed panels in an opaque-origin sandbox. The only document operation
// crossing the boundary is validated SVG insertion into the currently running session.
export function createPluginHost({ fetchBytes, cache, insertSvg, onError, storage }) {
  const active = new Map(); let sequence = 0;
  const encode = new TextEncoder(), decode = new TextDecoder();
  const safePath = path => typeof path === 'string' && path.length <= 240 && path.split('/').every(p => /^[\w.-]{1,100}$/.test(p) && p !== '.' && p !== '..');
  async function prepare(input) {
    const url = canonicalPluginUrl(input), base = url.slice(0, -'manifest.json'.length);
    // The default package travels with the static build, including offline precaching.
    // Other revisions still use their exact remote source.
    const downloadBase = url === canonicalPluginUrl(DEFAULT_PLUGIN_URL) ? new URL('./plugins/shapes/', import.meta.url).href : base;
    const manifestBytes = await fetchBytes(downloadBase + 'manifest.json', 2 << 20);
    const manifest = JSON.parse(decode.decode(manifestBytes));
    const files = manifest.schema_version === 2 ? manifest.files : [manifest.main];
    if (!Array.isArray(files) || files.length > 16 || !files.every(safePath)) throw new Error('Invalid plugin asset list');
    const downloaded = new Map([[url, manifestBytes]]); let total = manifestBytes.length;
    for (const file of [...files, 'LICENSE']) {
      const bytes = await fetchBytes(downloadBase + file, 2 << 20); total += bytes.length;
      if (total > 8 << 20) throw new Error('Plugin bundle exceeds 8 MiB');
      downloaded.set(base + file, bytes);
    }
    for (const [url, bytes] of downloaded) cache.set(url, bytes);
  }
  function open(payload) {
    const { plugin, panel, files, network } = JSON.parse(payload);
    if (!files[panel]) throw new Error('Plugin panel is missing');
    for (const [key, value] of Object.entries(files)) if (!safePath(key) || typeof value !== 'string') throw new Error('Invalid plugin asset');
    if (!Array.isArray(network) || network.some(origin => origin !== 'https://api.iconify.design')) throw new Error('Unsupported plugin network origin');
    const id = ++sequence, token = crypto.randomUUID(), nonce = crypto.randomUUID().replaceAll('-', '');
    const section = document.createElement('section'); section.className = 'plugin-panel'; section.setAttribute('aria-label', plugin.name);
    const header = document.createElement('header'), title = document.createElement('strong'), close = document.createElement('button');
    title.textContent = plugin.name; close.textContent = 'Close'; close.type = 'button'; close.onclick = () => dispose(id);
    header.append(title, close);
    const iframe = document.createElement('iframe'); iframe.title = plugin.name;
    iframe.setAttribute('sandbox', 'allow-scripts allow-downloads'); iframe.referrerPolicy = 'no-referrer';
    const parsed = new DOMParser().parseFromString(files[panel], 'text/html');
    parsed.querySelectorAll('meta[http-equiv],base').forEach(node => node.remove());
    const urls = [];
    // Module imports resolve against a private import map of the declared bundle only.
    const imports = {};
    for (const [path, source] of Object.entries(files)) if (path.endsWith('.js')) {
      const rewritten = source.replace(/(from\s*|import\s*\()(['"])(\.\.?\/[^'"]+)\2/g, (_, prefix, quote, relative) => {
        const resolved = new URL(relative, `https://desigma-plugin.invalid/${path}`).pathname.slice(1);
        if (!safePath(resolved) || !files[resolved]) throw new Error(`Plugin module is missing: ${resolved}`);
        return `${prefix}${quote}desigma-plugin:${resolved}${quote}`;
      });
      const encoded = new TextEncoder().encode(rewritten); let binary=''; for (let i=0;i<encoded.length;i+=8192) binary += String.fromCharCode(...encoded.subarray(i,i+8192));
      imports[`desigma-plugin:${path}`] = 'data:text/javascript;base64,' + btoa(binary);
    }
    for (const link of parsed.querySelectorAll('link[rel="stylesheet"]')) {
      const path = link.getAttribute('href').replace(/^\.\//, '');
      if (!files[path]) throw new Error(`Plugin stylesheet is missing: ${path}`);
      const style = parsed.createElement('style'); style.textContent = files[path]; link.replaceWith(style);
    }
    for (const script of parsed.querySelectorAll('script')) {
      script.setAttribute('nonce', nonce);
      const path = script.getAttribute('src')?.replace(/^\.\//, '');
      if (path) {
        if (!files[path]) throw new Error(`Plugin script is missing: ${path}`);
        if (script.type === 'module') script.setAttribute('src', imports[`desigma-plugin:${path}`]);
        else { script.removeAttribute('src'); script.textContent = files[path]; }
      }
    }
    const path = `/library/plugin-storage/${plugin.id}.json`;
    let saved = {};
    try { saved = JSON.parse(decode.decode(storage().read(path))); } catch {}
    const bootstrap = `(() => {
      const token=${JSON.stringify(token)}, permissions=${JSON.stringify(plugin.permissions)}, values=${JSON.stringify(saved)}, pending=new Map(); let serial=0;
      const request=(operation,data)=>new Promise((resolve,reject)=>{const id=++serial;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Plugin request timed out'));},10000);pending.set(id,{resolve,reject,timer});parent.postMessage({desigmaPlugin:token,id,operation,data},'*');});
      addEventListener('message',e=>{if(e.source!==parent||e.data?.desigmaPlugin!==token)return;const p=pending.get(e.data.id);if(!p)return;clearTimeout(p.timer);pending.delete(e.data.id);e.data.error?p.reject(new Error(e.data.error)):p.resolve(e.data.result);});
      const nativeFetch=fetch.bind(window);
      window.fetch=async(input,options={})=>{
        const url=typeof input==='string'?input:input.url || String(input);
        if(/(?:^|\\/)host\\.json$/.test(url))return new Response(JSON.stringify({api_version:1,token,permissions}),{headers:{'content-type':'application/json'}});
        if(/(?:^|\\/)insert-svg$/.test(url)){
          if(!permissions.includes('document:insert-svg'))throw new Error('SVG insertion permission is required');
          const result=await request('insert',JSON.parse(options.body));return new Response(JSON.stringify({ok:true,node_id:result}),{headers:{'content-type':'application/json'}});
        }
        return nativeFetch(input,{...options,credentials:'omit'});
      };
      const local={getItem:key=>Object.hasOwn(values,key)?String(values[key]):null,setItem(key,value){values[key]=String(value);request('storage',values).catch(console.error)},removeItem(key){delete values[key];request('storage',values).catch(console.error)},clear(){for(const key of Object.keys(values))delete values[key];request('storage',values).catch(console.error)},key:index=>Object.keys(values)[index]??null,get length(){return Object.keys(values).length}};
      Object.defineProperty(window,'localStorage',{value:local});
    })();`;
    const policy = parsed.createElement('meta'); policy.httpEquiv = 'Content-Security-Policy';
    policy.content = `default-src 'none'; script-src 'nonce-${nonce}' data:; style-src 'unsafe-inline'; img-src blob: data:; connect-src ${network.length ? network.join(' ') : "'none'"}; object-src 'none'; form-action 'none'; base-uri 'none'`;
    const setup = parsed.createElement('script'); setup.setAttribute('nonce', nonce); setup.textContent = bootstrap;
    const map = parsed.createElement('script'); map.type = 'importmap'; map.setAttribute('nonce', nonce); map.textContent = JSON.stringify({ imports });
    parsed.head.prepend(policy, setup, map);
    // Escaping script end tags preserves valid HTML even for strings inside bundled code.
    for (const script of parsed.querySelectorAll('script:not([src])')) script.textContent = script.textContent.replaceAll('</script', '<\\/script');
    iframe.srcdoc = '<!doctype html>' + parsed.documentElement.outerHTML;
    const message = async event => {
      if (event.source !== iframe.contentWindow || event.data?.desigmaPlugin !== token || !active.has(id)) return;
      const request = event.data;
      try {
        let result;
        if (request.operation === 'insert' && plugin.permissions.includes('document:insert-svg')) {
          if (typeof request.data?.svg !== 'string' || request.data.svg.length > 8 << 20 || typeof request.data?.name !== 'string') throw new Error('Invalid SVG insertion');
          result = await insertSvg(id, request.data.svg, request.data.name);
        } else if (request.operation === 'storage' && plugin.permissions.includes('storage:local')) {
          const json = JSON.stringify(request.data); if (json.length > 1 << 20) throw new Error('Plugin storage exceeds 1 MiB');
          storage().mkdir('/library/plugin-storage'); storage().write(path, encode.encode(json)); await storage().flush(); result = true;
        } else throw new Error('Plugin operation is not permitted');
        if (active.has(id)) iframe.contentWindow.postMessage({ desigmaPlugin: token, id: request.id, result }, '*');
      } catch (error) { if (active.has(id)) iframe.contentWindow.postMessage({ desigmaPlugin: token, id: request.id, error: error.message || String(error) }, '*'); }
    };
    active.set(id, { section, message, urls }); window.addEventListener('message', message);
    section.append(header, iframe); document.body.append(section);
    return id;
  }
  function dispose(id) {
    const item = active.get(id); if (!item) return;
    window.removeEventListener('message', item.message); item.section.remove(); item.urls.forEach(URL.revokeObjectURL); active.delete(id);
  }
  return { prepare, open, close: dispose };
}
