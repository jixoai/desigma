// The editor reads a synchronous working set. Only changed records go to IndexedDB;
// a rename and its temporary file cleanup commit together in one transaction.
export class BrowserFileSystem {
  constructor({ name = 'desigma-browser-v1', onError = console.error, onDownload = () => {}, onReady = () => {}, cacheBytes = 32 * 1024 * 1024 } = {}) {
    this.name = name;
    this.onError = onError;
    this.onDownload = onDownload;
    this.onReady = onReady;
    this.entries = new Map();
    this.pending = new Map();
    this.versions = new Map();
    this.inFlight = new Set();
    this.db = null;
    this.timer = null;
    this.writing = Promise.resolve();
    this.lastError = null;
    this.cacheBytes = cacheBytes;
    this.access = new Map();
    this.loading = new Map();
  }
  normalize(path) {
    if (typeof path !== 'string' || path.includes('\0')) this.fail('EINVAL', 'Invalid file path');
    const out = [];
    for (const part of path.replaceAll('\\', '/').split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') { if (!out.length) this.fail('EACCES', 'Path escapes browser storage'); out.pop(); }
      else out.push(part);
    }
    return '/' + out.join('/');
  }
  fail(code, message) { throw Object.assign(new Error(message), { code }); }
  async init() {
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'path' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Close other FDE2E Desigma tabs to upgrade browser storage.'));
    });
    this.db.onversionchange = () => this.db.close();
    await new Promise((resolve, reject) => {
      const tx = this.db.transaction('files', 'readwrite');
      const request = tx.objectStore('files').openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const entry = cursor.value;
          // One-time migration of v1 byte arrays, one record at a time. Subsequent
          // launches only clone Blob handles, including for untouched old projects.
          if (entry.bytes && this.lazy(cursor.key)) {
            entry.blob = new Blob([entry.bytes]); delete entry.bytes; cursor.update(entry);
          }
          this.entries.set(cursor.key, entry); this.versions.set(cursor.key, this.version(entry)); cursor.continue();
        }
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    // Blob handles are cheap to clone. Hydrate only metadata/settings and legacy records;
    // project documents and private recovery files stay on disk until opened.
    for (const [path, entry] of this.entries) {
      if (entry.blob && !this.lazy(path)) entry.bytes = new Uint8Array(await entry.blob.arrayBuffer());
      if (entry.bytes && this.lazy(path)) {
        entry.blob ??= new Blob([entry.bytes]);
        delete entry.bytes;
      }
    }
    this.channel = new BroadcastChannel(`${this.name}:storage`);
    this.channel.unref?.();
    this.channel.onmessage = async ({ data }) => {
      if (!Array.isArray(data)) return;
      for (const [path, entry] of data) {
        if (this.pending.has(path) || this.inFlight.has(path)) continue;
        if (entry) this.entries.set(path, entry); else this.entries.delete(path);
        this.versions.set(path, this.version(entry));
        if (entry?.blob && !this.lazy(path)) {
          try { await this.hydrate(path); } catch (error) { this.onError(error); }
        }
      }
    };
    for (const dir of ['/', '/library', '/imports', '/downloads', '/cache']) this.mkdir(dir);
    return this;
  }
  version(entry) { return entry?.version ?? entry?.modified ?? null; }
  kind(path) {
    const entry = this.entries.get(this.normalize(path));
    if (!entry) return undefined;
    if (entry.kind !== undefined) return entry.kind || undefined;
    if (!entry.kindLoading) {
      entry.kindLoading = true;
      const blob = entry.blob ?? new Blob([entry.bytes]);
      blob.slice(0, 65536).text().then(text => {
        // Native files write name/kind before the nodes map. Parse that small prefix
        // as JSON (not a regex on values), so a name containing escaped keys is safe.
        const boundary = /,\s*"nodes"\s*:/.exec(text);
        try { entry.kind = boundary ? JSON.parse(text.slice(0, boundary.index) + '}').kind || 'Design' : null; }
        catch { entry.kind = null; }
        this.onReady();
      }).catch(this.onError);
    }
    return undefined;
  }
  lazy(path) { return path.startsWith('/sessions/') || ((/\/projects\/[^/]+\/files\//.test(path) || path.startsWith('/library/trash/')) && /\.desigma(?:\.tmp)?$/.test(path)); }
  async hydrate(path) {
    path = this.normalize(path);
    const entry = this.entries.get(path);
    if (!entry) this.fail('ENOENT', `File not found: ${path}`);
    if (!entry.directory && !entry.bytes) {
      let task = this.loading.get(entry);
      if (!task) {
        task = entry.blob.arrayBuffer().then(buffer => { entry.bytes = new Uint8Array(buffer); }).finally(() => this.loading.delete(entry));
        this.loading.set(entry, task);
      }
      await task;
      // A different tab or a local write may have replaced the entry during I/O.
      if (this.entries.get(path) !== entry) return this.hydrate(path);
    }
    this.access.delete(path); this.access.set(path, true);
    this.trim(path);
    return entry.bytes;
  }
  trim(keep) {
    let size = 0;
    for (const [path, entry] of this.entries) if (this.lazy(path)) size += entry.bytes?.byteLength || 0;
    for (const path of this.access.keys()) {
      if (size <= this.cacheBytes) break;
      const entry = this.entries.get(path);
      if (path === keep || !entry?.blob || !this.lazy(path) || this.pending.has(path) || this.inFlight.has(path)) continue;
      size -= entry.bytes?.byteLength || 0;
      delete entry.bytes; this.access.delete(path);
    }
  }
  stats() {
    let residentBytes = 0, storedBytes = 0, coldFiles = 0;
    for (const entry of this.entries.values()) {
      residentBytes += entry.bytes?.byteLength || 0;
      storedBytes += entry.blob?.size ?? entry.bytes?.byteLength ?? 0;
      if (entry.blob && !entry.bytes) coldFiles++;
    }
    return { residentBytes, storedBytes, coldFiles, entries: this.entries.size, cacheBytes: this.cacheBytes };
  }
  close() { this.channel?.close(); this.db?.close(); }
  persistent(path) { return !path.startsWith('/downloads/') && !path.startsWith('/imports/'); }
  change(path, entry) {
    if (entry) entry = { ...entry, version: crypto.randomUUID() };
    if (entry) this.entries.set(path, entry); else this.entries.delete(path);
    this.access.delete(path);
    if (entry?.bytes) this.access.set(path, true);
    if (!this.persistent(path)) return;
    this.pending.set(path, entry);
    if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.flush().catch(this.onError); }, 150);
  }
  stat(path) {
    const entry = this.entries.get(this.normalize(path));
    if (!entry) this.fail('ENOENT', `File not found: ${path}`);
    return { directory: entry.directory, size: entry.blob?.size ?? entry.bytes?.byteLength ?? 0, modified: entry.modified };
  }
  read(path) {
    const normalized = this.normalize(path);
    const entry = this.entries.get(normalized);
    if (!entry) this.fail('ENOENT', `File not found: ${normalized}`);
    if (entry.directory) this.fail('EINVAL', 'Cannot read a directory as a file');
    if (!entry.bytes) this.fail('EAGAIN', `File must be loaded before reading: ${normalized}`);
    this.access.delete(normalized); this.access.set(normalized, true);
    return entry.bytes;
  }
  writeBlob(path, blob) {
    path = this.normalize(path);
    const parent = path.slice(0, path.lastIndexOf('/')) || '/';
    if (!this.stat(parent).directory || this.entries.get(path)?.directory) this.fail('EINVAL', 'Invalid file destination');
    this.change(path, { path, directory: false, blob, modified: Date.now() });
  }
  copy(from, to) {
    from = this.normalize(from); to = this.normalize(to);
    const source = this.entries.get(from);
    if (!source) this.fail('ENOENT', `File not found: ${from}`);
    if (source.directory) this.fail('EINVAL', 'Cannot copy a directory');
    if (source.blob && this.lazy(to)) this.writeBlob(to, source.blob); else if (source.bytes) this.write(to, source.bytes);
    else this.fail('EAGAIN', 'Load the source before copying it to this location');
    return this.stat(to).size;
  }
  write(path, bytes) {
    path = this.normalize(path);
    const parent = path.slice(0, path.lastIndexOf('/')) || '/';
    if (!this.stat(parent).directory) this.fail('EINVAL', 'Parent is not a directory');
    if (this.entries.get(path)?.directory) this.fail('EINVAL', 'Cannot overwrite a directory');
    // wasm-bindgen's slice is borrowed WASM memory; own it before returning to Rust.
    const owned = new Uint8Array(bytes).slice();
    this.change(path, { path, directory: false, bytes: owned, modified: Date.now() });
    if (path.startsWith('/downloads/') && owned.length && !/\.(tmp|part)$/.test(path) && !path.split('/').pop().startsWith('.')) this.onDownload(path.split('/').pop(), owned);
  }
  mkdir(path) {
    path = this.normalize(path);
    let current = '';
    for (const part of ['', ...path.split('/').filter(Boolean)]) {
      current = part ? (current === '/' ? '' : current) + '/' + part : '/';
      const old = this.entries.get(current);
      if (old && !old.directory) this.fail('EEXIST', `A file occupies ${current}`);
      if (!old) this.change(current, { path: current, directory: true, modified: Date.now() });
    }
  }
  readDir(path) {
    path = this.normalize(path);
    if (!this.stat(path).directory) this.fail('EINVAL', 'Not a directory');
    const prefix = path === '/' ? '/' : path + '/';
    return [...this.entries.keys()].filter(key => key.startsWith(prefix) && key !== path && !key.slice(prefix.length).includes('/')).sort();
  }
  remove(path, recursive) {
    path = this.normalize(path);
    const stat = this.stat(path);
    if (path === '/') this.fail('EACCES', 'Cannot remove the storage root');
    const children = stat.directory ? [...this.entries.keys()].filter(key => key.startsWith(path + '/')) : [];
    if (children.length && !recursive) this.fail('EINVAL', 'Directory is not empty');
    for (const child of children) this.change(child, null);
    this.change(path, null);
  }
  rename(from, to) {
    from = this.normalize(from); to = this.normalize(to);
    this.stat(from);
    if (from === to) return;
    if (to.startsWith(from + '/')) this.fail('EINVAL', 'Cannot move a directory inside itself');
    const parent = to.slice(0, to.lastIndexOf('/')) || '/';
    if (!this.stat(parent).directory) this.fail('EINVAL', 'Destination parent is not a directory');
    const source = this.entries.get(from);
    const destination = this.entries.get(to);
    if (destination && (destination.directory !== source.directory || (destination.directory && this.readDir(to).length))) this.fail('EEXIST', 'Destination is not replaceable');
    const moved = [...this.entries].filter(([key]) => key === from || key.startsWith(from + '/'));
    for (const [oldPath, entry] of moved) {
      const path = to + oldPath.slice(from.length);
      this.change(path, { ...entry, path, modified: Date.now() });
      this.change(oldPath, null);
    }
    if (to.startsWith('/downloads/') && !source.directory) this.onDownload(to.split('/').pop(), source.bytes);
  }
  async flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    // Serialize transactions while allowing newer writes to accumulate separately.
    const work = this.writing.catch(() => {}).then(async () => {
      if (!this.pending.size) return;
      const batch = this.pending;
      this.pending = new Map();
      try {
        this.inFlight = new Set(batch.keys());
        const committed = new Map();
        await new Promise((resolve, reject) => {
          const tx = this.db.transaction('files', 'readwrite', { durability: 'strict' });
          const store = tx.objectStore('files'); let conflict;
          for (const [path, entry] of batch) {
            const request = store.get(path);
            request.onsuccess = () => {
              const current = request.result;
              if (current?.directory && entry?.directory) { committed.set(path, current); return; }
              if (this.version(current) !== (this.versions.get(path) ?? null)) {
                conflict = new Error(`Another tab changed ${path}. Download your document before reloading to resolve the conflict.`);
                conflict.code = 'ECONFLICT'; tx.abort(); return;
              }
              if (entry) {
                // Persist large documents as disk-backed Blob records. Metadata remains
                // directly readable by Rust; broadcasting never clones document arrays.
                const record = this.lazy(path) ? { ...entry, blob: entry.blob ?? new Blob([entry.bytes]), bytes: undefined } : entry;
                if (record.blob && this.entries.get(path) === entry) entry.blob = record.blob;
                store.put(record);
                committed.set(path, record);
              } else { store.delete(path); committed.set(path, entry); }
            };
          }
          tx.oncomplete = resolve;
          tx.onerror = () => reject(conflict || tx.error);
          tx.onabort = () => reject(conflict || tx.error || new Error('Storage transaction aborted'));
        });
        for (const [path, entry] of committed) this.versions.set(path, this.version(entry));
        this.inFlight.clear();
        // Recovery files belong to one locked tab; broadcasting their large byte arrays
        // makes every other editor duplicate them even though it never reads them.
        const shared = [...committed].filter(([path]) => !path.startsWith('/sessions/'));
        if (shared.length) this.channel?.postMessage(shared);
        this.lastError = null;
        this.trim();
      } catch (error) {
        this.inFlight.clear();
        // Never lose dirty writes on quota/transaction failure, or overwrite a newer edit.
        for (const [key, value] of batch) if (!this.pending.has(key)) this.pending.set(key, value);
        this.lastError = error;
        throw error;
      }
    });
    this.writing = work;
    await work;
  }
}
