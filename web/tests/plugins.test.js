import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonicalPluginUrl, createPluginHost, DEFAULT_PLUGIN_URL } from '../plugins.js';

test('plugin registry accepts fork manifests and rejects alternate sources and disguised paths', () => {
  const raw = 'https://raw.githubusercontent.com/jixoai/desigma/browser-wasm/plugins/shapes/manifest.json';
  assert.equal(canonicalPluginUrl(DEFAULT_PLUGIN_URL), raw);
  assert.equal(canonicalPluginUrl(` ${raw} `), raw);
  for (const url of [
    raw.replace('/jixoai/', '/another-owner/'),
    raw.replace('/desigma/', '/another-repo/'),
    raw.replace('https:', 'http:'),
    raw.replace('.com/', '.com:8443/'),
    raw.replace('https://', 'https://user@'),
    raw.replace('/shapes/', '/%73hapes/'),
    raw.replace('/shapes/', '/shapes/../shapes/'),
    raw.replace('/shapes/', '/shapes\\/'),
    raw.replace('/browser-wasm/', '/./'),
    raw.replace('/browser-wasm/', '/' + 'a'.repeat(101) + '/'),
    DEFAULT_PLUGIN_URL.replace('/blob/', '/raw/'),
    raw + '?download=1', raw + '#fragment',
  ]) assert.throws(() => canonicalPluginUrl(url), undefined, url);
});

test('default plugin installs entirely from packaged assets, with canonical cache keys and license', async () => {
  const cache = new Map(), requests = [];
  const host = createPluginHost({ cache, async fetchBytes(url) {
    const prefix = new URL('../plugins/shapes/', import.meta.url).href;
    assert.ok(url.startsWith(prefix), `Unexpected remote request: ${url}`);
    const file = url.slice(prefix.length); requests.push(file);
    return new Uint8Array(await readFile(new URL(`../../plugins/shapes/${file}`, import.meta.url)));
  } });
  await host.prepare(DEFAULT_PLUGIN_URL);
  assert.deepEqual(requests, ['manifest.json', 'panel.html', 'main.js', 'styles.css', 'LICENSE']);
  const base = canonicalPluginUrl(DEFAULT_PLUGIN_URL).replace('manifest.json', '');
  assert.equal(cache.size, 5);
  const manifest = JSON.parse(new TextDecoder().decode(cache.get(base + 'manifest.json')));
  assert.equal(manifest.id, 'fde2e-shapes');
  assert.deepEqual(manifest.network, []);
  assert.deepEqual(manifest.permissions, ['document:insert-svg']);
  assert.match(new TextDecoder().decode(cache.get(base + 'LICENSE')), /Copyright.*FDE2E/);
});

test('pinned plugin revision uses its exact source and failed installs publish no partial cache', async () => {
  const cache = new Map(), requests = [];
  const url = DEFAULT_PLUGIN_URL.replace('/browser-wasm/', '/abc123/');
  const host = createPluginHost({ cache, async fetchBytes(request) {
    requests.push(request);
    if (request.endsWith('manifest.json')) return new TextEncoder().encode(JSON.stringify({ schema_version: 2, files: ['main.js', 'panel.html'] }));
    throw new Error('Offline');
  } });
  await assert.rejects(host.prepare(url), /Offline/);
  assert.ok(requests.every(request => request.startsWith('https://raw.githubusercontent.com/jixoai/desigma/abc123/plugins/shapes/')));
  assert.equal(cache.size, 0);
});
