/**
 * Top-bar configuration: which parts of the editor's own header are shown.
 *
 * Run: npm test
 *
 * Pure resolution logic -- no DOM. The rendering half (a shell built with no
 * header row) is checked by hand in a browser; see AGENTS.md.
 */
import assert from 'node:assert/strict';

const { resolveToolbar, toolbarKey, TOOLBAR_ITEMS } = await import(new URL('../src/core/toolbar.js', import.meta.url).href);

let passed = 0;
let failed = 0;
async function it(name, fn) {
  try { await fn(); passed++; console.log('  ok    ' + name); }
  catch (e) { failed++; console.log('  FAIL  ' + name + '\n        ' + String(e.message).split('\n').join('\n        ')); }
}

const allOn = (v) => TOOLBAR_ITEMS.every((k) => v[k] === true);

console.log('\nToolbar (host decides what the editor shows of its own chrome)');

await it('unset shows the whole bar', async () => {
  assert.equal(allOn(resolveToolbar(undefined)), true);
  assert.equal(allOn(resolveToolbar(null)), true);
  assert.equal(allOn(resolveToolbar('')), true);
  assert.equal(allOn(resolveToolbar('all')), true);
});

await it('false and the hidden keywords mean no bar at all', async () => {
  ['none', 'hidden', 'off', 'false', ' NONE '].forEach((v) => assert.equal(resolveToolbar(v), null, v));
  assert.equal(resolveToolbar(false), null);
});

await it('an object switches parts off without restating the rest', async () => {
  const on = resolveToolbar({ logo: false, ai: false });
  assert.equal(on.logo, false);
  assert.equal(on.ai, false);
  assert.equal(on.export, true, 'everything not named stays on');
  assert.equal(on.undo, true);
});

await it('an attribute list names the parts to keep', async () => {
  const on = resolveToolbar('undo,redo,export');
  assert.deepEqual(TOOLBAR_ITEMS.filter((k) => on[k]), ['undo', 'redo', 'export']);
});

await it('whitespace in the attribute list is tolerated', async () => {
  const on = resolveToolbar(' export , logo ');
  assert.deepEqual(TOOLBAR_ITEMS.filter((k) => on[k]), ['logo', 'export']);
});

await it('an unknown name in the list is ignored, not an error', async () => {
  const on = resolveToolbar('export,not-a-control');
  assert.deepEqual(TOOLBAR_ITEMS.filter((k) => on[k]), ['export']);
});

await it('switching every part off collapses to no bar', async () => {
  const everythingOff = {};
  TOOLBAR_ITEMS.forEach((k) => { everythingOff[k] = false; });
  assert.equal(resolveToolbar(everythingOff), null, 'an empty 54px bar is not what that meant');
});

await it('the key is stable, so a set that changes nothing costs no rebuild', async () => {
  assert.equal(toolbarKey(resolveToolbar({ logo: false })), toolbarKey(resolveToolbar({ logo: false })));
  assert.notEqual(toolbarKey(resolveToolbar({ logo: false })), toolbarKey(resolveToolbar({ ai: false })));
  assert.equal(toolbarKey(resolveToolbar(false)), 'none');
});

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed) process.exit(1);
