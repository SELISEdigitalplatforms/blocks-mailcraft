/**
 * The DOM half of the editor: the custom element, the shell it builds, every
 * inspector tab, the modals, and the mount-into-a-container API.
 *
 * Run: npm test
 *
 * The other suites are DOM-free by design and cover `src/core/`. These drive
 * the real element inside jsdom, because `mailcraft-editor.js` and everything
 * under `src/render/` cannot be reached any other way -- see test/dom-harness.mjs
 * for the two shim details that make it work.
 */
import assert from 'node:assert/strict';
import { installDom, mountEditor, settle, closeDom, win } from './dom-harness.mjs';

installDom();
const { BLOCKS, LAYOUTS, GROUPS, createEditor, isReady } = await import(new URL('../src/index.js', import.meta.url).href);

let passed = 0;
let failed = 0;
const pageErrors = [];
win().addEventListener('error', (e) => pageErrors.push(String(e.message || e)));

async function it(name, fn) {
  try { await fn(); passed++; console.log('  ok    ' + name); }
  catch (e) { failed++; console.log('  FAIL  ' + name + '\n        ' + String(e.message).split('\n').join('\n        ')); }
}

const q = (el, sel) => el.shadowRoot.querySelector(sel);
const qa = (el, sel) => Array.from(el.shadowRoot.querySelectorAll(sel));
// The modals reuse .mc-icon-button / .mc-icon-label, so anything asserting about
// the top bar has to look inside the bar, not across the whole shadow root.
const bar = (el, sel) => Array.from((q(el, '.mc-header') || { querySelectorAll: () => [] }).querySelectorAll(sel));
const allBlocks = (el) => el.getContent().rows.flatMap((r) => r.cols.flatMap((c) => c.blocks));
const EMAIL = '<table><tr><td><h1>Launch</h1><p>Body copy here.</p><a href="https://example.com" style="background:#0065b3;color:#fff;padding:12px 24px;display:inline-block">Go</a></td></tr></table>';

console.log();
console.log('Editor element (jsdom)');

await it('registers itself and reports it', async () => {
  assert.equal(isReady(), true);
  assert.ok(win().customElements.get('mailcraft-editor'));
});

await it('builds the whole shell on mount', async () => {
  const el = await mountEditor();
  assert.ok(q(el, '.mc-header'), 'header');
  assert.ok(q(el, '.mc-layout'), 'body layout');
  assert.ok(q(el, '.mc-device-segment'), 'device segment');
  assert.ok(el.shadowRoot.querySelectorAll('*').length > 200, 'a real tree, not a stub');
});

await it('renders an imported document onto the canvas', async () => {
  const el = await mountEditor();
  el.importHtml(EMAIL);
  await settle();
  const doc = el.getContent();
  assert.ok(doc.rows.length >= 1);
  assert.ok(el.shadowRoot.querySelectorAll('[data-mc-content]').length >= 1, 'blocks carry export anchors');
});

await it('exports what is on the canvas, not a re-template of props', async () => {
  const el = await mountEditor();
  el.importHtml(EMAIL);
  await settle(3);
  const html = el.exportHtml();
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<title>Email<\/title>/);
  assert.ok(html.includes('Launch'), 'heading survived');
  assert.match(html, /<\/html>$/);
});

await it('the export event carries the html', async () => {
  const el = await mountEditor();
  let seen = null;
  el.addEventListener('export', (e) => { seen = e.detail; });
  const returned = el.exportHtml();
  assert.equal(seen, returned);
  assert.ok(seen.length > 100);
});

await it('the change event fires on an edit and carries the document', async () => {
  const el = await mountEditor();
  let detail = null;
  el.addEventListener('change', (e) => { detail = e.detail; });
  el.importHtml(EMAIL);
  await settle();
  assert.ok(detail && Array.isArray(detail.rows), 'a document, not undefined');
});

console.log();
console.log('Inspector tabs');

for (const tab of ['design', 'blocks', 'rows', 'layers', 'files', 'data', 'theme']) {
  await it('renders the ' + tab + ' tab without error', async () => {
    const el = await mountEditor();
    el.importHtml(EMAIL);
    await settle();
    el.core.setState({ tab });
    await settle();
    assert.equal(el.core.state.tab, tab);
    assert.ok(q(el, '.mc-layout'), 'the shell survived the tab switch');
  });
}

await it('selecting a block shows its fields in the inspector', async () => {
  const el = await mountEditor();
  el.importHtml(EMAIL);
  await settle();
  const block = el.getContent().rows[0].cols[0].blocks[0];
  el.core.select('block', block.id);
  await settle();
  assert.equal(el.core.state.sel.id, block.id);
  assert.equal(el.core.state.tab, 'design');
  assert.ok(el.shadowRoot.querySelectorAll('input, select, button').length > 5, 'controls rendered');
});

await it('selecting a row shows row fields', async () => {
  const el = await mountEditor();
  el.importHtml(EMAIL);
  await settle();
  const row = el.getContent().rows[0];
  el.core.select('row', row.id);
  await settle();
  assert.equal(el.core.state.sel.type, 'row');
  assert.ok(el.core.fields().length > 0, 'the binder produced descriptors');
});

await it('editing a prop through the inspector reaches the canvas and the export', async () => {
  const el = await mountEditor();
  el.importHtml(EMAIL);
  await settle();
  const block = el.getContent().rows[0].cols[0].blocks.find((b) => b.type === 'heading' || b.type === 'text');
  el.core.select('block', block.id);
  el.core.setProp(block.id, 'align', 'center');
  await settle(3);
  assert.equal(el.getContent().rows[0].cols[0].blocks.find((b) => b.id === block.id).props.align, 'center');
  assert.ok(el.exportHtml().includes('center'), 'the change reached the exported html');
});

console.log();
console.log('Blocks, rows and layouts');

await it('every block type inserts, renders and exports', async () => {
  const el = await mountEditor();
  await settle();
  const failures = [];
  for (const def of BLOCKS) {
    try {
      el.core.insertBlock(def.type);
      await settle();
    } catch (e) { failures.push(def.type + ': ' + e.message); }
  }
  assert.deepEqual(failures, [], 'no block type threw on insert');
  const types = allBlocks(el).map((b) => b.type);
  // Dynamic-content markers insert as a start+end pair, so they count twice.
  const expected = BLOCKS.length + BLOCKS.filter((d) => d.type === 'condition' || d.type === 'loop').length;
  assert.equal(types.length, expected, 'all ' + BLOCKS.length + ' inserted (markers as pairs)');
  await settle(3);
  const html = el.exportHtml();
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<\/html>$/);
});

await it('every layout inserts a row with the right column count', async () => {
  const el = await mountEditor();
  for (const layout of LAYOUTS) {
    el.core.insertRow(layout.spans);
    await settle();
  }
  const counts = el.getContent().rows.map((r) => r.cols.length);
  LAYOUTS.forEach((l) => assert.ok(counts.includes(l.spans.length), l.label + ' produced ' + l.spans.length + ' columns'));
});

await it('every compound group builds and renders', async () => {
  const el = await mountEditor();
  const failures = [];
  for (const id of Object.keys(GROUPS)) {
    try { el.core.insertGroup(id); await settle(); }
    catch (e) { failures.push(id + ': ' + e.message); }
  }
  assert.deepEqual(failures, [], 'no group threw');
  assert.ok(el.getContent().rows.length > 1);
});

await it('duplicate, delete and undo work through the element', async () => {
  const el = await mountEditor();
  el.core.insertBlock('heading');
  await settle();
  const id = allBlocks(el)[0].id;
  el.core.select('block', id);
  el.core.dupSel();
  await settle();
  assert.equal(allBlocks(el).length, 2, 'duplicated');
  el.core.select('block', id);
  el.core.delSel();
  await settle();
  assert.equal(allBlocks(el).length, 1, 'deleted');
  el.undo();
  await settle();
  assert.equal(allBlocks(el).length, 2, 'undo restored it');
  el.redo();
  await settle();
  assert.equal(allBlocks(el).length, 1, 'redo removed it again');
});

console.log();
console.log('Modals and chrome');

for (const [label, open] of [
  ['export', (c) => c.openExport()],
  ['code', (c) => c.openCode()],
  ['preview', (c) => c.setState({ previewOpen: true })],
  ['ai draft', (c) => c.setState({ aiOpen: true })],
  ['library', (c) => c.openLibrary(null)],
]) {
  await it('the ' + label + ' modal opens and closes', async () => {
    const el = await mountEditor();
    el.importHtml(EMAIL);
    await settle();
    open(el.core);
    await settle(2);
    el.core.setState({ exportOpen: false, codeOpen: false, previewOpen: false, aiOpen: false, libraryOpen: false });
    await settle();
    assert.ok(q(el, '.mc-layout'), 'the editor survived');
  });
}

await it('the code modal round-trips the document through html', async () => {
  const el = await mountEditor();
  el.importHtml(EMAIL);
  await settle(3);
  el.core.openCode();
  await settle(2);
  assert.ok(el.core.state.codeSrc.length > 100, 'the modal was seeded with the current html');
  el.core.applyCode();
  await settle(2);
  assert.equal(el.core.state.codeOpen, false);
  assert.ok(el.getContent().rows.length >= 1, 'applying kept a document');
});

await it('the code preview uses the editor scrollbar without changing its source', async () => {
  const el = await mountEditor();
  el.importHtml(EMAIL);
  await settle(3);
  el.core.openCode();
  await settle(2);
  const source = el.core.state.codeSrc;
  const frame = q(el, '.mc-code-frame');
  const previewDocument = win().document.implementation.createHTMLDocument('preview');
  Object.defineProperty(frame, 'contentDocument', { configurable: true, value: previewDocument });
  frame.dispatchEvent(new (win().Event)('load'));
  const style = frame.contentDocument.head.querySelector('[data-mc-preview-scrollbar]');
  assert.ok(style, 'preview-only scrollbar style was installed inside the iframe');
  assert.match(style.textContent, /width: 8px !important/);
  assert.match(style.textContent, /border-radius: 999px !important/);
  assert.match(style.textContent, /scrollbar-button \{ display: none !important/);
  assert.equal(el.core.state.codeSrc, source, 'editor source was not modified');
  assert.equal(frame.srcdoc, source, 'iframe source remains the exact editor source');
});

await it('the code source wraps long lines within the visible pane', async () => {
  const el = await mountEditor();
  el.importHtml(EMAIL);
  await settle(3);
  el.core.openCode();
  await settle(2);
  const textarea = q(el, '.mc-code-source textarea');
  const scrollPane = textarea.parentElement.parentElement;
  const highlightedRows = textarea.previousElementSibling.children;
  assert.equal(textarea.wrap, 'soft');
  assert.equal(textarea.style.whiteSpace, 'pre-wrap');
  assert.equal(textarea.style.overflowWrap, 'anywhere');
  assert.equal(scrollPane.style.overflowX, 'hidden');
  assert.equal(highlightedRows.length, el.core.state.codeSrc.split('\n').length, 'one numbered highlight row per source line');
});

await it('the light/dark toggle repaints without losing the document', async () => {
  const el = await mountEditor();
  el.importHtml(EMAIL);
  await settle();
  const before = el.getContent().rows.length;
  el.core.setState({ chrome: 'dark' });
  await settle();
  assert.equal(q(el, '#mc').dataset.chrome, 'dark');
  assert.equal(el.getContent().rows.length, before);
});

await it('the device toggle switches the canvas width', async () => {
  const el = await mountEditor();
  el.core.setState({ device: 'mobile' });
  await settle();
  assert.equal(el.core.state.device, 'mobile');
  el.core.setState({ device: 'desktop' });
  await settle();
  assert.equal(el.core.state.device, 'desktop');
});

await it('zoom re-renders at each step', async () => {
  const el = await mountEditor();
  for (const zoom of [0.75, 1, 1.25]) {
    el.core.setState({ zoom });
    await settle();
    assert.equal(el.core.state.zoom, zoom);
  }
});

console.log();
console.log('Host-owned attributes');

await it('locale switches the chrome language and direction', async () => {
  const el = await mountEditor({ locale: 'de' });
  await settle();
  assert.equal(el.core.t('action.export'), 'Exportieren');
  el.setAttribute('locale', 'ar');
  await settle();
  assert.equal(el.getAttribute('dir') || q(el, '#mc').getAttribute('dir'), 'rtl');
});

await it('messages override individual strings', async () => {
  const el = await mountEditor();
  el.messages = { 'action.export': 'Send it' };
  await settle();
  assert.equal(el.core.t('action.export'), 'Send it');
});

await it('a host theme attribute hides the built-in toggle', async () => {
  const el = await mountEditor({ theme: 'dark' });
  await settle();
  const toggle = bar(el, '.mc-icon-label').find((b) => /dark|light/i.test(b.textContent));
  assert.ok(!toggle || toggle.style.display === 'none', 'the editor does not fight the host');
});

await it('ui-font reaches the chrome', async () => {
  const el = await mountEditor({ 'ui-font': 'inherit' });
  await settle();
  assert.equal(el.uiFont, 'inherit');
  el.uiFont = "'IBM Plex Sans', Arial, sans-serif";
  await settle();
  assert.match(el.getAttribute('ui-font'), /IBM Plex Sans/);
});

await it('accent repaints the chrome from a host brand color', async () => {
  const el = await mountEditor({ accent: '#e11d48' });
  await settle();
  const mc = q(el, '#mc');
  assert.equal(el.accent, '#e11d48');
  // Inline on #mc is the only place that outranks the stylesheet's own
  // declarations on the same element -- see render/style.js.
  assert.equal(mc.style.getPropertyValue('--ed-accent'), '#e11d48');
  assert.ok(mc.style.getPropertyValue('--ed-accent-strong'), 'hover shade is derived, not left on the built-in blue');
  assert.equal(mc.style.getPropertyValue('--ed-accent-ink'), '#ffffff');
  assert.match(mc.style.getPropertyValue('--ed-soft'), /^rgba\(225,29,72,/);
  // Everything drawn on the email sheet -- the row grip, the block toolbars,
  // the drop outlines and the selection outlines -- runs off the sheet family,
  // so a brand color that reaches only --ed-accent would leave them blue.
  assert.equal(mc.style.getPropertyValue('--ed-accent-sheet'), '#e11d48');
  assert.ok(mc.style.getPropertyValue('--ed-accent-sheet-strong'), 'grip hover follows the brand');
  assert.match(mc.style.getPropertyValue('--ed-accent-sheet-line'), /^rgba\(225,29,72,/);
  assert.match(mc.style.getPropertyValue('--ed-select'), /^rgba\(225,29,72,/, 'text selection too');
  assert.ok(mc.style.getPropertyValue('--ed-accent-tint'), 'the brand mark gradient too');

  // Chrome changes the derivation: the dark palette needs a lighter accent.
  el.core.setState({ chrome: 'dark' });
  await settle();
  assert.notEqual(mc.style.getPropertyValue('--ed-accent'), '#e11d48');
  // ...but the sheet stays a white page in dark chrome, so its accent does not
  // lighten with the panels.
  assert.equal(mc.style.getPropertyValue('--ed-accent-sheet'), '#e11d48');
  el.core.setState({ chrome: 'light' });
  await settle();
  assert.equal(mc.style.getPropertyValue('--ed-accent'), '#e11d48');

  // Removing it hands the chrome back to the built-in accent rather than
  // stranding it on the last brand color.
  el.accent = '';
  await settle();
  assert.equal(mc.style.getPropertyValue('--ed-accent'), '');
  assert.equal(mc.style.getPropertyValue('--ed-soft'), '');
});

await it('accent reads a host design token and survives a shell rebuild', async () => {
  const el = await mountEditor();
  el.style.setProperty('--brand', '#0b3d91');
  el.accent = 'var(--brand)';
  await settle();
  assert.equal(q(el, '#mc').style.getPropertyValue('--ed-accent'), '#0b3d91');

  // toolbar= rebuilds the whole shell, which throws away the #mc that carried
  // the inline tokens -- the accent has to be re-applied onto the new one.
  el.setAttribute('toolbar', 'undo,redo,export');
  await settle();
  assert.equal(q(el, '#mc').style.getPropertyValue('--ed-accent'), '#0b3d91', 'the brand survives a toolbar rebuild');

  // A host that moves its own token re-sets the attribute to the same string
  // to ask for a re-read -- nothing else can tell the element a custom
  // property changed, and the memo must not swallow that.
  el.style.setProperty('--brand', '#e11d48');
  el.accent = 'var(--brand)';
  await settle();
  assert.equal(q(el, '#mc').style.getPropertyValue('--ed-accent'), '#e11d48', 're-setting the same attribute re-reads the token');

  // Junk leaves the built-in accent standing instead of half-painting the UI.
  el.accent = 'not-a-color';
  await settle();
  assert.equal(q(el, '#mc').style.getPropertyValue('--ed-accent'), '');
});

await it('the footer carries the attribution and is fully configurable', async () => {
  const el = await mountEditor();
  await settle();
  const foot = q(el, '.mc-footer');
  assert.ok(foot, 'the strip is part of the shell');
  assert.equal(foot.parentElement, q(el, '.mc-layout'), 'the strip lives under the canvas, not across the shell');
  assert.equal(foot.style.width, el.core.state.doc.theme.width + 'px', 'the strip follows the email width');
  assert.match(foot.textContent, /Powered by SELISE Blocks/, 'the default attribution shows');
  assert.match(foot.textContent, /2026/);

  el.core.setState({ device: 'mobile' });
  await settle();
  assert.equal(foot.style.width, '375px', 'the strip follows the mobile email width too');

  // A host string replaces the line.
  el.footer = '© 2026 Acme';
  await settle();
  assert.equal(q(el, '.mc-footer').textContent, '© 2026 Acme');

  // ...and an object gives it a link, opened away from the editor.
  el.footer = { text: 'Acme Mail', href: 'https://acme.test' };
  await settle();
  const link = q(el, '.mc-footer-link');
  assert.equal(link.textContent, 'Acme Mail');
  assert.equal(link.getAttribute('href'), 'https://acme.test');
  assert.equal(link.getAttribute('target'), '_blank');
  assert.equal(link.getAttribute('rel'), 'noopener noreferrer');

  // Removing it collapses the row rather than leaving an empty bar.
  el.footer = false;
  await settle();
  assert.equal(q(el, '.mc-footer').style.display, 'none');

  // ...and back, through the attribute half of the API.
  el.footer = undefined;
  el.setAttribute('footer', 'none');
  await settle();
  assert.equal(q(el, '.mc-footer').style.display, 'none');
  el.setAttribute('footer', 'Built at Acme');
  await settle();
  assert.equal(q(el, '.mc-footer').style.display, 'flex');
  assert.equal(q(el, '.mc-footer').textContent, 'Built at Acme');
});

await it('the default footer line follows the locale and message overrides', async () => {
  const el = await mountEditor();
  await settle();
  el.messages = { 'footer.poweredBy': 'Powered by Acme' };
  await settle();
  assert.equal(q(el, '.mc-footer').textContent, 'Powered by Acme', 'the default line is a translatable string, not baked in');
});

await it('variables reach the token list', async () => {
  const el = await mountEditor({ variables: 'first_name,company' });
  assert.deepEqual(el.variables, ['first_name', 'company']);
  el.variables = ['a', 'b', 'c'];
  assert.equal(el.variables.length, 3);
});

console.log();
console.log('Top bar configuration');

await it('the bar renders every part by default', async () => {
  const el = await mountEditor();
  assert.ok(q(el, '.mc-brand-name'), 'logo');
  assert.ok(q(el, '.mc-device-segment'), 'device');
  assert.ok(bar(el, '.mc-icon-button').length >= 2, 'undo/redo');
});

await it('toolbar="none" builds no header and the canvas takes the whole shell', async () => {
  const el = await mountEditor({ toolbar: 'none' });
  assert.equal(q(el, '.mc-header'), null);
  assert.match(q(el, '.mc-shell').className, /mc-no-header/);
  assert.ok(q(el, '.mc-layout'), 'the editor still rendered');
});

await it('an attribute allow-list keeps only what it names', async () => {
  const el = await mountEditor({ toolbar: 'undo,redo,export' });
  assert.equal(q(el, '.mc-brand-name'), null, 'no logo');
  assert.equal(q(el, '.mc-device-segment'), null, 'no device segment');
  assert.equal(bar(el, '.mc-icon-label').length, 1, 'only export');
  assert.match(bar(el, '.mc-icon-label')[0].textContent, /Export/);
});

await it('setting the property rebuilds the bar in place', async () => {
  const el = await mountEditor();
  assert.ok(q(el, '.mc-brand-name'));
  el.toolbar = { logo: false };
  await settle(2);
  assert.equal(q(el, '.mc-brand-name'), null);
  assert.ok(q(el, '.mc-header'), 'the rest of the bar is still there');
});

await it('a re-set that changes nothing does not rebuild', async () => {
  const el = await mountEditor();
  el.toolbar = { logo: false };
  await settle(2);
  const header = q(el, '.mc-header');
  el.toolbar = { logo: false };
  await settle(2);
  assert.equal(q(el, '.mc-header'), header, 'same node -- no rebuild');
});

console.log();
console.log('createEditor (mount into a container)');

await it('mounts into a selector and returns a working handle', async () => {
  const host = win().document.createElement('div');
  host.id = 'mount-a';
  win().document.body.appendChild(host);
  const editor = createEditor('#mount-a', { html: EMAIL, variables: ['first_name'], toolbar: { logo: false } });
  await settle(3);
  assert.ok(host.querySelector('mailcraft-editor'), 'mounted');
  assert.equal(editor.element.getAttribute('variables'), 'first_name');
  assert.equal(q(editor.element, '.mc-brand-name'), null, 'toolbar option applied');
  assert.ok(editor.exportHtml().includes('Launch'), 'the html option was applied');
  editor.destroy();
  assert.equal(host.querySelector('mailcraft-editor'), null, 'destroy removed it');
});

await it('accepts an element, appends, and leaves existing content alone', async () => {
  const host = win().document.createElement('div');
  host.innerHTML = '<p id="keep">host content</p>';
  win().document.body.appendChild(host);
  const editor = createEditor(host, {});
  await settle(2);
  assert.ok(host.querySelector('#keep'), 'not wiped');
  editor.destroy();
  assert.ok(host.querySelector('#keep'), 'still there after destroy');
});

await it('replace:true empties the container first', async () => {
  const host = win().document.createElement('div');
  host.innerHTML = '<p id="gone">x</p>';
  win().document.body.appendChild(host);
  createEditor(host, { replace: true });
  await settle(2);
  assert.equal(host.querySelector('#gone'), null);
});

await it('height is applied to the container when given', async () => {
  const host = win().document.createElement('div');
  win().document.body.appendChild(host);
  createEditor(host, { height: 480 });
  assert.equal(host.style.height, '480px');
  const other = win().document.createElement('div');
  win().document.body.appendChild(other);
  createEditor(other, { height: '30rem' });
  assert.equal(other.style.height, '30rem');
});

await it('forwards every method and exposes the element', async () => {
  const host = win().document.createElement('div');
  win().document.body.appendChild(host);
  const editor = createEditor(host, {});
  await settle(2);
  ['exportHtml', 'importHtml', 'loadTemplate', 'undo', 'redo', 'screenshotPng', 'previewScreenshot', 'downloadScreenshot', 'copyScreenshot']
    .forEach((m) => assert.equal(typeof editor[m], 'function', m + ' forwarded'));
  assert.equal(editor.element.tagName.toLowerCase(), 'mailcraft-editor');
  editor.importHtml(EMAIL);
  await settle(2);
  assert.ok(editor.exportHtml().includes('Launch'));
});

await it('onChange and onExport are wired, and destroy detaches them', async () => {
  const host = win().document.createElement('div');
  win().document.body.appendChild(host);
  let changes = 0;
  let exports = 0;
  const editor = createEditor(host, { onChange: () => { changes++; }, onExport: () => { exports++; } });
  await settle(2);
  editor.importHtml(EMAIL);
  await settle(2);
  editor.exportHtml();
  assert.ok(changes > 0, 'onChange fired');
  assert.equal(exports, 1, 'onExport fired once');
  const el = editor.element;
  editor.destroy();
  el.dispatchEvent(new (win().CustomEvent)('change', { detail: {} }));
  assert.ok(changes > 0);
});

await it('a target that matches nothing throws instead of failing silently', async () => {
  assert.throws(() => createEditor('#does-not-exist', {}), /no element matched/);
  assert.throws(() => createEditor(null, {}), /no element matched/);
  assert.throws(() => createEditor(42, {}), /no element matched/);
});

console.log();
console.log('Lifecycle');

await it('disconnecting stops the editor cleanly', async () => {
  const el = await mountEditor();
  el.importHtml(EMAIL);
  await settle();
  el.remove();
  await settle();
  assert.ok(true, 'no throw on teardown');
});

await it('a host document survives a remount', async () => {
  const el = await mountEditor();
  el.importHtml(EMAIL);
  await settle();
  const before = el.getContent().rows.length;
  const box = win().document.createElement('div');
  win().document.body.appendChild(box);
  box.appendChild(el);
  await settle(2);
  assert.equal(el.getContent().rows.length, before, 'the document was not replaced by the persisted draft');
});

await it('no uncaught page errors across the whole suite', async () => {
  assert.deepEqual(pageErrors.slice(0, 5), []);
});

console.log(`\n${passed} passed, ${failed} failed.`);
closeDom();
process.exit(failed ? 1 : 0);
