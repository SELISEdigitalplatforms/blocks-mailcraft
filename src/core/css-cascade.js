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
/**
 * Splits at-rules off the top level. `out` is what the cascade can fold into
 * inline styles; `atRules` is everything it cannot -- `@media`, `@font-face`,
 * `@import` -- which used to be dropped on the floor here. A webfont
 * declaration and a mobile breakpoint are not decoration a document can be
 * asked to do without, so they are handed back for the caller to keep.
 */
function stripAtRules(css) {
  let out = '';
  const atRules = [];
  let i = 0;
  while (i < css.length) {
    if (css[i] === '@') {
      const semi = css.indexOf(';', i);
      const brace = css.indexOf('{', i);
      if (brace === -1 || (semi !== -1 && semi < brace)) {
        // A statement at-rule (`@import url(...);`) ends at the semicolon.
        atRules.push(css.slice(i, semi === -1 ? css.length : semi + 1).trim());
        i = semi === -1 ? css.length : semi + 1;
        continue;
      }
      let depth = 0;
      let j = brace;
      for (; j < css.length; j++) {
        if (css[j] === '{') depth++;
        else if (css[j] === '}') { depth--; if (!depth) break; }
      }
      atRules.push(css.slice(i, j + 1).trim());
      i = j + 1;
      continue;
    }
    out += css[i];
    i++;
  }
  return { out, atRules };
}

function specificity(sel) {
  const ids = (sel.match(/#[\w-]+/g) || []).length;
  const classes = (sel.match(/\.[\w-]+|\[[^\]]*\]/g) || []).length;
  const tags = (sel.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length;
  return ids * 100 + classes * 10 + tags;
}

export function inlineStylesheets(doc) {
  // A style tag carrying the css-block marker IS a block (import-html reads
  // it back as one); folding its rules inline here stamped them onto every
  // matched element AND kept the block, doubling the styles on each save.
  const sheets = Array.from(doc.querySelectorAll('style')).filter((s) => !(s.getAttribute && s.getAttribute('data-mc')));
  if (!sheets.length) return;
  const split = stripAtRules(stripComments(sheets.map((s) => s.textContent || '').join('\n')));
  const css = split.out;
  // Rules the cascade cannot fold are collected as they are skipped below, so
  // the caller can keep them verbatim instead of losing them.
  // Pruned, not filtered: a media query a person has edited holds their rules
  // beside ours, and dropping the block whole would take theirs with it.
  const kept = split.atRules.map(pruneGeneratedCss).filter(Boolean);

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
      if (!sel || sel === '*') return;
      // A pseudo-class cannot be inlined -- there is no "hover" attribute to
      // stamp it onto -- so it is kept as source rather than discarded. A
      // template's `a.cta:hover` is a designed state, not noise.
      if (sel.indexOf(':') > -1) {
        const rule = sel + ' { ' + decls.map((d) => d.prop + ':' + d.value + (d.important ? ' !important' : '')).join('; ') + '; }';
        if (!isGeneratedCss(rule)) kept.push(rule);
        return;
      }
      rules.push({ sel, decls, spec: specificity(sel), order: order++ });
    });
  }
  if (!rules.length) return kept.join('\n');

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
  return kept.join('\n');
}

/*
 * MailCraft's own head <style> is regenerated on every export, so re-importing
 * it as author CSS would add a second copy to the document each time it was
 * saved. It carries no marker (only `css` blocks do), and in a template a
 * person has edited it sits in the same <style> as their own rules -- so the
 * test has to be per rule, not per element.
 *
 * Matched on what the exporter writes: the `.mc-` layout classes, the Apple
 * data-detectors reset, and the responsive image rule. Everything else in that
 * sheet is the author's.
 */
const GENERATED_SEL = /(^|[\s,>+~(])\.mc-[\w-]+|x-apple-data-detectors/;
const GENERATED_IMG = /^\s*img\s*\{\s*max-width\s*:\s*100%\s*!important\s*;\s*height\s*:\s*auto\s*!important\s*;?\s*\}\s*$/i;

function isGeneratedCss(rule) {
  const text = String(rule || '');
  if (GENERATED_SEL.test(text)) {
    // An @media block mixing ours and theirs keeps the author's half; only a
    // block that is entirely ours is dropped whole.
    if (/^@/.test(text)) return innerRules(text).every((r) => GENERATED_SEL.test(r) || GENERATED_IMG.test(r));
    return true;
  }
  if (GENERATED_IMG.test(text)) return true;
  if (/^@/.test(text)) {
    const inner = innerRules(text);
    return inner.length > 0 && inner.every((r) => GENERATED_SEL.test(r) || GENERATED_IMG.test(r));
  }
  return false;
}

/** The individual rules inside an at-rule block, as written. */
function innerRules(block) {
  const open = block.indexOf('{');
  if (open < 0) return [];
  const body = block.slice(open + 1, block.lastIndexOf('}'));
  return (body.match(/[^{}]+\{[^{}]*\}/g) || []).map((r) => r.trim());
}

/**
 * Drops the generated rules from an at-rule, keeping the author's. Returns ''
 * when nothing is left.
 *
 * Only a *conditional* group -- `@media`, `@supports` -- can be pruned rule by
 * rule. `@font-face` holds declarations rather than nested rules and `@import`
 * has no block at all; both are all-or-nothing, and treating them like a media
 * query emptied them (a template's whole webfont declaration vanished because
 * the prune found no inner rules to keep).
 */
export function pruneGeneratedCss(block) {
  const text = String(block || '').trim();
  if (!text) return '';
  const open = text.indexOf('{');
  const inner = /^@/.test(text) && open > -1 ? innerRules(text) : [];
  if (!inner.length) return isGeneratedCss(text) ? '' : text;
  const mine = inner.filter((r) => !GENERATED_SEL.test(r) && !GENERATED_IMG.test(r));
  return mine.length ? text.slice(0, open + 1) + '\n  ' + mine.join('\n  ') + '\n}' : '';
}
