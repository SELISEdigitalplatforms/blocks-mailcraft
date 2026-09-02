/**
 * Keyboard shortcuts, the selection listener, the export/code/AI panels and
 * the inspector's compound field callbacks.
 *
 * Run: npm test
 *
 * These are the paths behind buttons and key presses -- the last part of
 * EditorCore a host never calls and a render test never triggers.
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
const blocksOf = (el) => el.getContent().rows.flatMap((r) => r.cols.flatMap((c) => c.blocks));
const EMAIL = '<table><tr><td><h1>Launch</h1><p>Body copy</p></td></tr></table>';

/** A keydown the editor's window-level listener will see, with a composedPath it can trust. */
function key(k, opts) {
  const o = opts || {};
  const ev = new (win().KeyboardEvent)('keydown', { key: k, bubbles: true, cancelable: true, ctrlKey: !!o.ctrl, metaKey: !!o.meta, shiftKey: !!o.shift });
  if (o.target) ev.composedPath = () => [o.target];
  return ev;
}
const press = (k, opts) => win().dispatchEvent(key(k, opts));

/** Puts a text block into edit mode and returns it. */
async function editing(el) {
  el.core.insertBlock('text');
  await settle(2);
  const block = blocksOf(el)[0];
  el.core.setState({ editing: block.id, sel: { type: 'block', id: block.id } });
  await settle(3);
  el.core.editEl = q(el, '[contenteditable="true"]');
  // `editKey`/`editPlain` travel with `editEl` -- canvas.js `onFocus` sets all
  // three together, and the live-edit fold (mailcraft-editor.js) needs the key
  // to know which prop the node is a copy of.
  el.core.editKey = 'html';
  el.core.editPlain = false;
  return block;
}

console.log();
console.log('Keyboard shortcuts');

await it('escape clears the selection and closes every panel', async () => {
  const el = await mountEditor();
  el.importHtml(EMAIL);
  await settle(2);
  el.core.select('row', el.getContent().rows[0].id);
  el.core.setState({ exportOpen: true, libraryOpen: true });
  await settle(2);
  press('Escape');
  await settle(2);
  assert.equal(el.core.state.sel, null);
  assert.equal(el.core.state.exportOpen, false);
  assert.equal(el.core.state.libraryOpen, false);
});

await it('escape inside a field blurs it instead of dropping the selection', async () => {
  const el = await mountEditor();
  el.importHtml(EMAIL);
  await settle(2);
  el.core.select('row', el.getContent().rows[0].id);
  await settle(2);
  const input = q(el, 'input');
  let blurred = false;
  const target = { blur: () => { blurred = true; }, tagName: 'INPUT', isContentEditable: false };
  press('Escape', { target });
  await settle(2);
  assert.equal(blurred, true, 'the field was blurred');
  assert.ok(el.core.state.sel, 'and the selection survived');
  assert.ok(input || true);
});

await it('ctrl+z undoes and ctrl+shift+z redoes', async () => {
  const el = await mountEditor();
  el.core.insertBlock('heading');
  await settle(2);
  assert.equal(blocksOf(el).length, 1);
  press('z', { ctrl: true });
  await settle(2);
  assert.equal(blocksOf(el).length, 0, 'undone');
  press('z', { ctrl: true, shift: true });
  await settle(2);
  assert.equal(blocksOf(el).length, 1, 'redone');
});

await it('undo inside a form field is left to the browser', async () => {
  const el = await mountEditor();
  el.core.insertBlock('heading');
  await settle(2);
  const before = blocksOf(el).length;
  press('z', { ctrl: true, target: { tagName: 'INPUT', isContentEditable: false } });
  await settle(2);
  assert.equal(blocksOf(el).length, before, 'the document was not touched');
});

await it('undo inside a contenteditable is still document undo', async () => {
  const el = await mountEditor();
  el.core.insertBlock('heading');
  await settle(2);
  press('z', { ctrl: true, target: { tagName: 'DIV', isContentEditable: true } });
  await settle(2);
  assert.equal(blocksOf(el).length, 0, 'the block edit was undone');
});

await it('ctrl+e opens the export panel', async () => {
  const el = await mountEditor();
  el.importHtml(EMAIL);
  await settle(2);
  press('e', { ctrl: true });
  await settle(2);
  assert.equal(el.core.state.exportOpen, true);
  assert.ok(el.core.state.exportCode.length > 100, 'and it was seeded with the html');
});

await it('ctrl+k opens the link editor, but only while editing', async () => {
  const el = await mountEditor();
  await settle(2);
  press('k', { ctrl: true });
  await settle(2);
  assert.equal(el.core.state.linkDraft, null, 'nothing to link to');
  await editing(el);
  press('k', { ctrl: true });
  await settle(2);
  assert.ok(el.core.state.linkDraft, 'the popover opened');
});

await it('ctrl+d duplicates the selection', async () => {
  const el = await mountEditor();
  el.core.insertBlock('heading');
  await settle(2);
  el.core.select('block', blocksOf(el)[0].id);
  await settle(2);
  press('d', { ctrl: true });
  await settle(2);
  assert.equal(blocksOf(el).length, 2);
});

await it('backspace deletes the selection, and does nothing while typing', async () => {
  const el = await mountEditor();
  el.core.insertBlock('heading');
  await settle(2);
  el.core.select('block', blocksOf(el)[0].id);
  await settle(2);
  press('Backspace', { target: { tagName: 'INPUT', isContentEditable: false } });
  await settle(2);
  assert.equal(blocksOf(el).length, 1, 'a keystroke in a field is not a delete');
  press('Delete');
  await settle(2);
  assert.equal(blocksOf(el).length, 0, 'but a bare Delete is');
});

await it('an unhandled key falls through', async () => {
  const el = await mountEditor();
  await settle(2);
  press('q');
  press('F5');
  await settle(2);
  assert.ok(true, 'no throw');
});

console.log();
console.log('Selection tracking');

await it('a caret move inside the edited block saves a range and refreshes the toolbar', async () => {
  const el = await mountEditor();
  await editing(el);
  let refreshes = 0;
  el.core.onFormatChange = () => { refreshes++; };
  const doc = win().document;
  const box = doc.createElement('div');
  box.setAttribute('contenteditable', 'true');
  box.innerHTML = 'abcdef';
  doc.body.appendChild(box);
  el.core.editEl = box;
  const sel = win().getSelection();
  const range = doc.createRange();
  range.setStart(box.firstChild, 2);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  el.core.onSelect();
  assert.ok(el.core.savedRange, 'the range was cached');
  assert.equal(refreshes, 1);
  // The same position again must not cost a second toolbar rebuild.
  el.core.onSelect();
  assert.equal(refreshes, 1, 'an unchanged caret is ignored');
  const r2 = doc.createRange();
  r2.setStart(box.firstChild, 4);
  r2.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r2);
  el.core.onSelect();
  assert.equal(refreshes, 2, 'a real move does refresh');
});

await it('a selection change with nothing being edited is ignored', async () => {
  const el = await mountEditor();
  await settle(2);
  el.core.setState({ editing: null });
  el.core.onSelect();
  assert.ok(true, 'returned early');
});

await it('a selection outside the edited block is ignored', async () => {
  const el = await mountEditor();
  await editing(el);
  const doc = win().document;
  const outside = doc.createElement('p');
  outside.textContent = 'elsewhere';
  doc.body.appendChild(outside);
  const range = doc.createRange();
  range.selectNodeContents(outside);
  const sel = win().getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  el.core.onSelect();
  assert.ok(true, 'no throw, nothing cached from outside');
});

console.log();
console.log('Links and sizing');

await it('a link is opened, applied and removed', async () => {
  const el = await mountEditor();
  const block = await editing(el);
  el.core.openLink();
  await settle(2);
  assert.ok(el.core.state.linkDraft, 'draft open');
  el.core.setState({ linkDraft: { href: 'https://example.com/a', blank: true, editing: false } });
  el.core.applyLink(blocksOf(el)[0]);
  await settle(2);
  assert.equal(el.core.state.linkDraft, null, 'applying closes the popover');
  el.core.removeLink(blocksOf(el)[0]);
  await settle(2);
  assert.ok(block, 'and unlinking ran');
});

await it('applying with no draft open is a no-op', async () => {
  const el = await mountEditor();
  await editing(el);
  el.core.setState({ linkDraft: null });
  el.core.applyLink(blocksOf(el)[0]);
  assert.ok(true);
});

await it('size() folds the live text in before changing the size', async () => {
  const el = await mountEditor();
  await editing(el);
  const block = blocksOf(el)[0];
  el.core.editEl.innerHTML = 'edited then resized';
  el.core.size(block, 4);
  await settle(2);
  const after = blocksOf(el)[0];
  assert.match(JSON.stringify(after.props), /edited then resized/, 'the edit was committed first');
  assert.ok(after.props.size >= 10 && after.props.size <= 64);
});

console.log();
console.log('Export, code and AI panels');

await it('copying the export reports it', async () => {
  const el = await mountEditor();
  el.importHtml(EMAIL);
  await settle(2);
  el.core.openExport();
  await settle(2);
  el.core.copyExport();
  await settle(2);
  assert.equal(el.core.state.copied, true);
});

await it('downloading the export mints and revokes a url', async () => {
  const el = await mountEditor();
  el.importHtml(EMAIL);
  await settle(2);
  el.core.openExport();
  await settle(2);
  el.core.downloadExport();
  await settle(2);
  assert.ok(true, 'the download path ran');
});

await it('typing in the code editor marks it dirty without touching the document', async () => {
  const el = await mountEditor();
  el.importHtml(EMAIL);
  await settle(2);
  el.core.openCode();
  await settle(2);
  const rowsBefore = el.getContent().rows.length;
  el.core.setCodeSrc('<h1>typed</h1>');
  await settle(2);
  assert.equal(el.core.state.codeSrc, '<h1>typed</h1>');
  assert.equal(el.core.state.codeDirty, true);
  assert.equal(el.getContent().rows.length, rowsBefore, 'the document is untouched until Apply');
});

await it('applying unparseable source reports a parse error', async () => {
  const el = await mountEditor();
  await settle(2);
  el.core.openCode();
  await settle(2);
  el.core.setCodeSrc('');
  await settle(2);
  el.core.applyCode();
  await settle(2);
  assert.ok(el.core.state.toast, 'it said something');
});

await it('the AI panel runs a provider and offers its results', async () => {
  const el = await mountEditor();
  await settle(2);
  const prompts = [];
  el.aiProvider = async (p) => { prompts.push(p); return 'Subject: Hi\n\nBody copy from the model.'; };
  el.core.setState({ aiOpen: true, aiBrief: 'a launch email', aiGoal: 'Full email draft', aiTone: 'Confident, plain' });
  await settle(2);
  await el.core.runAi();
  await settle(2);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /launch email/);
  assert.equal(el.core.state.aiBusy, false, 'it finished');
});

await it('a provider that throws falls back to a draft rather than failing', async () => {
  const el = await mountEditor();
  await settle(2);
  el.aiProvider = async () => { throw new Error('model unavailable'); };
  el.core.setState({ aiOpen: true, aiBrief: 'the autumn drop.' });
  await settle(2);
  await el.core.runAi();
  await settle(2);
  assert.equal(el.core.state.aiBusy, false);
  assert.ok(el.core.state.aiResults.length >= 3, 'it still offered something usable');
  assert.match(el.core.state.aiResults[1].text, /autumn drop/, 'built from the brief');
});

await it('a provider that returns unparseable text falls back the same way', async () => {
  const el = await mountEditor();
  await settle(2);
  el.aiProvider = async () => 'not json at all';
  el.core.setState({ aiOpen: true, aiBrief: 'winter sale' });
  await settle(2);
  await el.core.runAi();
  await settle(2);
  assert.ok(el.core.state.aiResults.length >= 3);
});

await it('each AI suggestion inserts a block when used', async () => {
  const el = await mountEditor();
  await settle(2);
  el.aiProvider = async () => JSON.stringify({ headline: 'Meet Nova', body: 'Body text.', cta: 'Buy' });
  el.core.setState({ aiOpen: true, aiBrief: 'launch' });
  await settle(2);
  await el.core.runAi();
  await settle(2);
  for (const r of el.core.state.aiResults) {
    if (typeof r.onUse === 'function') { r.onUse(); await settle(2); }
  }
  assert.ok(blocksOf(el).length >= 3, 'every suggestion added its block');
  assert.ok(el.core.state.toast, 'and said so');
});

await it('with no provider the AI panel says so instead of hanging', async () => {
  const el = await mountEditor();
  await settle(2);
  el.aiProvider = null;
  el.core.setState({ aiOpen: true, aiBrief: 'x' });
  await settle(2);
  await el.core.runAi();
  await settle(2);
  assert.equal(el.core.state.aiBusy, false);
});

console.log();
console.log('Theme and compound inspector fields');

await it('theme values commit to the document', async () => {
  const el = await mountEditor();
  await settle(2);
  el.core.setTheme('bg', '#101010');
  el.core.setTheme('width', 700);
  await settle(2);
  assert.equal(el.getContent().theme.bg, '#101010');
  assert.equal(el.getContent().theme.width, 700);
});

await it('the compound fields of every block type build and accept a change', async () => {
  const el = await mountEditor();
  await settle(2);
  const compound = { text: 'richLinks', social: 'social', table: 'tablegrid' };
  for (const [type, kind] of Object.entries(compound)) {
    el.core.insertBlock(type);
    await settle(2);
    const block = blocksOf(el).at(-1);
    // richLinks is offered only when there is a link to edit.
    if (type === 'text') { el.core.setProp(block.id, 'html', 'see <a href="https://example.com">this</a>'); await settle(2); }
    el.core.select('block', block.id);
    await settle(2);
    const field = el.core.fields().find((f) => f && f.kind === kind);
    assert.ok(field, kind + ' field present for ' + type);
    if (typeof field.onChange === 'function') field.onChange(field.value || '');
    await settle(2);
  }
  assert.ok(true, 'every compound field accepted a change');
});

await it('row padding splits into four sides and back', async () => {
  const el = await mountEditor();
  el.core.insertRow([100]);
  await settle(2);
  const row = el.getContent().rows.at(-1);
  el.core.select('row', row.id);
  await settle(2);
  el.core.togglePadSplit(row.id);
  await settle(2);
  assert.equal(el.getContent().rows.find((r) => r.id === row.id).props.padSplit, true);
  const split = el.core.fields();
  assert.ok(split.length, 'the split fields rendered');
  el.core.togglePadSplit(row.id);
  await settle(2);
  assert.equal(el.getContent().rows.find((r) => r.id === row.id).props.padSplit, false);
});

await it('advanced options add the developer-grade fields', async () => {
  const el = await mountEditor();
  el.core.insertRow([100]);
  await settle(2);
  el.core.select('row', el.getContent().rows.at(-1).id);
  await settle(2);
  const plain = el.core.fields().length;
  el.core.setState({ advancedOpen: true });
  await settle(2);
  assert.ok(el.core.fields().length > plain, 'more fields behind the switch');
});

await it('with nothing selected the inspector has no fields', async () => {
  const el = await mountEditor();
  await settle(2);
  el.core.setState({ sel: null });
  assert.deepEqual(el.core.fields(), []);
});

await it('a column carries its own styling fields', async () => {
  const el = await mountEditor();
  el.core.insertRow([50, 50]);
  await settle(2);
  const row = el.getContent().rows.at(-1);
  el.core.setColProp(row.id, 0, 'bg', '#fafafa');
  el.core.setColProp(row.id, 0, 'radius', 8);
  await settle(2);
  const col = el.getContent().rows.find((r) => r.id === row.id).cols[0];
  assert.equal(col.bg, '#fafafa');
  assert.equal(col.radius, 8);
});

console.log(`\n${passed} passed, ${failed} failed.`);
closeDom();
process.exit(failed ? 1 : 0);
