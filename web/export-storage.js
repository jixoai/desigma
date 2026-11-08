// Export paths are chosen by people and agents; unlike ordinary filesystem
// writes, an export creates its destination folders automatically.
export function exportPath(fs, path) {
  if (typeof path !== 'string' || !path.startsWith('/')) throw new Error('Use an absolute browser storage path');
  path = fs.normalize(path);
  if (path === '/' || fs.entries.get(path)?.directory) throw new Error('Export destination must be a file');
  const parent = path.slice(0, path.lastIndexOf('/')) || '/';
  let current = parent;
  while (current !== '/') {
    const entry = fs.entries.get(current);
    if (entry && !entry.directory) throw new Error(`A file occupies export folder ${current}`);
    current = current.slice(0, current.lastIndexOf('/')) || '/';
  }
  return { path, parent };
}

export async function writeExport(fs, path, bytes, signal) {
  signal?.throwIfAborted();
  const destination = exportPath(fs, path);
  fs.mkdir(destination.parent);
  fs.write(destination.path, bytes);
  await fs.flush();
  return { path: destination.path, bytes: bytes.byteLength, exported: true };
}
