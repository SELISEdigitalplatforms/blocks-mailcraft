/**
 * Raw HTML blocks keep the author's exact source across a save.
 *
 * The exported email is also the saved draft (HTML in, HTML out), and the
 * exporter's whole-document passes -- link colors stamped on anchors, the
 * Outlook declarations of `msoHarden`, tight merge tags -- rewrite a raw
 * block's code on its way into the mail. That rewrite is what the recipient
 * needs, so it stays; what the author needs back is what they typed. Between
 * the two sits a reverse patch: the few spans the passes changed, recorded
 * against the shipped text, carried in the block's closing comment
 * (core/export.js) and applied by the importer (core/import-html.js).
 *
 * The patch is only ever a best effort on top of the shipped code, never a
 * requirement: the exporter drops it unless it provably reproduces the
 * source, and the importer ignores it unless the shipped text still matches
 * the checksum it was made against (an ESP or a hand edit that touched the
 * block). Either way the block still comes back whole -- in its shipped form.
 */

/** FNV-1a over UTF-16 units, with the length: enough to tell "the text this patch was made for" from "something else", which is all it is used for. */
export function rawChecksum(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return s.length.toString(36) + '.' + h.toString(36);
}

/** Applies `[at, drop, insert]` ops (ascending, non-overlapping, positions in `s`) to `s`. Returns null on any op that does not fit. */
export function applyRawOps(s, ops) {
  let out = '';
  let last = 0;
  for (const op of ops) {
    if (!Array.isArray(op) || op.length !== 3) return null;
    const [at, drop, ins] = op;
    if (!Number.isInteger(at) || !Number.isInteger(drop) || typeof ins !== 'string') return null;
    if (at < last || drop < 0 || at + drop > s.length) return null;
    out += s.slice(last, at) + ins;
    last = at + drop;
  }
  return out + s.slice(last);
}

/*
 * The passes only ever touch short spans inside one tag or one merge tag, so
 * a greedy walk that resynchronises on the next common run is enough -- no
 * general diff. It can be fooled; that is why the result is checked by
 * applying it, and a wrong or oversized patch is simply not shipped.
 */
const SYNC = 6;
const REACH = 400;
function rawOps(o, s) {
  const ops = [];
  const same = (i, j) => {
    const x = s.substr(i, SYNC);
    const y = o.substr(j, SYNC);
    return x === y && (x.length === SYNC || (i + x.length === s.length && j + y.length === o.length));
  };
  let i = 0;
  let j = 0;
  while (i < s.length || j < o.length) {
    if (i < s.length && j < o.length && s[i] === o[j]) { i++; j++; continue; }
    let hit = null;
    for (let t = 1; t <= 2 * REACH && !hit; t++) {
      for (let a = Math.max(0, t - REACH); a <= Math.min(t, REACH); a++) {
        const b = t - a;
        if (i + a > s.length || j + b > o.length) continue;
        if (same(i + a, j + b)) { hit = [a, b]; break; }
      }
    }
    if (!hit) return null;
    ops.push([i, hit[0], o.substr(j, hit[1])]);
    i += hit[0];
    j += hit[1];
  }
  return ops;
}

/** The closing-comment payload that turns `shipped` back into `source`, or '' when none is needed or none could be made. Comment-safe: no `-`, `>` or `<` survive the encoding, and nothing the export passes match on (tags, braces, `style="`). */
export function rawPatchFor(source, shipped) {
  if (source === shipped) return '';
  const ops = rawOps(source, shipped);
  if (!ops || applyRawOps(shipped, ops) !== source) return '';
  const body = JSON.stringify(ops);
  // A patch as big as the code itself buys nothing over shipping the code
  // twice, and the mail is where the bytes are paid (Gmail clips at ~102 KB).
  if (body.length > Math.max(256, source.length / 4)) return '';
  return 's=' + rawChecksum(shipped) + ' p=' + encodeURIComponent(body).replace(/-/g, '%2D');
}

/** The author's source back from the shipped code and the closing comment's payload; `shipped` itself whenever the payload is absent, malformed, or was made for different text. */
export function rawSourceOf(shipped, meta) {
  const m = /^s=([0-9a-z]+\.[0-9a-z]+) p=([^\s]+)$/.exec(String(meta || '').trim());
  if (!m || m[1] !== rawChecksum(shipped)) return shipped;
  let ops;
  try { ops = JSON.parse(decodeURIComponent(m[2])); } catch { return shipped; }
  if (!Array.isArray(ops)) return shipped;
  const out = applyRawOps(shipped, ops);
  return out == null ? shipped : out;
}
