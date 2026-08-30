/**
 * Focus and caret survival across a full rebuild.
 *
 * Run: npm test
 *
 * The canvas is torn down and rebuilt on every state change -- no diffing --
 * so without this module every keystroke would drop focus and collapse the
 * caret. Driven against a real shadow root rather than the whole editor,
 * because the interesting cases (a slider mid-drag, a caret at a node
 * boundary) are hard to provoke through the UI and trivial to state here.
 */
import assert from 'node:assert/strict';
import { installDom, closeDom, win } from './dom-harness.mjs';

installDom();
const { withFocusPreserved, textOffset } = await import(new URL('../src/render/focus-preserve.js', import.meta.url).href);

let passed = 0;
let failed = 0;
async function it(name, fn) {
  try { await fn(); passed++; console.log('  ok    ' + name); }
  catch (e) { failed++; console.log('  FAIL  ' + name + '\n        ' + String(e.message).split('\n').join('\n        ')); }
}

/** A real shadow root, so `activeElement` behaves the way the editor's does. */
function shadow(html) {
  const host = win().document.createElement('div');
  win().document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = html;
  return root;
}

console.log();
console.log('Focus preservation');

await it('a rebuild with nothing focused just runs', async () => {
  const root = shadow('<div id="a">x</div>');
  let ran = false;
  withFocusPreserved(root, () => { ran = true; root.innerHTML = '<div id="b">y</div>'; });
  assert.equal(ran, true);
  assert.ok(root.querySelector('#b'));
});

await it('a focused element with no focus key is not restored', async () => {
  const root = shadow('<input id="plain">');
  root.getElementById ? null : null;
  const input = root.querySelector('#plain');
  input.focus();
  withFocusPreserved(root, () => { root.innerHTML = '<input id="plain">'; });
  assert.ok(true, 'no throw, nothing to restore');
});

await it('a text input keeps focus, selection and scroll', async () => {
  const root = shadow('<input data-focus-key="k1" value="hello world">');
  const input = root.querySelector('input');
  input.focus();
  input.setSelectionRange(2, 7);
  withFocusPreserved(root, () => { root.innerHTML = '<input data-focus-key="k1" value="hello world">'; });
  const next = root.querySelector('[data-focus-key="k1"]');
  assert.equal(root.activeElement, next, 'focus moved to the rebuilt node');
  assert.equal(next.selectionStart, 2);
  assert.equal(next.selectionEnd, 7);
});

await it('a textarea is treated the same way', async () => {
  const root = shadow('<textarea data-focus-key="k2">some text</textarea>');
  const ta = root.querySelector('textarea');
  ta.focus();
  ta.setSelectionRange(1, 4);
  withFocusPreserved(root, () => { root.innerHTML = '<textarea data-focus-key="k2">some text</textarea>'; });
  const next = root.querySelector('[data-focus-key="k2"]');
  assert.equal(next.selectionStart, 1);
  assert.equal(next.selectionEnd, 4);
});

await it('an input type that has no selection api does not break the pass', async () => {
  const root = shadow('<input type="color" data-focus-key="k3" value="#ff0000">');
  const input = root.querySelector('input');
  input.focus();
  withFocusPreserved(root, () => { root.innerHTML = '<input type="color" data-focus-key="k3" value="#ff0000">'; });
  assert.ok(root.querySelector('[data-focus-key="k3"]'), 'rebuilt and survived');
});

await it('a range slider keeps the live node so the drag capture is not dropped', async () => {
  const root = shadow('<input type="range" data-focus-key="k4" min="0" max="10" step="1" value="4">');
  const slider = root.querySelector('input');
  slider.focus();
  withFocusPreserved(root, () => {
    root.innerHTML = '<input type="range" data-focus-key="k4" min="0" max="20" step="2" value="4">';
  });
  const next = root.querySelector('[data-focus-key="k4"]');
  assert.equal(next, slider, 'the original element was spliced back in, not replaced');
  assert.equal(next.getAttribute('max'), '20', 'but its attributes were synced to the new tree');
  assert.equal(next.getAttribute('step'), '2');
});

await it('an attribute dropped by the rebuild is removed from the kept slider', async () => {
  const root = shadow('<input type="range" data-focus-key="k5" min="0" max="10" step="1">');
  const slider = root.querySelector('input');
  slider.focus();
  withFocusPreserved(root, () => {
    root.innerHTML = '<input type="range" data-focus-key="k5" min="0" max="10">';
  });
  assert.equal(slider.hasAttribute('step'), false, 'step was removed to match');
});

await it('a caret in a contenteditable is restored by character offset', async () => {
  const root = shadow('<div contenteditable="true" data-focus-key="k6">abcdef</div>');
  const box = root.querySelector('[contenteditable]');
  box.focus();
  const doc = win().document;
  const range = doc.createRange();
  range.setStart(box.firstChild, 2);
  range.setEnd(box.firstChild, 4);
  const sel = win().getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  withFocusPreserved(root, () => { root.innerHTML = '<div contenteditable="true" data-focus-key="k6">abcdef</div>'; });
  const next = root.querySelector('[data-focus-key="k6"]');
  assert.ok(next, 'rebuilt');
  assert.equal(root.activeElement, next, 'still focused');
});

await it('a caret spanning inline markup is restored', async () => {
  const root = shadow('<div contenteditable="true" data-focus-key="k7">ab<b>cd</b>ef</div>');
  const box = root.querySelector('[contenteditable]');
  box.focus();
  const doc = win().document;
  const range = doc.createRange();
  range.setStart(box.querySelector('b').firstChild, 1);
  range.collapse(true);
  const sel = win().getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  withFocusPreserved(root, () => { root.innerHTML = '<div contenteditable="true" data-focus-key="k7">ab<b>cd</b>ef</div>'; });
  assert.ok(root.querySelector('[data-focus-key="k7"]'));
});

await it('a selection outside the focused node is not captured', async () => {
  const root = shadow('<div contenteditable="true" data-focus-key="k8">inside</div><p id="other">outside</p>');
  const box = root.querySelector('[contenteditable]');
  box.focus();
  const doc = win().document;
  const range = doc.createRange();
  range.selectNodeContents(root.querySelector('#other'));
  const sel = win().getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  withFocusPreserved(root, () => { root.innerHTML = '<div contenteditable="true" data-focus-key="k8">inside</div>'; });
  assert.ok(root.querySelector('[data-focus-key="k8"]'), 'rebuild still completed');
});

await it('a key that no longer exists after the rebuild is dropped quietly', async () => {
  const root = shadow('<input data-focus-key="gone" value="x">');
  root.querySelector('input').focus();
  withFocusPreserved(root, () => { root.innerHTML = '<div>replaced</div>'; });
  assert.equal(root.querySelector('[data-focus-key="gone"]'), null);
});

await it('a focus key with characters that need escaping still resolves', async () => {
  const root = shadow('<input data-focus-key="row.1:pad" value="x">');
  const input = root.querySelector('input');
  input.focus();
  withFocusPreserved(root, () => { root.innerHTML = '<input data-focus-key="row.1:pad" value="x">'; });
  assert.ok(root.querySelector('[data-focus-key="row.1:pad"]'), 'the key was escaped for the selector');
});

console.log();
console.log('textOffset');

await it('counts characters before a text node', async () => {
  const doc = win().document;
  const root = doc.createElement('div');
  root.innerHTML = 'ab<b>cd</b>ef';
  assert.equal(textOffset(root, root.firstChild, 0), 0);
  assert.equal(textOffset(root, root.firstChild, 2), 2);
  assert.equal(textOffset(root, root.querySelector('b').firstChild, 1), 3);
  assert.equal(textOffset(root, root.lastChild, 2), 6);
});

await it('handles a boundary that lands on an element rather than text', async () => {
  const doc = win().document;
  const root = doc.createElement('div');
  root.innerHTML = 'ab<b>cd</b>ef';
  const n = textOffset(root, root, 1);
  assert.equal(typeof n, 'number');
  assert.ok(n >= 0);
});

await it('an offset past the end clamps rather than running away', async () => {
  const doc = win().document;
  const root = doc.createElement('div');
  root.textContent = 'abc';
  assert.ok(textOffset(root, root.firstChild, 99) <= 99);
});

await it('an empty root is offset zero', async () => {
  const doc = win().document;
  const root = doc.createElement('div');
  assert.equal(textOffset(root, root, 0), 0);
});

console.log(`\n${passed} passed, ${failed} failed.`);
closeDom();
process.exit(failed ? 1 : 0);
