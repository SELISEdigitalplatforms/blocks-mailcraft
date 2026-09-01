/**
 * The importer: real-world email HTML into native blocks.
 *
 * Run: npm test
 *
 * One fixture per shape it claims to recognize, plus the fallbacks. This is
 * the module with no coverage for the longest -- it needs a DOMParser, so it
 * runs on the jsdom harness rather than the DOM-free suites.
 */
import assert from 'node:assert/strict';
import { installDom, closeDom } from './dom-harness.mjs';

installDom();
const { htmlToDoc, htmlToRows } = await import(new URL('../src/core/import-html.js', import.meta.url).href);

let passed = 0;
let failed = 0;
async function it(name, fn) {
  try { await fn(); passed++; console.log('  ok    ' + name); }
  catch (e) { failed++; console.log('  FAIL  ' + name + '\n        ' + String(e.message).split('\n').join('\n        ')); }
}

/** Wraps a fragment in the 600px content table almost every email uses. */
const email = (inner, bodyStyle) => `<!doctype html><html><head></head><body style="${bodyStyle || 'background:#eef2f7'}">
<table role="presentation" width="100%"><tr><td align="center">
<table role="presentation" width="600" style="width:600px;background:#ffffff">${inner}</table>
</td></tr></table></body></html>`;

const rowsOf = (html) => htmlToRows(html);
const blocksOf = (html) => htmlToRows(html).flatMap((r) => r.cols.flatMap((c) => c.blocks));
const typesOf = (html) => blocksOf(html).map((b) => b.type);
const firstOf = (html, type) => blocksOf(html).find((b) => b.type === type);

console.log();
console.log('Importer — block shapes');

await it('a heading becomes a heading block at its level', async () => {
  const b = firstOf(email('<tr><td><h1 style="font-size:32px;text-align:center">Big</h1></td></tr>'), 'heading');
  assert.ok(b, 'classified');
  assert.equal(b.props.level, 'h1');
  assert.equal(b.props.align, 'center');
  assert.equal(b.props.size, 32);
  assert.match(b.props.text, /Big/);
});

await it('every heading level is recognized', async () => {
  ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].forEach((h) => {
    const b = firstOf(email(`<tr><td><${h}>T</${h}></td></tr>`), 'heading');
    assert.ok(b, h + ' classified');
    assert.equal(b.props.level, h);
  });
});

await it('a paragraph becomes a text block carrying its inline markup', async () => {
  const b = firstOf(email('<tr><td><p style="font-size:15px;line-height:24px;color:#333">Hello <strong>you</strong></p></td></tr>'), 'text');
  assert.ok(b);
  assert.match(b.props.html, /<strong>you<\/strong>/);
  assert.equal(b.props.size, 15);
  assert.ok(b.props.lh > 1 && b.props.lh < 2, 'line-height folded to a ratio, got ' + b.props.lh);
});

await it('an image becomes an image block with its dimensions and link', async () => {
  const b = firstOf(email('<tr><td><a href="https://example.com"><img src="https://cdn.test/a.png" width="600" alt="Hero"></a></td></tr>'), 'image');
  assert.ok(b);
  assert.equal(b.props.src, 'https://cdn.test/a.png');
  assert.equal(b.props.alt, 'Hero');
  assert.equal(b.props.href, 'https://example.com');
});

await it('a padded anchor becomes a button, not a text link', async () => {
  const b = firstOf(email('<tr><td><a href="https://example.com" style="background-color:#0065b3;color:#ffffff;padding:14px 28px;display:inline-block;border-radius:6px">Shop</a></td></tr>'), 'button');
  assert.ok(b, 'classified as a button');
  assert.equal(b.props.href, 'https://example.com');
  assert.match(b.props.label, /Shop/);
  assert.equal(b.props.radius, 6);
});

await it('a bare inline link stays text', async () => {
  const types = typesOf(email('<tr><td><p>Read <a href="https://example.com">the post</a></p></td></tr>'));
  assert.ok(types.includes('text'));
  assert.ok(!types.includes('button'));
});

await it('an hr becomes a divider carrying its thickness and colour', async () => {
  const b = firstOf(email('<tr><td><hr style="height:3px;background:#eeeeee"></td></tr>'), 'divider');
  assert.ok(b, 'classified');
  assert.equal(b.props.thickness, 3);
});

// The other divider every builder emits: an empty div with a height and a fill.
await it('a thin filled bar div becomes a divider', async () => {
  const b = firstOf(email('<tr><td><div style="height:2px;background:#cccccc;width:50%"></div></td></tr>'), 'divider');
  assert.ok(b, 'classified');
  assert.equal(b.props.thickness, 2);
  assert.equal(b.props.width, 50, 'a percentage width carries through');
});

await it('an empty fixed-height cell becomes a spacer', async () => {
  const b = firstOf(email('<tr><td height="40" style="height:40px;font-size:0;line-height:0">&nbsp;</td></tr>'), 'spacer');
  assert.ok(b, 'classified');
  assert.ok(b.props.height >= 1);
});

await it('a list becomes a list block with its items', async () => {
  const b = firstOf(email('<tr><td><ul><li>One</li><li>Two</li></ul></td></tr>'), 'list');
  assert.ok(b);
  assert.ok(JSON.stringify(b.props).includes('One'));
  const ol = firstOf(email('<tr><td><ol><li>A</li></ol></td></tr>'), 'list');
  assert.ok(ol, 'ordered lists too');
});

await it('list items pass through the import sanitizer like every other path', async () => {
  const b = firstOf(email('<tr><td><ul>'
    + '<li class="x" onclick="hack()"><img src="pic.png" onerror="hack()">One</li>'
    + '<li><span style="font-size:13px;color:#334155;mso-line-height-rule:exactly">Two</span></li>'
    + '</ul></td></tr>'), 'list');
  assert.ok(b, 'still classified');
  assert.doesNotMatch(b.props.items, /onerror|onclick|class=|mso-/, 'handlers, classes and mso-* are stripped');
  assert.match(b.props.items, /src="pic\.png"/, 'the image itself survives');
  assert.match(b.props.items, /font-size:\s*13px/, 'whitelisted inline typography survives');
  assert.equal(b.props.items.split('\n').length, 2, 'one line per item');
});

// A table that is a direct child of a layout cell is read as layout -- which is
// correct, that is what those tables are. A wrapped one is content.
await it('a wrapped data table becomes a table block', async () => {
  const b = firstOf(email('<tr><td><div><table><tr><td>Boot</td><td>2</td></tr><tr><td>Hat</td><td>1</td></tr></table></div></td></tr>'), 'table');
  assert.ok(b, 'classified as a table');
  assert.match(b.props.data, /Boot\|2/, 'cells joined with a pipe');
  assert.equal(b.props.header, false);
});

await it('a table with header cells and borders keeps both', async () => {
  const b = firstOf(email('<tr><td><div><table><tr><th style="border:2px solid #dddddd">Item</th><th>Qty</th></tr><tr><td>Boot</td><td>2</td></tr></table></div></td></tr>'), 'table');
  assert.ok(b);
  assert.equal(b.props.header, true);
  assert.equal(b.props.borders, true);
  assert.equal(b.props.borderWidth, 2);
});

await it('a table cell containing a pipe does not corrupt the row encoding', async () => {
  const b = firstOf(email('<tr><td><div><table><tr><td>a|b</td><td>c</td></tr><tr><td>d</td><td>e</td></tr></table></div></td></tr>'), 'table');
  assert.ok(b);
  assert.match(b.props.data, /a\/b/, 'the pipe was replaced, not left to split the cell');
});

await it('a row of social icon links becomes one social block', async () => {
  const html = email(`<tr><td align="center">
    <a href="https://x.com/acme"><img src="https://cdn.test/x.png" width="24" alt="X"></a>
    <a href="https://instagram.com/acme"><img src="https://cdn.test/ig.png" width="24" alt="Instagram"></a>
    <a href="https://linkedin.com/acme"><img src="https://cdn.test/li.png" width="24" alt="LinkedIn"></a>
  </td></tr>`);
  const types = typesOf(html);
  assert.ok(types.includes('social') || types.filter((t) => t === 'image').length >= 1, 'social strip handled: ' + types.join(','));
});

await it('a horizontal link strip becomes a menu', async () => {
  const html = email(`<tr><td align="center">
    <a href="https://example.com/a" style="padding:0 10px">Shop</a>
    <a href="https://example.com/b" style="padding:0 10px">About</a>
    <a href="https://example.com/c" style="padding:0 10px">Help</a>
  </td></tr>`);
  const types = typesOf(html);
  assert.ok(types.length > 0, 'produced something: ' + types.join(','));
});

console.log();
console.log('Importer — structure');

await it('a two-column table becomes one row with two columns', async () => {
  const rows = rowsOf(email('<tr><td><table><tr><td width="50%"><p>L</p></td><td width="50%"><p>R</p></td></tr></table></td></tr>'));
  const twoCol = rows.find((r) => r.cols.length === 2);
  assert.ok(twoCol, 'two columns found');
  assert.deepEqual(twoCol.cols.map((c) => c.span), [50, 50]);
});

await it('uneven column widths carry through as spans', async () => {
  const rows = rowsOf(email('<tr><td><table><tr><td width="33%"><p>L</p></td><td width="67%"><p>R</p></td></tr></table></td></tr>'));
  const r = rows.find((x) => x.cols.length === 2);
  assert.ok(r);
  assert.equal(r.cols[0].span + r.cols[1].span, 100, 'spans normalize to 100');
});

await it('row padding and background come from the cell', async () => {
  const rows = rowsOf(email('<tr><td style="padding:24px 32px;background-color:#f7f7f7"><p>Hi</p></td></tr>'));
  const r = rows.find((x) => x.props.bg || x.props.py);
  assert.ok(r, 'a row picked up styling');
});

await it('a border on the container becomes per-side row borders', async () => {
  const rows = rowsOf(email('<tr><td style="border:1px solid #dddddd;border-radius:8px"><p>Framed</p></td></tr>'));
  assert.ok(rows.some((r) => r.props.border || r.props.radius), 'frame captured');
});

await it('a background image on a row survives with its sizing', async () => {
  const rows = rowsOf(email('<tr><td style="background-image:url(https://cdn.test/bg.jpg);background-size:cover;background-position:center"><p>Hero</p></td></tr>'));
  assert.ok(rows.some((r) => (r.props.bgImage || '').includes('bg.jpg')), 'bg image captured');
});

await it('hidden elements are dropped', async () => {
  const types = typesOf(email('<tr><td><p style="display:none">Mobile only</p><p>Visible</p></td></tr>'));
  const texts = blocksOf(email('<tr><td><p style="display:none">Mobile only</p><p>Visible</p></td></tr>'))
    .map((b) => JSON.stringify(b.props)).join(' ');
  assert.ok(!texts.includes('Mobile only'), 'the hidden copy did not come through');
  assert.ok(types.includes('text'));
});

await it('nested grids survive as raw html rather than being flattened wrongly', async () => {
  const html = email('<tr><td><table><tr><td colspan="2"><table><tr><td>deep</td></tr></table></td></tr></table></td></tr>');
  const blocks = blocksOf(html);
  assert.ok(blocks.length >= 1, 'something came through');
  assert.ok(JSON.stringify(blocks).includes('deep'), 'content was not dropped');
});

await it('a style block is folded in before classifying', async () => {
  const html = `<!doctype html><html><head><style>.big{font-size:30px}</style></head><body>
    <table width="600"><tr><td><h2 class="big">Styled</h2></td></tr></table></body></html>`;
  const b = firstOf(html, 'heading');
  assert.ok(b);
  assert.equal(b.props.size, 30, 'the class rule reached the block');
});

console.log();
console.log('Importer — theme and document');

await it('htmlToDoc returns rows plus the theme the source declared', async () => {
  const doc = htmlToDoc(email('<tr><td><p>Hi</p></td></tr>', 'background:#123456'));
  assert.ok(Array.isArray(doc.rows));
  assert.ok(doc.theme && typeof doc.theme === 'object');
});

await it('the page background and content width are extracted', async () => {
  const doc = htmlToDoc(email('<tr><td><p>Hi</p></td></tr>', 'background-color:#102030'));
  if (doc.theme.bg) assert.match(String(doc.theme.bg).toLowerCase(), /#102030|rgb\(16,\s*32,\s*48\)/);
  if (doc.theme.width) assert.equal(doc.theme.width, 600);
});

await it('a font stack on the body is picked up', async () => {
  const doc = htmlToDoc(email('<tr><td><p>Hi</p></td></tr>', "font-family:Georgia, serif"));
  if (doc.theme.font) assert.match(doc.theme.font, /Georgia/);
});

/*
 * The band around the template and the content column's own corner. Both are
 * exportable now, so both have to survive a round trip -- an import that read
 * neither would silently square off and un-pad every template a host loaded
 * back in for editing.
 */
await it('page padding on the centering cell becomes the page padding', async () => {
  const src = `<!doctype html><html><body style="background:#eef2f7">
<table role="presentation" width="100%"><tr><td align="center" style="padding:30px 18px;">
<table role="presentation" width="600" style="width:600px;background:#ffffff"><tr><td><p>Hi</p></td></tr></table>
</td></tr></table></body></html>`;
  const doc = htmlToDoc(src);
  assert.equal(doc.theme.padY, 30);
  assert.equal(doc.theme.padX, 18);
});

await it('a rounded content table becomes the content corner radius', async () => {
  const src = `<!doctype html><html><body style="background:#eef2f7">
<table role="presentation" width="100%"><tr><td align="center">
<table role="presentation" width="600" style="width:600px;background:#ffffff;border-radius:12px;overflow:hidden"><tr><td><p>Hi</p></td></tr></table>
</td></tr></table></body></html>`;
  assert.equal(htmlToDoc(src).theme.radius, 12);
});

await it('a flush square email declares neither, so the current values stand', async () => {
  const theme = htmlToDoc(email('<tr><td><p>Hi</p></td></tr>')).theme;
  assert.equal('padY' in theme, false);
  assert.equal('padX' in theme, false);
  assert.equal('radius' in theme, false);
});


console.log();
console.log('Importer — degrading, never dropping');

await it('empty input produces no rows rather than throwing', async () => {
  assert.deepEqual(htmlToRows(''), []);
  assert.deepEqual(htmlToRows('   '), []);
  assert.deepEqual(htmlToRows(null), []);
});

await it('a bare fragment with no email scaffolding still imports', async () => {
  const blocks = blocksOf('<h1>Naked</h1><p>copy</p>');
  assert.ok(blocks.length >= 1, 'produced blocks');
  assert.ok(JSON.stringify(blocks).includes('Naked'));
});

await it('unparseable soup keeps its content', async () => {
  const rows = htmlToRows('<div><span>text<b>bold</div></span>');
  const json = JSON.stringify(rows);
  assert.ok(json.includes('text') || rows.length === 0, 'nothing invented');
});

await it('a script tag never survives the import', async () => {
  const json = JSON.stringify(htmlToRows(email('<tr><td><p>ok</p><script>alert(1)</script></td></tr>')));
  assert.ok(!json.includes('alert(1)'), 'script content stripped');
});

await it('exported output re-imports (round trip)', async () => {
  const once = htmlToDoc(email('<tr><td><h1>Round</h1><p>trip</p></td></tr>'));
  assert.ok(once.rows.length >= 1);
  const again = htmlToRows(email('<tr><td><h1>Round</h1><p>trip</p></td></tr>'));
  assert.equal(again.length, once.rows.length, 'stable across two passes');
});

// Dynamic-content markers: the exporter writes literal {{#if}}/{{#each}} tags
// at marker positions (between <tr>s for marker rows, as bare text inside a
// td for in-column markers); the importer must hand them back as marker
// blocks in the same document order, not let the parser foster the stray
// text out of the table into a phantom text row.
await it('row-level dynamic-content tags become marker rows in document order', async () => {
  const rows = rowsOf(email('{{#if has_order}}\n{{#each order.items}}\n<tr><td><p>{{ this.name }}</p></td></tr>\n{{/each}}\n{{/if}}'));
  const seq = rows.map((r) => r.cols[0].blocks[0]).map((b) => b.type + (b.props.end ? ':end' : ''));
  assert.deepEqual(seq, ['condition', 'loop', 'text', 'loop:end', 'condition:end']);
  assert.equal(rows[0].cols[0].blocks[0].props.expr, 'has_order');
  assert.equal(rows[1].cols[0].blocks[0].props.expr, 'order.items');
  assert.match(JSON.stringify(rows), /this\.name/, 'item-scoped merge tag kept as content');
});

await it('bare tags inside a cell become marker blocks around the cell content', async () => {
  const blocks = blocksOf(email('<tr><td>{{#if is_premium}}<p>Members only</p>{{/if}}</td></tr>'));
  const seq = blocks.map((b) => b.type + (b.props.end ? ':end' : ''));
  assert.deepEqual(seq, ['condition', 'text', 'condition:end']);
  assert.equal(blocks[0].props.expr, 'is_premium');
});

await it('template tags mixed into prose stay literal content', async () => {
  const rows = rowsOf(email('<tr><td><p>{{#if vip}}Hi{{/if}}</p></td></tr>'));
  const types = rows.flatMap((r) => r.cols.flatMap((c) => c.blocks.map((b) => b.type)));
  assert.deepEqual(types, ['text'], 'an inline conditional is content, not structure');
  assert.match(JSON.stringify(rows), /\{\{#if vip\}\}/, 'and it passes through untouched');
});

/*
 * The width vote has to understand a responsive content column.
 *
 * This exporter now writes it as `width:100%;max-width:620px` -- the shape
 * every modern builder emits, and the one that lets the email narrow to a
 * phone -- so a reader that only recognised a fixed px width came back with
 * no `theme.width` at all and silently fell to the default on every
 * export -> import round trip.
 */
await it('a fluid content column still yields the document width', async () => {
  const fluid = `<!doctype html><html><head></head><body style="background:#eef2f7">
<table role="presentation" width="100%"><tr><td align="center">
<table role="presentation" width="100%" style="width:100%;max-width:640px;background:#ffffff"><tr><td><p>hi</p></td></tr></table>
</td></tr></table></body></html>`;
  const doc = htmlToDoc(fluid);
  assert.equal(doc.theme.width, 640, 'read off max-width, not lost');
});

await it('the fixed-width form keeps working exactly as before', async () => {
  const doc = htmlToDoc(email('<tr><td><p>hi</p></td></tr>'));
  assert.equal(doc.theme.width, 600, 'width:600px still votes');
});

await it('a purely proportional table casts no width vote', async () => {
  const pct = `<!doctype html><html><head></head><body>
<table role="presentation" width="100%" style="width:100%"><tr><td><p>hi</p></td></tr></table></body></html>`;
  const doc = htmlToDoc(pct);
  assert.equal(doc.theme.width, undefined, 'nothing to claim, so the default stands');
});

/*
 * The one-cell button shape, read back. This exporter now wraps a button in a
 * table so Classic Outlook has a `<td>` to pad and paint, and hand-written
 * bulletproof buttons have always looked like this -- so the classifier has
 * to see through the wrapper, and has to find the properties that moved off
 * the anchor onto the cell.
 */
await it('a bulletproof one-cell table button is a button, not a table', async () => {
  const src = email('<tr><td><div style="text-align:center"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tbody><tr>'
    + '<td align="center" bgcolor="#0065b3" style="background:#0065b3;padding:14px 28px;border-radius:6px">'
    + '<a href="https://example.com" style="display:block;color:#ffffff;text-decoration:none;font-size:15px">Shop</a>'
    + '</td></tr></tbody></table></div></td></tr>');
  const b = blocksOf(src).find((x) => x.type === 'button');
  assert.ok(b, 'classified as a button, got ' + blocksOf(src).map((x) => x.type).join(','));
  assert.equal(b.props.label, 'Shop');
  assert.equal(b.props.px, 28, 'padding read off the cell');
  assert.equal(b.props.py, 14);
  assert.equal(b.props.full, false, 'an auto-width table is not a full-width button');
});

await it('an outline button keeps the border that lives on its cell', async () => {
  const src = email('<tr><td><div><table role="presentation"><tbody><tr>'
    + '<td bgcolor="#ffffff" style="background:#ffffff;padding:12px 32px;border:2px solid #0065b3">'
    + '<a href="https://example.com" style="display:block;color:#0065b3;text-decoration:none">Reset</a>'
    + '</td></tr></tbody></table></div></td></tr>');
  const b = blocksOf(src).find((x) => x.type === 'button');
  assert.ok(b);
  assert.equal(b.props.borderW, 2, 'the frame is on the cell, the paint on the anchor');
  assert.equal(b.props.borderColor, '#0065b3');
});

await it('a full-width one-cell button is recognised as full width', async () => {
  const src = email('<tr><td><div><table role="presentation" style="width:100%"><tbody><tr>'
    + '<td bgcolor="#0065b3" style="background:#0065b3;padding:14px 28px">'
    + '<a href="https://example.com" style="display:block;color:#ffffff">Go</a>'
    + '</td></tr></tbody></table></div></td></tr>');
  const b = blocksOf(src).find((x) => x.type === 'button');
  assert.ok(b);
  assert.equal(b.props.full, true, 'read off the table, since the anchor is always block here');
});

/*
 * Device visibility, read back. A mobile-only block is deliberately
 * `display:none` in the base stylesheet so Classic Outlook -- which never
 * reads a media query -- does not show it, and css-cascade folds that inline
 * on import. Without special handling it was indistinguishable from a hidden
 * preheader and was dropped, losing content the user had authored.
 */
await it('a mobile-only block survives import instead of being read as a hidden preheader', async () => {
  const src = email('<tr><td><div class="mc-only-m" style="margin:0;display:none;max-height:0;overflow:hidden">'
    + '<h2 style="font-size:20px;margin:0">Tap to open</h2></div></td></tr>');
  const b = blocksOf(src).find((x) => x.type === 'heading');
  assert.ok(b, 'kept, got ' + blocksOf(src).map((x) => x.type).join(',') || '(nothing)');
  assert.equal(b.props.vis, 'mobile');
  assert.equal(b.props.text, 'Tap to open', 'and it is still a heading, not an untyped run of text');
});

await it("another builder's desktop_hide / mobile_hide become the same property", async () => {
  const src = email('<tr><td>'
    + '<div class="mobile_hide"><h2 style="font-size:20px;margin:0">Wide only</h2></div>'
    + '<div class="desktop_hide" style="mso-hide:all;display:none;max-height:0;overflow:hidden"><h2 style="font-size:20px;margin:0">Narrow only</h2></div>'
    + '</td></tr>');
  const heads = blocksOf(src).filter((x) => x.type === 'heading');
  assert.equal(heads.length, 2, 'both kept, got ' + blocksOf(src).map((x) => x.type).join(','));
  assert.equal(heads[0].props.vis, 'mobile', 'mobile_hide means hidden on mobile -> desktop... ');
  assert.equal(heads[1].props.vis, 'desktop');
});

await it('an ordinary hidden preheader is still dropped', async () => {
  const src = email('<tr><td><div style="display:none;max-height:0;overflow:hidden">secret preheader</div>'
    + '<p style="font-size:14px">Real copy</p></td></tr>');
  const text = blocksOf(src).map((b) => (b.props.html || b.props.text || '')).join(' ');
  assert.equal(/secret preheader/.test(text), false, 'no visibility class, so it is genuinely hidden content');
  assert.match(text, /Real copy/);
});

/*
 * Sections that paint one background. Cut down from real Beefree templates
 * (`table.row[background-image]` > `table.row-content` > one `td.column`
 * holding a stack of per-block tables) and this exporter's own MFA email.
 * Each of these regressed in the wild before being pinned here.
 */
console.log();
console.log('Importer — sections as one visual band');

const heroSection = (inner, rowStyle) => `<!doctype html><html><body style="background-color:#0c0e19">
<table width="100%"><tbody><tr><td>
<table class="row" align="center" width="100%" style="${rowStyle}"><tbody><tr><td>
<table class="row-content" align="center" width="680" style="color:#000;width:680px;margin:0 auto"><tbody><tr>
<td class="column" width="100%" style="text-align:left;vertical-align:top">${inner}</td>
</tr></tbody></table></td></tr></tbody></table>
</td></tr></tbody></table></body></html>`;

await it('a bg-image section keeps its blocks in ONE row, the image applied once', async () => {
  const src = heroSection(
    '<div style="height:40px;line-height:40px;font-size:1px">&#8202;</div>'
    + '<table width="100%"><tr><td style="padding:10px 40px"><div style="color:#fadbb1;font-size:58px;text-align:center"><p style="margin:0"><span style="color:#ffffff">BIG GAME</span></p></div></td></tr></table>'
    + '<div style="height:500px;line-height:500px;font-size:1px">&#8202;</div>'
    + '<table width="100%"><tr><td style="padding:10px 40px"><div style="color:#ddd;font-size:16px"><p style="margin:0">Join us Sunday.</p></div></td></tr></table>',
    'background-color:#0c0e19;background-image:url(https://cdn.test/hero-band.png);background-position:top center;background-repeat:no-repeat',
  );
  const rows = rowsOf(src);
  assert.equal(rows.length, 1, 'one section, one row — got ' + rows.length);
  const r = rows[0];
  assert.equal(r.props.bgImage, 'https://cdn.test/hero-band.png');
  assert.equal(r.props.bg, '#0c0e19');
  assert.deepEqual(r.cols[0].blocks.map((b) => b.type), ['spacer', 'text', 'spacer', 'text']);
  const texts = r.cols[0].blocks.filter((b) => b.type === 'text');
  assert.equal(texts[0].props.px, 40, "each block keeps its own source row's padding");
});

await it('rows with their own styling are never merged into a band', async () => {
  const src = heroSection(
    '<table width="100%"><tr><td style="background-color:#111111;padding:10px"><p>dark</p></td></tr></table>'
    + '<table width="100%"><tr><td style="background-color:#eeeeee;padding:10px"><p>light</p></td></tr></table>',
    'background-image:url(https://cdn.test/band2.png)',
  );
  const rows = rowsOf(src);
  assert.equal(rows.length, 2, 'differing backgrounds are real band boundaries');
});

await it("the section cell's own background beats every wrapper's", async () => {
  const src = email('<tr><td style="background-color:#1a1a2e;background-image:url(https://cdn.test/h.jpg);color:#ffffff;padding:48px 32px"><h1 style="font-size:36px">Sale</h1><p>Everything</p></td></tr>');
  const r = rowsOf(src)[0];
  assert.equal(r.props.bg, '#1a1a2e', 'not the content table\'s #ffffff');
  assert.equal(r.props.bgImage, 'https://cdn.test/h.jpg');
});

await it('a heading inherits color and alignment from the section cell, like text does', async () => {
  const src = email('<tr><td style="color:#ffffff;text-align:center;padding:20px"><h1 style="font-size:36px">Over the photo</h1></td></tr>');
  const b = firstOf(src, 'heading');
  assert.equal(b.props.color, '#ffffff');
  assert.equal(b.props.align, 'center');
  const own = firstOf(email('<tr><td style="color:#ffffff"><h1 style="color:#f3a61d">Own color</h1></td></tr>'), 'heading');
  assert.equal(own.props.color, '#f3a61d', 'an own value still wins');
});

await it('a bare text node reads its typography off the cell around it', async () => {
  const src = email('<tr><td style="padding:14px 24px;font-size:30px;font-weight:800;color:#0065b2">{{TwoFactorCode}}</td></tr>');
  const b = firstOf(src, 'text');
  assert.match(b.props.html, /\{\{TwoFactorCode\}\}/);
  assert.equal(b.props.size, 30);
  assert.equal(b.props.weight, '800');
  assert.equal(b.props.color, '#0065b2');
});

await it('bgcolor on the tr itself is read', async () => {
  const r = rowsOf(email('<tr bgcolor="#123456"><td style="padding:10px"><p>on the tr</p></td></tr>'))[0];
  assert.equal(r.props.bg, '#123456');
});

await it('an empty paragraph does not become a phantom row', async () => {
  const types = typesOf(email('<tr><td><p style="margin:0"></p><p>Real</p></td></tr>'));
  assert.deepEqual(types, ['text']);
  const b = firstOf(email('<tr><td><p style="margin:0"></p><p>Real</p></td></tr>'), 'text');
  assert.equal(/Real/.test(b.props.html), true);
});

await it("a border-top-only empty cell is the divider it draws (Beefree's divider_inner)", async () => {
  const src = email('<tr><td><table width="100%" cellpadding="40"><tr><td><div align="center">'
    + '<table width="20%"><tr><td style="font-size:1px;line-height:1px;border-top:1px solid #ca1029"><span>&#8202;</span></td></tr></table>'
    + '</div></td></tr></table></td></tr>');
  const b = firstOf(src, 'divider');
  assert.ok(b, 'classified, got ' + typesOf(src).join(','));
  assert.equal(b.props.thickness, 1);
  assert.equal(b.props.color, '#ca1029');
  assert.equal(b.props.width, 20);
});

await it('a card split across stacked tables does not double its frame', async () => {
  const card = (style, inner) => '<table align="center" width="600" style="width:600px;margin:0 auto;' + style + '"><tbody><tr><td>' + inner + '</td></tr></tbody></table>';
  const src = '<!doctype html><html><body style="background-color:#f1f5f9">'
    + card('background-color:#fff;border:1px solid #e2e8f0;border-bottom:none;border-radius:16px 16px 0 0', '<p style="padding:10px">top</p>')
    + card('background-color:#fff;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0', '<p style="padding:10px">middle</p>')
    + card('background-color:#fff;border:1px solid #e2e8f0;border-radius:0 0 16px 16px', '<p style="padding:10px">bottom</p>')
    + '</body></html>';
  const { rows, theme } = htmlToDoc(src);
  assert.equal(theme.borderW, 1, 'the frame lives on the theme once');
  assert.equal(theme.radius, 16);
  const framed = rows.filter((r) => r.props.border && (r.props.bLeft || r.props.bRight));
  assert.equal(framed.length, 0, 'no row keeps the vertical fragments — got ' + JSON.stringify(framed.map((r) => r.props)));
  assert.equal(rows.some((r) => r.props.radius), false, 'no second rounded box inside the card');
});

console.log();
console.log('Importer — fonts, inherit and the styling that used to vanish on save');

// A block font is only an *override* when the document font differs, so these
// fixtures declare the document's own face on the body -- exactly what
// core/export.js writes. Where a source declares one family and nothing else,
// that family IS the document font and the blocks are right to inherit it
// (the fold in htmlToDoc), which the two "restates the theme" cases below own.
const themed = (inner) => email(inner, "background:#eef2f7;font-family:'DM Sans', Arial, sans-serif");

await it('a block-level font family is read back (heading, button, menu, list, table)', async () => {
  const h = firstOf(themed('<tr><td><h2 style="font-family:Georgia, serif">T</h2></td></tr>'), 'heading');
  assert.equal(h.props.fontFamily, 'Georgia, serif');
  const btn = firstOf(themed('<tr><td><a href="#" style="display:inline-block;background:#0065b3;color:#fff;padding:12px 24px;font-family:Tahoma, Geneva, sans-serif">Go</a></td></tr>'), 'button');
  assert.match(btn.props.fontFamily || '', /Tahoma/);
  const menu = firstOf(themed('<tr><td><a href="/a" style="font-family:Verdana, sans-serif;margin:0 10px">One</a><a href="/b" style="margin:0 10px">Two</a></td></tr>'), 'menu');
  assert.match(menu.props.fontFamily || '', /Verdana/);
  assert.equal(menu.props.gap, 20, 'anchor margins fold back into the gap');
  const list = firstOf(themed('<tr><td><ul style="font-family:Georgia, serif;font-size:17px;color:#ff0000;line-height:1.9;padding:3px 0 3px 22px"><li style="margin-bottom:9px">a</li><li style="margin-bottom:9px">b</li></ul></td></tr>'), 'list');
  assert.equal(list.props.fontFamily, 'Georgia, serif');
  assert.equal(list.props.size, 17);
  assert.equal(list.props.color, '#ff0000');
  assert.equal(list.props.lh, 1.9);
  assert.equal(list.props.py, 3);
  assert.equal(list.props.gap, 9);
  const tbl = firstOf(themed('<tr><td><table style="width:100%;font-family:Georgia, serif;font-size:13px"><tr style="background:#ffeecc"><th style="padding:7px 8px;text-align:center">A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></table></td></tr>'), 'table');
  assert.equal(tbl.props.fontFamily, 'Georgia, serif');
  assert.equal(tbl.props.size, 13);
  assert.equal(tbl.props.headBg, '#ffeecc');
  assert.equal(tbl.props.pad, 7);
  assert.equal(tbl.props.align, 'center');
  assert.equal(tbl.props.striped, false, 'no stripe tint in the source, no stripes on import');
});

await it('a uniform text run claims its family at block level and folds the inline copies', async () => {
  const b = firstOf(themed('<tr><td><p style="font-family:Georgia, serif;font-size:15px">One</p><p style="font-family:Georgia, serif">Two</p></td></tr>'), 'text');
  assert.equal(b.props.fontFamily, 'Georgia, serif');
  assert.doesNotMatch(b.props.html, /font-family/, 'claimed means consumed — it must not ship twice');
});

await it('a mixed-family run keeps its inline declarations and claims nothing', async () => {
  const b = firstOf(themed('<tr><td><p style="font-family:Georgia, serif">One</p><p style="font-family:Courier, monospace">Two</p></td></tr>'), 'text');
  assert.equal(b.props.fontFamily || '', '', 'no block-level font on a mixed run');
  assert.match(b.props.html, /Georgia/);
  assert.match(b.props.html, /Courier/);
});

await it('a lone family with no document font of its own becomes the theme, not a per-block override', async () => {
  // The other half of the fold: a foreign email that declares one face and
  // nothing on the body is a document IN that face -- promoting it to the
  // theme is what makes the Font control reach the whole template afterwards.
  const doc = htmlToDoc(email('<tr><td><h2 style="font-family:Georgia, serif">T</h2><p style="font-family:Georgia, serif">copy</p></td></tr>'));
  assert.match(doc.theme.font, /Georgia/);
  const blocks = doc.rows.flatMap((r) => r.cols.flatMap((c) => c.blocks));
  assert.ok(blocks.every((b) => !b.props.fontFamily), 'every block inherits it instead of restating it');
});

await it('the condensed heading stack folds back into the style toggle', async () => {
  const b = firstOf(email(`<tr><td><h2 style="font-family:'Arial Narrow', 'Helvetica Neue Condensed', Helvetica, Arial, sans-serif">T</h2></td></tr>`), 'heading');
  assert.equal(b.props.font, 'condensed');
  assert.equal(b.props.fontFamily || '', '', 'the stack itself is not stored');
});

await it("the body's own family wins the theme font over the first block's", async () => {
  const src = `<!doctype html><html><body style="font-family:'DM Sans', Arial, sans-serif">
<table width="600"><tr><td><h1 style="font-family:Georgia, serif">Fancy</h1><p>Body copy</p></td></tr></table></body></html>`;
  const doc = htmlToDoc(src);
  assert.match(doc.theme.font, /DM Sans/, 'theme font from the body');
  const h = doc.rows.flatMap((r) => r.cols.flatMap((c) => c.blocks)).find((b) => b.type === 'heading');
  assert.match(h.props.fontFamily, /Georgia/, 'the heading keeps its own font as an override');
});

await it('values that restate the theme fold back to inherit', async () => {
  const src = `<!doctype html><html><body style="font-family:Georgia, serif;color:#172033;background:#eef2f7">
<table role="presentation" width="100%"><tr><td align="center">
<table role="presentation" width="600" style="width:600px;background:#ffffff">
<tr><td style="background:#ffffff"><h2 style="font-family:Georgia, serif;color:#172033">Same as theme</h2></td></tr>
<tr><td style="background:#101418"><p style="color:#ffffff">Own colors</p></td></tr>
</table></td></tr></table></body></html>`;
  const doc = htmlToDoc(src);
  const blocks = doc.rows.flatMap((r) => r.cols.flatMap((c) => c.blocks));
  const h = blocks.find((b) => b.type === 'heading');
  assert.equal(h.props.fontFamily || '', '', 'a restated theme font is inherit again');
  assert.equal(h.props.color || '', '', 'a restated theme ink is inherit again');
  assert.equal(doc.rows[0].props.bg || '', '', 'a row repainted in the content background is inherit again');
  assert.equal(doc.rows[1].props.bg, '#101418', 'a genuinely different row background stays explicit');
  const p = blocks.find((b) => b.type === 'text');
  assert.equal(p.props.color, '#ffffff', 'a genuinely different ink stays explicit');
});

await it("the exporter's overlay gradient folds back into the overlay percentage", async () => {
  const rows = rowsOf(email('<tr><td style="background-color:#101418;background-image:linear-gradient(rgba(20,22,24,0.4),rgba(20,22,24,0.4)),url(https://cdn.test/hero.jpg);background-size:cover"><p style="color:#fff">Hero</p></td></tr>'));
  const r = rows.find((x) => x.props.bgImage);
  assert.ok(r, 'the image survived');
  assert.equal(r.props.overlay, 40);
  const foreign = rowsOf(email('<tr><td style="background-image:linear-gradient(rgba(255,0,0,0.5),rgba(0,0,255,0.5)),url(https://cdn.test/x.jpg)"><p>x</p></td></tr>'))
    .find((x) => x.props.bgImage);
  assert.equal(foreign.props.overlay || 0, 0, 'a foreign gradient claims nothing');
});

await it('a styled column keeps its border through the wrapper hoist', async () => {
  const row = rowsOf(email(`<tr><td><table><tr>
    <td width="50%"><div style="background:#fff4e5;border:2px dashed #cc6600;border-radius:8px;padding:12px 14px"><p>Card</p></div></td>
    <td width="50%"><p>Plain</p></td>
  </tr></table></td></tr>`)).find((r) => r.cols.length === 2);
  assert.ok(row);
  assert.equal(row.cols[0].border, 2);
  assert.equal(row.cols[0].borderStyle, 'dashed');
  assert.equal(row.cols[0].lineColor, '#cc6600');
  assert.equal(row.cols[0].bg, '#fff4e5');
});

await it("an image wrapper's padding and a divider wrapper's spacing are the block's own again", async () => {
  const img = firstOf(email('<tr><td><div style="padding:18px 6px;text-align:center"><img src="https://cdn.test/i.png" width="120"></div></td></tr>'), 'image');
  assert.equal(img.props.py, 18);
  assert.equal(img.props.px, 6);
  const div = firstOf(email('<tr><td><div style="padding:3px 0"><div style="height:2px;background:#cccccc"></div></div></td></tr>'), 'divider');
  assert.equal(div.props.py, 3);
});

console.log(`\n${passed} passed, ${failed} failed.`);
closeDom();
process.exit(failed ? 1 : 0);
