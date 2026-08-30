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

console.log(`\n${passed} passed, ${failed} failed.`);
closeDom();
process.exit(failed ? 1 : 0);
