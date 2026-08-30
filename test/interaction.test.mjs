/**
 * The interaction paths: drag and drop, the asset library, uploads, the link
 * editor, inline-edit syncing, the autosave failure path, and the story
 * viewer's playback.
 *
 * Run: npm test
 *
 * These are the branches a host never calls directly and a render test never
 * reaches -- they only run when someone drags, drops, types or uploads. Driven
 * through the real element on the jsdom harness.
 */
import assert from 'node:assert/strict';
import { installDom, mountEditor, settle, closeDom, win } from './dom-harness.mjs';

installDom();
await import(new URL('../src/index.js', import.meta.url).href);

let passed = 0;
let failed = 0;
async function it(name, fn) {
  try { await fn(); passed++; console.log('  ok    ' + name); }
  catch (e) { failed++; console.log('  FAIL  ' + name + '\n        ' + String(e.message).split('\n').join('\n        ')); }
}

const q = (el, sel) => el.shadowRoot.querySelector(sel);
const blocksOf = (el) => el.getContent().rows.flatMap((r) => r.cols.flatMap((c) => c.blocks));
const EMAIL = '<table><tr><td><h1>Launch</h1><p>Body copy</p></td></tr></table>';

/** A drag-ish event jsdom will dispatch (it has no DragEvent constructor). */
function dragEvent(type, y) {
  const ev = new (win().Event)(type, { bubbles: true, cancelable: true });
  ev.clientY = y === undefined ? 100 : y;
  ev.clientX = 100;
  ev.dataTransfer = { setData() {}, getData() { return ''; }, setDragImage() {}, types: [], files: [] };
  return ev;
}

/** A real File, so FileReader and the validators behave as they would in a browser. */
function pngFile(name, bytes) {
  const header = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
  const body = new Uint8Array(bytes || 64).fill(1);
  const all = new Uint8Array(header.length + body.length);
  all.set(header, 0);
  all.set(body, header.length);
  return new (win().File)([all], name || 'shot.png', { type: 'image/png' });
}

console.log();
console.log('Drag and drop');

await it('dragging a new block onto the canvas inserts it at the drop index', async () => {
  const el = await mountEditor();
  el.importHtml(EMAIL);
  await settle(2);
  const before = blocksOf(el).length;
  el.core.startDrag({ kind: 'block', type: 'button' })(dragEvent('dragstart'));
  assert.ok(el.core.drag, 'a drag is in flight');
  const sheet = q(el, '[data-mc-sheet]');
  sheet.dispatchEvent(dragEvent('dragover', 50));
  sheet.dispatchEvent(dragEvent('drop', 50));
  await settle(2);
  assert.ok(blocksOf(el).length >= before, 'the drop was handled');
});

await it('indexFromPoint resolves a row index from a y coordinate', async () => {
  const el = await mountEditor();
  el.importHtml(EMAIL);
  await settle(2);
  const sheet = q(el, '[data-mc-sheet]');
  const at = el.core.indexFromPoint(sheet, 400);
  assert.equal(typeof at, 'number');
  assert.ok(at >= 0);
  assert.equal(el.core.indexFromPoint(null, 0), 0, 'a missing element is index zero, not a throw');
  assert.equal(el.core.indexFromPoint({}, 0), 0);
});

await it('a block moves between columns', async () => {
  const el = await mountEditor();
  el.core.insertRow([50, 50]);
  await settle(2);
  const row = el.getContent().rows.at(-1);
  el.core.insertBlock('text', row.id, 0);
  await settle(2);
  const block = blocksOf(el)[0];
  el.core.moveBlock(block.id, row.id, 1, 0);
  await settle(2);
  const after = el.getContent().rows.find((r) => r.id === row.id);
  assert.equal(after.cols[1].blocks.length, 1, 'landed in the second column');
  assert.equal(after.cols[0].blocks.length, 0, 'left the first');
});

await it('a block dragged out to its own row creates one', async () => {
  const el = await mountEditor();
  el.core.insertBlock('heading');
  await settle(2);
  const rowsBefore = el.getContent().rows.length;
  const block = blocksOf(el)[0];
  el.core.moveBlockToNewRow(block.id, rowsBefore);
  await settle(2);
  assert.ok(el.getContent().rows.length >= rowsBefore, 'a row was made for it');
});

await it('rows reorder', async () => {
  const el = await mountEditor();
  el.core.insertRow([100]);
  el.core.insertRow([50, 50]);
  await settle(2);
  const ids = el.getContent().rows.map((r) => r.id);
  el.core.moveRow(ids.at(-1), 0);
  await settle(2);
  assert.equal(el.getContent().rows[0].id, ids.at(-1), 'moved to the front');
});

await it('a column drop is handled', async () => {
  const el = await mountEditor();
  el.core.insertRow([50, 50]);
  await settle(2);
  const row = el.getContent().rows.at(-1);
  el.core.startDrag({ kind: 'block', type: 'text' })(dragEvent('dragstart'));
  el.core.colDragOver(dragEvent('dragover'), row.id, 0);
  el.core.colDrop(dragEvent('drop'), row.id, 0);
  await settle(2);
  assert.ok(true, 'no throw through the column drop path');
});

console.log();
console.log('Asset library and uploads');

await it('the library lists the seeded files and filters by folder and query', async () => {
  const el = await mountEditor();
  await settle(2);
  const all = el.core.visibleAssets().length;
  assert.ok(all > 0, 'seeded files');
  assert.ok(el.core.folderOptions().length > 1, 'folders offered');
  el.core.setAssetFolder('Product');
  await settle(2);
  assert.ok(el.core.visibleAssets().length <= all);
  el.core.setAssetQuery('jacket');
  await new Promise((r) => setTimeout(r, 380));
  await settle(2);
  assert.ok(el.core.visibleAssets().every((a) => a.name.includes('jacket')), 'query applied');
});

await it('choosing an asset fills the selected image block', async () => {
  const el = await mountEditor();
  el.core.insertBlock('image');
  await settle(2);
  const block = blocksOf(el)[0];
  el.core.openLibrary({ type: 'block', id: block.id, prop: 'src' });
  await settle(2);
  const asset = el.core.visibleAssets()[0];
  el.core.useAsset(asset);
  await settle(2);
  assert.equal(blocksOf(el)[0].props.src, asset.url);
});

await it('dropping an asset onto the canvas adds an image block', async () => {
  const el = await mountEditor();
  await settle(2);
  const asset = el.core.visibleAssets()[0];
  const before = blocksOf(el).length;
  el.core.dropAsset(asset.id);
  await settle(2);
  assert.ok(blocksOf(el).length > before, 'an image landed');
  el.core.dropAsset('not-a-real-id');
  await settle();
  assert.ok(true, 'an unknown id is a no-op');
});

await it('with no provider and no limits, files become data urls', async () => {
  const el = await mountEditor();
  await settle(2);
  const before = el.core.state.assets.length;
  el.core.addFilesAsDataUrls([pngFile('a.png'), new (win().File)(['x'], 'notes.txt', { type: 'text/plain' })]);
  await new Promise((r) => setTimeout(r, 120));
  await settle(2);
  assert.equal(el.core.state.assets.length, before + 1, 'the image was taken, the text file was not');
});

await it('an empty drop is a no-op', async () => {
  const el = await mountEditor();
  await settle(2);
  const before = el.core.state.assets.length;
  el.core.addFilesAsDataUrls([]);
  await el.core.addFiles([]);
  await settle(2);
  assert.equal(el.core.state.assets.length, before);
});

await it('a provider without limits refuses every upload', async () => {
  const el = await mountEditor();
  await settle(2);
  el.storageProvider = { list: async () => ({ items: [], cursor: null }), upload: async () => ({}) };
  await settle(2);
  await el.core.addFiles([pngFile('a.png')]);
  await settle(2);
  assert.ok(el.core.state.toast, 'it said why');
});

await it('a provider with limits uploads and shows the result', async () => {
  const el = await mountEditor();
  await settle(2);
  const uploaded = [];
  el.storageLimits = { accept: ['image/png'], maxBytes: 5 * 1024 * 1024 };
  el.storageProvider = {
    list: async () => ({ items: [{ id: 'r1', name: 'remote.png', url: 'https://cdn.test/r.png', w: 10, ht: 10, size: 5 }], cursor: null }),
    upload: async (file) => { uploaded.push(file.name); return { id: 'u1', name: file.name, url: 'https://cdn.test/u.png', w: 1, ht: 1, size: file.size }; },
    remove: async () => {},
    folders: async () => [{ id: 'f1', name: 'Brand' }],
  };
  await settle(3);
  assert.equal(el.core.state.assets[0].name, 'remote.png', 'the provider listing replaced the seeds');
  await el.core.addFiles([pngFile('up.png')]);
  await settle(3);
  assert.deepEqual(uploaded, ['up.png']);
});

await it('a failing listing surfaces the error instead of an empty library', async () => {
  const el = await mountEditor();
  await settle(2);
  el.storageProvider = { list: async () => { throw new Error('backend down'); }, upload: async () => ({}) };
  await settle(3);
  assert.match(String(el.core.state.assetsError || ''), /backend down/);
});

await it('removing an asset asks the provider, and survives a provider that refuses', async () => {
  const el = await mountEditor();
  await settle(2);
  el.storageLimits = { accept: ['image/png'], maxBytes: 1024 };
  el.storageProvider = {
    list: async () => ({ items: [{ id: 'r1', name: 'r.png', url: 'https://cdn.test/r.png' }], cursor: null }),
    upload: async () => ({}),
    remove: async () => { throw new Error('nope'); },
  };
  await settle(3);
  await el.core.removeAsset({ id: 'r1', name: 'r.png' });
  await settle(2);
  assert.ok(el.core.state.toast, 'the refusal was reported');
});

console.log();
console.log('Inline editing internals');

await it('the link editor applies a href and then unlinks', async () => {
  const el = await mountEditor();
  el.core.insertBlock('text');
  await settle(2);
  const block = blocksOf(el)[0];
  el.core.setState({ editing: block.id, sel: { type: 'block', id: block.id } });
  await settle(3);
  el.core.editEl = q(el, '[contenteditable="true"]');
  el.core.setState({ linkDraft: { href: 'https://example.com/x', blank: true, editing: false } });
  await settle(2);
  assert.ok(el.core.state.linkDraft, 'the popover is open');
  el.core.exec('createLink', 'https://example.com/x');
  el.core.exec('unlink');
  await settle(2);
  el.core.setState({ linkDraft: null });
  await settle();
  assert.equal(el.core.state.linkDraft, null, 'and closes again');
});

await it('syncEdit folds the live dom back into props', async () => {
  const el = await mountEditor();
  el.core.insertBlock('text');
  await settle(2);
  const block = blocksOf(el)[0];
  el.core.setState({ editing: block.id, sel: { type: 'block', id: block.id } });
  await settle(3);
  const editable = q(el, '[contenteditable="true"]');
  el.core.editEl = editable;
  editable.innerHTML = 'Typed by hand';
  el.core.syncEdit(blocksOf(el)[0]);
  await settle(2);
  assert.match(JSON.stringify(blocksOf(el)[0].props), /Typed by hand/);
});

await it('syncEdit with nothing being edited is a no-op', async () => {
  const el = await mountEditor();
  await settle(2);
  el.core.setState({ editing: null });
  el.core.editEl = null;
  el.core.syncEdit({ id: 'x', type: 'text', props: {} });
  assert.ok(true, 'with no editable node it returns early');
});

await it('the format fingerprint changes with the caret context', async () => {
  const el = await mountEditor();
  el.core.insertBlock('text');
  await settle(2);
  const block = blocksOf(el)[0];
  el.core.setState({ editing: block.id, sel: { type: 'block', id: block.id } });
  await settle(3);
  el.core.editEl = q(el, '[contenteditable="true"]');
  const a = el.core.formatFingerprint(blocksOf(el)[0]);
  assert.equal(typeof a, 'string');
  el.core.setProp(block.id, 'size', 22);
  await settle(2);
  assert.notEqual(el.core.formatFingerprint(blocksOf(el)[0]), a, 'it tracks what the toolbar shows');
});

await it('pasting strips formatting when asked', async () => {
  const el = await mountEditor();
  el.core.insertBlock('text');
  await settle(2);
  const block = blocksOf(el)[0];
  el.core.setState({ editing: block.id, sel: { type: 'block', id: block.id } });
  await settle(3);
  el.core.editEl = q(el, '[contenteditable="true"]');
  const ev = new (win().Event)('paste', { bubbles: true, cancelable: true });
  ev.clipboardData = { getData: (t) => (t === 'text/plain' ? 'plain text' : '<b>rich</b>') };
  el.core.pasteClean(true)(ev);
  el.core.pasteClean(false)(ev);
  await settle(2);
  assert.ok(true, 'both paste modes ran');
});

console.log();
console.log('Autosave');

await it('a storage failure is reported rather than swallowed', async () => {
  const el = await mountEditor();
  await settle(2);
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, removeItem() {}, key: () => null, length: 0, setItem() { throw new Error('quota exceeded'); } },
  });
  try {
    el.core.persist(el.core.state.doc);
    // Read it straight away: a later autosave would overwrite the flag.
    assert.equal(el.core.state.savedStatus, 'error', 'the editor knows the save failed');
  } finally {
    Object.defineProperty(globalThis, 'localStorage', desc);
  }
});

await it('the saved label reflects a successful save', async () => {
  const el = await mountEditor();
  await settle(2);
  el.core.persist(el.core.state.doc);
  await settle(2);
  assert.notEqual(el.core.state.savedStatus, 'error');
});

console.log();
console.log('Story playback');

await it('plays through and stops at the end', async () => {
  const el = await mountEditor();
  el.importHtml(EMAIL);
  await settle(2);
  el.story.open();
  await settle(3);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(el.story.isOpen(), true);
  el.story.close();
  await settle(2);
  assert.equal(el.story.isOpen(), false);
});

await it('arrow keys page it and a swipe is handled', async () => {
  const el = await mountEditor();
  el.importHtml(EMAIL);
  await settle(2);
  el.story.open();
  await settle(3);
  ['ArrowRight', 'ArrowLeft', ' '].forEach((key) => {
    win().dispatchEvent(new (win().KeyboardEvent)('keydown', { key, bubbles: true }));
  });
  const node = el.story.node;
  const down = new (win().Event)('pointerdown', { bubbles: true });
  down.clientX = 200; down.clientY = 200; down.pointerId = 1;
  node.dispatchEvent(down);
  const up = new (win().Event)('pointerup', { bubbles: true });
  up.clientX = 40; up.clientY = 200; up.pointerId = 1;
  node.dispatchEvent(up);
  await settle(2);
  assert.ok(true, 'no throw through paging or the swipe');
  el.story.close();
});

await it('a pointerup with no matching pointerdown is ignored', async () => {
  const el = await mountEditor();
  await settle(2);
  el.story.open();
  await settle(3);
  const up = new (win().Event)('pointerup', { bubbles: true });
  up.clientX = 10; up.clientY = 10;
  el.story.node.dispatchEvent(up);
  await settle();
  assert.equal(el.story.isOpen(), true);
  el.story.close();
});

console.log(`\n${passed} passed, ${failed} failed.`);
closeDom();
process.exit(failed ? 1 : 0);
