// A preview returns bytes directly. It never enters the file system's download
// path, so agents do not need to race a browser download event to inspect work.
export async function renderPreview({ args, compute, snapshot, fonts, signal }) {
  const bytes = await compute.run('export', {
    document: await snapshot(), name: 'desigma_export_asset',
    args: { node_id: args.node_id, format: 'png', path: '/preview.png', scale: args.scale ?? 1 }, fonts,
  }, { signal });
  signal?.throwIfAborted();
  if (bytes.length < 24 || ![137,80,78,71,13,10,26,10].every((n,i) => bytes[i] === n)) throw new Error('Preview renderer did not return PNG');
  if (bytes.length > 8 * 1024 * 1024) throw new Error('Preview exceeds 8 MiB; reduce scale or use export_asset');
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 16384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  return { mime_type: 'image/png', width: header.getUint32(16), height: header.getUint32(20), bytes: bytes.length, data_url: `data:image/png;base64,${btoa(binary)}` };
}
