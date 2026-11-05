import init, { worker_export, worker_import, worker_register_font, worker_thumbnail } from './pkg/desigma_app.js';
let ready;
const fonts = new Set();
let currentId;
self.desigmaCompute = { progress: (done, total) => self.postMessage({ id: currentId, progress: [done, total] }) };
self.onmessage = async ({ data }) => {
  const { id, operation, payload } = data;
  currentId = id;
  try {
    ready ??= init();
    await ready;
    if (operation === 'export' || operation === 'thumbnail') {
      for (const font of payload.fonts || []) { if (!fonts.has(font.key)) { worker_register_font(font.bytes); fonts.add(font.key); } }
      const document = payload.document instanceof Blob ? await payload.document.text() : payload.document;
      const bytes = operation === 'thumbnail' ? worker_thumbnail(document) : worker_export(document, payload.name, JSON.stringify(payload.args));
      self.postMessage({ id, result: bytes }, [bytes.buffer]);
    } else if (operation === 'import') {
      const result = worker_import(payload.bytes, payload.extension, payload.name);
      self.postMessage({ id, result });
    } else throw new Error('Unknown worker operation');
  } catch (error) { self.postMessage({ id, error: error?.message || String(error) }); }
};
