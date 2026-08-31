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

const { buildHtml, msoHarden } = await import(new URL('../src/core/export.js', import.meta.url).href);
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

await it('the canvas drop shadow rides the content table, only when asked', async () => {
  const plain = render(docOf([mk('text')]));
  assert.equal(/box-shadow/.test(plain), false, 'no shadow with theme.shadow unset');
  const doc = docOf([mk('text')]);
  doc.theme = Object.assign({}, THEME, { shadow: '0 8px 28px rgba(23,32,51,0.14)' });
  const html = buildHtml({ doc }, stubRoot({}), boxCss);
  assert.match(html, /width:100%;max-width:620px[^"]*box-shadow:0 8px 28px rgba\(23,32,51,0\.14\)/);
});

await it('the content-area border rides the content table, only when asked', async () => {
  const plain = render(docOf([mk('text')]));
  assert.equal(/max-width:620px[^"]*border:/.test(plain), false, 'no border style with borderW unset');
  const doc = docOf([mk('text')]);
  doc.theme = Object.assign({}, THEME, { borderW: 3, borderStyle: 'dashed', borderColor: '#123456' });
  const html = buildHtml({ doc }, stubRoot({}), boxCss);
  assert.match(html, /width:100%;max-width:620px[^"]*border:3px dashed #123456/, 'the border sits on the content table');
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

/*
 * The page section: the band around the content column. It is the one part of
 * a template that only exists in the sent HTML, so these guard both that it
 * can now be shaped and that a document which never touched it still exports
 * the flush, square markup it always did.
 */
await it('a document that never touched the page exports flush and square', async () => {
  const html = render(docOf([]));
  assert.match(html, /<td align="center" style="padding:0;">/);
  assert.equal(/border-radius/.test(html.split('<tr>')[0]), false, 'no radius on the content table');
  assert.equal(/overflow:hidden/.test(html), false);
});

await it('page padding becomes the band around the content column', async () => {
  const doc = docOf([]);
  doc.theme = Object.assign({}, THEME, { padY: 28, padX: 16 });
  const html = render(doc);
  assert.match(html, /<td align="center" style="padding:28px 16px;">/);
});

await it('one page padding axis alone still emits both', async () => {
  const doc = docOf([]);
  doc.theme = Object.assign({}, THEME, { padY: 0, padX: 24 });
  assert.match(render(doc), /padding:0px 24px;/);
});

await it('the content radius is emitted with the clip that makes it visible', async () => {
  const doc = docOf([]);
  doc.theme = Object.assign({}, THEME, { radius: 14 });
  const html = render(doc);
  assert.match(html, /border-radius:14px;overflow:hidden;/);
});

await it('a transparent page background reaches the body and the wrapper table', async () => {
  const doc = docOf([]);
  doc.theme = Object.assign({}, THEME, { bg: 'transparent' });
  const html = render(doc);
  assert.equal((html.match(/background:transparent/g) || []).length, 2, 'body and full-width table');
  assert.equal(html.indexOf(THEME.bg), -1, 'the old colour is gone, not merely overpainted');
});

await it('a transparent content background is passed through, not defaulted to white', async () => {
  const doc = docOf([]);
  doc.theme = Object.assign({}, THEME, { contentBg: 'transparent' });
  assert.match(render(doc), /max-width:620px;background:transparent;/);
});

await it('a page with no background at all still emits valid CSS', async () => {
  const doc = docOf([]);
  doc.theme = Object.assign({}, THEME, { bg: '', contentBg: '' });
  const html = render(doc);
  assert.equal(/background:;/.test(html), false, 'never an empty declaration');
  assert.match(html, /background:transparent/);
});

/*
 * Responsiveness. The exporter used to pin the content column at a fixed
 * `width:620px`, which a mail client on a phone cannot narrow -- and because
 * a px width is also a table's min-content contribution, it propagated
 * outward and held the full-width wrapper open too, so even a text-only
 * template scrolled sideways on a 390px screen. These lock in the fluid
 * shape, the Outlook cage that compensates for it, and the stacking the row
 * inspector's "Stack columns on mobile" toggle had been promising while
 * nothing actually read the prop.
 */
await it('the content column is fluid, capped by max-width rather than pinned to it', async () => {
  const html = render(docOf([mk('text')]));
  assert.match(html, /style="width:100%;max-width:620px/, 'fluid up to the document width');
  assert.equal(/style="width:620px/.test(html), false, 'never a fixed px width, which no client can narrow');
});

await it('Outlook, which honours neither max-width nor media queries, still gets a fixed cage', async () => {
  const html = render(docOf([mk('text')]));
  assert.match(html, /<!--\[if mso\]><table role="presentation" width="620"/, 'the ghost table opens');
  assert.match(html, /<!--\[if mso\]><\/td><\/tr><\/table><!\[endif\]-->/, 'and closes');
});

await it('columns carry the hook that stacks them on a narrow screen', async () => {
  const two = buildHtml({ doc: { theme: THEME, rows: [mkRow([50, 50], [mk('text')])] } }, stubRoot({}), boxCss);
  assert.match(two, /<td class="mc-col" width="50%"/, 'each cell opts in');
  assert.match(two, /@media only screen and \(max-width:620px\)/, 'and the query that acts on it ships');
  assert.match(two, /\.mc-col \{ display:block !important; width:100% !important;/);
});

await it('a single-column row is not given a stacking hook it cannot use', async () => {
  const one = buildHtml({ doc: { theme: THEME, rows: [mkRow([100], [mk('text')])] } }, stubRoot({}), boxCss);
  assert.equal(/class="mc-col"/.test(one), false, 'already full width');
});

await it('a row that opted out of stacking keeps its columns side by side', async () => {
  const row = mkRow([50, 50], [mk('text')]);
  row.props.stackMobile = false;
  const html = buildHtml({ doc: { theme: THEME, rows: [row] } }, stubRoot({}), boxCss);
  assert.equal(/class="mc-col"/.test(html), false, 'the toggle is honoured, not ignored as it was');
});

/*
 * Mail-client hardening. Each of these is one or two declarations that fix a
 * defect a real client still has today; the deliberately *absent* ones are
 * asserted too, so nobody reintroduces the legacy payload (VML buttons and
 * their namespace, o:AllowPNG, #MessageViewBody, -ms-text-size-adjust) that
 * only ever served clients now long dead.
 */
await it('Outlook is told to render at 96dpi, so it stops scaling the template up', async () => {
  const html = render(docOf([mk('text')]));
  assert.match(html, /xmlns:o="urn:schemas-microsoft-com:office:office"/, 'the namespace o: actually needs');
  assert.match(html, /<!--\[if mso\]>\s*<xml><o:OfficeDocumentSettings><o:PixelsPerInch>96<\/o:PixelsPerInch>/);
});

await it('every table blocks Word from adding its own horizontal spacing', async () => {
  const html = render(docOf([mk('text')]));
  const tables = html.match(/<table\b[^>]*>/g) || [];
  assert.ok(tables.length >= 3, 'the shell alone has several');
  tables.forEach((tag) => assert.match(tag, /mso-table-lspace:0pt;mso-table-rspace:0pt;/, tag.slice(0, 60)));
});

await it('declared line-heights are made exact for Outlook, and none are invented', async () => {
  const html = render(docOf([mk('text')]));
  (html.match(/style="[^"]*"/g) || []).forEach((attr) => {
    if (/line-height:/.test(attr)) assert.match(attr, /mso-line-height-rule:exactly/, 'paired: ' + attr.slice(0, 70));
    else assert.equal(/mso-line-height-rule/.test(attr), false, 'never added on its own: ' + attr.slice(0, 70));
  });
});

await it('mobile clients are stopped from resizing the type, without blocking scaling outright', async () => {
  const html = render(docOf([mk('text')]));
  assert.match(html, /-webkit-text-size-adjust:100%;text-size-adjust:100%/);
  assert.equal(/text-size-adjust:none/.test(html), false, 'none leaves text too small on some Android clients');
});

await it("Apple Mail's auto-detected links are handed back to the surrounding text", async () => {
  const html = render(docOf([mk('text')]));
  assert.match(html, /a\[x-apple-data-detectors\] \{ color:inherit !important; text-decoration:none !important; \}/);
});

await it('the legacy payload is deliberately not carried', async () => {
  const html = render(docOf([mk('button'), mk('text')]));
  assert.equal(/xmlns:v=/.test(html), false, 'no VML namespace, because nothing emits VML');
  assert.equal(/v:roundrect/.test(html), false, 'no VML buttons');
  assert.equal(/AllowPNG/.test(html), false, 'Outlook 2007-2010 era');
  assert.equal(/MessageViewBody/.test(html), false, 'old Outlook.com / Windows Live');
  assert.equal(/-ms-text-size-adjust/.test(html), false, 'IE / Windows Phone');
});

await it('hardening is idempotent, so a re-export never doubles it', async () => {
  const html = render(docOf([mk('text')]));
  const twice = msoHarden(html);
  assert.equal(twice, html, 'a second pass is a no-op');
});

await it('line-heights are resolved to pixels before Outlook is told to obey them exactly', async () => {
  // Exercised through msoHarden directly: this suite is DOM-free, and block
  // bodies reach the exporter from the rendered tree. The input below is the
  // shape render/block-body.js emits for a text block.
  const out = msoHarden('<div style="padding: 10px 0px; font-size: 15px; line-height: 1.65;">x</div>');
  // A unitless ratio is not a length, so pairing it with `exactly` is
  // ambiguous at best. Every block sets font-size beside line-height, so the
  // ratio can be resolved rather than guessed: 15 * 1.65 = 24.75 -> 25.
  assert.match(out, /line-height:25px;mso-line-height-rule:exactly;/);
  assert.equal(/line-height:\s*[\d.]+\s*;/.test(out), false, 'no bare ratio survives');
});

await it('a line-height with no font-size beside it is left alone, and gets no exactly', async () => {
  const out = msoHarden('<p style="line-height:1.65">x</p>');
  assert.match(out, /line-height:1\.65/, 'nothing to resolve it against, so it is untouched');
  assert.equal(/mso-line-height-rule/.test(out), false, 'and no exactly, which would have no length to honour');
});

await it('the document declares one colour scheme, the one it actually ships', async () => {
  const html = render(docOf([mk('text')]));
  // Declaring `light dark` invites a client to apply its own dark transform
  // to a template whose colours are all hard-coded light.
  assert.match(html, /<meta name="color-scheme" content="light">/);
  assert.match(html, /<meta name="supported-color-schemes" content="light">/);
  assert.equal(/content="light dark"/.test(html), false);
});


console.log(`\n${passed} passed, ${failed} failed.`);
if (failed) process.exit(1);
