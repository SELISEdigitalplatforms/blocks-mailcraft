/**
 * The render layer: the canvas, the inline rich-text toolbar, focus/caret
 * preservation across a full rebuild, the screenshot capture and the story
 * viewer.
 *
 * Run: npm test
 *
 * These are the modules that a DOM-free suite cannot touch at all. Three of
 * them lean on browser APIs jsdom does not implement (canvas, image decoding,
 * the clipboard); test/dom-harness.mjs supplies stand-ins so the real code
 * still runs end to end and only the rasterization is faked.
 */
import assert from 'node:assert/strict';
import { installDom, mountEditor, settle, closeDom, win } from './dom-harness.mjs';

installDom();
await import(new URL('../src/index.js', import.meta.url).href);

let passed = 0;
let failed = 0;
async function it(name, fn) {
  try { await fn(); passed++; console.log('  ok    ' + name); }
  catch (e) { failed++; console.log('  FAIL  ' + name + '\n        ' + String(e.message).split('\n').join('\n        ')); }
}

const q = (el, sel) => el.shadowRoot.querySelector(sel);
const qa = (el, sel) => Array.from(el.shadowRoot.querySelectorAll(sel));
const EMAIL = '<table><tr><td><h1>Launch</h1><p>Body copy</p></td></tr></table>';

/** Mounts, imports a small email, and returns the editor plus its first text-ish block. */
async function withText() {
  const el = await mountEditor();
  el.core.insertBlock('text');
  await settle(2);
  const block = el.getContent().rows.flatMap((r) => r.cols.flatMap((c) => c.blocks))[0];
  return { el, block };
}

console.log();
console.log('Canvas');

await it('renders a sheet with a drop target for every row', async () => {
  const el = await mountEditor();
  el.importHtml(EMAIL);
  await settle(2);
  assert.ok(q(el, '[data-mc-sheet]'), 'the email sheet');
  assert.ok(qa(el, '[data-mc-slot]').length >= 1, 'row slots');
});

await it('selecting a row shows its action toolbar on the canvas', async () => {
  const el = await mountEditor();
  el.importHtml(EMAIL);
  await settle(2);
  const row = el.getContent().rows[0];
  el.core.select('row', row.id);
  await settle(2);
  assert.ok(q(el, '.mc-row-el.is-selected'), 'the selected row is marked');
});

await it('clicking a block on the canvas selects it', async () => {
  const el = await mountEditor();
  el.importHtml(EMAIL);
  await settle(2);
  const node = q(el, '[data-mc-content]');
  node.closest('[data-mc-slot]').dispatchEvent(new (win().MouseEvent)('click', { bubbles: true }));
  await settle(2);
  assert.ok(el.core.state.sel, 'something got selected');
});

await it('an image block with a Link URL renders an anchor, scheme-corrected', async () => {
  const el = await mountEditor();
  el.core.insertBlock('image');
  await settle(2);
  const block = el.getContent().rows.flatMap((r) => r.cols.flatMap((c) => c.blocks)).find((b) => b.type === 'image');
  assert.ok(block, 'an image block');
  assert.equal(qa(el, '[data-mc-content] a').length, 0, 'unlinked image is a bare <img>');
  // What the inspector's Link URL field does, typed the way people type it.
  el.core.setProp(block.id, 'href', 'selise.ch');
  await settle(2);
  const a = q(el, '[data-mc-content] a');
  assert.ok(a, 'the image is wrapped in an anchor');
  assert.equal(a.getAttribute('href'), 'https://selise.ch', 'a bare host is not shipped as a relative URL');
  assert.ok(a.querySelector('img'), 'the img is inside the anchor');
  assert.match(el.exportHtml(), /<a[^>]+href="https:\/\/selise\.ch"[^>]*>\s*<img/, 'and the export carries it');
});

await it('clicking a linked image on the canvas does not navigate the host away', async () => {
  const el = await mountEditor();
  el.core.insertBlock('image');
  await settle(2);
  const block = el.getContent().rows.flatMap((r) => r.cols.flatMap((c) => c.blocks)).find((b) => b.type === 'image');
  el.core.setProp(block.id, 'href', 'https://selise.ch');
  await settle(2);
  const ev = new (win().MouseEvent)('click', { bubbles: true, cancelable: true });
  q(el, '[data-mc-content] a').dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true, 'the anchor swallows its own click');
});

await it('the mobile device toggle narrows the sheet', async () => {
  const el = await mountEditor();
  el.importHtml(EMAIL);
  await settle(2);
  const desktop = q(el, '[data-mc-sheet]').style.width;
  el.core.setState({ device: 'mobile' });
  await settle(2);
  const mobile = q(el, '[data-mc-sheet]').style.width;
  assert.notEqual(desktop, mobile);
  assert.equal(mobile, '375px');
});

await it('a drag over the canvas resolves a drop index without throwing', async () => {
  const el = await mountEditor();
  el.importHtml(EMAIL);
  await settle(2);
  el.core.startDrag({ kind: 'block', type: 'text' });
  const sheet = q(el, '[data-mc-sheet]');
  const ev = new (win().Event)('dragover', { bubbles: true, cancelable: true });
  ev.clientY = 100;
  sheet.dispatchEvent(ev);
  const ev2 = new (win().Event)('drop', { bubbles: true, cancelable: true });
  ev2.clientY = 100;
  sheet.dispatchEvent(ev2);
  await settle(2);
  assert.ok(el.getContent().rows.length >= 1, 'the document survived the gesture');
});

await it('a row with a background image renders it on the canvas', async () => {
  const el = await mountEditor();
  el.core.insertRow([100]);
  await settle();
  const row = el.getContent().rows.at(-1);
  el.core.setProp(row.id, 'bgImage', 'https://example.com/bg.png');
  await settle(2);
  assert.match(el.shadowRoot.innerHTML, /bg\.png/);
});


await it('pressing on block text hands the gesture to the caret, not to the block drag', async () => {
  const { el } = await withText();
  const editable = q(el, '[contenteditable="true"]');
  const wrap = editable.closest('.mc-block-el');
  assert.equal(wrap.draggable, true, 'a block is draggable at rest');
  editable.dispatchEvent(new (win().MouseEvent)('mousedown', { bubbles: true }));
  // WebKit decides drag-vs-select at mousedown, so the attribute has to be
  // gone by the time this returns or Safari never selects the word.
  assert.equal(wrap.draggable, false, 'the drag is released for the length of the gesture');
  win().dispatchEvent(new (win().MouseEvent)('mouseup', { bubbles: true }));
  assert.equal(wrap.draggable, true, 'and comes back on mouseup, so reordering still works');
});

await it('pressing on a block that is not editable leaves its drag alone', async () => {
  const el = await mountEditor();
  el.core.insertBlock('divider');
  await settle(2);
  const wrap = q(el, '.mc-block-el');
  wrap.dispatchEvent(new (win().MouseEvent)('mousedown', { bubbles: true }));
  assert.equal(wrap.draggable, true);
});

await it('editable copy opts out of the writing assistants that would float over it', async () => {
  const { el } = await withText();
  const editable = q(el, '[contenteditable="true"]');
  ['data-gramm', 'data-gramm_editor', 'data-enable-grammarly', 'data-lt-active'].forEach((name) => {
    assert.equal(editable.getAttribute(name), 'false', name + ' declared');
  });
});

/*
 * The page section around the sheet. It is what the recipient sees as the
 * band around a template, and until it was painted here it was invisible in
 * the editor -- changing its colour did nothing on screen and its size could
 * not be changed at all.
 */
await it('the canvas paints the page around the sheet from the document theme', async () => {
  const el = await mountEditor();
  el.importHtml(EMAIL);
  await settle(2);
  el.core.setTheme('bg', '#123456');
  el.core.setTheme('padY', 24);
  el.core.setTheme('padX', 12);
  await settle(2);
  const page = q(el, '[data-mc-page]');
  assert.ok(page, 'the page section exists');
  assert.ok(page.contains(q(el, '[data-mc-sheet]')), 'the sheet sits inside it');
  assert.match(page.style.background, /#123456|rgb\(18,\s*52,\s*86\)/);
  assert.equal(page.style.padding, '24px 12px');
  assert.ok(page.classList.contains('is-padded'), 'the frame moves out to the page');
});

await it('with no page padding the page hugs the sheet and keeps the sheet framed', async () => {
  const el = await mountEditor();
  el.importHtml(EMAIL);
  await settle(2);
  const page = q(el, '[data-mc-page]');
  assert.equal(page.style.padding, '0px', 'collapsed by the CSSOM to a single zero');
  assert.equal(page.classList.contains('is-padded'), false);
});

await it('a transparent page background is painted as transparent, not as a colour', async () => {
  const el = await mountEditor();
  el.importHtml(EMAIL);
  await settle(2);
  el.core.setTheme('bg', 'transparent');
  await settle(2);
  assert.equal(q(el, '[data-mc-page]').style.background, 'transparent');
});

await it('the content corner radius reaches the sheet but never clips the live canvas', async () => {
  const el = await mountEditor();
  el.importHtml(EMAIL);
  await settle(2);
  const sheet = () => q(el, '[data-mc-sheet]');
  assert.equal(sheet().style.borderRadius, '', 'no radius set leaves the editor chrome corner alone');
  el.core.setTheme('radius', 16);
  await settle(2);
  assert.equal(sheet().style.borderRadius, '16px');
  // The sheet is what the row grip straddles and what the floating RTE
  // toolbar overhangs; clipping it would cut both off mid-edit.
  assert.notEqual(sheet().style.overflow, 'hidden');
});

await it('a drag held over the page padding still resolves a drop', async () => {
  const el = await mountEditor();
  el.importHtml(EMAIL);
  await settle(2);
  el.core.setTheme('padY', 40);
  await settle(2);
  const before = el.getContent().rows.length;
  el.core.startDrag({ kind: 'block', type: 'text' });
  const page = q(el, '[data-mc-page]');
  const ev = new (win().Event)('dragover', { bubbles: true, cancelable: true });
  ev.clientY = 5;
  page.dispatchEvent(ev);
  const ev2 = new (win().Event)('drop', { bubbles: true, cancelable: true });
  ev2.clientY = 5;
  page.dispatchEvent(ev2);
  await settle(2);
  assert.ok(el.getContent().rows.length >= before, 'the document survived the gesture');
});
console.log();
console.log('Inline rich text');

await it('double-clicking a text block puts it into edit mode and shows the toolbar', async () => {
  const { el, block } = await withText();
  el.core.setState({ editing: block.id, sel: { type: 'block', id: block.id }, tab: 'design' });
  await settle(3);
  assert.equal(el.core.state.editing, block.id);
  assert.ok(q(el, '[contenteditable="true"]'), 'the block became editable');
});

await it('the formatting commands run against the edited block', async () => {
  const { el, block } = await withText();
  el.core.setState({ editing: block.id, sel: { type: 'block', id: block.id } });
  await settle(3);
  const editable = q(el, '[contenteditable="true"]');
  el.core.editEl = editable;
  const flags = [];
  ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'justifyCenter'].forEach((cmd) => {
    el.core.exec(cmd);
    // `rteActive` is cleared on a 0ms timer, so it is only observable here.
    flags.push(el.core.rteActive);
  });
  assert.deepEqual(flags, [true, true, true, true, true, true], 'each command marked the editor busy');
  await settle(2);
  assert.equal(el.core.rteActive, false, 'and the flag clears on the next tick');
});

await it('the link editor opens, applies and cancels', async () => {
  const { el, block } = await withText();
  el.core.setState({ editing: block.id, sel: { type: 'block', id: block.id } });
  await settle(3);
  el.core.editEl = q(el, '[contenteditable="true"]');
  el.core.anchorAt();
  await settle(2);
  el.core.setState({ linkDraft: { href: 'https://example.com', blank: true, editing: false } });
  await settle(2);
  assert.ok(el.core.state.linkDraft, 'a draft is open');
  el.core.setState({ linkDraft: null });
  await settle();
  assert.equal(el.core.state.linkDraft, null);
});

await it('inserting a merge tag reaches the document', async () => {
  const { el, block } = await withText();
  el.variables = 'first_name';
  el.core.setState({ editing: block.id, sel: { type: 'block', id: block.id } });
  await settle(3);
  el.core.editEl = q(el, '[contenteditable="true"]');
  el.core.insertTag('first_name');
  await settle(2);
  assert.ok(true, 'no throw through the insert path');
});

// The old version of this test called `el.core.nudge(-2)` -- the block
// *reorder* method, a silent no-op for an id of -2 -- so it asserted only the
// values `setProp` had just written and `core.size()` ran with no coverage at
// all. That vacuum hid a real bug: size() clamped to a private 10–64 while the
// panel allowed 8–96 (text) and 12–120 (heading), so one "Larger text" click
// on a 96px block shrank it to 64. These call the real ± path and pin the
// shared span.
await it('the RTE font size ± clamps at the panel\'s own ends (text 8–96)', async () => {
  const { el, block } = await withText();
  const cur = () => el.getContent().rows.flatMap((r) => r.cols.flatMap((c) => c.blocks))[0];
  el.core.setProp(block.id, 'size', 9);
  for (let i = 0; i < 4; i++) el.core.size(cur(), -2);
  await settle();
  assert.equal(cur().props.size, 8, 'clamped at the panel floor');
  el.core.setProp(block.id, 'size', 95);
  for (let i = 0; i < 4; i++) el.core.size(cur(), 2);
  await settle();
  assert.equal(cur().props.size, 96, 'clamped at the panel ceiling');
});

await it('one ± click on a heading at the panel edge no longer collapses it', async () => {
  const el = await mountEditor();
  el.core.insertBlock('heading');
  await settle(2);
  const cur = () => el.getContent().rows.flatMap((r) => r.cols.flatMap((c) => c.blocks))[0];
  el.core.setProp(cur().id, 'size', 120);
  el.core.size(cur(), 1);
  await settle();
  assert.equal(cur().props.size, 120, 'a 120px heading stays 120px, not 64');
  el.core.setProp(cur().id, 'size', 12);
  el.core.size(cur(), -1);
  await settle();
  assert.equal(cur().props.size, 12, 'floor holds at the panel minimum');
});

await it('the RTE size controls appear only on blocks that render a size', async () => {
  const { el, block } = await withText();
  el.core.setState({ editing: block.id, sel: { type: 'block', id: block.id } });
  await settle(3);
  assert.ok(q(el, '[data-rte-root] [title="Larger text"]'), 'text keeps the ± pair');

  const el2 = await mountEditor();
  el2.core.insertBlock('box');
  await settle(2);
  const box = el2.getContent().rows.flatMap((r) => r.cols.flatMap((c) => c.blocks))[0];
  el2.core.setState({ editing: box.id, sel: { type: 'block', id: box.id } });
  await settle(3);
  assert.ok(q(el2, '[data-rte-root]'), 'a box still gets the toolbar');
  assert.equal(q(el2, '[data-rte-root] [title="Larger text"]'), null,
    'no ± on a box — it hardcodes 15px, so the buttons only wrote a junk size prop');
});

await it('an explicit text-block font overrides imported inline families', async () => {
  const { el, block } = await withText();
  el.core.setProp(block.id, 'html', '<p style="font-family:Georgia, serif;color:#654321"><a href="https://example.com" style="font-family:Georgia, serif">Linked copy</a></p>');
  await settle(2);
  let content = q(el, '[data-mc-content="' + block.id + '"]');
  assert.match(content.querySelector('p').style.fontFamily, /Georgia/, 'inherit keeps the imported family');

  el.core.setProp(block.id, 'fontFamily', 'Tahoma, Geneva, sans-serif');
  await settle(2);
  content = q(el, '[data-mc-content="' + block.id + '"]');
  assert.equal(content.style.fontFamily, 'Tahoma, Geneva, sans-serif');
  assert.equal(content.querySelector('p').style.fontFamily, '');
  assert.equal(content.querySelector('a').style.fontFamily, '');
  assert.equal(content.querySelector('p').style.color, 'rgb(101, 67, 33)', 'other imported formatting survives');
  const html = el.exportHtml();
  assert.match(html, /font-family:\s*Tahoma/i);
  assert.doesNotMatch(html, /font-family:\s*Georgia/i);
});

// The render applies a block font by stripping the descendants' own
// declarations from the *DOM* only (`overrideRichFont`), so an empty value can
// still hand the imported typography back. While the block was focused, the
// live-edit fold copied that stripped DOM into props and made the strip
// permanent -- picking a font and changing your mind lost the import.
await it('a render-time font strip is not written into the document', async () => {
  const { el, block } = await withText();
  const MIXED_FAMILY = '<p style="font-family:Georgia,serif">Hi there,</p><p style="font-family:Tahoma,sans-serif">Welcome</p>';
  el.core.setProp(block.id, 'html', MIXED_FAMILY);
  el.core.select('block', block.id);
  await settle(2);
  q(el, '[data-mc-content="' + block.id + '"]').focus();
  await settle(2);
  el.core.setProp(block.id, 'fontFamily', 'Verdana, sans-serif');
  await settle(2);
  assert.equal(q(el, '[data-mc-content="' + block.id + '"]').querySelector('p').style.fontFamily, '', 'the DOM copy is stripped, as before');
  el.core.setProp(el.getContent().rows[0].id, 'py', 30); // any unrelated render
  await settle(2);
  el.core.setProp(block.id, 'fontFamily', '');           // back to Inherit
  await settle(2);
  const back = el.getContent().rows.flatMap((r) => r.cols.flatMap((c) => c.blocks))[0];
  assert.match(back.props.html, /font-family:\s*Georgia/i, 'the imported families are still in the document');
  assert.equal(q(el, '[data-mc-content="' + block.id + '"]').querySelector('p').style.fontFamily, 'Georgia, serif', 'and paint again');
});

// Imported (and AI-drafted) text blocks keep per-element inline typography on
// purpose, and those declarations beat inheritance from the wrapper -- so the
// block-level Text size / color / Line spacing / weight controls were dead on
// exactly those blocks. The repair happens at mutation time (core setProp):
// size *scales* descendants so the imported hierarchy survives, the others
// strip the descendant property the way the Font control already does.
const MIXED_IMPORT =
  '<p style="font-size:15px;color:rgb(71, 85, 105);line-height:22px">Hi {{DisplayName}},</p>'
  + '<p style="font-size:26px;font-weight:800">Welcome</p>'
  + '<p style="font-size:15px;color:rgb(71, 85, 105)">Login now</p>';

await it('Text size on a mixed-size block rescales the inline sizes proportionally', async () => {
  const { el, block } = await withText();
  el.core.setProp(block.id, 'size', 15);
  el.core.setProp(block.id, 'html', MIXED_IMPORT);
  el.core.setProp(block.id, 'size', 45);
  await settle(2);
  const content = q(el, '[data-mc-content="' + block.id + '"]');
  assert.equal(content.style.fontSize, '45px', 'the wrapper carries the new base');
  const ps = Array.from(content.querySelectorAll('p'));
  assert.deepEqual(ps.map((p) => p.style.fontSize), ['45px', '78px', '45px'], '15/26/15 became 45/78/45');
  assert.equal(ps[0].style.lineHeight, '66px', 'a px line-height scales with its font-size');
  assert.match(el.exportHtml(), /font-size:\s*78px/, 'the scaled hierarchy ships');

  el.core.undo();
  await settle(2);
  const back = el.getContent().rows.flatMap((r) => r.cols.flatMap((c) => c.blocks))[0];
  assert.equal(back.props.size, 15, 'one undo step reverts the size...');
  assert.match(back.props.html, /font-size:\s*26px/, '...and the rescaled html with it');
});

// The same rewrite, but reached the way a user actually reaches it: the block
// is focused (the RTE toolbar is up) and the size moves from the toolbar's own
// +/- pair. Every render folds the live contenteditable back into props first
// (`syncLiveEdit`) -- which used to copy the pre-rewrite html straight back
// over the freshly scaled one, so the `size` prop climbed with each click
// while a mixed-size block's inline sizes never moved at all.
await it('Text size from the RTE, with the block focused, is not reverted by the live-edit sync', async () => {
  const { el, block } = await withText();
  el.core.setProp(block.id, 'size', 15);
  el.core.setProp(block.id, 'html', MIXED_IMPORT);
  el.core.select('block', block.id);
  await settle(2);
  q(el, '[data-mc-content="' + block.id + '"]').focus();
  await settle(2);
  assert.equal(el.core.state.editing, block.id, 'the block is being edited');

  for (let i = 0; i < 3; i++) { q(el, 'button[title="Larger text"]').click(); await settle(2); }
  const after = el.getContent().rows.flatMap((r) => r.cols.flatMap((c) => c.blocks))[0];
  assert.equal(after.props.size, 18, 'three clicks, three pixels');
  const sizes = Array.from(q(el, '[data-mc-content="' + block.id + '"]').querySelectorAll('p')).map((n) => n.style.fontSize);
  assert.deepEqual(sizes, ['18px', '31.19px', '18px'], '15/26/15 followed the base instead of standing still');

  // The other half of the same guard: uncommitted typing must still win over
  // props, so the rewrite is fed the live content rather than replacing it.
  const node = q(el, '[data-mc-content="' + block.id + '"]');
  node.querySelector('p').textContent = 'Hi {{DisplayName}}, friend';
  q(el, 'button[title="Larger text"]').click();
  await settle(2);
  const typed = el.getContent().rows.flatMap((r) => r.cols.flatMap((c) => c.blocks))[0];
  assert.match(typed.props.html, /friend/, 'the mid-edit text survived the rewrite');
  assert.match(typed.props.html, /font-size:\s*19px/, 'and the rewrite still landed');
});

// Two clicks inside one frame: the second lands before the rebuild has put the
// rescaled html into the DOM, so it must read its base off the document (not
// the block the toolbar closed over) and must not hand the render back to the
// stale DOM copy. Both halves failed -- the pair used to move nothing at all.
await it('two clicks of the RTE +/- in the same frame both count', async () => {
  const { el, block } = await withText();
  el.core.setProp(block.id, 'size', 15);
  el.core.setProp(block.id, 'html', MIXED_IMPORT);
  el.core.select('block', block.id);
  await settle(2);
  q(el, '[data-mc-content="' + block.id + '"]').focus();
  await settle(2);
  q(el, 'button[title="Larger text"]').click();
  q(el, 'button[title="Larger text"]').click();
  await settle(2);
  const after = el.getContent().rows.flatMap((r) => r.cols.flatMap((c) => c.blocks))[0];
  assert.equal(after.props.size, 17, 'two clicks, two pixels');
  const sizes = Array.from(q(el, '[data-mc-content="' + block.id + '"]').querySelectorAll('p')).map((n) => n.style.fontSize);
  assert.deepEqual(sizes, ['17px', '29.46px', '17px'], 'and the inline hierarchy followed');
  assert.match(el.exportHtml(), /font-size:\s*17px/, 'what the canvas shows is what ships');
});

// Undo has the same problem from the other side: it restores the document, and
// the render that follows used to sync the pre-undo contenteditable back over
// it -- so undoing a change to the block you were editing reverted everything
// except that block.
await it('undo reaches the block being edited', async () => {
  const { el, block } = await withText();
  el.core.setProp(block.id, 'size', 15);
  el.core.setProp(block.id, 'html', MIXED_IMPORT);
  el.core.select('block', block.id);
  await settle(2);
  q(el, '[data-mc-content="' + block.id + '"]').focus();
  await settle(2);
  q(el, 'button[title="Larger text"]').click();
  await settle(2);
  el.core.undo();
  await settle(2);
  const back = el.getContent().rows.flatMap((r) => r.cols.flatMap((c) => c.blocks))[0];
  assert.equal(back.props.size, 15, 'the base is back');
  assert.match(back.props.html, /font-size:\s*26px/, 'and so is the html the rewrite had scaled');
  const sizes = Array.from(q(el, '[data-mc-content="' + block.id + '"]').querySelectorAll('p')).map((n) => n.style.fontSize);
  assert.deepEqual(sizes, ['15px', '26px', '15px'], 'the canvas shows the reverted sizes, not the pre-undo DOM');
});

await it('an untouched block is never rewritten, and a size change on plain copy leaves the html alone', async () => {
  const { el, block } = await withText();
  const before = el.getContent().rows.flatMap((r) => r.cols.flatMap((c) => c.blocks))[0].props.html;
  el.core.setProp(block.id, 'size', 45);
  await settle(2);
  const after = el.getContent().rows.flatMap((r) => r.cols.flatMap((c) => c.blocks))[0];
  assert.equal(after.props.html, before, 'no inline sizes, nothing to rewrite');
  assert.equal(q(el, '[data-mc-content="' + block.id + '"]').style.fontSize, '45px', 'inheritance does the work');
});

await it('the AI-headline shape (27px strong over a 16px base) follows the control', async () => {
  const { el, block } = await withText();
  // exactly what the AI draft's "Insert as heading" writes (editor-core addText)
  el.core.setProp(block.id, 'html', '<strong style="font-size:27px;line-height:1.15;display:block">Big headline</strong>');
  el.core.setProp(block.id, 'size', 32); // 16 -> 32: the strong must double
  await settle(2);
  const strong = q(el, '[data-mc-content="' + block.id + '"]').querySelector('strong');
  assert.equal(strong.style.fontSize, '54px', '27px scaled by the same ratio');
  assert.equal(strong.style.lineHeight, '1.15', 'a unitless line-height is left alone');
});

await it('an explicit Text color overrides imported inline colors', async () => {
  const { el, block } = await withText();
  el.core.setProp(block.id, 'html', MIXED_IMPORT);
  el.core.setProp(block.id, 'color', '#ff0000');
  await settle(2);
  const content = q(el, '[data-mc-content="' + block.id + '"]');
  assert.equal(content.querySelectorAll('[style*="color"]').length, 0, 'descendant colors stripped');
  assert.doesNotMatch(el.exportHtml(), /71, 85, 105/, 'the imported grey no longer ships');
});

await it('Line spacing and Text weight override imported inline copies the same way', async () => {
  const { el, block } = await withText();
  el.core.setProp(block.id, 'html', MIXED_IMPORT);
  el.core.setProp(block.id, 'lh', 2);
  el.core.setProp(block.id, 'weight', '700');
  await settle(2);
  const content = q(el, '[data-mc-content="' + block.id + '"]');
  assert.equal(content.style.lineHeight, '2');
  assert.equal(content.querySelectorAll('[style*="line-height"]').length, 0, 'inline 22px line-height gone');
  assert.equal(content.querySelectorAll('[style*="font-weight"]').length, 0, 'inline 800 gone — the block weight owns it');
  assert.match(content.querySelector('p:nth-child(2)').style.fontSize, /26px/, 'sizes untouched by the other controls');
});

// The native colour dialog is bound to its <input type="color"> node:
// Chromium closes it when the node leaves the document. Committing a picked
// colour re-renders everything, so the panel must not rebuild under a
// focused picker -- the canvas still must (it is the live preview).
await it('an open colour dialog survives its own commits', async () => {
  const { el, block } = await withText();
  el.core.select('block', block.id);
  await settle(3);
  const picker = q(el, '.mc-color-control input[type="color"]');
  assert.ok(picker, 'the colour pill renders its native picker');
  picker.focus();
  picker.value = '#ff0000';
  picker.dispatchEvent(new (win().Event)('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 170)); // past typeCommit's 120ms debounce
  await settle(2);
  assert.equal(picker.isConnected, true, 'the dialog-owning input was not rebuilt');
  assert.equal(el.shadowRoot.activeElement, picker, 'focus (and with it the dialog) stays put');
  const after = el.getContent().rows.flatMap((r) => r.cols.flatMap((c) => c.blocks))[0];
  assert.equal(after.props.color, '#ff0000', 'the colour still committed');
  const content = q(el, '[data-mc-content="' + block.id + '"]');
  assert.equal(content.style.color, 'rgb(255, 0, 0)', 'the canvas re-rendered live');
  const hex = q(el, '.mc-color-control input.mc-stepper-input');
  assert.equal(hex.value, '#ff0000', 'the pill previews itself while rebuilds are skipped');

  // The skip is scoped to a focused picker: once focus moves on, the panel
  // rebuilds as it always did.
  picker.blur();
  el.core.setProp(block.id, 'size', 20);
  await settle(2);
  assert.equal(picker.isConnected, false, 'with focus elsewhere the panel rebuilds normally');
});

await it('list items rescale per line without merging', async () => {
  const el = await mountEditor();
  el.core.insertBlock('list');
  await settle(2);
  const block = el.getContent().rows.flatMap((r) => r.cols.flatMap((c) => c.blocks))[0];
  el.core.setProp(block.id, 'items', '<span style="font-size:20px">First</span>\nSecond');
  el.core.setProp(block.id, 'size', 30); // list default is 15 -> doubles
  await settle(2);
  const after = el.getContent().rows.flatMap((r) => r.cols.flatMap((c) => c.blocks))[0];
  assert.equal(after.props.items.split('\n').length, 2, 'still two items');
  assert.match(after.props.items, /font-size:\s*40px/, 'the styled item scaled with the base');
});

await it('every block with a Font control renders the selected family', async () => {
  const el = await mountEditor();
  const family = 'Tahoma, Geneva, sans-serif';
  const types = ['text', 'button', 'social', 'countdown', 'menu', 'heading', 'list', 'table'];
  for (const type of types) {
    el.core.insertBlock(type);
    await settle(2);
    const block = el.getContent().rows.flatMap((r) => r.cols.flatMap((c) => c.blocks)).filter((b) => b.type === type).at(-1);
    if (type === 'social') el.core.setProp(block.id, 'showLabel', true);
    if (type === 'list') el.core.setProp(block.id, 'items', '<span style="font-family:Georgia, serif">Imported item</span>');
    el.core.setProp(block.id, 'fontFamily', family);
    await settle(2);
    const rendered = q(el, '[data-mc-content="' + block.id + '"]');
    const nodes = [rendered].concat(Array.from(rendered.querySelectorAll('*')));
    assert.ok(nodes.some((node) => node.style.fontFamily === family), type + ' applies the selected font');
    assert.equal(nodes.some((node) => /Georgia/i.test(node.style.fontFamily)), false, type + ' has no overriding imported font');
  }
});

console.log();
console.log('Focus and caret preservation');

await it('a focused inspector input keeps focus across a full re-render', async () => {
  const el = await mountEditor();
  el.importHtml(EMAIL);
  await settle(2);
  const block = el.getContent().rows[0].cols[0].blocks[0];
  el.core.select('block', block.id);
  await settle(2);
  const input = qa(el, 'input[data-focus-key]')[0] || qa(el, 'input')[0];
  assert.ok(input, 'the inspector rendered an input');
  input.focus();
  const key = input.getAttribute('data-focus-key');
  el.core.emit();
  await settle(3);
  if (key) {
    const after = q(el, '[data-focus-key="' + key + '"]');
    assert.ok(after, 'the field survived the rebuild');
  }
  assert.ok(true);
});

await it('a caret inside an edited block is restored after a rebuild', async () => {
  const { el, block } = await withText();
  el.core.setState({ editing: block.id, sel: { type: 'block', id: block.id } });
  await settle(3);
  const editable = q(el, '[contenteditable="true"]');
  assert.ok(editable, 'editable node');
  editable.focus();
  const doc = win().document;
  const range = doc.createRange();
  const textNode = editable.firstChild || editable;
  range.setStart(textNode, 0);
  range.collapse(true);
  const sel = win().getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  el.core.emit();
  await settle(3);
  assert.ok(q(el, '[contenteditable="true"]'), 'still editing after the rebuild');
});

await it('textOffset walks a tree and counts characters before a node', async () => {
  const { textOffset } = await import(new URL('../src/render/focus-preserve.js', import.meta.url).href);
  const doc = win().document;
  const root = doc.createElement('div');
  root.innerHTML = 'ab<b>cd</b>ef';
  const bold = root.querySelector('b');
  assert.equal(textOffset(root, root.firstChild, 2), 2);
  assert.equal(textOffset(root, bold.firstChild, 2), 4);
  assert.equal(textOffset(root, root.lastChild, 2), 6);
});

console.log();
console.log('Screenshot');

await it('captures the template as a png blob', async () => {
  const el = await mountEditor();
  el.importHtml(EMAIL);
  await settle(2);
  const blob = await el.screenshotPng();
  assert.equal(blob.type, 'image/png');
  assert.ok(blob.size > 0);
});

await it('captures at desktop width even with the mobile toggle on', async () => {
  const el = await mountEditor();
  el.importHtml(EMAIL);
  el.core.setState({ device: 'mobile' });
  await settle(2);
  const blob = await el.screenshotPng();
  assert.ok(blob.size > 0);
  assert.equal(el.core.state.device, 'mobile', 'the borrowed state was put back');
});

await it('downloading reports success through a toast', async () => {
  const el = await mountEditor();
  await settle(2);
  await el.downloadScreenshot();
  assert.ok(el.core.state.toast, 'a toast was raised');
});

await it('copying to the clipboard reports its outcome either way', async () => {
  const el = await mountEditor();
  await settle(2);
  await el.copyScreenshot();
  assert.ok(el.core.state.toast, 'success or failure, it says so');
});

await it('a pre-captured blob is saved as-is rather than re-rendered', async () => {
  const el = await mountEditor();
  await settle(2);
  const blob = new (win().Blob)([new Uint8Array([1, 2, 3])], { type: 'image/png' });
  await el.downloadScreenshot(blob);
  await el.copyScreenshot(blob);
  assert.ok(true, 'both accepted a supplied blob');
});

console.log();
console.log('Story viewer');

await it('opens over the editor and closes again', async () => {
  const el = await mountEditor();
  el.importHtml(EMAIL);
  await settle(2);
  el.previewScreenshot();
  await settle(3);
  assert.equal(el.story.isOpen(), true);
  el.story.close();
  await settle(2);
  assert.equal(el.story.isOpen(), false);
});

await it('opening twice is a no-op, not a second viewer', async () => {
  const el = await mountEditor();
  await settle(2);
  el.story.open();
  el.story.open();
  await settle(3);
  assert.equal(el.story.isOpen(), true);
  el.story.close();
});

await it('escape closes it', async () => {
  const el = await mountEditor();
  await settle(2);
  el.story.open();
  await settle(3);
  win().dispatchEvent(new (win().KeyboardEvent)('keydown', { key: 'Escape', bubbles: true }));
  await settle(2);
  assert.equal(el.story.isOpen(), false);
});

await it('retranslates while open', async () => {
  const el = await mountEditor();
  await settle(2);
  el.story.open();
  await settle(3);
  el.setAttribute('locale', 'de');
  await settle(2);
  el.story.retranslate();
  assert.ok(true, 'no throw');
  el.story.close();
});

/*
 * Fitting the column.
 *
 * jsdom lays nothing out, so these assert the declarations rather than
 * measured boxes -- the geometry they stand for was verified in a real
 * engine: a stock table needed 224px in a 148px column, a countdown 247px,
 * and in the sent email a long tracking URL dragged a 25% cell to 511px
 * against its neighbours' 24px. Each declaration below is the specific thing
 * that brings one of those back inside its column, and each is easy to drop
 * by accident while restyling the block.
 */
console.log();
console.log('Blocks stay inside their column');

/** The inline style of the rendered body for a freshly inserted block. */
async function styleOf(type, props) {
  const el = await mountEditor();
  el.core.insertBlock(type);
  await settle(2);
  const block = el.getContent().rows.flatMap((r) => r.cols.flatMap((c) => c.blocks)).find((b) => b.type === type);
  if (props) Object.keys(props).forEach((k) => el.core.setProp(block.id, k, props[k]));
  await settle(2);
  return { el, node: q(el, `[data-mc-content="${block.id}"]`) };
}

await it('text, heading and list can break a token too long for the column', async () => {
  for (const type of ['text', 'heading', 'list']) {
    const { node } = await styleOf(type);
    // `anywhere`, not `break-word`: only `anywhere` lowers the min-content
    // width, which is the number the column actually sizes against.
    assert.equal(node.style.overflowWrap, 'anywhere', type + ' breaks an over-long token');
  }
});

await it('the canvas does not rely on contenteditable to do that for it', async () => {
  const { node } = await styleOf('text');
  // Chrome's UA sheet gives [contenteditable] `overflow-wrap: break-word`,
  // which made the canvas look correct while the export -- which strips
  // contenteditable -- shipped the overflow. The declaration must be the
  // block's own, so it survives into the sent email.
  assert.match(node.getAttribute('style') || '', /overflow-wrap/, 'declared inline, not inherited from the editor');
});

await it('table cells break rather than hold the table open past the column', async () => {
  const { el, node } = await styleOf('table');
  assert.equal(node.tagName, 'TABLE');
  const cell = node.querySelector('th, td');
  assert.equal(cell.style.overflowWrap, 'anywhere', 'the cell, which is what sets the table min-content');
  // Deliberately not table-layout:fixed -- that also fits, but re-proportions
  // every table in every saved document.
  assert.equal(node.style.tableLayout, '', 'column proportions are left alone');
  el.remove();
});

await it('the countdown wraps its boxes instead of overhanging the next column', async () => {
  const { node } = await styleOf('countdown');
  const row = Array.from(node.querySelectorAll('div')).find((d) => d.style.display === 'flex');
  assert.ok(row, 'the digits sit in a flex row');
  assert.equal(row.style.flexWrap, 'wrap', 'which wraps when four boxes will not fit');
});

await it('menu items are atomic inlines, so a line can break between them', async () => {
  const { node } = await styleOf('menu');
  const links = Array.from(node.querySelectorAll('a'));
  assert.ok(links.length > 1);
  // Adjacent inline *text* runs offer no wrap opportunity between them, and
  // these are appended with no whitespace in between.
  links.forEach((a) => assert.equal(a.style.display, 'inline-block'));
});

await it('a code sample wraps its long lines, having no scrollbar in an inbox', async () => {
  const { node } = await styleOf('codeblock');
  assert.equal(node.tagName, 'PRE');
  assert.equal(node.style.whiteSpace, 'pre-wrap');
  assert.equal(node.style.overflowWrap, 'anywhere');
});

await it("a box's max width caps the box, not just its text area", async () => {
  const { node } = await styleOf('box', { maxW: 60 });
  assert.equal(node.style.maxWidth, '60%');
  assert.equal(node.style.boxSizing, 'border-box', 'padding and border sit inside the cap');
});

await it('a button renders as a one-cell table, which Word can pad and paint', async () => {
  const { node } = await styleOf('button');
  const table = node.querySelector('table');
  assert.ok(table, 'wrapped in a table rather than left as a bare padded anchor');
  const td = table.querySelector('td');
  // Word does not lay out inline-block and treats padding on an inline
  // anchor inconsistently; a cell is the one box it sizes and paints.
  assert.ok(td.getAttribute('bgcolor'), 'the cell carries the paint for Outlook');
  assert.equal(td.style.padding, '13px 26px', 'and the padding');
  const a = td.querySelector('a');
  assert.ok(a, 'the anchor is the label inside the cell');
  assert.ok(a.style.background, 'which keeps its own paint too, so classifyButton still sees a pill');
});

await it("a left-aligned button's table does not float, so the block keeps its height", async () => {
  const { node } = await styleOf('button', { align: 'left' });
  const table = node.querySelector('table');
  assert.equal(table.getAttribute('align'), 'left', 'Word still gets its alignment attribute');
  // Browsers map table[align=left|right] to a float presentational hint,
  // which takes the pill out of flow: the block collapses to a sliver on the
  // canvas and the button paints over the next block. The inline declaration
  // outranks the hint; text-align on the wrapper positions the inline-table.
  assert.equal(table.style.cssFloat, 'none', 'the inline style cancels the float hint');
  assert.equal(node.style.textAlign, 'left', 'the wrapper aligns the pill where floats are off');
});

console.log();
console.log('Mobile preview tells the truth');

/** Mounts a document of one row with the given mobile props, in the given device. */
async function previewRow(props, device, spans = [50, 50]) {
  const el = await mountEditor();
  el.core.insertRow(spans);
  await settle(2);
  const row = el.getContent().rows.at(-1);
  Object.keys(props).forEach((k) => el.core.setProp(row.id, k, props[k]));
  el.core.setState({ device });
  await settle(2);
  const sheet = q(el, '[data-mc-sheet]');
  return { el, sheet, row };
}

await it('the desktop preview is untouched by any mobile setting', async () => {
  const { sheet } = await previewRow({ mobileCols: 2, mobileOrder: 'reverse' }, 'desktop');
  const wraps = qa({ shadowRoot: sheet }, 'div').filter((d) => d.style.display === 'flex' && d.style.flexDirection);
  assert.equal(wraps.filter((d) => /reverse/.test(d.style.flexDirection)).length, 0, 'nothing reverses on desktop');
});

await it('the mobile preview reverses where the sent email reverses', async () => {
  const { sheet } = await previewRow({ mobileOrder: 'reverse' }, 'mobile');
  const rev = Array.from(sheet.querySelectorAll('div')).find((d) => d.style.flexDirection === 'column-reverse');
  assert.ok(rev, 'the row is drawn reversed, matching the exported .mc-rev rule');
});

await it('the mobile preview lays out two-up where the sent email does', async () => {
  const { sheet } = await previewRow({ mobileCols: 2 }, 'mobile');
  const half = Array.from(sheet.querySelectorAll('div')).filter((d) => d.style.maxWidth === '50%' && d.style.boxSizing === 'border-box');
  assert.ok(half.length >= 2, 'columns take half each, box-sized so their padding cannot wrap them');
});

await it('a row that keeps its columns is left alone on mobile', async () => {
  const { sheet } = await previewRow({ mobileCols: 'keep' }, 'mobile');
  const stacked = Array.from(sheet.querySelectorAll('div')).filter((d) => d.style.display === 'block' && d.style.flexDirection);
  assert.equal(stacked.length, 0);
});

await it('a block the current device would not receive is faded, not removed, while editing', async () => {
  const el = await mountEditor();
  el.core.insertBlock('text');
  await settle(2);
  const block = el.getContent().rows.flatMap((r) => r.cols.flatMap((c) => c.blocks))[0];
  el.core.setProp(block.id, 'vis', 'mobile');
  await settle(2);
  const node = q(el, `[data-mc-content="${block.id}"]`);
  // Hiding it outright would leave a block that cannot be selected, moved,
  // or set back to "all devices".
  assert.ok(node, 'still in the canvas');
  assert.equal(node.closest('[data-mc-slot]').style.opacity, '0.4', 'but visibly not shipping here');
});

console.log(`\n${passed} passed, ${failed} failed.`);
closeDom();
process.exit(failed ? 1 : 0);
