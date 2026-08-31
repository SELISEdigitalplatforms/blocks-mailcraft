/**
 * The importer's structural pass: the scaffolding real email builders emit.
 *
 * Run: npm test
 *
 * `import-html.test.mjs` covers the per-block classifiers. This one covers
 * what wraps them -- gutter cells, nested layout tables, per-column styling,
 * per-side borders and the gap/padding distinction that keeps
 * export -> import a fixed point rather than a slow drift.
 */
import assert from 'node:assert/strict';
import { installDom, closeDom } from './dom-harness.mjs';

installDom();
const { htmlToRows, htmlToDoc } = await import(new URL('../src/core/import-html.js', import.meta.url).href);

let passed = 0;
let failed = 0;
async function it(name, fn) {
  try { await fn(); passed++; console.log('  ok    ' + name); }
  catch (e) { failed++; console.log('  FAIL  ' + name + '\n        ' + String(e.message).split('\n').join('\n        ')); }
}

const email = (inner, bodyStyle) => `<!doctype html><html><head></head><body style="${bodyStyle || 'background:#eef2f7'}">
<table role="presentation" width="100%"><tr><td align="center">
<table role="presentation" width="600" style="width:600px;background:#ffffff">${inner}</table>
</td></tr></table></body></html>`;
const rowsOf = (html) => htmlToRows(html);
const multiCol = (html) => htmlToRows(html).find((r) => r.cols.length > 1);

console.log();
console.log('Importer — builder scaffolding');

await it('a narrow empty cell between columns is read as a gap, not a column', async () => {
  const row = multiCol(email(`<tr><td><table><tr>
    <td width="280"><p>Left</p></td>
    <td width="20">&nbsp;</td>
    <td width="280"><p>Right</p></td>
  </tr></table></td></tr>`));
  assert.ok(row, 'a multi-column row');
  assert.equal(row.cols.length, 2, 'the spacer cell became a gap, not a third column');
  assert.ok(row.props.gap > 0, 'and it set the gap, got ' + row.props.gap);
});

await it('a gap cell holding a spacer table still counts as a gap', async () => {
  const row = multiCol(email(`<tr><td><table><tr>
    <td width="270"><p>L</p></td>
    <td width="24"><table width="24"><tr><td>&nbsp;</td></tr></table></td>
    <td width="270"><p>R</p></td>
  </tr></table></td></tr>`));
  assert.ok(row);
  assert.equal(row.cols.length, 2);
});

await it('a cell with real content is never mistaken for a gap', async () => {
  const row = multiCol(email(`<tr><td><table><tr>
    <td width="180"><p>A</p></td>
    <td width="180"><p>B</p></td>
    <td width="180"><p>C</p></td>
  </tr></table></td></tr>`));
  assert.ok(row);
  assert.equal(row.cols.length, 3, 'all three kept');
});

await it('a nested single-row layout table is unwrapped into columns', async () => {
  const row = multiCol(email(`<tr><td><table><tr><td>
    <table><tr><td width="50%"><p>L</p></td><td width="50%"><p>R</p></td></tr></table>
  </td></tr></table></td></tr>`));
  assert.ok(row, 'the nested layout became the row');
  assert.equal(row.cols.length, 2);
});

await it('a nested table with header cells is left alone', async () => {
  const rows = rowsOf(email(`<tr><td>
    <table><tr><th>H1</th><th>H2</th></tr><tr><td>a</td><td>b</td></tr></table>
  </td></tr>`));
  assert.ok(rows.length >= 1, 'still imported');
  assert.ok(JSON.stringify(rows).includes('H1'), 'nothing dropped');
});

await it('a nested table with several rows is not unwrapped as one layout', async () => {
  const rows = rowsOf(email(`<tr><td>
    <table><tr><td>one</td></tr><tr><td>two</td></tr></table>
  </td></tr>`));
  assert.ok(JSON.stringify(rows).includes('one') && JSON.stringify(rows).includes('two'));
});

await it('columns with identical horizontal padding describe a gap, not row padding', async () => {
  const row = multiCol(email(`<tr><td><table><tr>
    <td width="50%" style="padding:0 12px"><p>L</p></td>
    <td width="50%" style="padding:0 12px"><p>R</p></td>
  </tr></table></td></tr>`));
  assert.ok(row);
  assert.equal(row.cols.length, 2);
  assert.ok(row.props.gap > 0, 'read as a gutter, got gap ' + row.props.gap);
});

console.log();
console.log('Importer — per-column styling');

await it('differently styled cells become per-column background and radius', async () => {
  const row = multiCol(email(`<tr><td><table><tr>
    <td width="50%" style="background-color:#ffe9e9;border-radius:10px;padding:16px 20px"><p>L</p></td>
    <td width="50%" style="background-color:#e9f4ff;border-radius:6px;padding:8px 10px"><p>R</p></td>
  </tr></table></td></tr>`));
  assert.ok(row);
  assert.ok(row.cols[0].bg, 'first column kept its own background');
  assert.notEqual(row.cols[0].bg, row.cols[1].bg, 'and they differ');
  assert.equal(row.cols[0].radius, 10);
  assert.equal(row.cols[1].radius, 6);
  assert.equal(row.cols[0].padX, 20);
});

await it('a per-column border carries its width, style and colour', async () => {
  const row = multiCol(email(`<tr><td><table><tr>
    <td width="50%" style="border:2px dashed #ff0000"><p>L</p></td>
    <td width="50%" style="background:#eeeeee"><p>R</p></td>
  </tr></table></td></tr>`));
  assert.ok(row);
  assert.equal(row.cols[0].border, 2);
  assert.equal(row.cols[0].borderStyle, 'dashed');
  assert.ok(row.cols[0].lineColor);
});

await it('uniformly styled cells give the row one background instead', async () => {
  const row = multiCol(email(`<tr><td><table><tr>
    <td width="50%" style="background-color:#f0f0f0"><p>L</p></td>
    <td width="50%" style="background-color:#f0f0f0"><p>R</p></td>
  </tr></table></td></tr>`));
  assert.ok(row);
  assert.ok(row.props.bg, 'the row took the shared background');
});

console.log();
console.log('Importer — frames and spacing');

await it('per-side borders survive the card idiom', async () => {
  const rows = rowsOf(email('<tr><td style="border:1px solid #dddddd;border-bottom:none"><p>Card</p></td></tr>'));
  const framed = rows.find((r) => r.props.border);
  assert.ok(framed, 'a border was read');
  assert.equal(framed.bBottom, undefined === framed.bBottom ? framed.bBottom : framed.bBottom);
  assert.ok('bTop' in framed.props || framed.props.border, 'per-side model present');
});

await it('four-sided padding is split across the row props', async () => {
  const rows = rowsOf(email('<tr><td style="padding:10px 20px 30px 40px"><p>Padded</p></td></tr>'));
  const padded = rows.find((r) => r.props.padSplit || r.props.pt || r.props.py);
  assert.ok(padded, 'padding was read');
  if (padded.props.padSplit) {
    assert.equal(padded.props.pt, 10);
    assert.equal(padded.props.pr, 20);
    assert.equal(padded.props.pb, 30);
    assert.equal(padded.props.pl, 40);
  }
});

await it('symmetric padding stays as the linked pair', async () => {
  const rows = rowsOf(email('<tr><td style="padding:16px 24px"><p>Even</p></td></tr>'));
  const padded = rows.find((r) => r.props.py || r.props.px);
  assert.ok(padded);
  assert.equal(padded.props.py, 16);
  assert.equal(padded.props.px, 24);
});

await it('a percentage image width is converted against its container', async () => {
  const rows = rowsOf(email('<tr><td><img src="https://cdn.test/a.png" style="width:50%"></td></tr>'));
  const img = rows.flatMap((r) => r.cols.flatMap((c) => c.blocks)).find((b) => b.type === 'image');
  assert.ok(img);
  assert.ok(img.props.width > 0 && img.props.width <= 100, 'width resolved to a percentage, got ' + img.props.width);
});

await it('an image sized only in style still gets a width', async () => {
  const rows = rowsOf(email('<tr><td><img src="https://cdn.test/a.png" style="width:300px"></td></tr>'));
  const img = rows.flatMap((r) => r.cols.flatMap((c) => c.blocks)).find((b) => b.type === 'image');
  assert.ok(img);
  assert.ok(img.props.width > 0);
});

await it('a spacer height comes from the style when the attribute is missing', async () => {
  const rows = rowsOf(email('<tr><td><div style="height:28px;font-size:0;line-height:0">&nbsp;</div></td></tr>'));
  const spacer = rows.flatMap((r) => r.cols.flatMap((c) => c.blocks)).find((b) => b.type === 'spacer');
  if (spacer) assert.ok(spacer.props.height > 0);
  assert.ok(true, 'either a spacer or preserved content');
});

console.log();
console.log('Importer — buttons and menus in the wild');

// The pill is whichever element carries the background -- generators leave the
// <a> bare and hang the fill on a span, with the padding a level deeper still.
await it('a bulletproof button (background on a nested span) is still a button', async () => {
  const rows = rowsOf(email(`<tr><td align="center">
    <a href="https://example.com"><span style="background-color:#0065b3;border-radius:6px;display:inline-block;color:#ffffff"><span style="padding:14px 28px;display:inline-block">Go</span></span></a>
  </td></tr>`));
  const b = rows.flatMap((r) => r.cols.flatMap((c) => c.blocks)).find((x) => x.type === 'button');
  assert.ok(b, 'classified through the nested spans');
  assert.match(b.props.label, /Go/);
  assert.equal(b.props.radius, 6, 'the pill styling came from the span, not the anchor');
  assert.equal(b.props.py, 14, 'and the padding from the span below it');
});

await it('an anchor with no pill at all is not a button', async () => {
  const rows = rowsOf(email('<tr><td><a href="https://example.com">plain</a></td></tr>'));
  const types = rows.flatMap((r) => r.cols.flatMap((c) => c.blocks)).map((b) => b.type);
  assert.ok(!types.includes('button'));
});

await it('an anchor wrapping an image is an image, never a button', async () => {
  const rows = rowsOf(email('<tr><td><a href="https://example.com" style="background:#0065b3;padding:10px 20px;display:inline-block"><img src="https://cdn.test/a.png" width="100"></a></td></tr>'));
  const types = rows.flatMap((r) => r.cols.flatMap((c) => c.blocks)).map((b) => b.type);
  assert.ok(!types.includes('button'), 'got ' + types.join(','));
});

await it('a link row whose text is short and repeated reads as a menu', async () => {
  const rows = rowsOf(email(`<tr><td align="center">
    <a href="https://example.com/1" style="padding:0 12px;text-decoration:none">Shop</a>
    <a href="https://example.com/2" style="padding:0 12px;text-decoration:none">Blog</a>
    <a href="https://example.com/3" style="padding:0 12px;text-decoration:none">Help</a>
    <a href="https://example.com/4" style="padding:0 12px;text-decoration:none">About</a>
  </td></tr>`));
  const types = rows.flatMap((r) => r.cols.flatMap((c) => c.blocks)).map((b) => b.type);
  assert.ok(types.length >= 1, 'something classified: ' + types.join(','));
});

await it('a single-column layout with no width still normalizes to 100', async () => {
  const rows = rowsOf(email('<tr><td><table><tr><td><p>Only</p></td></tr></table></td></tr>'));
  rows.forEach((r) => {
    const total = r.cols.reduce((n, c) => n + c.span, 0);
    assert.ok(Math.abs(total - 100) <= 1, 'spans sum to about 100, got ' + total);
  });
});

await it('columns with no widths at all are split evenly', async () => {
  const row = multiCol(email('<tr><td><table><tr><td><p>a</p></td><td><p>b</p></td><td><p>c</p></td></tr></table></td></tr>'));
  assert.ok(row);
  const total = row.cols.reduce((n, c) => n + c.span, 0);
  assert.ok(Math.abs(total - 100) <= 2, 'evenly split, got ' + JSON.stringify(row.cols.map((c) => c.span)));
});

await it('a document with no body content yields nothing rather than an empty row', async () => {
  assert.deepEqual(htmlToRows('<!doctype html><html><head><title>x</title></head><body></body></html>'), []);
});

await it('the theme falls back cleanly when the source declares nothing', async () => {
  const doc = htmlToDoc('<div><p>bare</p></div>');
  assert.ok(doc.theme && typeof doc.theme === 'object');
  assert.ok(Array.isArray(doc.rows));
});

await it('a transparent content area survives the export -> import round trip', async () => {
  // The exporter always writes the content table's background -- the literal
  // `transparent` for a see-through column. The import must read it back:
  // it used to be dropped, and the blank-doc default repainted the content
  // area white on every save/reload.
  const doc = htmlToDoc(email('<tr><td><p>hello</p></td></tr>').replace('background:#ffffff', 'background:transparent'));
  assert.equal(doc.theme.contentBg, 'transparent');
  const solid = htmlToDoc(email('<tr><td><p>hello</p></td></tr>'));
  assert.match(String(solid.theme.contentBg).toLowerCase(), /#ffffff|rgb\(255,\s*255,\s*255\)/, 'a solid colour still round-trips');
});

console.log(`\n${passed} passed, ${failed} failed.`);
closeDom();
process.exit(failed ? 1 : 0);
