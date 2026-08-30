/**
 * Import-time CSS cascade: folds a parsed document's `<style>` rules into the
 * elements' inline styles, so the importer's classifiers (which read inline
 * styles only) see class-styled templates -- Mailchimp exports, hand-written
 * emails, framework output that was never inlined -- the same way a mail
 * client would.
 *
 * Deliberately a subset of a real cascade, matched to what email CSS uses:
 * - `@media` blocks (and every other at-rule) are dropped whole: responsive
 *   overrides can't be represented in the imported model, desktop values win.
 *   A side benefit: base-rule `.desktop_hide { display:none }` still applies,
 *   so mobile-only duplicate content is correctly dropped by the importer's
 *   hidden-element skip.
 * - Selectors containing `:` are skipped -- pseudo-classes/-elements are
 *   interactive or generated state with no place in a static import.
 * - Specificity is the classic ids/classes/tags count; equal specificity
 *   resolves by source order; `!important` wins over everything including
 *   inline styles, which otherwise always win (matching browser behavior for
 *   the combinations that matter here).
 */

function stripComments(css) {
  return String(css || '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Removes every at-rule: block-less ones (`@import ...;`) to the semicolon, block ones (`@media { ... }`) across balanced braces. */
function stripAtRules(css) {
  let out = '';
  let i = 0;
  while (i < css.length) {
    if (css[i] === '@') {
      const semi = css.indexOf(';', i);
      const brace = css.indexOf('{', i);
      if (brace === -1 || (semi !== -1 && semi < brace)) {
        i = semi === -1 ? css.length : semi + 1;
        continue;
      }
      let depth = 0;
      let j = brace;
      for (; j < css.length; j++) {
        if (css[j] === '{') depth++;
        else if (css[j] === '}') { depth--; if (!depth) break; }
      }
      i = j + 1;
      continue;
    }
    out += css[i];
    i++;
  }
  return out;
}

function specificity(sel) {
  const ids = (sel.match(/#[\w-]+/g) || []).length;
  const classes = (sel.match(/\.[\w-]+|\[[^\]]*\]/g) || []).length;
  const tags = (sel.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length;
  return ids * 100 + classes * 10 + tags;
}

export function inlineStylesheets(doc) {
  const sheets = Array.from(doc.querySelectorAll('style'));
  if (!sheets.length) return;
  const css = stripAtRules(stripComments(sheets.map((s) => s.textContent || '').join('\n')));

  const rules = [];
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  let order = 0;
  while ((m = ruleRe.exec(css))) {
    const decls = [];
    m[2].split(';').forEach((d) => {
      const at = d.indexOf(':');
      if (at < 0) return;
      const prop = d.slice(0, at).trim().toLowerCase();
      let value = d.slice(at + 1).trim();
      if (!prop || !value || prop.indexOf('--') === 0 || prop.indexOf('mso-') === 0) return;
      const important = /!important\s*$/i.test(value);
      if (important) value = value.replace(/!important\s*$/i, '').trim();
      if (value) decls.push({ prop, value, important });
    });
    if (!decls.length) continue;
    m[1].split(',').forEach((raw) => {
      const sel = raw.trim();
      if (!sel || sel === '*' || sel.indexOf(':') > -1) return;
      rules.push({ sel, decls, spec: specificity(sel), order: order++ });
    });
  }
  if (!rules.length) return;

  // Ascending: later (more specific / later-in-source) rules overwrite
  // earlier winners per property below.
  rules.sort((a, b) => a.spec - b.spec || a.order - b.order);

  const winners = new Map(); // element -> Map(prop -> {value, important})
  rules.forEach((rule) => {
    let matched;
    try { matched = doc.querySelectorAll(rule.sel); } catch { return; }
    matched.forEach((el) => {
      if (el !== doc.body && !doc.body.contains(el)) return;
      let bucket = winners.get(el);
      if (!bucket) { bucket = new Map(); winners.set(el, bucket); }
      rule.decls.forEach((d) => {
        const cur = bucket.get(d.prop);
        if (cur && cur.important && !d.important) return;
        bucket.set(d.prop, d);
      });
    });
  });

  winners.forEach((bucket, el) => {
    if (!el.style) return;
    bucket.forEach((d, prop) => {
      if (!d.important && el.style.getPropertyValue(prop)) return; // inline wins
      try { el.style.setProperty(prop, d.value); } catch { /* unparseable value -- skip */ }
    });
  });
}
