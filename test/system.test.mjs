/**
 * System tests: the core modules end-to-end, from raw input (HTML, sparse
 * JSON, host variables) through the document model and its state machine
 * (EditorCore) to the exported email.
 *
 * Run: npm test  (or: node test/system.test.mjs)
 *
 * No DOM and no dependencies -- same constraints as the other suites. What is
 * DOM-shaped is stubbed at the exact, narrow seams the code itself defines:
 * localStorage/sessionStorage (persist/mount), and the importer's DOMParser
 * (whose absence is a designed-in path: the never-drop-content fallback keeps
 * the source verbatim as one raw-html row).
 */
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  get length() { return store.size; },
  key: (i) => [...store.keys()][i],
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
globalThis.sessionStorage = {
  getItem: () => null, setItem: () => {}, removeItem: () => {},
};
// `unmount()` -> `unmountKeyboard()` removes window/document listeners; in a
// browser those always exist, in Node they don't. Minimal stand-ins -- nothing
// on the tested paths reads anything else off them.
globalThis.window = globalThis;
globalThis.window.addEventListener = () => {};
globalThis.window.removeEventListener = () => {};
globalThis.document = { addEventListener() {}, removeEventListener() {}, };

const { EditorCore, AI_GOALS, AI_TONES, AI_GOAL_VALUES } = await import(new URL('../src/core/editor-core.js', import.meta.url).href);
const { mk, mkRow, blk, blankDoc, normalizeDoc, migrateDoc, LAYOUTS, GROUPS } = await import(new URL('../src/core/blocks.js', import.meta.url).href);
const { boxCss, rowPad, rowMargin, rowBorderCss } = await import(new URL('../src/core/layout-style.js', import.meta.url).href);
const { cssUrl, escHtml, migrateTokens, scopeCss } = await import(new URL('../src/core/sanitize.js', import.meta.url).href);
const { vars, TOKEN, DEFAULT_VARS, INSERT_KEYS } = await import(new URL('../src/core/variables.js', import.meta.url).href);
const { THEME } = await import(new URL('../src/core/theme.js', import.meta.url).href);
const { normalizeAsset, resolveLimits, providerProblems, ALL_FOLDER_ID } = await import(new URL('../src/core/storage.js', import.meta.url).href);
const { PH } = await import(new URL('../src/core/placeholder.js', import.meta.url).href);
const { uid } = await import(new URL('../src/core/ids.js', import.meta.url).href);
const { buildHtml } = await import(new URL('../src/core/export.js', import.meta.url).href);
const { createTranslator, defineMessages, missingKeys, LOCALES, isRtl } = await import(new URL('../src/core/i18n/index.js', import.meta.url).href);
const { LOCALE_TABLES } = await import(new URL('../src/core/i18n/tables.js', import.meta.url).href);
const { EN, MESSAGE_KEYS } = await import(new URL('../src/core/i18n/en.js', import.meta.url).href);

let passed = 0;
let failed = 0;
async function it(name, fn) {
  try { await fn(); passed++; console.log('  ok    ' + name); }
  catch (e) { failed++; console.log('  FAIL  ' + name + '\n        ' + String(e.message).split('\n').join('\n        ')); }
}

/** EditorCore with the DOM-y callbacks stubbed to no-ops. */
const core = () => {
  const c = new EditorCore();
  c.flash = () => {};
  return c;
};

/** Every block of a document, flat. */
const allBlocks = (doc) => doc.rows.flatMap((r) => r.cols.flatMap((c) => c.blocks));

console.log('\nSystem (modules end-to-end, no DOM)');

// ---- document model -------------------------------------------------------

await it('a fresh editor opens on one empty row with the full default theme', async () => {
  const c = core();
  assert.equal(c.state.doc.rows.length, 1);
  assert.equal(c.state.doc.rows[0].cols.length, 1);
  assert.equal(c.state.doc.rows[0].cols[0].blocks.length, 0);
  const t = c.state.doc.theme;
  Object.keys(THEME()).forEach((k) => assert.ok(t[k], 'theme key seeded: ' + k));
});

await it('every block type the palette offers can be made and carries its defaults', async () => {
  const types = ['text', 'image', 'button', 'divider', 'spacer', 'social', 'video', 'html', 'countdown', 'menu', 'heading', 'list', 'table', 'embed', 'css', 'codeblock', 'box', 'svg'];
  for (const type of types) {
    const b = mk(type);
    assert.equal(b.type, type);
    assert.match(b.id, /^[a-z0-9]{7}$/, type + ' gets a uid id');
    assert.ok(Object.keys(b.props).length > 0, type + ' ships default props');
  }
});

await it('layouts are the expected span sets', async () => {
  assert.deepEqual(LAYOUTS.map((l) => l.spans), [[100], [50, 50], [33, 67], [67, 33], [33, 34, 33], [25, 25, 25, 25]]);
});

await it('compound groups build ordinary rows and blocks, nothing persists a groupId', async () => {
  for (const id of Object.keys(GROUPS)) {
    const rows = GROUPS[id].build();
    assert.ok(rows.length >= 1, id + ' builds at least one row');
    for (const r of rows) {
      assert.equal('groupId' in r, false, id + ' rows carry no groupId');
      assert.ok(r.cols.every((c) => Array.isArray(c.blocks)));
      assert.ok(allBlocks({ rows }).every((b) => b.id && b.type && b.props));
    }
  }
});

await it('normalizeDoc fills a sparse hand-written document into a renderable one', async () => {
  const doc = normalizeDoc({
    theme: { bg: '#101418' },
    rows: [
      { cols: [{ blocks: [{ type: 'text', props: { html: 'Hi' } }] }] },
      { cols: [{ span: 60 }, { span: 40, blocks: [{ type: 'button' }] }] },
      {}, // a row with no cols at all still becomes one column
    ],
  });
  assert.ok(doc, 'usable input returns a doc');
  assert.equal(doc.theme.bg, '#101418', 'declared theme keys survive');
  assert.equal(doc.theme.font, THEME().font, 'undeclared theme keys fall back to defaults');
  assert.equal(doc.rows.length, 3);
  doc.rows.forEach((r) => {
    assert.ok(r.id, 'row ids seeded');
    const defaults = mkRow([100]).props;
    Object.keys(defaults).forEach((k) => assert.notEqual(r.props[k], undefined, 'row prop seeded: ' + k));
    r.cols.forEach((c) => assert.ok(c.id));
  });
  // the bare row gained a column; the button kept only its own overrides on top of defaults
  assert.equal(doc.rows[2].cols.length, 1);
  assert.equal(doc.rows[1].cols[1].blocks[0].props.bg, mk('button').props.bg);
});

await it('normalizeDoc rejects nothing-usable as null so callers no-op', async () => {
  assert.equal(normalizeDoc(null), null);
  assert.equal(normalizeDoc('string'), null);
  assert.equal(normalizeDoc([]), null);
  assert.equal(normalizeDoc({ rows: [] }), null);
  // A row whose cols array went away entirely is *repaired* to one empty
  // column, not dropped -- the never-reject contract.
  assert.equal(normalizeDoc({ rows: [{ cols: [] }] }).rows.length, 1);
  assert.equal(normalizeDoc({ rows: [{ cols: [] }] }).rows[0].cols.length, 1);
});

await it('migrateDoc converts legacy compound blocks and drops emptied rows, keeping purpose-empty ones', async () => {
  const legacyRow = mkRow([100], [blk('html')]);
  legacyRow.cols[0].blocks = [
    { id: 'a', type: 'hero', props: { title: 'Old hero', cta: 'Go' } },
    { id: 'b', type: 'text', props: { html: 'plain' } },
    { id: 'c', type: 'nosuchtype', props: {} },
  ];
  const emptyOnPurpose = mkRow([100]);
  const doc = migrateDoc({ theme: THEME(), rows: [legacyRow, emptyOnPurpose] });
  const types = doc.rows[0].cols[0].blocks.map((b) => b.type);
  assert.equal(types.includes('hero'), false, 'legacy hero converted away');
  assert.equal(types.includes('nosuchtype'), false, 'unknown type dropped');
  assert.equal(types.includes('text'), true, 'ordinary blocks kept');
  // Row 0 still holds blocks (the converted hero produced some), so only the
  // semantics are exercised: emptied rows go, purpose-empty ones stay.
  assert.equal(doc.rows.length, 2, 'both rows survive when row 0 kept content');
  const allEmpty = doc.rows.every((r) => r.cols.every((c) => c.blocks.length === 0));
  assert.equal(allEmpty, false);
});

await it('migrateDoc seeds the four-side outside-spacing model from the legacy vertical my', async () => {
  const row = mkRow([100]);
  row.props.my = 14;
  delete row.props.mt; delete row.props.mr; delete row.props.mb; delete row.props.ml;
  const doc = migrateDoc({ theme: THEME(), rows: [row] });
  const p = doc.rows[0].props;
  assert.equal(p.mt, 14); assert.equal(p.mb, 14);
  assert.equal(p.mr, 0); assert.equal(p.ml, 0);
});

// ---- EditorCore state machine ----------------------------------------------

await it('edits are undoable and redoable, and undo restores byte-identical documents', async () => {
  const c = core();
  const before = JSON.stringify(c.state.doc);
  c.insertBlock('text', c.state.doc.rows[0].id, 0);
  assert.equal(allBlocks(c.state.doc).length, 1);
  c.undo();
  assert.equal(JSON.stringify(c.state.doc), before);
  c.redo();
  assert.equal(allBlocks(c.state.doc).length, 1);
  c.undo();
  assert.equal(JSON.stringify(c.state.doc), before);
});

await it('setProp, delSel and dupSel address rows and blocks by id wherever they sit', async () => {
  const c = core();
  c.insertRow([50, 50]); // appended after the blank row
  const twoColId = c.state.doc.rows[1].id;
  c.insertBlock('heading', twoColId, 1);
  c.insertBlock('text', twoColId, 0);
  // `commit` replaces state.doc with a clone, so re-read by id every time.
  const twoCol = () => c.find(c.state.doc, twoColId).row;
  const h = () => twoCol().cols[1].blocks[0];
  c.setProp(h().id, 'text', 'Edited');
  assert.equal(twoCol().cols[1].blocks[0].props.text, 'Edited');
  c.select('block', h().id);
  c.dupSel();
  assert.equal(twoCol().cols[1].blocks.length, 2, 'duplicate lands next to the original');
  c.delSel();
  assert.equal(twoCol().cols[1].blocks.length, 1);
  c.select('row', twoColId);
  c.dupSel();
  assert.equal(c.state.doc.rows.length, 3, 'row duplicate lands under the original');
  c.delSel();
  assert.equal(c.state.doc.rows.length, 2);
});

await it('moveBlock / moveRow / nudge keep the tree consistent across columns and rows', async () => {
  const c = core();
  c.insertRow([50, 50]);
  const row = c.state.doc.rows[1];
  c.insertBlock('text', row.id, 0);
  const bId = c.find(c.state.doc, row.id).row.cols[0].blocks[0].id;
  c.moveBlock(bId, row.id, 1, 0);
  assert.equal(c.state.doc.rows[1].cols[0].blocks.length, 0, 'moved out of column 0');
  assert.equal(c.state.doc.rows[1].cols[1].blocks.length, 1, 'moved into column 1');
  c.moveBlockToNewRow(bId, 2);
  assert.equal(c.state.doc.rows.length, 3, 'block got its own new row');
  assert.ok(c.state.doc.rows[2].cols.some((col) => col.blocks.some((x) => x.id === bId)));
  const newRowId = c.state.doc.rows[2].id;
  c.moveRow(newRowId, 0);
  assert.equal(c.find(c.state.doc, bId).row.id, c.state.doc.rows[0].id, 'row moved to the top');
  c.nudge(bId, -1);
  assert.equal(c.find(c.state.doc, bId).bi, 0, 'nudge clamps at the top');
});

await it('changing the column count keeps content and per-column styling, orphans merge right', async () => {
  const c = core();
  c.insertRow([50, 50]);
  const row = c.state.doc.rows[1];
  c.setColProp(row.id, 0, 'bg', '#ffeeee');
  c.insertBlock('text', row.id, 0);
  c.insertBlock('text', row.id, 1);
  c.select('row', row.id);
  const field = c.fields().find((f) => f.label === 'Columns');
  assert.ok(field, 'Columns control is offered for a selected section');
  field.onChange('0'); // LAYOUTS[0] === [100]
  const after = c.state.doc.rows[1];
  assert.equal(after.cols.length, 1);
  assert.equal(after.cols[0].bg, '#ffeeee', 'surviving column keeps its styling');
  assert.equal(after.cols[0].blocks.length, 2, 'both columns\' blocks land in the one column');
});

await it('history is bounded at 41 entries', async () => {
  const c = core();
  for (let i = 0; i < 50; i++) c.insertBlock('spacer', c.state.doc.rows[0].id, 0);
  assert.ok(c.state.history.length <= 41, 'history does not grow without bound (kept ' + c.state.history.length + ')');
});

await it('commit persists to storage debounced, and a fresh mount restores it', async () => {
  const c = core();
  c.mount(null);
  c.insertBlock('text', c.state.doc.rows[0].id, 0);
  await new Promise((r) => setTimeout(r, 450)); // past the 400ms debounce
  const saved = JSON.parse(store.get('mailcraft.v3'));
  assert.equal(saved.doc.rows[0].cols[0].blocks.length, 1, 'doc round-tripped through storage');
  assert.ok(saved.t, 'sweepDrafts has a timestamp to age by');
  const c2 = core();
  c2.mount(null);
  assert.equal(c2.state.doc.rows[0].cols[0].blocks.length, 1, 'a second editor restores the draft');
  c.unmount(); c2.unmount();
});

await it('sweepDrafts reclaims other tabs\' stale slots but never its own or the seed', async () => {
  store.clear();
  store.set('mailcraft.v3.tab.other', JSON.stringify({ doc: blankDoc(), t: Date.now() - 8 * 86400000 }));
  store.set('mailcraft.v3.tab.fresh', JSON.stringify({ doc: blankDoc(), t: Date.now() }));
  store.set('mailcraft.v3.tab.junk', '{not json');
  const c = core();
  c.mount(null);
  c.persist(c.state.doc);
  c.sweepDrafts();
  assert.equal(store.has('mailcraft.v3.tab.other'), false, 'past TTL: gone');
  assert.equal(store.has('mailcraft.v3.tab.junk'), false, 'unreadable counts as stale');
  assert.equal(store.has('mailcraft.v3.tab.fresh'), true, 'recent foreign slot survives');
  assert.equal(store.has('mailcraft.v3'), true, 'the shared seed survives');
  c.unmount();
});

await it('togglePadSplit copies the linked pair to four sides and folds them back without a jump', async () => {
  const c = core();
  c.insertRow([100]);
  const id = c.state.doc.rows[0].id;
  c.setProp(id, 'py', 30);
  c.setProp(id, 'px', 40);
  c.togglePadSplit(id);
  let p = c.state.doc.rows[0].props;
  assert.equal(p.padSplit, true);
  assert.deepEqual([p.pt, p.pr, p.pb, p.pl], [30, 40, 30, 40], 'split copies the pair');
  c.setProp(id, 'pt', 50);
  c.togglePadSplit(id);
  p = c.state.doc.rows[0].props;
  assert.equal(p.padSplit, false);
  assert.equal(p.py, 40, 'relink folds to the average (50+30)/2');
  assert.equal(p.pt, undefined, 'overrides removed on relink');
});

// ---- templates & import ------------------------------------------------------

await it('loadTemplate(doc) deep-copies: editing the loaded doc never mutates the host object', async () => {
  const c = core();
  const source = { name: 'T', doc: blankDoc() };
  c.loadTemplate(source);
  c.state.doc.rows[0].cols[0].blocks.push(blk('text'));
  c.loadTemplate(source);
  assert.equal(c.state.doc.rows[0].cols[0].blocks.length, 0, 'second load is a clean copy');
  assert.equal(source.doc.rows[0].cols[0].blocks.length, 0, 'host object untouched');
});

await it('loadTemplate(html) degrades identically to importHtml without a DOM: source survives verbatim', async () => {
  const c = core();
  const src = '<table><tr><td><h1>Hello</h1><p>Body</p></td></tr></table>';
  c.loadTemplate({ name: 'From HTML', html: src });
  const b = c.state.doc.rows[0].cols[0].blocks[0];
  assert.equal(b.type, 'html', 'no DOMParser -> never-drop fallback row');
  assert.equal(b.props.code.includes('<h1>Hello</h1>'), true, 'content is kept, not dropped');
  const n = c.importHtml(src);
  assert.equal(n, 1, 'importHtml reports the fallback row count');
  assert.equal(c.state.doc.rows[0].cols[0].blocks[0].props.code, c.state.doc.rows[0].cols[0].blocks[0].props.code);
});

await it('loadDoc normalizes sparse host JSON instead of failing later at render time', async () => {
  const c = core();
  c.loadDoc({ rows: [{ cols: [{ blocks: [{ type: 'button', props: { label: 'Go' } }] }] }] });
  const b = c.state.doc.rows[0].cols[0].blocks[0];
  assert.equal(b.props.href, mk('button').props.href, 'missing props seeded from defaults');
  assert.equal(c.docSetByHost, true, 'host push recorded so mount will not clobber it');
  assert.equal(c.loadDoc({ rows: [] }), undefined, 'unusable input is a no-op');
});

await it('a loaded template is one undo step back to the previous document', async () => {
  const c = core();
  c.insertBlock('text', c.state.doc.rows[0].id, 0);
  c.loadTemplate({ name: 'T', doc: blankDoc() });
  assert.equal(allBlocks(c.state.doc).length, 0);
  c.undo();
  assert.equal(allBlocks(c.state.doc).length, 1);
});

// ---- export -------------------------------------------------------------------

const stubRoot = (byId) => ({
  querySelector: (sel) => {
    const m = sel.match(/data-mc-content="([^"]+)"/);
    const html = m && byId[m[1]];
    return html ? { outerHTML: html } : null;
  },
});

await it('a document built from groups exports complete, well-formed email HTML', async () => {
  const doc = normalizeDoc({
    theme: THEME(),
    rows: [...GROUPS.hero.build(), ...GROUPS.stats.build(), ...GROUPS.footer.build()],
  });
  const content = {};
  allBlocks(doc).forEach((b) => { content[b.id] = '<div data-mc-content="' + b.id + '">block ' + b.type + '</div>'; });
  const html = buildHtml({ doc }, stubRoot(content), boxCss);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<title>Email<\/title>/);
  assert.match(html, /<\/html>$/);
  allBlocks(doc).forEach((b) => assert.ok(html.includes('block ' + b.type), 'block ' + b.type + ' exported'));
  assert.equal(/data-mc-/.test(html), false, 'editing attributes stripped');
});

await it('the full edit -> persist -> restore -> export path round-trips content', async () => {
  store.clear();
  const c = core();
  c.mount(null);
  c.insertBlock('heading', c.state.doc.rows[0].id, 0);
  const id = c.state.doc.rows[0].cols[0].blocks[0].id;
  c.setProp(id, 'text', 'Round trip');
  await new Promise((r) => setTimeout(r, 450));
  const c2 = core();
  c2.mount(null);
  const b = c2.state.doc.rows[0].cols[0].blocks[0];
  assert.equal(b.props.text, 'Round trip');
  const html = buildHtml({ doc: c2.state.doc }, stubRoot({ [b.id]: '<div data-mc-content="' + b.id + '"><h2>Round trip</h2></div>' }), boxCss);
  assert.match(html, /Round trip/);
  c.unmount(); c2.unmount();
});

await it('row backgrounds, overlays and per-column cards survive export', async () => {
  const doc = normalizeDoc({ theme: THEME(), rows: [{ cols: [{ blocks: [] }, { blocks: [] }] }] });
  const row = doc.rows[0];
  // Column styling is applied post-normalization the way the inspector does
  // (setColProp) -- normalizeDoc deliberately keeps only id/span/blocks.
  Object.assign(row.cols[1], { bg: '#f7f7f7', radius: 8, padY: 10, padX: 12 });
  row.props.bgImage = 'https://example.com/hero.jpg';
  row.props.overlay = 40;
  row.props.radius = 6;
  const html = buildHtml({ doc }, stubRoot({}), boxCss);
  assert.match(html, /linear-gradient\(rgba\(20,22,24,0\.4\)/, 'overlay emitted');
  assert.match(html, /url\(&quot;https:\/\/example\.com\/hero\.jpg&quot;\)/, 'encoded background url');
  assert.match(html, /background:#f7f7f7/, 'column card background emitted');
  assert.match(html, /border-radius:8px/, 'column radius emitted');
  assert.match(html, /padding:10px 12px/, 'column padding emitted');
});

// ---- sanitize / variables / i18n / contracts --------------------------------

await it('cssUrl percent-encodes for both CSS and attribute contexts and allowlists schemes', async () => {
  assert.equal(cssUrl('https://a.com/x.png'), 'https://a.com/x.png');
  assert.equal(cssUrl('https://a.com/x y.png'), 'https://a.com/x%20y.png');
  assert.equal(cssUrl('https://a.com/x"y.png'), 'https://a.com/x%22y.png');
  assert.equal(cssUrl('images/x.png'), 'images/x.png', 'relative paths are fine');
  assert.equal(cssUrl('javascript:alert(1)'), '', 'script scheme dropped');
  assert.equal(cssUrl(''), '');
});

await it('escHtml escapes the three characters that break markup', async () => {
  assert.equal(escHtml('<a & b>'), '&lt;a &amp; b&gt;');
});

await it('scopeCss scopes selectors to the root, leaves at-rule heads alone', async () => {
  const out = scopeCss('h1{color:red} .x,.y b{color:blue} @media (max-width:600px){ p{margin:0} } body{margin:0}', '.mc');
  assert.match(out, /\.mc h1\{color:red\}/);
  assert.match(out, /\.mc \.x, \.mc \.y b\{color:blue\}/);
  assert.match(out, /@media \(max-width:600px\)\{\s*\.mc p\{margin:0\}\s*\}/);
  assert.match(out, /\.mc\{margin:0\}/, 'html/body/:root collapse onto the root');
});

await it('migrateTokens moves old [[token]] drafts to the {{ token }} spelling', async () => {
  assert.equal(migrateTokens('[[first_name]] and [[ order_id ]]'), '{{ first_name }} and {{ order_id }}');
  assert.equal(migrateTokens('{{ already }} new'), '{{ already }} new');
});

await it('vars parses host input in every accepted shape and strips stray braces', async () => {
  assert.deepEqual(vars(null), DEFAULT_VARS.split('\n'), 'null host input means the default set');
  assert.deepEqual(vars(['a', 'b']), ['a', 'b']);
  assert.deepEqual(vars('a,b\n c ,{{ d }}'), ['a', 'b', 'c', 'd']);
  assert.equal(TOKEN('email'), '{{ email }}');
  assert.equal(INSERT_KEYS.text, 'html', 'merge tags know which prop they land in');
});

await it('the translator resolves English, overrides, params, and names missing keys', async () => {
  const t = createTranslator({ 'tab.blocks': 'Bausteine' });
  assert.equal(t('tab.blocks'), 'Bausteine', 'override wins');
  assert.equal(t('tab.design'), 'Design', 'English fallback');
  assert.equal(t('toast.templateLoaded', { name: 'Welcome' }), 'Welcome loaded', 'params interpolate');
  assert.equal(t('nope.missing'), 'nope.missing', 'a truly missing key renders as itself');
  const merged = defineMessages(EN, { 'tab.blocks': 'Blokken' });
  assert.equal(merged['tab.design'], EN['tab.design']);
  assert.ok(missingKeys({ 'tab.blocks': 'x' }, EN).includes('tab.design'));
});

await it('every shipped locale table resolves the tab bar without gaps, and metadata matches the tables', async () => {
  const tags = LOCALES.map((l) => l.tag);
  assert.deepEqual(tags.slice().sort(), Object.keys(LOCALE_TABLES).sort(), 'LOCALES and LOCALE_TABLES cover the same tags');
  for (const tag of tags) {
    const t = createTranslator(LOCALE_TABLES[tag]);
    ['tab.design', 'tab.blocks', 'tab.rows', 'tab.settings', 'tab.data'].forEach((k) => {
      assert.equal(t(k) === k, false, tag + ' translates ' + k);
    });
  }
  assert.equal(isRtl('ar'), true);
  assert.equal(isRtl('en'), false);
  assert.deepEqual(MESSAGE_KEYS, Object.keys(EN).sort());
});

await it('the storage contract normalizes provider assets and resolves limits per key', async () => {
  assert.deepEqual(normalizeAsset({ id: 7, url: 'https://x/1.png' }), { id: '7', name: 'file', url: 'https://x/1.png', folder: '', folderId: undefined, w: 0, ht: 0, size: 0 });
  assert.deepEqual(normalizeAsset(null, { name: 'f.png', w: 10, ht: 20, size: 30 }), { id: '', name: 'f.png', url: '', folder: '', folderId: undefined, w: 10, ht: 20, size: 30 });
  assert.deepEqual(resolveLimits({ maxBytes: 5 }, { maxBytes: 9, accept: ['image/png'] }), { maxBytes: 5, accept: ['image/png'] }, 'host wins per key');
  assert.deepEqual(providerProblems({}), ['storageProvider is missing list and upload']);
  assert.deepEqual(providerProblems({ list() {}, upload() {} }), []);
  assert.equal(ALL_FOLDER_ID, '', 'the "all" folder id reads as no filter to a provider');
});

await it('placeholder images are self-contained data URIs and uids are unique', async () => {
  const url = PH('test label', 300, 150);
  assert.match(url, /^data:image\/svg\+xml;utf8,/);
  assert.match(decodeURIComponent(url), /test%20label|test label/);
  const seen = new Set(Array.from({ length: 500 }, uid));
  assert.equal(seen.size, 500, 'uids do not collide');
});

await it('layout-style shorthands match the exported CSS the renderer and exporter agree on', async () => {
  assert.equal(rowPad({ py: 10, px: 20 }), '10px 20px 10px 20px');
  assert.equal(rowPad({ py: 10, px: 20, pt: 30, pl: 5 }), '30px 20px 10px 5px', 'per-side overrides win where present');
  assert.equal(rowMargin({ mt: 1, mr: 2, mb: 3, ml: 4 }), '1px 2px 3px 4px');
  assert.equal(rowMargin({ mt: 1 }, true), '1px auto 0px auto', 'empty horizontal margins center');
  assert.equal(rowBorderCss({}), '', 'zero-width border emits nothing');
  assert.equal(rowBorderCss({ border: 2, borderStyle: 'dashed', lineColor: '#111' }), 'border:2px dashed #111;');
  assert.equal(rowBorderCss({ border: 2, bTop: false, bLeft: false }), 'border-right:2px solid #e2e2e5;border-bottom:2px solid #e2e2e5;', 'per-side borders emit per-side rules');
  assert.equal(boxCss({ bBg: '#eee', bPad: 4 }), 'background:#eee;padding:4px;');
  assert.equal(boxCss({}), 'margin:0', 'an unstyled box still neutralises margins');
});

await it('the example templates on disk import (DOM-less fallback) without losing content', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const dir = new URL('../examples/templates/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.html'));
  assert.ok(files.length >= 10, 'the gallery still holds its templates (' + files.length + ' files)');
  const c = core();
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    c.loadTemplate({ name: f, html: src });
    const blocks = allBlocks(c.state.doc);
    assert.ok(blocks.length >= 1, f + ' produced blocks');
    assert.ok(blocks.some((b) => b.type === 'html' && b.props.code.length > 50), f + ' kept its content through the fallback');
  }
});

await it('the AI goal and tone lists are prompt-safe and the defaults are selectable', () => {
  // These strings are spliced into the provider prompt verbatim, so a stray
  // quote or brace would corrupt the instruction -- or the JSON contract the
  // reply is parsed against -- rather than just look odd in the dropdown.
  const quote = String.fromCharCode(34);
  const open = String.fromCharCode(123), close = String.fromCharCode(125);
  const all = [...AI_GOAL_VALUES, ...AI_TONES];
  assert.ok(AI_GOAL_VALUES.length >= 12, 'the goal list covers the shipped template jobs');
  assert.equal(new Set(all).size, all.length, 'no duplicate goal or tone');
  for (const v of all) {
    assert.equal(v, v.trim(), JSON.stringify(v) + ' has stray whitespace');
    assert.equal(JSON.stringify(v), quote + v + quote, JSON.stringify(v) + ' needs JSON escaping, so it would corrupt the prompt');
    assert.ok(!v.includes(open) && !v.includes(close), JSON.stringify(v) + ' carries a brace, which the reply parser scans for');
  }
  for (const g of AI_GOALS) assert.ok(g.group && g.items.length, 'every optgroup is labelled and non-empty');

  // The <select> only ever holds these values, so a default outside them would
  // render as a blank field when the modal opens.
  const c = core();
  assert.ok(AI_GOAL_VALUES.includes(c.state.aiGoal), 'default goal is in the list');
  assert.ok(AI_TONES.includes(c.state.aiTone), 'default tone is in the list');
});

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed) process.exit(1);
