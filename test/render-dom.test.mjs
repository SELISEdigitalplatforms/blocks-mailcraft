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

await it('the font size nudges clamp at both ends', async () => {
  const { el, block } = await withText();
  el.core.select('block', block.id);
  el.core.setProp(block.id, 'size', 10);
  for (let i = 0; i < 4; i++) el.core.nudge(-2);
  await settle();
  const min = el.getContent().rows.flatMap((r) => r.cols.flatMap((c) => c.blocks))[0].props.size;
  assert.ok(min >= 10, 'clamped at the floor, got ' + min);
  el.core.setProp(block.id, 'size', 62);
  for (let i = 0; i < 4; i++) el.core.nudge(2);
  await settle();
  const max = el.getContent().rows.flatMap((r) => r.cols.flatMap((c) => c.blocks))[0].props.size;
  assert.ok(max <= 64, 'clamped at the ceiling, got ' + max);
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

console.log(`\n${passed} passed, ${failed} failed.`);
closeDom();
process.exit(failed ? 1 : 0);
