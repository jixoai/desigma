import test from 'node:test';
import assert from 'node:assert/strict';
import { collectWorkerFonts } from '../font-assets.js';

test('export workers receive the cached catalog family even when the binary uses another name', () => {
  const bytes = new Uint8Array([0,1,0,0]);
  const metadata = { modified: 2, bytes: new TextEncoder().encode(JSON.stringify({ family: 'Noto Sans SC' })) };
  const fs = { entries: new Map([
    ['/cache/noto-400.ttf', { bytes, modified: 1 }],
    ['/cache/noto-400.json', metadata],
    ['/imports/custom.otf', { bytes, modified: 3 }],
    ['/cache/cold.ttf', { modified: 4 }],
  ]) };
  const fonts = collectWorkerFonts(fs);
  assert.equal(fonts.length, 2);
  assert.equal(fonts[0].family, 'Noto Sans SC');
  assert.equal(fonts[0].bytes, bytes);
  assert.equal(fonts[1].family, undefined);
  metadata.modified++;
  assert.notEqual(collectWorkerFonts(fs)[0].key, fonts[0].key, 'Changed alias must refresh worker registration');
});

test('malformed sidecars leave custom fonts usable under their binary family', () => {
  const fs = { entries: new Map([
    ['/imports/custom.ttf', { bytes: new Uint8Array([1]), modified: 1 }],
    ['/imports/custom.json', { bytes: new TextEncoder().encode('{broken'), modified: 1 }],
  ]) };
  assert.equal(collectWorkerFonts(fs)[0].family, undefined);
});

test('workers skip obsolete Latin-only CJK caches until the matching script face replaces them', () => {
  const side = { family: 'Noto Serif SC', source_url: 'https://cdn.jsdelivr.net/fontsource/fonts/noto-serif-sc@5.3.1/latin-600-normal.ttf' };
  const fs = { entries: new Map([
    ['/cache/serif.ttf', { bytes: new Uint8Array([1]), modified: 1 }],
    ['/cache/serif.json', { bytes: new TextEncoder().encode(JSON.stringify(side)), modified: 1 }],
  ]) };
  assert.equal(collectWorkerFonts(fs).length, 0);
  side.source_url = side.source_url.replace('/latin-', '/chinese-simplified-');
  fs.entries.get('/cache/serif.json').bytes = new TextEncoder().encode(JSON.stringify(side));
  assert.equal(collectWorkerFonts(fs)[0].family, 'Noto Serif SC');
});
