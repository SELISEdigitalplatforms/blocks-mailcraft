/**
 * The import-time CSS cascade: folding `<style>` rules into inline styles so
 * the importer's classifiers, which read inline styles only, see class-styled
 * templates the way a mail client would.
 *
 * Run: npm test
 *
 * Needs a document (it walks one), so it runs on the jsdom harness.
 */
import assert from 'node:assert/strict';
import { installDom, closeDom, win } from './dom-harness.mjs';

installDom();
const { inlineStylesheets } = await import(new URL('../src/core/css-cascade.js', import.meta.url).href);

let passed = 0;
let failed = 0;
async function it(name, fn) {
  try { await fn(); passed++; console.log('  ok    ' + name); }
  catch (e) { failed++; console.log('  FAIL  ' + name + '\n        ' + String(e.message).split('\n').join('\n        ')); }
}

/** Parses a body fragment (plus optional css) and folds the sheet in. */
function fold(css, body) {
  const html = '<!doctype html><html><head>' + (css === null ? '' : '<style>' + css + '</style>') + '</head><body>' + body + '</body></html>';
  const doc = new (win().DOMParser)().parseFromString(html, 'text/html');
  inlineStylesheets(doc);
  return doc;
}
const styleOf = (doc, sel) => doc.querySelector(sel).getAttribute('style') || '';

console.log();
console.log('CSS cascade (import-time inlining)');

await it('a document with no stylesheet is left alone', async () => {
  const doc = fold(null, '<p id="a" style="color:red">x</p>');
  assert.equal(styleOf(doc, '#a'), 'color:red');
});

await it('a stylesheet with no usable rules changes nothing', async () => {
  const doc = fold('   ', '<p id="a">x</p>');
  assert.equal(styleOf(doc, '#a'), '');
});

await it('class rules land on the element as inline style', async () => {
  const doc = fold('.hero { color: rgb(1, 2, 3); font-size: 20px }', '<p id="a" class="hero">x</p>');
  assert.match(styleOf(doc, '#a'), /color:\s*rgb\(1,\s*2,\s*3\)/);
  assert.match(styleOf(doc, '#a'), /font-size:\s*20px/);
});

await it('comments are stripped before parsing', async () => {
  const doc = fold('/* .hero { color: red } */ .hero { font-size: 9px }', '<p id="a" class="hero">x</p>');
  assert.doesNotMatch(styleOf(doc, '#a'), /color/);
  assert.match(styleOf(doc, '#a'), /9px/);
});

await it('block-less at-rules are dropped to the semicolon', async () => {
  const doc = fold('@import url("x.css"); .hero { color: rgb(9, 9, 9) }', '<p id="a" class="hero">x</p>');
  assert.match(styleOf(doc, '#a'), /rgb\(9,\s*9,\s*9\)/);
});

await it('an at-rule with no semicolon and no block consumes the rest', async () => {
  const doc = fold('@charset "utf-8"', '<p id="a" class="hero">x</p>');
  assert.equal(styleOf(doc, '#a'), '');
});

await it('@media blocks are dropped whole, base rules survive', async () => {
  const doc = fold('.hero { color: rgb(1, 1, 1) } @media (max-width: 600px) { .hero { color: rgb(2, 2, 2) } } .hero { font-size: 8px }',
    '<p id="a" class="hero">x</p>');
  assert.match(styleOf(doc, '#a'), /rgb\(1,\s*1,\s*1\)/, 'the desktop value wins');
  assert.match(styleOf(doc, '#a'), /8px/, 'rules after the at-rule still parse');
});

await it('nested at-rule braces are balanced correctly', async () => {
  const doc = fold('@supports (display: grid) { @media screen { .hero { color: red } } } .hero { font-size: 7px }',
    '<p id="a" class="hero">x</p>');
  assert.doesNotMatch(styleOf(doc, '#a'), /color/);
  assert.match(styleOf(doc, '#a'), /7px/);
});

await it('a declaration with no colon is ignored', async () => {
  const doc = fold('.hero { nonsense; font-size: 6px }', '<p id="a" class="hero">x</p>');
  assert.match(styleOf(doc, '#a'), /6px/);
});

await it('custom properties and mso- hacks are skipped', async () => {
  const doc = fold('.hero { --brand: red; mso-line-height-rule: exactly; font-size: 5px }', '<p id="a" class="hero">x</p>');
  assert.doesNotMatch(styleOf(doc, '#a'), /--brand|mso-/);
  assert.match(styleOf(doc, '#a'), /5px/);
});

await it('a declaration with an empty value is skipped', async () => {
  const doc = fold('.hero { color: ; font-size: 4px }', '<p id="a" class="hero">x</p>');
  assert.match(styleOf(doc, '#a'), /4px/);
});

await it('a rule whose declarations are all unusable is dropped', async () => {
  const doc = fold('.hero { --only: 1 } .hero { font-size: 3px }', '<p id="a" class="hero">x</p>');
  assert.match(styleOf(doc, '#a'), /3px/);
});

await it('the universal selector and pseudo-selectors are skipped', async () => {
  const doc = fold('* { color: rgb(7, 7, 7) } .hero:hover { color: rgb(8, 8, 8) } a::before { content: "x" } .hero { font-size: 2px }',
    '<p id="a" class="hero">x</p>');
  assert.doesNotMatch(styleOf(doc, '#a'), /color/);
  assert.match(styleOf(doc, '#a'), /2px/);
});

await it('a comma list applies to each selector in it', async () => {
  const doc = fold('.one, .two { color: rgb(4, 4, 4) }', '<p id="a" class="one">x</p><p id="b" class="two">y</p>');
  assert.match(styleOf(doc, '#a'), /rgb\(4,\s*4,\s*4\)/);
  assert.match(styleOf(doc, '#b'), /rgb\(4,\s*4,\s*4\)/);
});

await it('an empty selector in a comma list is skipped', async () => {
  const doc = fold('.one, , .two { font-size: 11px }', '<p id="a" class="one">x</p>');
  assert.match(styleOf(doc, '#a'), /11px/);
});

await it('a selector the engine rejects is skipped, not fatal', async () => {
  const doc = fold('.a[ { color: red } .hero { font-size: 12px }', '<p id="a" class="hero">x</p>');
  assert.match(styleOf(doc, '#a'), /12px/, 'parsing continued past the bad selector');
});

await it('specificity decides: id beats class beats tag', async () => {
  const doc = fold('p { font-size: 1px } .hero { font-size: 2px } #a { font-size: 3px }', '<p id="a" class="hero">x</p>');
  assert.match(styleOf(doc, '#a'), /3px/);
});

await it('equal specificity resolves by source order', async () => {
  const doc = fold('.hero { font-size: 1px } .other { font-size: 2px }', '<p id="a" class="hero other">x</p>');
  assert.match(styleOf(doc, '#a'), /2px/, 'the later rule wins');
});

await it('an attribute selector counts as a class for specificity', async () => {
  const doc = fold('p { color: rgb(1, 1, 1) } p[data-x] { color: rgb(2, 2, 2) }', '<p id="a" data-x="1">x</p>');
  assert.match(styleOf(doc, '#a'), /rgb\(2,\s*2,\s*2\)/);
});

await it('an inline style beats a stylesheet rule', async () => {
  const doc = fold('.hero { color: rgb(1, 1, 1) }', '<p id="a" class="hero" style="color: rgb(9, 9, 9)">x</p>');
  assert.match(styleOf(doc, '#a'), /rgb\(9,\s*9,\s*9\)/);
});

await it('!important beats an inline style', async () => {
  const doc = fold('.hero { color: rgb(1, 1, 1) !important }', '<p id="a" class="hero" style="color: rgb(9, 9, 9)">x</p>');
  assert.match(styleOf(doc, '#a'), /rgb\(1,\s*1,\s*1\)/);
});

await it('!important is not overwritten by a later non-important rule', async () => {
  const doc = fold('.hero { font-size: 1px !important } .hero { font-size: 2px }', '<p id="a" class="hero">x</p>');
  assert.match(styleOf(doc, '#a'), /1px/);
});

await it('a later !important does replace an earlier one', async () => {
  const doc = fold('.hero { font-size: 1px !important } .hero { font-size: 2px !important }', '<p id="a" class="hero">x</p>');
  assert.match(styleOf(doc, '#a'), /2px/);
});

await it('elements outside the body are ignored', async () => {
  const doc = fold('title { color: red } .hero { font-size: 13px }', '<p id="a" class="hero">x</p>');
  const title = doc.querySelector('title');
  assert.ok(!title || !(title.getAttribute('style') || '').includes('color'));
  assert.match(styleOf(doc, '#a'), /13px/);
});

await it('the body itself can be styled', async () => {
  const doc = fold('body { background: rgb(5, 5, 5) }', '<p>x</p>');
  assert.match(doc.body.getAttribute('style') || '', /rgb\(5,\s*5,\s*5\)/);
});

await it('an unparseable value is skipped without taking the pass down', async () => {
  const doc = fold('.hero { color: ((( ; font-size: 14px }', '<p id="a" class="hero">x</p>');
  assert.match(styleOf(doc, '#a'), /14px/);
});

await it('multiple stylesheets are concatenated in document order', async () => {
  const html = '<!doctype html><html><head><style>.hero{font-size:1px}</style><style>.hero{font-size:2px}</style></head><body><p id="a" class="hero">x</p></body></html>';
  const doc = new (win().DOMParser)().parseFromString(html, 'text/html');
  inlineStylesheets(doc);
  assert.match(styleOf(doc, '#a'), /2px/);
});

console.log(`\n${passed} passed, ${failed} failed.`);
closeDom();
process.exit(failed ? 1 : 0);
