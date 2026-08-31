/** Scopes authored CSS to the email sheet so a raw block can never restyle the editor chrome. Ported verbatim: manual brace-matching, not the CSSOM, so arbitrary/partial CSS still scopes instead of failing to parse. */
export const scopeCss = (css, root) => {
  const src = String(css || '');
  let out = ''; let i = 0;
  const prefix = (sel) => sel.split(',').map((s) => {
    const t = s.trim();
    if (!t) return '';
    if (/^(from|to|\d+%)$/i.test(t)) return t;
    if (t.startsWith('@')) return t;
    if (/^(html|body|:root)\b/i.test(t)) return root + t.replace(/^(html|body|:root)/i, '');
    return root + ' ' + t;
  }).filter(Boolean).join(', ');
  while (i < src.length) {
    const brace = src.indexOf('{', i);
    if (brace < 0) { out += src.slice(i); break; }
    const head = src.slice(i, brace).trim();
    let depth = 1; let j = brace + 1;
    while (j < src.length && depth > 0) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
    const body = src.slice(brace + 1, j - 1);
    if (head.startsWith('@')) {
      out += head + '{' + (/^@(media|supports|layer|container)/i.test(head) ? scopeCss(body, root) : body) + '}';
    } else {
      out += prefix(head) + '{' + body + '}';
    }
    i = j;
  }
  return out;
};

export const migrateTokens = (json) => String(json).replace(/\[\[\s*([\w.]+)\s*\]\]/g, '{' + '{ $1 }' + '}');

/** Paste sanitizer -- Word/Docs/Notion drop class soup, mso- properties and nested spans into the document; keep a small tag whitelist and drop attributes (href/target/rel on links survive). */
const PASTE_OK = { A: 1, B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, STRIKE: 1, BR: 1, P: 1, UL: 1, OL: 1, LI: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, BLOCKQUOTE: 1, CODE: 1, SUP: 1, SUB: 1 };

export const cleanHtml = (html) => {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  doc.querySelectorAll('style,script,meta,link,title,head').forEach((n) => n.remove());
  const walk = (node) => {
    Array.from(node.children).forEach((el) => {
      walk(el);
      if (!PASTE_OK[el.tagName]) {
        const parent = el.parentNode;
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
        return;
      }
      Array.from(el.attributes).forEach((at) => {
        const keep = el.tagName === 'A' && ['href', 'target', 'rel'].indexOf(at.name) > -1;
        if (!keep) el.removeAttribute(at.name);
      });
    });
  };
  walk(doc.body);
  return doc.body.innerHTML.replace(/<!--[\s\S]*?-->/g, '').replace(/\s{2,}/g, ' ').trim();
};

/**
 * Import sanitizer. Pasting wants `cleanHtml`'s scorched-earth policy (Word/
 * Docs class soup adds nothing), but an HTML *import* is the opposite case:
 * a hand-built email's inline styles ARE the design. Running imports through
 * the paste path collapsed every distinctly-styled paragraph -- a 26px/800
 * headline, an italic footnote, a 12px footer -- into one uniform block in
 * the theme's default face. This variant keeps the same structural whitelist
 * (plus `SPAN`/`IMG`, which carry real content in emails) and preserves a
 * whitelist of typographic/spacing style properties per element; everything
 * else (mso-*, classes, ids, event handlers) is still stripped.
 */
const IMPORT_OK = Object.assign({ SPAN: 1, IMG: 1 }, PASTE_OK);
const IMPORT_STYLES = [
  'font-size', 'font-weight', 'font-style', 'font-family', 'color', 'line-height',
  'letter-spacing', 'text-align', 'text-decoration', 'text-transform',
  'background-color', 'border-radius', 'padding', 'margin', 'word-break',
  'width', 'max-width', 'height',
];

export const cleanImportHtml = (html) => {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  doc.querySelectorAll('style,script,meta,link,title,head').forEach((n) => n.remove());
  const walk = (node) => {
    Array.from(node.children).forEach((el) => {
      walk(el);
      if (!IMPORT_OK[el.tagName]) {
        const parent = el.parentNode;
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
        return;
      }
      const kept = [];
      IMPORT_STYLES.forEach((p) => {
        const v = el.style.getPropertyValue(p);
        if (v) kept.push(p + ':' + v);
      });
      Array.from(el.attributes).forEach((at) => {
        const keep = (el.tagName === 'A' && ['href', 'target', 'rel'].indexOf(at.name) > -1)
          || (el.tagName === 'IMG' && ['src', 'alt', 'width', 'height'].indexOf(at.name) > -1);
        if (!keep) el.removeAttribute(at.name);
      });
      if (kept.length) el.setAttribute('style', kept.join(';'));
    });
  };
  walk(doc.body);
  return doc.body.innerHTML.replace(/<!--[\s\S]*?-->/g, '').replace(/\s{2,}/g, ' ').trim();
};

/**
 * Makes an image URL safe to drop inside `url("...")`.
 *
 * These URLs are not ours: they come from a storage provider's backend, or from
 * a user typing into the "Background image URL" field. They are then
 * interpolated into CSS -- in the library tiles, in the canvas, and (worst) into
 * a `style="..."` attribute in the exported email, where an unescaped quote ends
 * the attribute and everything after it becomes markup in someone's campaign.
 *
 * Percent-encoding rather than backslash-escaping, because the same value has to
 * survive two different contexts: `\"` is correct in CSS but is still a literal
 * quote to an HTML attribute parser. `%22` is safe in both, and resolves
 * identically when the browser fetches it.
 *
 * Schemes are allowlisted as well. A relative path has no scheme and is fine;
 * anything exotic resolves to nothing rather than being handed to the parser.
 */
const CSS_URL_ESCAPE = { '"': '%22', "'": '%27', '(': '%28', ')': '%29', '\\': '%5C' };

export const cssUrl = (u) => {
  const raw = String(u == null ? '' : u).trim();
  if (!raw) return '';
  const scheme = raw.match(/^([a-z][a-z0-9+.-]*):/i);
  if (scheme && !/^(https?|blob)$/i.test(scheme[1]) && !/^data:image\//i.test(raw)) return '';
  // An explicit table, not encodeURIComponent: that leaves ( ) ' untouched,
  // and an unescaped paren closes url(...) just as surely as a quote does.
  return raw.replace(/["'()\\]|\s/g, (c) => CSS_URL_ESCAPE[c] || '%20');
};

/**
 * A link target on its way into an anchor. Two jobs, and both of them showed
 * up as "the link does not work" rather than as anything that errors:
 *
 *   - A bare host (`selise.ch`, `www.selise.ch/pricing`) gets `https://`.
 *     Typed with no scheme it is a *relative* URL, so the mail client
 *     resolves it against its own origin and the click lands nowhere -- the
 *     single most common way an authored link ships broken, and invisible in
 *     the editor because the canvas never follows it.
 *   - Schemes are allowlisted the way `cssUrl` allowlists image sources, so
 *     `javascript:` resolves to nothing instead of becoming a click target.
 *
 * Left exactly as typed: anything already carrying an allowed scheme, an
 * in-page `#anchor`, a rooted `/path`, and anything opening with a merge tag
 * -- `{{ResetUrl}}` is a whole URL the host substitutes later, so prefixing
 * it would corrupt what reaches the template engine. A bare `name@host.tld`
 * becomes `mailto:`, which is the only thing it could have meant.
 */
export const linkHref = (u) => {
  const raw = String(u == null ? '' : u).trim();
  if (!raw) return '';
  const scheme = raw.match(/^([a-z][a-z0-9+.-]*):/i);
  if (scheme) {
    if (/^(https?|mailto|tel)$/i.test(scheme[1])) return raw;
    // `selise.ch:8080/x` matches the scheme shape but is a host and a port;
    // it falls through to be prefixed rather than dropped.
    if (!/^[a-z][a-z0-9+.-]*:\d/i.test(raw)) return '';
  }
  if (raw.startsWith('//')) return 'https:' + raw;
  if (/^[#/]/.test(raw) || raw.startsWith('{{')) return raw;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return 'mailto:' + raw;
  return 'https://' + raw;
};

export const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Minimal HTML syntax highlighter for the code view. */
export const hl = (src) => escHtml(src)
  .replace(/([\w-]+)=&quot;([^&]*)&quot;/g, '<span style="color:#a8763e">$1</span>=<span style="color:#4a8a6a">&quot;$2&quot;</span>')
  .replace(/([\w-]+)="([^"]*)"/g, '<span style="color:#a8763e">$1</span>=<span style="color:#4a8a6a">"$2"</span>')
  .replace(/(&lt;\/?)([a-zA-Z][\w-]*)/g, '$1<span style="color:#5980a6;font-weight:600">$2</span>')
  .replace(/(\{\{[^{}]*\}\})/g, '<span style="background:rgba(89,128,166,0.18);color:#2c455d;border-radius:2px">$1</span>');
