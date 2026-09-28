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
  // The second image is the pixel-sized one: a logo pinned in px rather than
  // as a share of the column, with the retina sources, tooltip and aspect
  // ratio that used to be dropped on import.
  rows.push(row(
    blk('image', { src: 'https://e.com/logo.png', alt: 'Logo probe', width: 15, wUnit: 'px', wpx: 88, ratio: 0.3636, srcset: 'https://e.com/logo.png 1x, https://e.com/logo@2x.png 2x', sizes: '88px', title: 'Tooltip probe', align: 'left', radius: 0, py: 0, px: 0 })));
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
  // The per-block "Box & border" panel: it exports as the block's own
  // wrapper div -- the verification-code box shape. Given a sibling on
  // purpose, because a lone styled div in a cell is the *column* wrapper
  // shape and is read back as column styling instead.
  rows.push(row([
    blk('text', { html: 'Panel probe', py: 18, px: 24, bBg: '#eff6fc', bBorder: 2, bStyle: 'dashed', bLine: '#cfe3f5', bRadius: 8 }),
    blk('text', { html: 'after the panel' }),
  ]));
  // A photo behind ONE column, with its own fit, position and tint -- the
  // row-level image cannot express this, and before it existed the column
  // came back unpainted on every reload.
  const twoBg = mkRow([50, 50]);
  twoBg.props.gap = 20;
  twoBg.cols[0].blocks = [blk('text', { html: 'over the photo' })];
  twoBg.cols[1].blocks = [blk('text', { html: 'plain neighbour' })];
  Object.assign(twoBg.cols[0], { bg: '#101820', bgImage: 'https://e.com/col.jpg', bgSize: 'contain', bgPos: 'left top', overlay: 35, padY: 14, padX: 10 });
  rows.push(twoBg);
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

await it("text: the block's own box -- background, border, radius -- and the padding inside it", async () => {
  const b = blocks.find((x) => /Panel probe/.test(x.props.html || ''));
  assert.ok(b, 'the panel block survived');
  assert.match(b.props.bBg, /^#eff6fc$/i, 'the wrapper div carries it; the sanitizer cannot');
  assert.equal(b.props.bBorder, 2);
  assert.equal(b.props.bStyle, 'dashed');
  assert.match(b.props.bLine, /^#cfe3f5$/i);
  assert.equal(b.props.bRadius, 8);
  assert.equal(b.props.py, 18, 'run padding stays inside the box, asymmetry intact');
  assert.equal(b.props.px, 24);
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

await it('image: a pixel width stays the exact pixel width, with srcset, sizes, title and the height that reserves its box', async () => {
  const b = one('image', 1);
  assert.equal(b.props.src, 'https://e.com/logo.png');
  assert.equal(b.props.wUnit, 'px', 'still pinned, not folded back into a percentage');
  assert.equal(b.props.wpx, 88, 'the exact number the author set -- no drift through a rounded %');
  assert.equal(b.props.srcset, 'https://e.com/logo.png 1x, https://e.com/logo@2x.png 2x');
  assert.equal(b.props.sizes, '88px');
  assert.equal(b.props.title, 'Tooltip probe');
  // 88 x 0.3636 = 32, and 32/88 is the ratio that comes back.
  assert.ok(Math.abs(b.props.ratio - 0.3636) < 0.005, 'aspect ratio survives, got ' + b.props.ratio);
  assert.match(html1, /<img[^>]+width="88"[^>]+height="32"/, 'both attributes ship, so a blocked image still holds its box');
  assert.match(html1, /srcset="https:\/\/e\.com\/logo\.png 1x, https:\/\/e\.com\/logo@2x\.png 2x"/);
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

await it('html block: comes back as an html block, source byte-for-byte', async () => {
  assert.equal(one('html').props.code, '<p style="margin:0">raw-html-probe</p>');
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

await it('columns: a per-column background image with its fit, position and darken survives a reload', async () => {
  const r = got.rows.find((x) => x.cols.length === 2 && x.cols[0].bgImage);
  assert.ok(r, 'the column kept its image');
  assert.equal(r.cols[0].bgImage, 'https://e.com/col.jpg');
  assert.equal(r.cols[0].bgSize, 'contain');
  assert.equal(r.cols[0].bgPos, 'left top');
  assert.equal(r.cols[0].overlay, 35, 'the tint folds back off its own rgba box');
  assert.match(r.cols[0].bg, /^#101820$/i, 'the colour underneath comes with it');
  assert.equal(r.cols[0].padY, 14);
  assert.equal(r.cols[1].bgImage, undefined, 'and it stays on the column that asked for it');
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

await it('a flex row that is the ONLY row keeps its layout, spans and column paint on reload', async () => {
  // With two or more rows the content table is never a passthrough, so this
  // only ever failed on a single-row document -- which is exactly the shape
  // a host storing one section at a time saves.
  const el2 = await mountEditor();
  const doc = el2.getContent();
  const solo = mkRow([30, 70]);
  Object.assign(solo.props, { layout: 'flex', flexDir: 'row', gap: 14 });
  solo.cols[0].blocks = [blk('text', { html: 'solo a' })];
  solo.cols[1].blocks = [blk('text', { html: 'solo b' })];
  Object.assign(solo.cols[0], { bg: '#ffeedd', padY: 12, padX: 10, bgImage: 'https://e.com/card.jpg' });
  doc.rows = [solo];
  el2.setContent(doc);
  await settle(3);
  const first = el2.exportHtml();
  el2.importHtml(first);
  await settle(3);
  const back = el2.getContent().rows;
  assert.equal(back.length, 1, 'one row, not one row per column');
  assert.equal(back[0].props.layout, 'flex', 'the layout survived the passthrough check');
  assert.deepEqual(back[0].cols.map((c) => c.span), [30, 70]);
  assert.match(back[0].cols[0].bg, /^#ffeedd$/i);
  assert.equal(back[0].cols[0].bgImage, 'https://e.com/card.jpg');
  assert.equal(back[0].cols[0].padY, 12);
  el2.setContent(el2.getContent());
  await settle(3);
  assert.equal(el2.exportHtml(), first, 'and it is a fixed point');
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

await it('the content area background image, fit, position and repeat survive a reload', async () => {
  const el2 = await mountEditor();
  const doc = el2.getContent();
  Object.assign(doc.theme, { contentBg: '#fffdf8', contentBgImage: 'https://e.com/paper.png', contentBgSize: 'contain', contentBgPos: 'top', contentBgRepeat: 'repeat' });
  const r2 = mkRow([100]);
  r2.cols[0].blocks = [blk('text', { html: 'body' })];
  doc.rows = [r2];
  el2.setContent(doc);
  await settle(3);
  const out = el2.exportHtml();
  el2.importHtml(out);
  await settle(3);
  const t2 = el2.getContent().theme;
  assert.equal(t2.contentBgImage, 'https://e.com/paper.png');
  assert.equal(t2.contentBgSize, 'contain');
  assert.equal(t2.contentBgPos, 'top');
  assert.equal(t2.contentBgRepeat, 'repeat');
  assert.equal(t2.contentBg, '#fffdf8', 'the colour underneath survives alongside the image');
  // Deliberately no byte-convergence assertion here. A single-row document of
  // this shape loses its row padding on reload (20/24 comes back 0/10) with
  // or without a content background image -- a pre-existing defect, verified
  // identical at HEAD, tracked separately. Asserting convergence here would
  // fail for a reason that has nothing to do with this feature.
  el2.remove();
});

await it('preview text and reading direction survive a reload, and the preheader is not re-imported as a row', async () => {
  const el2 = await mountEditor();
  const doc = el2.getContent();
  Object.assign(doc.theme, { preheader: 'Spring sale ends Sunday', dir: 'rtl' });
  const r2 = mkRow([100]);
  r2.cols[0].blocks = [blk('text', { html: 'body' })];
  doc.rows = [r2];
  el2.setContent(doc);
  await settle(3);
  el2.importHtml(el2.exportHtml());
  await settle(3);
  const got2 = el2.getContent();
  assert.equal(got2.theme.preheader, 'Spring sale ends Sunday');
  assert.equal(got2.theme.dir, 'rtl');
  assert.equal(got2.rows.length, 1, 'the hidden preheader div did not become a content row');
  el2.remove();
});

await it('the page background image, fit, position and repeat survive a reload and never land on a row', async () => {
  const el2 = await mountEditor();
  const doc = el2.getContent();
  Object.assign(doc.theme, { bgImage: 'https://e.com/page.png', bgSize: 'auto', bgPos: 'top', bgRepeat: 'repeat' });
  const r2 = mkRow([100]);
  r2.cols[0].blocks = [blk('text', { html: 'body' })];
  doc.rows = [r2];
  el2.setContent(doc);
  await settle(3);
  el2.importHtml(el2.exportHtml());
  await settle(3);
  const got2 = el2.getContent();
  assert.equal(got2.theme.bgImage, 'https://e.com/page.png');
  assert.equal(got2.theme.bgSize, 'auto');
  assert.equal(got2.theme.bgPos, 'top');
  assert.equal(got2.theme.bgRepeat, 'repeat');
  assert.equal(got2.rows.filter((r) => r.props.bgImage).length, 0, 'claimed at page level, stamped on no row');
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
console.log('Round trip — raw HTML blocks keep the author\'s source');

const { rawPatchFor, rawSourceOf } = await import(new URL('../src/core/raw-html.js', import.meta.url).href);

// What an author pastes: a comment, a card table, self-closing tags, a bare
// merge tag with padding, a logic pair, a line-height ratio and a colorless
// link -- every thing the classifiers used to split up or the export passes
// rewrite.
const CARD = `<!-- promo card -->
<table role="presentation" width="100%" style="border-collapse:collapse">
  <tr>
    <td style="padding:12px"><img src="https://e.com/a.png" width="120" alt="Logo"/><br/></td>
    <td style="padding:12px"><h2 style="margin:0;color:#c00">Sale ends Friday</h2>{{#if vip}}<p style="margin:0;font-size:16px;line-height:1.6">Hi {{ first_name }}, 30% off.</p>{{/if}}<a href="https://e.com/p">Details</a> <a href="https://e.com" style="background:#c00;color:#fff;padding:10px 18px;display:inline-block">Shop now</a></td>
  </tr>
</table>`;
const rawOf = (e) => e.getContent().rows.flatMap((r) => r.cols.flatMap((c) => c.blocks));
async function rawDoc(rows) {
  const e = await mountEditor();
  const doc = e.getContent();
  doc.rows = rows;
  e.setContent(doc);
  await settle(3);
  return e;
}
const segmentsOf = (h) => (h.match(/<!--mc:html:[\s\S]*?<!--\/mc:html:[^>]*-->/g) || []);

await it('a pasted card reloads as ONE html block holding exactly what was pasted', async () => {
  const e = await rawDoc([row(blk('html', { code: CARD }))]);
  e.importHtml(e.exportHtml());
  await settle(3);
  const bs = rawOf(e);
  assert.deepEqual(bs.map((b) => b.type), ['html'], 'not split into image/heading/text/button');
  assert.equal(bs[0].props.code, CARD);
  e.remove();
});

await it('the sent mail still gets every export pass on the raw code', async () => {
  const e = await rawDoc([row(blk('html', { code: CARD }))]);
  const seg = segmentsOf(e.exportHtml())[0];
  assert.ok(seg, 'the block is bracketed');
  assert.match(seg, /mso-table-lspace:0pt/, 'Outlook table spacing');
  assert.match(seg, /-ms-interpolation-mode:bicubic/, 'Outlook image scaling');
  assert.match(seg, /line-height:26px;mso-line-height-rule:exactly/, 'Outlook line-height');
  assert.match(seg, /\{\{first_name\}\}/, 'tight merge tag');
  assert.match(seg, /href="https:\/\/e\.com\/p" style="color:/, 'document link color');
  assert.match(seg, /<!-- promo card -->/, 'the author\'s own comment ships as written');
  e.remove();
});

await it('Code modal Apply keeps html blocks intact', async () => {
  const e = await rawDoc([row(blk('html', { code: CARD }))]);
  e.core.setState({ codeSrc: e.exportHtml() });
  e.core.applyCode();
  await settle(3);
  const bs = rawOf(e);
  assert.deepEqual(bs.map((b) => b.type), ['html']);
  assert.equal(bs[0].props.code, CARD);
  e.remove();
});

await it('the raw segment is byte-stable across save -> reload -> save', async () => {
  const e = await rawDoc([row(blk('text', { html: 'Intro' })), row(blk('html', { code: CARD }))]);
  const h1 = e.exportHtml();
  e.importHtml(h1);
  await settle(3);
  const h2 = e.exportHtml();
  e.importHtml(h2);
  await settle(3);
  assert.deepEqual(segmentsOf(h2), segmentsOf(h1), 'deterministic brackets and patch');
  assert.equal(e.exportHtml(), h2, 'and the whole export is a fixed point');
  e.remove();
});

await it('several html blocks across columns keep their order, place and source', async () => {
  const bad = '<tr><td>bare row</td></tr><div>unclosed';
  const r = row([blk('text', { html: 'left' }), blk('html', { code: bad })], null, [50, 50]);
  r.cols[1].blocks = [blk('html', { code: '<p>right</p>' })];
  const e = await rawDoc([r, row(blk('text', { html: 'After the unclosed div' }))]);
  e.importHtml(e.exportHtml());
  await settle(3);
  const g = e.getContent();
  assert.deepEqual(g.rows[0].cols.map((c) => c.blocks.map((b) => b.type)), [['text', 'html'], ['html']]);
  assert.equal(g.rows[0].cols[0].blocks[1].props.code, bad, 'unbalanced markup verbatim');
  assert.equal(g.rows[0].cols[1].blocks[0].props.code, '<p>right</p>');
  assert.match(JSON.stringify(g.rows[1]), /After the unclosed div/, 'and it swallowed nothing after it');
  e.remove();
});

await it('logic tags inside an html block stay inside it', async () => {
  const code = '{{#if vip}}<p>VIP</p>{{/if}}';
  const e = await rawDoc([row(blk('html', { code }))]);
  e.importHtml(e.exportHtml());
  await settle(3);
  const bs = rawOf(e);
  assert.deepEqual(bs.map((b) => b.type), ['html'], 'no condition markers were made from it');
  assert.equal(bs[0].props.code, code);
  e.remove();
});

await it('an exported email pasted into an html block is one block, brackets and all', async () => {
  const inner = await rawDoc([row(blk('html', { code: '<p>inner</p>' }))]);
  const pasted = inner.exportHtml();
  inner.remove();
  const e = await rawDoc([row(blk('html', { code: pasted }))]);
  e.importHtml(e.exportHtml());
  await settle(3);
  const bs = rawOf(e);
  assert.equal(bs.length, 1);
  assert.equal(bs[0].props.code, pasted);
  e.remove();
});

await it('a hand edit inside the block voids the patch, never the block', async () => {
  const e = await rawDoc([row(blk('html', { code: CARD }))]);
  const edited = e.exportHtml().replace('Sale ends Friday', 'Sale ends Monday');
  e.importHtml(edited);
  await settle(3);
  const bs = rawOf(e);
  assert.deepEqual(bs.map((b) => b.type), ['html']);
  assert.match(bs[0].props.code, /Sale ends Monday/, 'the edit is kept');
  assert.match(bs[0].props.code, /<!-- promo card -->/, 'and so is the structure');
  e.remove();
});

await it('comments stripped by an ESP: the old behavior, content intact', async () => {
  const e = await rawDoc([row(blk('html', { code: CARD }))]);
  const stripped = e.exportHtml().replace(/<!--(?!\[if|<!\[endif)[\s\S]*?-->/g, '');
  assert.equal(/mc:html/.test(stripped), false);
  e.importHtml(stripped);
  await settle(3);
  const json = JSON.stringify(e.getContent());
  assert.match(json, /Sale ends Friday/);
  assert.match(json, /Shop now/);
  e.remove();
});

await it('brackets in the wrong place fall back to the old import instead of losing content', async () => {
  const e = await mountEditor();
  e.importHtml('<table><tr><td><a title="<!--mc:html:h1-->x<!--/mc:html:h1-->" href="https://e.com">Link text</a></td></tr></table>');
  await settle(3);
  assert.match(JSON.stringify(e.getContent()), /Link text/, 'inside an attribute');
  e.importHtml('<table><tr><td><!--mc:html:h1--><p>Opened, never closed</p></td></tr></table>');
  await settle(3);
  assert.match(JSON.stringify(e.getContent()), /Opened, never closed/, 'unpaired');
  e.importHtml('<table><tr><td><div data-mc="html" data-mch="0"></div><p>Forged slot</p></td></tr></table>');
  await settle(3);
  assert.match(JSON.stringify(e.getContent()), /Forged slot/, 'a forged placeholder is not trusted');
  e.remove();
});

await it('markers:false and empty html blocks export exactly as before', async () => {
  const e = await rawDoc([row(blk('html', { code: CARD })), row(blk('html', { code: '' }))]);
  const pristine = e.exportHtml({ markers: false });
  assert.equal(/mc:html/.test(pristine), false, 'no brackets');
  assert.equal(segmentsOf(e.exportHtml()).length, 1, 'an empty block ships nothing, bracketed or not');
  e.remove();
});

await it('raw patch: malformed or foreign payloads leave the shipped code alone', async () => {
  const src = '<a href="x">go</a> {{ name }}';
  const shipped = '<a href="x" style="color:#0065b3;">go</a> {{name}}';
  const patch = rawPatchFor(src, shipped);
  assert.ok(patch, 'a patch is made');
  assert.equal(/[<>-]/.test(patch), false, 'and is comment-safe');
  assert.equal(rawSourceOf(shipped, patch), src, 'and reverses the passes');
  assert.equal(rawSourceOf(shipped + ' ', patch), shipped + ' ', 'wrong checksum');
  assert.equal(rawSourceOf(shipped, patch.replace(/p=.*/, 'p=%5B%5B999%2C1%2C%22%22%5D%5D')), shipped, 'op out of range');
  assert.equal(rawSourceOf(shipped, patch.replace(/p=.*/, 'p=%E0%A4%A')), shipped, 'undecodable');
  assert.equal(rawSourceOf(shipped, 'junk'), shipped, 'junk');
  assert.equal(rawPatchFor(src, src), '', 'nothing to reverse, nothing shipped');
  assert.equal(rawPatchFor('a'.repeat(40), 'b'.repeat(4000)), '', 'no patch bigger than the code is worth');
});

console.log();
console.log('Round trip — social: a network\'s own icon');

const { parseSocialItems, socialItemsString } = await import(new URL('../src/core/parse.js', import.meta.url).href);
const ICON = 'https://cdn.example.com/icons/insta.png';
const OWN = 'Instagram|https://instagram.com/me|' + ICON + '\nX|https://x.com/me\nLinkedIn|https://linkedin.com/in/me';

await it('an item\'s own icon ships as an <img> and reloads onto the same network', async () => {
  const e = await rawDoc([row(blk('social', { items: OWN, size: 24 }))]);
  const html = e.exportHtml();
  assert.match(html, new RegExp('<img[^>]*src="' + ICON.replace(/[.\/]/g, '\\$&') + '"[^>]*alt="Instagram"'), 'real image, named');
  assert.match(html, /<img[^>]*width="24"/, 'sized for Outlook');
  e.importHtml(html);
  await settle(3);
  const b = rawOf(e).find((x) => x.type === 'social');
  assert.ok(b, 'still a social block');
  assert.equal(b.props.items, OWN, 'icon on Instagram only, the others still built-in');
  assert.equal(b.props.size, 24);
  e.remove();
});

await it('markers:false keeps the icon too -- the src is the evidence, not the mark', async () => {
  const e = await rawDoc([row(blk('social', { items: OWN }))]);
  const pristine = e.exportHtml({ markers: false });
  assert.equal(/data-mc/.test(pristine), false);
  assert.match(pristine, /insta\.png/, 'the mail still shows the icon');
  e.importHtml(pristine);
  await settle(3);
  const b = rawOf(e).find((x) => x.type === 'social');
  assert.ok(b);
  // Until the importer read unmarked images this round trip was lossy by
  // contract: a pristine export came back on built-in glyphs. An <img> the
  // block can re-render is now kept whoever wrote it, so markers:false costs
  // the editing marks and nothing the reader sees.
  assert.equal(b.props.items, OWN, 'the author icon survives a pristine export');
  e.remove();
});

await it("a foreign image-icon strip keeps the sender's own icons", async () => {
  const e = await mountEditor();
  e.importHtml('<table><tr><td align="center"><a href="https://facebook.com/acme"><img src="https://acme.com/fb.png" width="24" alt="Facebook"></a> <a href="https://instagram.com/acme"><img src="https://acme.com/ig.png" width="24" alt="Instagram"></a></td></tr></table>');
  await settle(3);
  const b = rawOf(e).find((x) => x.type === 'social');
  assert.ok(b);
  // The networks were always right; the drawings were not. Swapping a brand's
  // own artwork for a built-in glyph is the kind of silent substitution an
  // import is not allowed to make.
  assert.equal(b.props.items, 'Facebook|https://facebook.com/acme|https://acme.com/fb.png\nInstagram|https://instagram.com/acme|https://acme.com/ig.png');
  e.remove();
});

await it('an inline <svg> icon has no src to keep, so it still falls back to a glyph', async () => {
  const e = await mountEditor();
  e.importHtml('<table><tr><td align="center"><a href="https://facebook.com/acme"><svg width="24" height="24"><title>Facebook</title></svg></a> <a href="https://instagram.com/acme"><svg width="24" height="24"><title>Instagram</title></svg></a></td></tr></table>');
  await settle(3);
  const b = rawOf(e).find((x) => x.type === 'social');
  assert.ok(b, 'still a social strip');
  // No third field: an inline <svg> is markup, not a source the block could
  // point an <img> at. The labels come from the hrefs because a <title> child
  // is not one of the naming attributes (alt/title/aria-label) the strip reads.
  assert.equal(b.props.items, 'facebook|https://facebook.com/acme\ninstagram|https://instagram.com/acme');
  e.remove();
});

await it('a forged or unsafe icon is not taken', async () => {
  const e = await mountEditor();
  e.importHtml('<table><tr><td align="center"><a href="https://facebook.com/a"><img data-mcicon="" src="javascript:alert(1)" width="24" alt="Facebook"></a> <a href="https://x.com/a"><img data-mcicon="" src="https://ok.com/x.png" width="24" alt="X"></a></td></tr></table>');
  await settle(3);
  const b = rawOf(e).find((x) => x.type === 'social');
  assert.equal(b.props.items, 'Facebook|https://facebook.com/a\nX|https://x.com/a|https://ok.com/x.png');
  e.remove();
});

await it('item strings: old lines parse as before, icons only when they are image sources', async () => {
  assert.deepEqual(parseSocialItems('X|https://x.com'), [{ label: 'X', href: 'https://x.com', icon: '' }]);
  assert.deepEqual(parseSocialItems('Odd|https://e.com/a|b'), [{ label: 'Odd', href: 'https://e.com/a|b', icon: '' }], 'a | inside a URL is not an icon');
  assert.deepEqual(parseSocialItems('Bad|https://e.com|javascript:alert(1)'), [{ label: 'Bad', href: 'https://e.com|javascript:alert(1)', icon: '' }]);
  assert.deepEqual(parseSocialItems('Me||https://e.com/i.png'), [{ label: 'Me', href: '', icon: 'https://e.com/i.png' }]);
  assert.deepEqual(parseSocialItems('Me|#|{{cdn}}/i.png')[0].icon, '{{cdn}}/i.png', 'a merge-tag host');
  assert.equal(socialItemsString([{ label: 'X', href: 'https://x.com' }]), 'X|https://x.com', 'no icon, old shape');
  assert.equal(socialItemsString([{ label: 'X', href: 'https://x.com', icon: 'nope' }]), 'X|https://x.com', 'an invalid icon is never written');
  assert.equal(socialItemsString(parseSocialItems(OWN)), OWN, 'lossless');
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

/*
 * The complaint this work started from: put HTML in, save, come back, and the
 * editor had rewritten it. Everything the importer now keeps has to survive
 * not just the first import but every cycle after it -- a second pass that
 * adds, drops or restyles anything is the same bug one save later.
 */
console.log();
console.log('Round trip -- a foreign document keeps saying what it said');

const FOREIGN = '<!doctype html><html><head>'
  + '<link href="https://fonts.googleapis.com/css2?family=Poppins&display=swap" rel="stylesheet">'
  + '<style>\n@font-face { font-family:Brand; src:url(https://cdn.example.com/b.woff2); }\n'
  + 'a.cta:hover { background:#252627 !important; }\n'
  + '@media only screen and (max-width:600px) {\n  .mc-col { display:block !important; }\n  .stack-gap { padding-top:16px !important; }\n  img { max-width:100% !important; height:auto !important; }\n}\n</style>'
  + '</head><body style="background:#fbfbfb"><table role="presentation" width="100%"><tr><td align="center">'
  + '<table role="presentation" width="600"><tr><td>'
  + '<div style="text-align:right"><a href="https://e.com/p" style="display:block;text-decoration:underline;padding:0 4px 4px;color:#6d6d6d">Privacy</a>'
  + '<a href="https://e.com/t" style="display:block;text-decoration:underline;padding:0 4px 4px;color:#6d6d6d">Terms</a></div>'
  + '<table><tr><td><a href="https://instagram.com/acme"><img src="https://acme.com/ig.svg" width="20" alt="Instagram"></a>'
  + '<a href="https://facebook.com/acme"><img src="https://acme.com/fb.svg" width="20" alt="Facebook"></a></td></tr></table>'
  + '</td></tr></table></td></tr></table></body></html>';

await it('what the source said is still there after the first import', async () => {
  const e = await mountEditor();
  e.importHtml(FOREIGN);
  await settle(3);
  const d = e.getContent();
  assert.deepEqual(d.theme.fontLinks, ['https://fonts.googleapis.com/css2?family=Poppins&display=swap'], 'the webfont');
  assert.match(d.theme.css, /@font-face/, 'the face declaration');
  assert.match(d.theme.css, /a\.cta:hover/, 'the hover state');
  assert.match(d.theme.css, /\.stack-gap/, "the author's breakpoint rule");
  assert.equal(/\.mc-col/.test(d.theme.css), false, 'but not the layout rules we regenerate');
  const menu = rawOf(e).find((b) => b.type === 'menu');
  assert.equal(menu.props.stacked, true);
  assert.equal(menu.props.transform, 'none', 'not shouted back in uppercase');
  const social = rawOf(e).find((b) => b.type === 'social');
  assert.match(social.props.items, /acme\.com\/ig\.svg/, "the sender's own icon, not a built-in glyph");
  e.remove();
});

await it('saving and reopening changes nothing -- the cycle converges', async () => {
  const e = await mountEditor();
  e.importHtml(FOREIGN);
  await settle(3);
  const first = e.exportHtml();
  e.importHtml(first);
  await settle(3);
  const second = e.exportHtml();
  assert.equal(second, first, 'export -> import -> export is a fixed point');
  e.importHtml(second);
  await settle(3);
  assert.equal(e.exportHtml(), first, 'and stays one on a third pass');
  e.remove();
});

await it('the kept stylesheet is not duplicated on every save', async () => {
  const e = await mountEditor();
  e.importHtml(FOREIGN);
  await settle(3);
  let html = e.exportHtml();
  const styles = (html.match(/<style/g) || []).length;
  const links = (html.match(/<link/g) || []).length;
  for (let i = 0; i < 3; i++) { e.importHtml(html); await settle(3); html = e.exportHtml(); }
  assert.equal((html.match(/<style/g) || []).length, styles, 'style count is stable across saves');
  assert.equal((html.match(/<link/g) || []).length, links, 'so is the font link');
  assert.equal((html.match(/@font-face/g) || []).length, 1, 'and the face is declared exactly once');
  e.remove();
});

console.log();
console.log(passed + ' passed, ' + failed + ' failed.');
if (failed) process.exit(1);
const { closeDom } = await import('./dom-harness.mjs');
closeDom();
process.exit(0);
