/**
 * Export tests: what `buildHtml()` actually emits.
 *
 * Run: npm test
 *
 * No DOM and no dependencies. `buildHtml` reads rendered block content back out
 * of the live tree, but it only ever calls `root.querySelector(...)` and reads
 * `.outerHTML` off the result -- so a stub root with those two things is a
 * faithful stand-in, and the rest of the function is string building.
 *
 * This file exists because the exporter is the highest-consequence code here:
 * its output goes to real recipients, where a mistake cannot be rolled back.
 */
import assert from 'node:assert/strict';

const { buildHtml } = await import(new URL('../src/core/export.js', import.meta.url).href);
const { boxCss } = await import(new URL('../src/core/layout-style.js', import.meta.url).href);
const { mk, mkRow, migrateDoc } = await import(new URL('../src/core/blocks.js', import.meta.url).href);

let passed = 0;
let failed = 0;
async function it(name, fn) {
  try { await fn(); passed++; console.log('  ok    ' + name); }
  catch (e) { failed++; console.log('  FAIL  ' + name + '\n        ' + String(e.message).split('\n').join('\n        ')); }
}

const THEME = { bg: '#ece8df', contentBg: '#fffdf8', width: 620, font: 'Georgia, Times, serif', text: '#172033', link: '#c2412d' };

/** Stands in for the shadow root `grab` queries. */
const stubRoot = (byId) => ({
  querySelector: (sel) => {
    const m = sel.match(/data-mc-content="([^"]+)"/);
    const html = m && byId[m[1]];
    return html ? { outerHTML: html } : null;
  },
});

/** A one-row, one-column document with the given blocks. */
const docOf = (blocks, rowProps = {}) => {
  const row = mkRow([100], blocks);
  Object.assign(row.props, rowProps);
  return { theme: THEME, rows: [row] };
};

const render = (doc, { content = {} } = {}) =>
  buildHtml({ doc }, stubRoot(content), boxCss);

console.log('\nExport');

await it('emits a complete document', async () => {
  const html = render(docOf([]));
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<\/html>$/);
});

// There is no campaign/title setting any more: hosts give the editor HTML and
// get HTML back. A per-document title was one more thing for them to carry for
// no benefit -- a mail client shows the Subject line, never the <title>.
await it('the title is a fixed neutral one, never a placeholder', async () => {
  const html = render(docOf([]));
  assert.match(html, /<title>Email<\/title>/);
  assert.equal(/Fall drop/.test(html), false);
});

await it('block content is read back from the rendered tree', async () => {
  const text = mk('text');
  const html = render(docOf([text]), { content: { [text.id]: '<p>Hello there</p>' } });
  assert.match(html, /<p>Hello there<\/p>/);
});

await it('editing-only attributes never reach the recipient', async () => {
  const text = mk('text');
  const html = render(docOf([text]), {
    content: { [text.id]: '<p contenteditable="true" spellcheck="false" draggable="true" data-mc-content="x" data-gramm="false" data-gramm_editor="false" data-enable-grammarly="false" data-lt-active="false">Hi</p>' },
  });
  assert.equal(/contenteditable/.test(html), false);
  assert.equal(/spellcheck/.test(html), false);
  assert.equal(/draggable/.test(html), false);
  assert.equal(/data-mc-/.test(html), false);
  assert.equal(/data-gramm/.test(html), false, 'the writing-assistant opt-outs are editor-only too');
  assert.equal(/data-enable-grammarly/.test(html), false);
  assert.equal(/data-lt-active/.test(html), false);
  assert.match(html, />Hi</);
});

await it('a missing block renders as nothing rather than breaking the document', async () => {
  const text = mk('text');
  const html = render(docOf([text]));          // nothing registered for its id
  assert.match(html, /<\/html>$/);
});

await it('raw html and css blocks pass through untouched', async () => {
  const raw = mk('html');
  raw.props.code = '<div class="custom">raw</div>';
  const css = mk('css');
  css.props.code = '.x { color: red }';
  const html = render(docOf([raw, css]));
  assert.match(html, /<div class="custom">raw<\/div>/);
  assert.match(html, /<style>\.x \{ color: red \}<\/style>/);
});

await it('a row background image is emitted as a css url', async () => {
  const html = render(docOf([], { bgImage: 'https://cdn.example.com/hero.png' }));
  assert.match(html, /background-image:url\(&quot;https:\/\/cdn\.example\.com\/hero\.png&quot;\)/);
});

// The regression this file was written for: the background URL is interpolated
// into a style="..." attribute, so an unescaped quote ends the attribute and
// everything after it becomes markup in a sent campaign.
await it('a quote in a background url cannot break out of the style attribute', async () => {
  const attack = 'https://cdn/a.png" onmouseover="alert(1)';
  const html = render(docOf([], { bgImage: attack }));
  assert.equal(html.includes('onmouseover="alert(1)"'), false);
  assert.equal(html.includes('a.png" '), false, 'the raw quote must not survive');
  assert.match(html, /a\.png%22%20onmouseover=%22alert%281%29/);
});

await it('a javascript: background url is dropped entirely', async () => {
  const html = render(docOf([], { bgImage: 'javascript:alert(1)' }));
  assert.equal(/javascript:/.test(html), false);
});

await it('column styling wraps the cell contents', async () => {
  const doc = docOf([]);
  Object.assign(doc.rows[0].cols[0], { bg: '#ffffff', radius: 8, padY: 12, padX: 16 });
  const html = render(doc);
  assert.match(html, /background:#ffffff;border-radius:8px;padding:12px 16px/);
});

await it('chosen border styles survive the email export', async () => {
  const block = mk('text');
  Object.assign(block.props, { bBorder: 2, bStyle: 'dotted', bLine: '#123456' });
  const doc = docOf([block], { border: 3, borderStyle: 'dashed', lineColor: '#654321' });
  Object.assign(doc.rows[0].cols[0], { border: 4, borderStyle: 'double', lineColor: '#abcdef' });
  const html = render(doc, {
    content: { [block.id]: '<p>Bordered content</p>' },
  });
  assert.match(html, /border:2px dotted #123456/);
  assert.match(html, /border:3px dashed #654321/);
  assert.match(html, /border:4px double #abcdef/);
});

await it('preserves all four outside-spacing sides in the email export', async () => {
  const html = render(docOf([], { mt: 8, mr: 10, mb: 12, ml: 14 }));
  assert.match(html, /margin:8px 10px 12px 14px/);
});

await it('migrates legacy vertical outside spacing into top and bottom', async () => {
  const row = mkRow([100]);
  delete row.props.mt; delete row.props.mr; delete row.props.mb; delete row.props.ml;
  row.props.my = 18;
  migrateDoc({ theme: THEME, rows: [row] });
  assert.deepEqual(
    { mt: row.props.mt, mr: row.props.mr, mb: row.props.mb, ml: row.props.ml },
    { mt: 18, mr: 0, mb: 18, ml: 0 },
  );
});

// Dynamic-content markers: the editor authors literal template tags at the
// markers' positions, the host's engine runs them at send time -- so what
// matters here is position, balance, and that nothing evaluated them.
const marker = (type, over) => { const b = mk(type); Object.assign(b.props, over || {}); return b; };

await it('a condition pair emits literal {{#if}}/{{/if}} around the content between them', async () => {
  const text = mk('text');
  const html = render(docOf([marker('condition'), text, marker('condition', { end: true })]), { content: { [text.id]: '<p>Members only</p>' } });
  const open = html.indexOf('{{#if is_premium}}');
  const body = html.indexOf('Members only');
  const close = html.indexOf('{{/if}}');
  assert.ok(open > -1 && close > -1, 'both tags are emitted');
  assert.ok(open < body && body < close, 'the tags bracket the content');
});

await it('a loop pair emits literal {{#each}}/{{/each}}', async () => {
  const text = mk('text');
  const html = render(docOf([marker('loop', { expr: 'order.items' }), text, marker('loop', { end: true })]), { content: { [text.id]: '<p>{{ this.name }}</p>' } });
  assert.ok(html.indexOf('{{#each order.items}}') < html.indexOf('this.name'));
  assert.ok(html.indexOf('this.name') < html.indexOf('{{/each}}'));
});

await it('a stray end marker emits nothing', async () => {
  const html = render(docOf([marker('condition', { end: true })]));
  assert.equal(/\{\{\/if\}\}/.test(html), false);
});

await it('an unclosed start marker is auto-closed after the last row', async () => {
  const html = render(docOf([marker('loop', { expr: 'items' })]));
  const open = html.indexOf('{{#each items}}');
  const close = html.indexOf('{{/each}}');
  assert.ok(open > -1, 'the opener is emitted');
  assert.ok(close > open, 'a closer is appended after it');
});

await it('mismatched interleaving degrades to balanced output, never a broken template', async () => {
  // if-open, each-open, if-close (wrong order): the if-close is a stray while
  // each is on top, so it emits nothing and both opens auto-close at the end.
  const html = render(docOf([marker('condition'), marker('loop', { expr: 'items' }), marker('condition', { end: true })]));
  const opens = (html.match(/\{\{#/g) || []).length;
  const closes = (html.match(/\{\{\//g) || []).length;
  assert.equal(opens, closes);
  assert.ok(html.indexOf('{{/each}}') < html.indexOf('{{/if}}'), 'closed innermost-first');
});

await it('angle brackets cannot ride a marker expression into the document', async () => {
  const html = render(docOf([marker('condition', { expr: 'x}}<script>alert(1)</script>' })]));
  assert.equal(/<script>/.test(html), false);
});

await it('a blank expression emits no tag at all', async () => {
  const html = render(docOf([marker('condition', { expr: '  ' }), marker('condition', { end: true })]));
  assert.equal(/\{\{#if/.test(html), false);
  assert.equal(/\{\{\/if\}\}/.test(html), false, 'its end marker is skipped too');
});

await it('a row holding only markers emits the tags without its <tr> scaffolding', async () => {
  const doc = { theme: THEME, rows: [mkRow([100], [marker('condition')]), mkRow([100], [mk('text')]), mkRow([100], [marker('condition', { end: true })])] };
  const html = buildHtml({ doc }, stubRoot({}), boxCss);
  const bare = buildHtml({ doc: { theme: THEME, rows: [mkRow([100], [mk('text')])] } }, stubRoot({}), boxCss);
  assert.equal((html.match(/<tr>/g) || []).length, (bare.match(/<tr>/g) || []).length, 'marker rows add no <tr> of their own');
  assert.ok(html.indexOf('{{#if is_premium}}') > -1 && html.indexOf('{{#if is_premium}}') < html.indexOf('{{/if}}'));
});

// decorateLogicTags dresses tags for the code preview iframe only -- the
// export itself must keep the literal text (asserted above).
await it('decorateLogicTags turns between-row tags into slim band rows and in-cell tags into chips', async () => {
  const { decorateLogicTags } = await import(new URL('../src/core/export.js', import.meta.url).href);
  const src = '<table>{{#if is_premium}}<tr><td>{{#each order.items}}<p>x</p>{{/each}}</td></tr>{{/if}}</table>';
  const out = decorateLogicTags(src);
  assert.equal(/\{\{#|\{\{\//.test(out), false, 'no raw tags remain');
  assert.match(out, /<tr><td colspan="99"[^>]*>[\s\S]*SHOW IF/, 'row-level tag became a band row');
  assert.match(out, /REPEAT EACH[\s\S]*\{\{ order\.items \}\}/, 'in-cell tag became a labeled chip');
  assert.match(out, /END LOOP/); assert.match(out, /END IF/);
});

await it('decorateLogicTags escapes markup smuggled inside an expression', async () => {
  const { decorateLogicTags } = await import(new URL('../src/core/export.js', import.meta.url).href);
  const out = decorateLogicTags('<td>{{#if a && "<img onerror=x>"}}</td>');
  assert.equal(/<img/.test(out), false);
  assert.match(out, /&lt;img/);
});

await it('the theme drives the page and content background and width', async () => {
  const html = render(docOf([]));
  assert.match(html, new RegExp('background:' + THEME.bg));
  assert.match(html, new RegExp('width:' + THEME.width + 'px'));
});

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed) process.exit(1);
