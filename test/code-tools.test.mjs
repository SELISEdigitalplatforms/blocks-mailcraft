/**
 * Code-view text tooling: the Format pretty-printer, the tag scanner behind
 * the code <-> preview inspect link, find matching, and mark insertion into
 * highlighted lines.
 *
 * Run: npm test
 *
 * No DOM. The formatter's contract is the high-consequence part: it may only
 * move whitespace the renderer cannot see, because its output is one Apply
 * away from being the email a real recipient gets.
 */
import assert from 'node:assert/strict';

const { formatHtml, scanElements, elementAtOffset, findMatches, markRanges } = await import(new URL('../src/core/code-tools.js', import.meta.url).href);
const { hl } = await import(new URL('../src/core/sanitize.js', import.meta.url).href);

let passed = 0;
let failed = 0;
async function it(name, fn) {
  try { await fn(); passed++; console.log('  ok    ' + name); }
  catch (e) { failed++; console.log('  FAIL  ' + name + '\n        ' + String(e.message).split('\n').join('\n        ')); }
}

console.log();
console.log('Code tools (core/code-tools.js)');

// ---- formatHtml -----------------------------------------------------------

await it('indents table structure, one structural tag per line', async () => {
  const out = formatHtml('<table><tr><td>Hi</td></tr></table>');
  assert.equal(out, '<table>\n  <tr>\n    <td>Hi</td>\n  </tr>\n</table>\n');
});

await it('is idempotent', async () => {
  const src = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>.a{color:red}</style></head><body><table><tr><td><p>Hello <b>you</b></p></td></tr></table></body></html>';
  const once = formatHtml(src);
  assert.equal(formatHtml(once), once, 'formatting formatted output changes nothing');
});

await it('never invents whitespace between inline or inline-block elements', async () => {
  // Hybrid email columns: a space between inline-block divs wraps the layout.
  const cols = '<div style="display:inline-block;width:300px">a</div><div style="display:inline-block;width:300px">b</div>';
  assert.ok(formatHtml(cols).includes('</div><div'), 'div-div boundary with no whitespace stays glued');
  const inline = '<td><b>a</b><i>b</i><img src="x"></td>';
  assert.ok(formatHtml(inline).includes('<b>a</b><i>b</i><img src="x">'), 'inline runs stay byte-identical');
});

await it('normalizes whitespace that already existed, even between divs', async () => {
  const out = formatHtml('<table><tr><td>\n<div>a</div>   <div>b</div>\n</td></tr></table>');
  assert.match(out, /<div>a<\/div>\n\s*<div>b<\/div>/, 'an existing gap becomes a clean line break');
});

await it('keeps raw-text contents and comments byte-for-byte', async () => {
  const css = '\n .weird   {  color : red ;\n}\ntd>a{x:1}\n';
  const mso = '<!--[if mso]><table><tr><td>ms only</td></tr></table><![endif]-->';
  const out = formatHtml('<html><head><style>' + css + '</style></head><body>' + mso + '<table><tr><td>x</td></tr></table></body></html>');
  assert.ok(out.includes('<style>' + css + '</style>'), 'style contents untouched');
  assert.ok(out.includes(mso), 'conditional comment survives whole');
});

await it('leaves <pre> contents alone and gives handlebars block tags their own line', async () => {
  const pre = '<pre>  keep\n   this   spacing</pre>';
  assert.ok(formatHtml('<table><tr><td>' + pre + '</td></tr></table>').includes(pre));
  const out = formatHtml('<table>{{#if a}}<tr><td>x</td></tr>{{/if}}</table>');
  assert.match(out, /<table>\n\s*\{\{#if a\}\}\n\s*<tr>/, '{{#if}} sits on its own indented line');
  assert.match(out, /\{\{\/if\}\}\n<\/table>/);
});

await it('quoted attribute values may contain > without confusing the formatter', async () => {
  const tag = '<img alt="a > b" src="x">';
  assert.ok(formatHtml('<td>' + tag + '</td>').includes(tag));
});

await it('removing every whitespace-only gap gives back the input, gaps removed', async () => {
  // The strongest whole-string safety check: content bytes are only ever
  // separated by different whitespace, never altered.
  const src = '<!DOCTYPE html><html><body> <table> <tr><td><a href="#">Go</a> now</td><td>{{ name }}</td></tr></table></body></html>';
  const squash = (h) => h.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
  assert.equal(squash(formatHtml(src)), squash(src));
});

// ---- scanElements / elementAtOffset --------------------------------------

await it('scans elements with per-tag indices and source ranges', async () => {
  const src = '<table><tr><td>a</td><td><b>b</b></td></tr></table>';
  const scan = scanElements(src);
  assert.equal(scan.byTag.td.length, 2);
  assert.equal(scan.byTag.td[1].nth, 1);
  assert.equal(src.slice(scan.byTag.b[0].openStart, scan.byTag.b[0].closeEnd), '<b>b</b>');
  assert.equal(scan.els[0].tag, 'table');
  assert.equal(scan.byTag.b[0].parent >= 0 ? scan.els[scan.byTag.b[0].parent].tag : '', 'td', 'parent chain is recorded');
});

await it('the innermost element wins at a caret offset', async () => {
  const src = '<table><tr><td>xx</td><td><b>yy</b></td></tr></table>';
  const scan = scanElements(src);
  assert.equal(elementAtOffset(scan, src.indexOf('xx')).tag, 'td');
  assert.equal(elementAtOffset(scan, src.indexOf('yy')).tag, 'b');
  assert.equal(elementAtOffset(scan, 0).tag, 'table');
});

await it('raw text, comments and void elements do not fool the scanner', async () => {
  const src = '<head><style>td{color:red}</style></head><body><!-- <td>not real</td> --><img src="x"><td>real</td></body>';
  const scan = scanElements(src);
  assert.equal(scan.byTag.td.length, 1, 'the style rule and the comment td are not elements');
  assert.equal((scan.byTag.img || []).length, 1);
  assert.equal(scan.byTag.style[0].closeEnd, src.indexOf('</style>') + '</style>'.length);
});

await it('an unclosed element ends where its parent closes', async () => {
  const src = '<table><tr><td>xx</table>';
  const scan = scanElements(src);
  assert.equal(scan.byTag.td[0].closeStart, src.indexOf('</table>'));
  assert.equal(elementAtOffset(scan, src.indexOf('xx')).tag, 'td');
});

// ---- findMatches / markRanges ---------------------------------------------

await it('finds case-insensitive matches with offsets', async () => {
  const m = findMatches('Hello HELLO hello', 'hello');
  assert.deepEqual(m, [{ start: 0, end: 5 }, { start: 6, end: 11 }, { start: 12, end: 17 }]);
  assert.equal(findMatches('aaaa', 'aa').length, 2, 'non-overlapping');
  assert.equal(findMatches('x', '').length, 0);
});

await it('marks land on the right characters inside highlighted html', async () => {
  const line = '<td class="a">x &amp; y</td>';
  const html = hl(line);
  const at = line.indexOf('&amp;');
  const marked = markRanges(html, [{ start: at, end: at + 5, cur: true }]);
  assert.ok(marked.includes('<mark'), 'a mark was inserted');
  // Strip tags and decode: the marked text is exactly the source substring.
  const text = (s) => s.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const seg = /<mark[^>]*>([\s\S]*?)<\/mark>/.exec(marked.replace(/<\/mark>(<[^>]*>)*<mark[^>]*>/g, ''));
  assert.equal(text(seg[1]), '&amp;', 'entity counted as one source character');
  assert.equal(text(marked), text(html), 'marking never adds or removes text');
});

await it('marks split cleanly across the highlighter\'s own spans', async () => {
  const line = '<td width="10">hi</td>';
  const html = hl(line);
  const marked = markRanges(html, [{ start: 0, end: line.length, cur: false }]);
  const text = (s) => s.replace(/<[^>]*>/g, '');
  assert.equal(text(marked), text(html));
  assert.equal((marked.match(/<mark/g) || []).length, (marked.match(/<\/mark>/g) || []).length, 'every mark closes');
  assert.equal(/<mark[^>]*>[^<]*<span/.test(marked), false, 'no span opens inside a mark');
});

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed) process.exit(1);
