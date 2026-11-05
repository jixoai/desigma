// Original FDE2E vector primitives; no network or external asset dependencies.
const shapes = [
  ['Rectangle', '<rect x="4" y="6" width="24" height="20" rx="3"/>'],
  ['Circle', '<circle cx="16" cy="16" r="12"/>'],
  ['Triangle', '<path d="M16 3L30 28H2Z"/>'],
  ['Diamond', '<path d="M16 2L30 16L16 30L2 16Z"/>'],
  ['Arrow', '<path d="M17 3L30 16L17 29V21H2V11H17Z"/>'],
  ['Plus', '<path d="M12 3H20V12H29V20H20V29H12V20H3V12H12Z"/>'],
];
const list = document.getElementById('shapes');
const status = document.getElementById('status');
for (const [name, geometry] of shapes) {
  const button = document.createElement('button');
  button.type = 'button';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 32 32" fill="#7ce8ca">${geometry}</svg>`;
  const preview = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  preview.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span'); label.textContent = name;
  button.append(document.importNode(preview, true), label);
  button.addEventListener('click', async () => {
    for (const control of list.children) control.disabled = true;
    status.textContent = `Inserting ${name.toLowerCase()}…`;
    try {
      const response = await fetch('insert-svg', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `FDE2E ${name}`, svg }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Could not insert the shape.');
      status.textContent = `${name} inserted. Use Undo in the editor to remove it.`;
    } catch (error) {
      status.textContent = `${error.message} Keep an editable document open and try again.`;
    } finally { for (const control of list.children) control.disabled = false; }
  });
  list.append(button);
}
