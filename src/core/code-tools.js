/**
 * Pure string helpers behind the Code view's editor features: a conservative
 * HTML pretty-printer (Format), a tag scanner that powers the code <-> preview
 * inspect link, plain-text search, and <mark> insertion into already
 * syntax-highlighted lines. No DOM anywhere -- everything here is
 * string-in/string-out so it runs (and is tested) in bare Node.
 */

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

/** Raw-text elements: the parser treats their contents as text, so the scanner and formatter must never read tags inside them. */
const RAW_TAGS = new Set(['style', 'script', 'textarea', 'title']);

/**
 * The only tags between which the formatter may *invent* a line break where
 * the source had no whitespace at all. Chosen because whitespace-only text is
 * invisible there: table internals (the parser lifts it out of the row grid),
 * and metadata that never renders. Deliberately absent: div, span, a, img --
 * whitespace between inline or inline-block elements paints as a visible gap,
 * and hybrid email columns (inline-block divs) actually break on a stray
 * space, so those boundaries only ever break where whitespace already existed.
 */
const SAFE_BREAK = new Set(['html', 'head', 'body', 'meta', 'title', 'link', 'style', 'script', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'ul', 'ol', 'li']);

/** whitespace-significant containers: everything inside is emitted verbatim. */
const PRE_TAGS = new Set(['pre', 'textarea']);

/** Index of the `>` closing the tag that starts before `from`, skipping quoted attribute values (`<img alt="a > b">`). -1 when the tag never closes. */
function tagEnd(s, from) {
  let quote = '';
  for (let j = from; j < s.length; j++) {
    const ch = s[j];
    if (quote) { if (ch === quote) quote = ''; }
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '>') return j;
  }
  return -1;
}

const TAG_NAME = /^[a-zA-Z][a-zA-Z0-9-]*/;

/**
 * Lexes html into { kind, text, tag?, selfClose? } tokens: 'tag' (an open
 * tag), 'close', 'comment' (whole comment, conditional comments included),
 * 'decl' (doctype / CDATA / processing instruction), 'raw' (the verbatim
 * contents of a raw-text element) and 'text'. Lenient by design -- a stray
 * `<` stays part of the surrounding text.
 */
function tokenize(src) {
  const s = String(src == null ? '' : src);
  const lower = s.toLowerCase();
  const n = s.length;
  const tokens = [];
  const pushText = (from, to) => { if (to > from) tokens.push({ kind: 'text', text: s.slice(from, to) }); };
  let last = 0;
  let i = 0;
  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt === -1) break;
    const c = s[lt + 1];
    if (c === '!' || c === '?') {
      let end; let kind = 'decl';
      if (s.startsWith('<!--', lt)) { const at = s.indexOf('-->', lt + 4); end = at === -1 ? n : at + 3; kind = 'comment'; }
      else { const at = tagEnd(s, lt + 1); end = at === -1 ? n : at + 1; }
      pushText(last, lt);
      tokens.push({ kind, text: s.slice(lt, end) });
      last = i = end;
      continue;
    }
    if (c === '/' && TAG_NAME.test(s.slice(lt + 2, lt + 3))) {
      const at = tagEnd(s, lt + 2);
      const end = at === -1 ? n : at + 1;
      const tag = TAG_NAME.exec(lower.slice(lt + 2, lt + 32))[0];
      pushText(last, lt);
      tokens.push({ kind: 'close', tag, text: s.slice(lt, end) });
      last = i = end;
      continue;
    }
    if (c && TAG_NAME.test(c)) {
      const at = tagEnd(s, lt + 1);
      const end = at === -1 ? n : at + 1;
      const tag = TAG_NAME.exec(lower.slice(lt + 1, lt + 32))[0];
      const selfClose = s[end - 2] === '/';
      pushText(last, lt);
      tokens.push({ kind: 'tag', tag, text: s.slice(lt, end), selfClose });
      last = i = end;
      if (RAW_TAGS.has(tag) && !selfClose) {
        const closeAt = lower.indexOf('</' + tag, end);
        const stop = closeAt === -1 ? n : closeAt;
        if (stop > end) tokens.push({ kind: 'raw', tag, text: s.slice(end, stop) });
        last = i = stop;
      }
      continue;
    }
    i = lt + 1;
  }
  pushText(last, n);
  return tokens;
}

/** A text run that is exactly one handlebars block tag ({{#if …}}, {{/each}}) -- worth its own line, like the structural rows it usually sits between. */
const isLogicToken = (text) => /^\{\{[#/][^{}]*\}\}$/.test(text);

/**
 * Pretty-prints html without changing what it renders: two-space indentation,
 * one structural tag per line. The rules that keep it rendering-identical:
 *
 * 1. Non-whitespace text is copied byte for byte -- never reflowed.
 * 2. Whitespace between nodes is only *normalized* (to newline + indent)
 *    where whitespace already existed; a break is *invented* only between
 *    SAFE_BREAK tags, where whitespace-only text is invisible.
 * 3. Raw-text contents (<style>, <script>) and everything inside <pre> /
 *    <textarea> pass through verbatim.
 * 4. Comments are atomic, so MSO conditionals survive whole.
 *
 * Idempotent: formatting formatted output returns it unchanged.
 */
export function formatHtml(src) {
  const tokens = tokenize(src);
  // Split text into whitespace gaps (formatting material) and content cores (untouchable).
  const items = [];
  for (const tk of tokens) {
    if (tk.kind !== 'text') { items.push(tk); continue; }
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(tk.text);
    if (m[2] === '') { items.push({ kind: 'gap', text: tk.text }); continue; }
    if (m[1]) items.push({ kind: 'gap', text: m[1] });
    items.push({ kind: 'text', text: m[2] });
    if (m[3]) items.push({ kind: 'gap', text: m[3] });
  }
  const breaky = (it) => !!it && (
    ((it.kind === 'tag' || it.kind === 'close') && SAFE_BREAK.has(it.tag))
    || it.kind === 'decl'
    || (it.kind === 'text' && isLogicToken(it.text))
  );
  let out = '';
  let started = false;
  const stack = [];
  let prev = null;
  let gap = null;
  for (const it of items) {
    if (it.kind === 'gap') { gap = (gap || '') + it.text; continue; }
    if (it.kind === 'close') {
      const at = stack.lastIndexOf(it.tag);
      if (at !== -1) stack.length = at; // implicitly closes unclosed children too
    }
    const inPre = stack.some((tag) => PRE_TAGS.has(tag));
    const brk = started && !inPre && (
      (gap !== null && gap !== '')
      || (breaky(prev) && breaky(it))
      || (breaky(prev) && it.kind === 'comment')
      || (prev && prev.kind === 'comment' && breaky(it))
    );
    if (started && brk) out += '\n' + '  '.repeat(stack.length);
    else if (started && gap) out += gap; // an inline gap survives verbatim
    out += it.text;
    if (it.kind === 'tag' && !it.selfClose && !VOID_TAGS.has(it.tag) && !RAW_TAGS.has(it.tag)) stack.push(it.tag);
    prev = it;
    gap = null;
    started = true;
  }
  if (!started) return String(src == null ? '' : src);
  return out.endsWith('\n') ? out : out + '\n';
}

/**
 * Scans html for elements without parsing it into a DOM. Returns
 * `{ els, byTag }`: `els` in document order, each
 * `{ tag, nth, openStart, openEnd, closeStart, closeEnd, parent }` where
 * `nth` is its index among same-tag elements (the key the inspect link uses
 * to find the same element in the preview document, immune to the parser's
 * inserted <tbody>s), `parent` is an index into `els` (-1 at the root), and
 * offsets are into the source string. Unclosed elements end where their
 * parent closes (or at EOF); raw-text contents are skipped, so a `</td>`
 * inside a style string is never mistaken for markup.
 */
export function scanElements(src) {
  const s = String(src == null ? '' : src);
  const lower = s.toLowerCase();
  const n = s.length;
  const els = [];
  const byTag = Object.create(null);
  const stack = [];
  let i = 0;
  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt === -1) break;
    const c = s[lt + 1];
    if (s.startsWith('<!--', lt)) { const at = s.indexOf('-->', lt + 4); i = at === -1 ? n : at + 3; continue; }
    if (c === '!' || c === '?') { const at = tagEnd(s, lt + 1); i = at === -1 ? n : at + 1; continue; }
    if (c === '/' && TAG_NAME.test(s.slice(lt + 2, lt + 3))) {
      const at = tagEnd(s, lt + 2);
      const end = at === -1 ? n : at + 1;
      const tag = TAG_NAME.exec(lower.slice(lt + 2, lt + 32))[0];
      for (let k = stack.length - 1; k >= 0; k--) {
        if (els[stack[k]].tag !== tag) continue;
        while (stack.length > k + 1) { const idx = stack.pop(); els[idx].closeStart = els[idx].closeEnd = lt; }
        const idx = stack.pop();
        els[idx].closeStart = lt;
        els[idx].closeEnd = end;
        break;
      }
      i = end;
      continue;
    }
    if (c && TAG_NAME.test(c)) {
      const at = tagEnd(s, lt + 1);
      const end = at === -1 ? n : at + 1;
      const tag = TAG_NAME.exec(lower.slice(lt + 1, lt + 32))[0];
      const selfClose = s[end - 2] === '/';
      const list = byTag[tag] || (byTag[tag] = []);
      const el = { tag, nth: list.length, openStart: lt, openEnd: end, closeStart: end, closeEnd: end, parent: stack.length ? stack[stack.length - 1] : -1 };
      els.push(el);
      list.push(el);
      i = end;
      if (selfClose || VOID_TAGS.has(tag)) continue;
      if (RAW_TAGS.has(tag)) {
        const closeAt = lower.indexOf('</' + tag, end);
        if (closeAt === -1) { el.closeStart = el.closeEnd = n; i = n; }
        else {
          const cgt = tagEnd(s, closeAt + 2);
          el.closeStart = closeAt;
          el.closeEnd = cgt === -1 ? n : cgt + 1;
          i = el.closeEnd;
        }
        continue;
      }
      stack.push(els.length - 1);
      continue;
    }
    i = lt + 1;
  }
  while (stack.length) { const idx = stack.pop(); els[idx].closeStart = els[idx].closeEnd = n; }
  return { els, byTag };
}

/** The innermost element whose source range contains character `offset`, or null. */
export function elementAtOffset(scan, offset) {
  let best = null;
  for (const e of scan.els) {
    if (e.openStart > offset) break; // els are in openStart order
    if (offset < Math.max(e.closeEnd, e.openEnd)) best = e;
  }
  return best;
}

/**
 * Case-insensitive plain-text occurrences of `query` in `src`, capped so a
 * one-letter query on a huge document cannot stall the repaint. Falls back to
 * case-sensitive matching for the rare locale-sensitive strings whose
 * lowercase form changes length (e.g. 'İ'), where offsets would drift.
 */
export function findMatches(src, query, cap = 5000) {
  const out = [];
  const raw = String(src == null ? '' : src);
  const q0 = String(query == null ? '' : query);
  if (!q0) return out;
  let s = raw.toLowerCase();
  let q = q0.toLowerCase();
  if (s.length !== raw.length || q.length !== q0.length) { s = raw; q = q0; }
  let i = 0;
  while (out.length < cap) {
    const at = s.indexOf(q, i);
    if (at === -1) break;
    out.push({ start: at, end: at + q.length });
    i = at + q.length;
  }
  return out;
}

const MARK_CSS = 'background:rgba(245,158,11,0.28);border-radius:2px;color:inherit;padding:0;margin:0';
const MARK_CUR_CSS = 'background:rgba(245,158,11,0.6);outline:1.5px solid rgba(180,83,9,0.85);border-radius:2px;color:inherit;padding:0;margin:0';

/**
 * Inserts <mark> around `ranges` (offsets into the *text* of one source line,
 * `{ start, end, cur }`) into that line's already-highlighted html. Walks the
 * html counting text positions -- an entity counts as the one source character
 * it escapes, tags count as nothing -- and closes/reopens marks at tag
 * boundaries so the highlighter's own spans stay properly nested.
 */
export function markRanges(html, ranges) {
  if (!ranges || !ranges.length || !html) return html;
  const token = /(<[^>]*>)|(&[a-zA-Z][a-zA-Z0-9]*;|&#[0-9]+;|&#x[0-9a-fA-F]+;)|([\s\S])/g;
  let out = '';
  let pos = 0;
  let open = null;
  let m;
  while ((m = token.exec(html))) {
    if (m[1]) {
      if (open) { out += '</mark>'; open = null; }
      out += m[1];
      continue;
    }
    let r = null;
    for (const range of ranges) { if (pos >= range.start && pos < range.end) { r = range; break; } }
    if (open && open !== r) { out += '</mark>'; open = null; }
    if (r && !open) { out += '<mark style="' + (r.cur ? MARK_CUR_CSS : MARK_CSS) + '">'; open = r; }
    out += m[0];
    pos += 1;
  }
  if (open) out += '</mark>';
  return out;
}
