// Recovery belongs to one editor tab. Never borrow another tab's latest draft.
const SESSION_KEY = 'desigma-session';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function openSession({ fs, params, storage,
  locks = globalThis.navigator?.locks, events = globalThis.window, uuid = () => crypto.randomUUID() }) {
  let previous;
  try { storage ??= globalThis.sessionStorage; previous = storage?.getItem(SESSION_KEY); } catch {}
  const fresh = params.has('fresh') || params.has('fixture');
  // Without Web Locks a copied sessionStorage cannot be distinguished from its
  // owner. Prefer a new draft to writing another live tab's recovery file.
  let id = !fresh && locks && UUID.test(previous || '') ? previous : uuid();
  let release = () => {};
  let active = true;
  async function claim(candidate) {
    return new Promise((resolve, reject) => {
      locks.request(`desigma-session:${candidate}`, { ifAvailable: true }, lock => {
        if (!lock) { resolve(false); return; }
        const held = new Promise(done => { release = done; });
        resolve(true);
        return held;
      }).catch(reject);
    });
  }
  if (locks && !await claim(id)) {
    id = uuid();
    if (!await claim(id)) throw new Error('Could not open an independent editor session. Retry this tab.');
  }
  try { storage?.setItem(SESSION_KEY, id); } catch {}
  const path = `/sessions/${id}.desigma`;
  const dispose = () => { active = false; release(); };
  events?.addEventListener('pagehide', dispose, { once: true });
  return Object.freeze({
    id, path,
    recovery: !fresh && !params.has('file') && fs.entries.has(path) ? path : undefined,
    assertActive() { if (!active) throw new Error('This editor session has closed. Reload the tab before editing.'); },
    dispose,
  });
}
