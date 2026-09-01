/**
 * Round-trip fidelity: every inspector control survives save -> reload.
 *
 * Run: npm test
 *
 * The host-facing persistence contract is HTML in, HTML out -- a draft is
 * saved as `exportHtml()` and restored by importing that HTML back. So for
 * every control the inspector offers, the exported markup must carry the
 * value and the importer must read it back: any gap in that pair is a prop
 * that silently reverts to its default on reload. One assertion per control,
 * plus the two properties that keep the whole loop honest: the export of a
 * reloaded document is byte-identical to the export it was loaded from
 * (convergence), and no block type is ever silently dropped (degradation
 * floor -- worst case is a raw html block, never nothing).
 *
 * The fidelity-marker layer (data-mc*, core/export.js) carries the few
 * blocks whose rendered shape cannot be read back -- countdown, video,
 * section box, code, raw CSS, flex/grid rows, `mobileCols:'keep'`. The one
 * remaining lossy mode is opted into: `exportHtml({ markers: false })`
 * ships pristine HTML and accepts the degradation floor below on reload.
 */
import assert from 'node:assert/strict';
import { installDom, mountEditor, settle } from './dom-harness.mjs';

installDom();
await import(new URL('../src/index.js', import.meta.url).href);
const { blk, mkRow } = await import(new URL('../src/core/blocks.js', import.meta.url).href);

let passed = 0;
let failed = 0;
async function it(name, fn) {
  try { await fn(); passed++; console.log('  ok    ' + name); }
  catch (e) { failed++; console.log('  FAIL  ' + name + '\n        ' + String(e.message).split('\n').join('\n        ')); }
}

const row = (blocks, props, spans) => {
  const r = mkRow(spans || [100]);
  if (props) Object.assign(r.props, props);
  r.cols[0].blocks = Array.isArray(blocks) ? blocks : [blocks];
  return r;
};

/**
 * The probe document: every round-trippable block type with every inspector
 * control moved OFF its default, so a revert is always detectable. Fonts are
 * chosen distinct from the theme font on purpose -- a block font equal to the
 * theme's folds back to inherit (by design), which would hide a loss here.
 */
function probeDoc(base) {
  const rows = [];
  rows.push(row(
    blk('text', { html: 'Probe text', size: 21, lh: 1.9, color: '#123456', align: 'right', weight: '700', py: 17, px: 9, fontFamily: 'Tahoma, Geneva, sans-serif', vis: 'mobile' }),
    { bg: '#f0e0d0', radius: 9, border: 2, borderStyle: 'dashed', lineColor: '#334455', bBottom: false, shadow: '0 2px 8px rgba(23,32,51,0.08)', py: 31, px: 17, valign: 'middle', mt: 12, mb: 18, maxW: 90 }));
  rows.push(row(
    blk('image', { src: 'https://e.com/i.png', alt: 'Alt probe', width: 47, align: 'right', href: 'https://e.com/l', radius: 3, py: 7, px: 5 }),
    { bgImage: 'https://e.com/bg.jpg', overlay: 40, bgSize: 'contain', bgPos: 'left top', bgRepeat: 'repeat' }));
  rows.push(row(blk('button', { label: 'Probe CTA', href: 'https://e.com/b', bg: '#22aa55', color: '#111111', radius: 21, py: 9, px: 33, align: 'center', size: 19, borderW: 2, borderStyle: 'dashed', borderColor: '#ff0000', fontFamily: 'Verdana, Geneva, sans-serif' })));
  rows.push(row(blk('divider', { thickness: 3, lineStyle: 'dotted', color: '#aa00aa', width: 55, py: 3 })));
  rows.push(row(blk('spacer', { height: 77 })));
  rows.push(row(blk('social', { align: 'left', size: 26, gap: 18, color: '#aa2244', shape: 'outline', showLabel: false })));
  rows.push(row(blk('social', { shape: 'bare', showLabel: true, palette: 'brand' })));
  rows.push(row(blk('menu', { items: 'One|https://e.com/1\nTwo|https://e.com/2', align: 'right', size: 14, gap: 34, color: '#224466', fontFamily: 'Verdana, Geneva, sans-serif' })));
  rows.push(row(blk('heading', { text: 'Probe head', level: 'h3', size: 27, lh: 1.35, align: 'center', color: '#654321', weight: '700', py: 3, px: 6, fontFamily: 'Georgia, "Times New Roman", serif' })));
  rows.push(row(blk('heading', { text: 'Condensed head', font: 'condensed' })));
  rows.push(row(blk('list', { items: 'alpha\nbeta', ordered: true, size: 18, lh: 2, color: '#0000cc', gap: 11, py: 5, fontFamily: 'Georgia, "Times New Roman", serif' })));
  rows.push(row(blk('table', { data: 'A|B\n1|2\n3|4', header: true, borders: true, borderWidth: 2, borderStyle: 'dashed', striped: false, pad: 6, size: 12, headBg: '#ddeeff', lineColor: '#ff8800', align: 'center', width: 80, fontFamily: 'Georgia, "Times New Roman", serif' })));
  rows.push(row(blk('svg', { align: 'center', width: 60, py: 4 })));
  rows.push(row(blk('html', { code: '<p style="margin:0">raw-html-probe</p>' })));
  rows.push(row(blk('condition', { expr: 'is_probe', end: false }), { py: 4, px: 0, gap: 0 }));
  rows.push(row(blk('text', { html: 'conditional body' })));
  rows.push(row(blk('condition', { expr: '', end: true }), { py: 4, px: 0, gap: 0 }));
  const two = mkRow([40, 60]);
  Object.assign(two.props, { gap: 28, valign: 'middle', mobileCols: 2, mobileOrder: 'reverse' });
  two.cols[0].blocks = [blk('text', { html: 'left col' })];
  two.cols[1].blocks = [blk('text', { html: 'right col' })];
  Object.assign(two.cols[0], { bg: '#ffeeee', radius: 7, padY: 9, padX: 11 });
  Object.assign(two.cols[1], { border: 2, borderStyle: 'dashed', lineColor: '#5500aa' });
  rows.push(two);
  const doc = base;
  doc.rows = rows;
  Object.assign(doc.theme, { font: '"Trebuchet MS", Helvetica, sans-serif', text: '#223344', bg: '#e0e0f0', contentBg: '#fffff0', width: 620, radius: 6, borderW: 1, shadow: '0 2px 8px rgba(23,32,51,0.08)', padY: 30, padX: 20, link: '#cc0066' });
  return doc;
}

console.log();
console.log('Round trip — every inspector control through exportHtml -> importHtml');

const el = await mountEditor();
el.setContent(probeDoc(el.getContent()));
await settle(3);
const sent = el.getContent();
const html1 = el.exportHtml();
el.importHtml(html1);
await settle(3);
const got = el.getContent();
const blocks = got.rows.flatMap((r) => r.cols.flatMap((c) => c.blocks));
const one = (type, skip) => blocks.filter((b) => b.type === type)[skip || 0];

await it('text: html, size, lh, color, align, weight, py/px, font, visibility', async () => {
  const b = one('text');
  assert.match(b.props.html, /Probe text/);
  assert.equal(b.props.size, 21);
  assert.equal(b.props.lh, 1.9);
  assert.equal(b.props.color, '#123456');
  assert.equal(b.props.align, 'right');
  assert.equal(b.props.weight, '700');
  assert.equal(b.props.py, 17);
  assert.equal(b.props.px, 9);
  assert.match(b.props.fontFamily, /Tahoma/);
  assert.equal(b.props.vis, 'mobile');
});

await it('image: src, alt, link, width (on the anchor!), align, radius, py/px', async () => {
  const b = one('image');
  assert.equal(b.props.src, 'https://e.com/i.png');
  assert.equal(b.props.alt, 'Alt probe');
  assert.equal(b.props.href, 'https://e.com/l');
  assert.equal(b.props.width, 47, 'the % width lives on the wrapping <a>');
  assert.equal(b.props.align, 'right');
  assert.equal(b.props.radius, 3);
  assert.equal(b.props.py, 7);
  assert.equal(b.props.px, 5);
});

await it('button: label, href, colors as hex, radius, pill padding, size, outline, font', async () => {
  const b = one('button');
  assert.equal(b.props.label, 'Probe CTA');
  assert.equal(b.props.href, 'https://e.com/b');
  assert.match(b.props.bg, /^#22aa55$/i, 'CSSOM hands back rgb(); hexOf folds it');
  assert.match(b.props.color, /^#111111$/i);
  assert.equal(b.props.radius, 21);
  assert.equal(b.props.py, 9);
  assert.equal(b.props.px, 33);
  assert.equal(b.props.align, 'center');
  assert.equal(b.props.size, 19);
  assert.equal(b.props.borderW, 2);
  assert.equal(b.props.borderStyle, 'dashed');
  assert.match(b.props.borderColor, /^#ff0000$/i);
  assert.match(b.props.fontFamily, /Verdana/);
});

await it('divider: thickness, line style, color as hex, width, spacing (a set 3px stays 3px)', async () => {
  const b = one('divider');
  assert.equal(b.props.thickness, 3);
  assert.equal(b.props.lineStyle, 'dotted');
  assert.match(b.props.color, /^#aa00aa$/i);
  assert.equal(b.props.width, 55);
  assert.equal(b.props.py, 3);
});

await it('spacer: height', async () => {
  assert.equal(one('spacer').props.height, 77);
});

await it('social: shape survives (transparent is not a fill), gap, size, color, align', async () => {
  const b = one('social');
  assert.equal(b.props.shape, 'outline', 'the renderer writes background:transparent on non-badge anchors; that is not a painted square');
  assert.equal(b.props.gap, 18, 'anchor margins, not the row gutter');
  assert.equal(b.props.size, 26);
  assert.match(b.props.color, /^#aa2244$/i);
  assert.equal(b.props.align, 'left');
  assert.equal(b.props.showLabel, false);
});

await it('social: a labeled brand strip is still a social block, not a menu', async () => {
  const b = one('social', 1);
  assert.ok(b, 'second strip survived as social');
  assert.equal(b.props.showLabel, true, 'network names inside the anchors are labels, not prose');
  assert.equal(b.props.palette, 'brand', 'per-network colors can only mean the brand palette');
  assert.equal(b.props.shape, 'bare');
});

await it('menu: items, align, size, item gap, color as hex, font', async () => {
  const b = one('menu');
  assert.equal(b.props.items, 'One|https://e.com/1\nTwo|https://e.com/2');
  assert.equal(b.props.align, 'right');
  assert.equal(b.props.size, 14);
  assert.equal(b.props.gap, 34);
  assert.match(b.props.color, /^#224466$/i);
  assert.match(b.props.fontFamily, /Verdana/);
});

await it('heading: level, size, line spacing, align, color, weight, padding, font', async () => {
  const b = one('heading');
  assert.equal(b.props.level, 'h3');
  assert.equal(b.props.size, 27);
  assert.equal(b.props.lh, 1.35, 'px line-height snaps back to the slider ratio');
  assert.equal(b.props.align, 'center');
  assert.match(b.props.color, /^#654321$/i);
  assert.equal(b.props.weight, '700');
  assert.equal(b.props.py, 3);
  assert.equal(b.props.px, 6);
  assert.match(b.props.fontFamily, /Georgia/);
});

await it('heading: the Condensed style toggle folds back from its stack', async () => {
  const b = one('heading', 1);
  assert.equal(b.props.font, 'condensed');
  assert.equal(b.props.fontFamily || '', '', 'the stack itself is not stored');
});

await it('list: items, ordered, size, line spacing, ink, item gap, spacing, font', async () => {
  const b = one('list');
  assert.equal(b.props.items, 'alpha\nbeta');
  assert.equal(b.props.ordered, true);
  assert.equal(b.props.size, 18);
  assert.equal(b.props.lh, 2);
  assert.match(b.props.color, /^#0000cc$/i);
  assert.equal(b.props.gap, 11);
  assert.equal(b.props.py, 5);
  assert.match(b.props.fontFamily, /Georgia/);
});

await it('table: data, header, borders, stripes OFF stays off, pad, size, tints, align, width, font', async () => {
  const b = one('table');
  assert.equal(b.props.data, 'A|B\n1|2\n3|4');
  assert.equal(b.props.header, true);
  assert.equal(b.props.borders, true);
  assert.equal(b.props.borderWidth, 2);
  assert.equal(b.props.borderStyle, 'dashed');
  assert.equal(b.props.striped, false);
  assert.equal(b.props.pad, 6);
  assert.equal(b.props.size, 12);
  assert.match(b.props.headBg, /^#ddeeff$/i);
  assert.match(b.props.lineColor, /^#ff8800$/i);
  assert.equal(b.props.align, 'center');
  assert.equal(b.props.width, 80);
  assert.match(b.props.fontFamily, /Georgia/);
});

await it('svg: the block survives with its drawing, width, align and spacing', async () => {
  const b = one('svg');
  assert.ok(b, 'an svg block used to vanish -- row and all');
  assert.match(b.props.code, /<rect/);
  assert.equal(b.props.width, 60, 'the width span the export now ships');
  assert.equal(b.props.align, 'center');
  assert.equal(b.props.py, 4);
});

await it('html block: its content passes through', async () => {
  // A simple fragment legitimately reads back as the text block it looks
  // like; the floor is that the content itself always survives.
  assert.match(JSON.stringify(got), /raw-html-probe/);
});

await it('dynamic-content markers: expr and end survive in order', async () => {
  const seq = blocks.filter((b) => b.type === 'condition');
  assert.equal(seq.length, 2);
  assert.equal(seq[0].props.expr, 'is_probe');
  assert.equal(seq[0].props.end, false);
  assert.equal(seq[1].props.end, true);
});

await it('row: bg, frame with a side off, radius, shadow, padding, valign, outside margins', async () => {
  const r = got.rows[0].props;
  assert.match(r.bg, /^#f0e0d0$/i);
  assert.equal(r.radius, 9);
  assert.equal(r.border, 2);
  assert.equal(r.borderStyle, 'dashed');
  assert.match(r.lineColor, /^#334455$/i);
  assert.equal(r.bBottom, false, 'the switched-off bottom side stays off');
  assert.match(r.shadow, /rgba\(23,\s*32,\s*51/);
  assert.equal(r.py, 31);
  assert.equal(r.px, 17);
  assert.equal(r.valign, 'middle');
  assert.equal(r.mt, 12, 'outside margins ride a wrapper div mail clients honour, and read back');
  assert.equal(r.mb, 18);
  assert.equal(r.maxW, 90, 'Max width ships as the wrapper cap and reads back');
});

await it('row: background image with overlay, fit, position and repeat', async () => {
  const r = got.rows[1].props;
  assert.equal(r.bgImage, 'https://e.com/bg.jpg');
  assert.equal(r.overlay, 40, "the exporter's own gradient signature folds back to the percentage");
  assert.equal(r.bgSize, 'contain');
  assert.equal(r.bgPos, 'left top');
  assert.equal(r.bgRepeat, 'repeat');
});

await it('row: single-column rows keep their gutter (gap)', async () => {
  // Every cell ships `padding:0 gap/2` -- one column or four; and a social
  // strip's refused table-unwrap must not hide its gap cell either.
  assert.equal(got.rows[2].props.gap, 20, 'button row');
  assert.equal(got.rows[5].props.gap, 20, 'social row');
  assert.equal(got.rows[11].props.gap, 20, 'table row');
});

await it('columns: spans, background, radius, inner padding, border -- through export AND normalizeDoc', async () => {
  const r = got.rows[got.rows.length - 1];
  assert.equal(r.cols.length, 2);
  assert.equal(r.cols[0].span, 40);
  assert.equal(r.cols[1].span, 60);
  assert.match(r.cols[0].bg, /^#ffeeee$/i);
  assert.equal(r.cols[0].radius, 7);
  assert.equal(r.cols[0].padY, 9);
  assert.equal(r.cols[0].padX, 11);
  assert.equal(r.cols[1].border, 2);
  assert.equal(r.cols[1].borderStyle, 'dashed');
  assert.match(r.cols[1].lineColor, /^#5500aa$/i);
  assert.equal(r.props.gap, 28);
  assert.equal(r.props.valign, 'middle');
});

await it('row: explicit mobile modes (two-up, reverse) come back off their classes', async () => {
  const r = got.rows[got.rows.length - 1].props;
  assert.equal(String(r.mobileCols), '2');
  assert.equal(r.mobileOrder, 'reverse');
});

await it('theme: every canvas setting survives, and link is not hijacked by menu items', async () => {
  const t = got.theme;
  assert.match(t.font, /Trebuchet/);
  assert.match(t.text, /^#223344$/i);
  assert.match(t.bg, /^#e0e0f0$/i);
  assert.match(t.contentBg, /^#fffff0$/i);
  assert.equal(t.width, 620);
  assert.equal(t.radius, 6);
  assert.equal(t.borderW, 1);
  assert.match(t.shadow, /rgba\(23,\s*32,\s*51/);
  assert.equal(t.padY, 30);
  assert.equal(t.padX, 20);
  assert.match(t.link, /^#cc0066$/i, 'menu anchors no longer outvote the document link color');
});

await it('inherit-ness: values that restate the theme come back as inherit, not stamped', async () => {
  // Untouched blocks in the probe (the two-column texts) inherit everything.
  const plain = got.rows[got.rows.length - 1].cols[0].blocks[0];
  assert.equal(plain.props.fontFamily || '', '', 'no stamped theme font');
  assert.equal(plain.props.color || '', '', 'no stamped theme ink');
});

await it('marked blocks keep their identity: countdown, video, box, code, raw CSS', async () => {
  // Their rendered shapes are unreadable (a countdown bakes its digits, a
  // video is a linked image, ...), so the export stamps data-mc/data-mcp and
  // the importer trusts the marker -- content still read from the DOM and
  // sanitized like any import.
  const el2 = await mountEditor();
  const doc = el2.getContent();
  doc.rows = [
    row(blk('countdown', { target: '2027-01-01T00:00', label: 'Ends probe', color: '#004488', fontFamily: 'Tahoma, Geneva, sans-serif' })),
    row(blk('video', { src: 'https://e.com/v.png', href: 'https://e.com/watch', caption: 'Cap probe', badge: '#ff2200' })),
    row(blk('box', { html: '<strong style="font-size:19px;display:block;margin-bottom:6px">Title</strong>Body', bg: '#eeffee', border: 2, borderStyle: 'dotted', lineColor: '#00aa00', radius: 5, pad: 12, align: 'center', maxW: 80, shadow: true })),
    row(blk('codeblock', { code: 'echo "probe" && exit', bg: '#101010', color: '#eeeeee', size: 11, pad: 9 })),
    row(blk('css', { code: '.mc-note{color:#ff0000}', note: 'Note probe' })),
  ];
  el2.setContent(doc);
  await settle(3);
  el2.importHtml(el2.exportHtml());
  await settle(3);
  const back = el2.getContent().rows.flatMap((r) => r.cols.flatMap((c) => c.blocks));
  const by = (t) => back.find((b) => b.type === t);
  const cd = by('countdown');
  assert.ok(cd, 'a countdown is a countdown again -- live, not baked digits');
  assert.equal(cd.props.target, '2027-01-01T00:00');
  assert.equal(cd.props.label, 'Ends probe');
  assert.equal(cd.props.color, '#004488');
  const vid = by('video');
  assert.ok(vid, 'video identity');
  assert.equal(vid.props.href, 'https://e.com/watch');
  assert.equal(vid.props.badge, '#ff2200');
  const box = by('box');
  assert.ok(box, 'box identity');
  assert.match(box.props.html, /display:block/, "the template's own block-level strong survives the sanitizer");
  assert.equal(box.props.bg, '#eeffee');
  assert.equal(box.props.border, 2);
  assert.equal(box.props.maxW, 80);
  const code = by('codeblock');
  assert.ok(code, 'code identity');
  assert.equal(code.props.code, 'echo "probe" && exit');
  assert.equal(code.props.bg, '#101010');
  const css = by('css');
  assert.ok(css, 'raw CSS identity -- and its rules are NOT also folded inline doc-wide');
  assert.equal(css.props.code, '.mc-note{color:#ff0000}');
  assert.equal(css.props.note, 'Note probe');
  el2.remove();
});

await it('flex and grid rows keep their layout through the data-mcr marker', async () => {
  const el2 = await mountEditor();
  const doc = el2.getContent();
  const flex = mkRow([30, 70]);
  Object.assign(flex.props, { layout: 'flex', flexDir: 'row', justify: 'center', alignItems: 'center', wrap: false, gap: 14 });
  flex.cols[0].blocks = [blk('text', { html: 'flex a' })];
  flex.cols[1].blocks = [blk('text', { html: 'flex b' })];
  const grid = mkRow([50, 50]);
  Object.assign(grid.props, { layout: 'grid', gridCols: 3, gap: 9 });
  grid.cols[0].blocks = [blk('text', { html: 'g1' })];
  grid.cols[1].blocks = [blk('text', { html: 'g2' })];
  doc.rows = [flex, grid];
  el2.setContent(doc);
  await settle(3);
  el2.importHtml(el2.exportHtml());
  await settle(3);
  const rows2 = el2.getContent().rows;
  assert.equal(rows2[0].props.layout, 'flex');
  assert.equal(rows2[0].props.justify, 'center');
  assert.equal(rows2[0].props.alignItems, 'center');
  assert.equal(rows2[0].props.wrap, false);
  assert.equal(rows2[0].props.gap, 14);
  assert.deepEqual(rows2[0].cols.map((c) => c.span), [30, 70], 'spans survive, no collapse to one column');
  assert.equal(rows2[1].props.layout, 'grid');
  assert.equal(rows2[1].props.gridCols, 3);
  el2.remove();
});

await it("mobileCols 'keep' survives via the inert mc-keep class", async () => {
  const el2 = await mountEditor();
  const doc = el2.getContent();
  const keep = mkRow([50, 50]);
  keep.props.mobileCols = 'keep';
  keep.cols[0].blocks = [blk('text', { html: 'k1' })];
  keep.cols[1].blocks = [blk('text', { html: 'k2' })];
  doc.rows = [keep];
  el2.setContent(doc);
  await settle(3);
  el2.importHtml(el2.exportHtml());
  await settle(3);
  assert.equal(el2.getContent().rows[0].props.mobileCols, 'keep');
  el2.remove();
});

await it('theme.link paints exported links inline, and folds back to inherit on reload', async () => {
  const el2 = await mountEditor();
  const doc = el2.getContent();
  const r2 = mkRow([100]);
  r2.cols[0].blocks = [blk('text', { html: 'Read <a href="https://e.com/a">plain</a> and <a href="https://e.com/b" style="color:#00aa00">colored</a>.' })];
  doc.rows = [r2];
  doc.theme.link = '#cc0066';
  el2.setContent(doc);
  await settle(3);
  const out = el2.exportHtml();
  assert.match(out, /<a href="https:\/\/e\.com\/a" style="color:#cc0066;">/, 'a colorless anchor ships the theme link color -- mail clients have no stylesheet to inherit from');
  assert.match(out, /e\.com\/b" style="color:#00aa00"/, 'a hand-colored anchor keeps its own');
  el2.importHtml(out);
  await settle(3);
  assert.equal(el2.getContent().theme.link, '#cc0066', 'the vote recovers it (menu items no longer hijack)');
  assert.doesNotMatch(el2.getContent().rows[0].cols[0].blocks[0].props.html, /cc0066/, 'the stamp folded back to inherit');
  el2.core.setTheme('link', '#118833');
  await settle(3);
  assert.match(el2.exportHtml(), /e\.com\/a" style="color:#118833;"/, 'a later Link color edit reaches reloaded links');
  el2.remove();
});

await it('convergence: the export of a reloaded document is byte-identical', async () => {
  // Cycle 1 may normalize authored markup once (the DOM serializer expands
  // an svg's self-closing tags); from then on export -> import -> export is
  // a fixed point, byte for byte.
  const html2 = el.exportHtml();
  el.importHtml(html2);
  await settle(3);
  const html3 = el.exportHtml();
  assert.equal(html3 === html2, true, 'byte-stable from the first reload on');
});

console.log();
console.log('Round trip — degradation floor (no block type ever silently dropped)');

await it('markers:false — pristine HTML, and the degradation floor still holds', async () => {
  // The opt-out ships no data-mc* attributes; identity is then lossy by
  // contract, but every piece of user content still reaches the reloaded
  // document.
  const el2 = await mountEditor();
  const doc = el2.getContent();
  doc.rows = [
    row(blk('countdown', { target: '2027-01-01T00:00', label: 'Ends probe', color: '#004488' })),
    row(blk('video', { src: 'https://e.com/v.png', href: 'https://e.com/watch', caption: 'Cap probe', badge: '#ff2200' })),
    row(blk('box', { html: 'Box probe content', bg: '#eeffee', pad: 12 })),
    row(blk('codeblock', { code: 'echo probe', bg: '#101010', color: '#eeeeee', size: 11, pad: 9 })),
    row(blk('css', { code: '.mc-note{color:#ff0000}', note: 'Note probe' })),
  ];
  el2.setContent(doc);
  await settle(3);
  const pristine = el2.exportHtml({ markers: false });
  assert.equal(/data-mc|mc-keep/.test(pristine), false, 'no marker attribute anywhere');
  el2.importHtml(pristine);
  await settle(3);
  const json = JSON.stringify(el2.getContent());
  assert.match(json, /Ends probe/, 'countdown label');
  assert.match(json, /e\.com\/watch/, 'video link');
  assert.match(json, /e\.com\/v\.png/, 'video thumbnail');
  assert.match(json, /Box probe content/, 'box content');
  assert.match(json, /echo probe/, 'code sample');
  assert.match(json, /mc-note/, 'raw css rules');
  // The embed block was removed on 2026-09-02 (mail clients strip iframes);
  // a document saved with one keeps its content as the raw html it exported.
  const el3 = await mountEditor();
  el3.setContent({ theme: {}, rows: [row({ id: 'x', type: 'embed', props: { src: 'https://e.com/legacy', height: 200, label: 'L', py: 8 } })] });
  await settle(2);
  const legacy = JSON.stringify(el3.getContent());
  assert.match(legacy, /"type":"html"/, 'legacy embed became an html block');
  assert.match(legacy, /e\.com\/legacy/, 'its iframe survives as content');
  el3.remove();
  el2.remove();
});

console.log();
console.log(passed + ' passed, ' + failed + ' failed.');
if (failed) process.exit(1);
const { closeDom } = await import('./dom-harness.mjs');
closeDom();
process.exit(0);
