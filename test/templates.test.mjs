/**
 * Template tests: templates are host content pushed through `loadTemplate` --
 * the editor has no gallery UI, no Templates tab, and ships no catalogue.
 *
 * Run: npm test
 *
 * No DOM and no dependencies -- EditorCore applies a template; whatever picker
 * the host renders lives outside the package (see examples/vanilla.html).
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const store = new Map();
globalThis.localStorage = {
  get length() { return store.size; },
  key: (i) => [...store.keys()][i],
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };

const { EditorCore } = await import(new URL('../src/core/editor-core.js', import.meta.url).href);
const { blankDoc, mkRow, mk } = await import(new URL('../src/core/blocks.js', import.meta.url).href);

let passed = 0;
let failed = 0;
async function it(name, fn) {
  try { await fn(); passed++; console.log('  ok    ' + name); }
  catch (e) { failed++; console.log('  FAIL  ' + name + '\n        ' + String(e.message).split('\n').join('\n        ')); }
}

const sampleDoc = () => {
  const row = mkRow([100], [mk('heading')]);
  return { theme: blankDoc().theme, rows: [row] };
};

console.log('\nTemplates (host-pushed, no editor gallery)');

await it('a fresh editor starts blank, not on a built-in template', async () => {
  const core = new EditorCore();
  assert.equal(core.state.doc.rows.length, 1);
  assert.deepEqual(core.state.doc.rows[0].cols[0].blocks, [], 'no sample content');
});

await it('the package ships no template catalogue and no gallery API', async () => {
  // Templates are content, not editor behaviour. The example gallery lives in
  // examples/templates/ as plain .html files, in host-app territory.
  // Read rather than import: the package entry defines a custom element and
  // needs a DOM, which this suite deliberately does not have.
  const entry = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.equal(/TEMPLATES/.test(entry), false, 'nothing named TEMPLATES is exported');
  assert.equal(existsSync(new URL('../src/core/templates.js', import.meta.url)), false,
    'no catalogue module remains under src/');
  const core = new EditorCore();
  assert.equal('templates' in core, false, 'the core holds no template list');
  assert.equal(typeof core.setTemplates, 'undefined', 'and exposes no gallery setter');
});

await it('the editor renders no Templates tab', async () => {
  const el = readFileSync(new URL('../src/mailcraft-editor.js', import.meta.url), 'utf8');
  assert.equal(/renderTemplatesTab/.test(el), false, 'no gallery panel');
  assert.equal(/key: 'templates'/.test(el), false, 'no gallery tab');
});

await it('loadTemplate replaces the document and is undoable', async () => {
  const core = new EditorCore();
  core.flash = () => {};
  const before = JSON.stringify(core.state.doc);
  core.loadTemplate({ name: 'Welcome', doc: sampleDoc() });
  assert.equal(core.state.doc.rows[0].cols[0].blocks.length, 1);
  assert.equal(core.state.history.length, 1, 'the previous document went onto the undo stack');
  core.undo();
  assert.equal(JSON.stringify(core.state.doc), before, 'undo restores what was there');
});

await it('loading twice does not share state with the host object', async () => {
  const source = { name: 'Welcome', doc: sampleDoc() };
  const core = new EditorCore();
  core.flash = () => {};
  core.loadTemplate(source);
  core.state.doc.rows[0].cols[0].blocks[0].props.text = 'edited in the editor';
  core.loadTemplate(source);
  assert.notEqual(core.state.doc.rows[0].cols[0].blocks[0].props.text, 'edited in the editor',
    'the second load must come from a clean copy');
  assert.equal(source.doc.rows[0].cols[0].blocks[0].props.text !== 'edited in the editor', true,
    "and the host's own object must not have been mutated");
});

await it('build() runs when the template is used, not before', async () => {
  let builds = 0;
  const core = new EditorCore();
  core.flash = () => {};
  const tpl = { name: 'Built', build: () => { builds++; return sampleDoc(); } };
  assert.equal(builds, 0);
  core.loadTemplate(tpl);
  assert.equal(builds, 1);
  assert.equal(core.state.doc.rows[0].cols[0].blocks.length, 1);
});

await it('a template can be raw email HTML, converted when it is used', async () => {
  // This suite has no DOM, so the importer's structural pass cannot run and
  // the never-drop-content fallback takes over: the source survives verbatim
  // as one raw-html row. In a browser the same string becomes native blocks.
  const src = '<table><tr><td><h1>Hello</h1></td></tr></table>';
  const core = new EditorCore();
  core.flash = () => {};
  core.loadTemplate({ name: 'From HTML', html: src });
  const block = core.state.doc.rows[0].cols[0].blocks[0];
  assert.equal(block.type, 'html');
  assert.equal(block.props.code.includes('<h1>Hello</h1>'), true, 'the source content is kept');
});

await it('a template is persisted like any other edit', async () => {
  const core = new EditorCore();
  core.flash = () => {};
  core.loadTemplate({ name: 'Welcome', doc: sampleDoc() });
  const saved = JSON.parse(store.get('mailcraft.v3'));
  assert.equal(saved.doc.rows[0].cols[0].blocks.length, 1);
});

await it('loading nothing, something malformed, or blank html is a no-op', async () => {
  const core = new EditorCore();
  core.flash = () => {};
  const before = JSON.stringify(core.state.doc);
  core.loadTemplate(null);
  core.loadTemplate({ name: 'no source' });
  core.loadTemplate({ name: 'blank html', html: '   ' });
  assert.equal(JSON.stringify(core.state.doc), before);
});

await it('the example gallery is plain HTML files, not a script', async () => {
  assert.equal(existsSync(new URL('../examples/templates.js', import.meta.url)), false,
    'the old JS catalogue is gone');
  assert.equal(existsSync(new URL('../examples/templates/the-sunday-brief.html', import.meta.url)), true,
    'templates live as .html under examples/templates/');
});

console.log();
console.log('Document input (JSON is normalized, never half-applied)');

// A document a backend or a human would plausibly write: no ids, no theme, no
// row props, only the block props that were actually meant. It used to reach
// the renderer intact and fail later at export time on `theme.font`.
const sparseDoc = () => JSON.parse(JSON.stringify({
  rows: [{ cols: [{ blocks: [
    { type: 'heading', props: { text: 'Hello from JSON' } },
    { type: 'text', props: { html: 'Sent as a plain object.' } },
  ] }] }],
}));

await it('setContent fills in a sparse document instead of half-applying it', async () => {
  const core = new EditorCore();
  core.flash = () => {};
  core.loadDoc(sparseDoc());
  const doc = core.state.doc;
  const row = doc.rows[0];
  const heading = row.cols[0].blocks[0];
  assert.equal(Object.keys(doc.theme).length, 6, 'the full theme is seeded');
  assert.equal(row.props.py, 20, 'row props come from the row defaults');
  assert.equal(row.cols[0].span, 100, 'a column with no span gets one');
  assert.ok(row.id && row.cols[0].id && heading.id, 'ids are generated');
  assert.equal(heading.props.text, 'Hello from JSON', 'the caller value wins');
  assert.equal(heading.props.level, 'h2', 'unstated block props come from the type default');
});

await it('loadTemplate normalizes the same way setContent does', async () => {
  const a = new EditorCore(); a.flash = () => {};
  const b = new EditorCore(); b.flash = () => {};
  a.loadDoc(sparseDoc());
  b.loadTemplate({ name: 'sparse', doc: sparseDoc() });
  const strip = (d) => JSON.stringify(d, (k, v) => (k === 'id' ? 0 : v));
  assert.equal(strip(a.state.doc), strip(b.state.doc), 'both entry points produce the same document');
});

await it('columns with no span are split evenly', async () => {
  const core = new EditorCore(); core.flash = () => {};
  core.loadDoc({ rows: [{ cols: [{ blocks: [] }, { blocks: [] }, { blocks: [] }] }] });
  assert.deepEqual(core.state.doc.rows[0].cols.map((c) => c.span), [33, 33, 33]);
});

await it('a block type this build does not know is dropped, the rest survive', async () => {
  const core = new EditorCore(); core.flash = () => {};
  core.loadDoc({ rows: [{ cols: [{ blocks: [
    { type: 'heading', props: { text: 'Kept' } },
    { type: 'not-a-real-block', props: {} },
  ] }] }] });
  const blocks = core.state.doc.rows[0].cols[0].blocks;
  assert.deepEqual(blocks.map((b) => b.type), ['heading']);
  assert.equal(blocks[0].props.text, 'Kept');
});

await it('input with nothing usable in it leaves the document alone', async () => {
  const core = new EditorCore();
  core.flash = () => {};
  const before = JSON.stringify(core.state.doc);
  [null, undefined, [1, 2, 3], '{"rows":[]}', 42, {}, { rows: [] }, { rows: 'nope' }].forEach((bad) => core.loadDoc(bad));
  core.loadTemplate({ name: 'junk', doc: { nope: true } });
  assert.equal(JSON.stringify(core.state.doc), before, 'nothing was replaced or cleared');
});

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed) process.exit(1);
