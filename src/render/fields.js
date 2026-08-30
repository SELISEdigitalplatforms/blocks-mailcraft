import { icon, brandIcon, socialKey, SOCIAL_BRAND, contrastInk } from '../core/icons.js';
import { parseItems } from '../core/parse.js';

function el(tag, style, attrs) {
  const node = document.createElement(tag);
  if (style) Object.assign(node.style, style);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else if (v !== undefined) node.setAttribute(k, v);
  }
  return node;
}

/**
 * Trailing debounce for free-typing inputs. Every commit rebuilds the whole
 * canvas and panel (full re-render, no diffing) -- fine per click, but per
 * keystroke it floors low-end hardware. Typing therefore commits 120ms after
 * the last keystroke: one rebuild per pause instead of per key. `flush` runs
 * on blur so leaving the field (or a blur-time clamp that reads committed
 * state, e.g. B.num) never races a still-pending commit. Discrete controls
 * (toggles, selects, steppers' -/+) stay immediate.
 */
export function typeCommit(fn) {
  let t = null; let last;
  const fire = () => { t = null; fn(last); };
  return {
    call(v) { last = v; if (t) clearTimeout(t); t = setTimeout(fire, 120); },
    flush() { if (t) { clearTimeout(t); fire(); } },
  };
}

/**
 * Label of the switch the user just clicked, consumed by the very next render.
 *
 * Toggling a prop re-renders the whole panel, which replaces the switch with a
 * fresh node built already in its new state -- there is no before/after on one
 * element for a CSS `transition` to interpolate, so the knob used to jump. The
 * flag lets the rebuilt switch (and no other) start a one-shot keyframe from
 * where the old one stood, so a click slides while merely opening a panel full
 * of already-on switches still paints them in place.
 */
let pendingSwitchAnim = null;

/**
 * One label style for every field kind, so the inspector reads as one system:
 * semibold editor UI font at 75% ink for field names (distinct from both the muted
 * values and the uppercase group kickers), block or inline per context.
 */
function fieldLabel(text, inline) {
  // One label treatment across every right-panel field. Placement can differ
  // (above wide controls, beside compact controls), but size, weight and color
  // must not change with the control type.
  return el('label', Object.assign(
    { fontFamily: 'var(--ed-font)', fontSize: '12.5px', lineHeight: '1.35', fontWeight: '500', color: 'var(--ed-text)' },
    inline
      ? { flex: '1', minWidth: '0' }
      : { display: 'block', marginBottom: '6px' },
  ), { text, class: 'mc-field-label' });
}

/**
 * Which accordion sections the user has collapsed, by section label.
 * Editor-UI state, deliberately module-level: it must survive the full
 * re-render on every commit (the panel is rebuilt each time) but is never
 * part of the document, and collapsing/expanding itself is pure DOM --
 * no core state, no re-render.
 */
const sectionCollapsed = Object.create(null);

/**
 * The flat accordion inspector layout: each `head` field becomes a
 * full-width light section bar (uppercase label, chevron, click to
 * collapse) and the fields under it render as roomy rows directly on the
 * panel surface. Fields before the first head form an untitled lead group.
 */
export function renderFieldCards(container, fields) {
  let body = null;
  const open = (headField) => {
    if (headField) {
      const label = headField.label;
      // The mc-section-* classes are theme hooks (render/style.js can restyle
      // the section chrome without touching this builder); the inline styles
      // stay the baseline look.
      const bar = el('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', background: 'var(--ed-panel-2)', borderTop: '1px solid var(--ed-line)', borderBottom: '1px solid var(--ed-line)', cursor: 'pointer', userSelect: 'none' }, { role: 'button', tabindex: '0', 'aria-expanded': String(!sectionCollapsed[label]), class: 'mc-section-bar' });
      bar.appendChild(el('span', { fontFamily: 'var(--ed-font)', fontSize: '10.5px', fontWeight: '700', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ed-muted)' }, { text: label, class: 'mc-section-label' }));
      const chev = el('span', { display: 'flex', color: 'var(--ed-faint)', transition: 'transform 0.16s', transform: sectionCollapsed[label] ? 'rotate(-90deg)' : 'none' }, { class: 'mc-section-chevron' });
      chev.appendChild(icon('chevronDown', 13));
      bar.appendChild(chev);
      const localBody = body = el('div', { padding: '12px 14px 16px', background: 'var(--ed-panel)' }, { class: 'mc-section-body mc-field-list' });
      if (sectionCollapsed[label]) localBody.hidden = true;
      const toggle = () => {
        sectionCollapsed[label] = !sectionCollapsed[label];
        localBody.hidden = !!sectionCollapsed[label];
        chev.style.transform = sectionCollapsed[label] ? 'rotate(-90deg)' : 'none';
        bar.setAttribute('aria-expanded', String(!sectionCollapsed[label]));
      };
      bar.addEventListener('click', toggle);
      bar.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      container.appendChild(bar);
      container.appendChild(localBody);
      return;
    }
    body = el('div', { padding: '12px 14px 16px', background: 'var(--ed-panel)' }, { class: 'mc-section-body mc-field-list' });
    container.appendChild(body);
  };
  fields.forEach((f) => {
    if (f.isHead) { open(f); return; }
    if (!body) open(null);
    const node = renderField(f);
    node.style.margin = '0';
    body.appendChild(node);
  });
}

/** Every platform the "Add network…" dropdown offers, with a sensible starter URL. Order roughly by how often they appear in email footers. */
const NETWORKS = [
  ['Instagram', 'https://instagram.com/'], ['X', 'https://x.com/'], ['Facebook', 'https://facebook.com/'],
  ['LinkedIn', 'https://linkedin.com/company/'], ['YouTube', 'https://youtube.com/@'], ['TikTok', 'https://tiktok.com/@'],
  ['Pinterest', 'https://pinterest.com/'], ['WhatsApp', 'https://wa.me/'], ['Telegram', 'https://t.me/'],
  ['Threads', 'https://threads.net/@'], ['Snapchat', 'https://snapchat.com/add/'], ['Discord', 'https://discord.gg/'],
  ['Reddit', 'https://reddit.com/r/'], ['Spotify', 'https://open.spotify.com/'], ['Behance', 'https://behance.net/'],
  ['Dribbble', 'https://dribbble.com/'], ['Email', 'mailto:hello@example.com'], ['Website', 'https://example.com'],
];

/**
 * The social block's network editor: one card per network (brand-colored icon
 * chip, editable name, URL, remove) plus an "Add network…" dropdown -- what
 * used to be a raw `Name|URL` textarea. The data stays that same string
 * (`f.value` in, serialized back out through `f.onChange`), so the block,
 * export and import are untouched; only the editing surface changed.
 */
function renderSocialItems(f) {
  const box = el('div');
  box.appendChild(fieldLabel(f.label));
  const items = parseItems(f.value || '');
  // No coercion here: commits land while the user is still typing (debounced,
  // see typeCommit) and the panel re-renders from the committed string, so
  // padding an empty field with a fallback would snap "cleared to retype"
  // inputs back mid-edit.
  const commit = (next) => f.onChange(next.map((it) => (it.label || '') + '|' + (it.href || '')).join('\n'));
  const list = el('div', { display: 'flex', flexDirection: 'column', gap: '6px' });

  items.forEach((it, i) => {
    const row = el('div', { display: 'flex', alignItems: 'center', gap: '7px', padding: '6px 7px', border: '1px solid var(--ed-line)', borderRadius: '9px', background: 'var(--ed-panel-2)' });
    const key = socialKey(it.label);
    const brand = SOCIAL_BRAND[key] || '';
    const chip = el('span', { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '24px', height: '24px', flex: 'none', borderRadius: '7px', background: brand || 'var(--ed-soft)', color: brand ? contrastInk(brand) : 'var(--ed-accent)' });
    chip.appendChild(brandIcon(key, 13));
    const name = el('input', { width: '70px', flex: 'none', boxSizing: 'border-box', background: 'transparent', border: '1px solid transparent', borderRadius: '5px', color: 'var(--ed-text)', font: 'inherit', fontSize: '11.5px', fontWeight: '600', padding: '3px 4px' }, { 'data-focus-key': `f${f.key}-n${i}`, title: 'Network name', dir: 'auto' });
    name.value = it.label;
    const nameCommit = typeCommit((v) => { const next = items.slice(); next[i] = { label: v, href: it.href }; commit(next); });
    name.addEventListener('input', (e) => nameCommit.call(e.target.value));
    name.addEventListener('focus', () => { name.style.borderColor = 'var(--ed-accent)'; name.style.background = 'var(--ed-panel)'; name.style.outline = 'none'; });
    name.addEventListener('blur', () => { name.style.borderColor = 'transparent'; name.style.background = 'transparent'; nameCommit.flush(); });
    const url = el('input', { flex: '1', minWidth: '0', boxSizing: 'border-box', background: 'var(--ed-panel)', border: '1px solid var(--ed-line)', borderRadius: '6px', color: 'var(--ed-text)', fontFamily: 'ui-monospace, monospace', fontSize: '10.5px', padding: '4px 6px' }, { placeholder: 'https://', 'data-focus-key': `f${f.key}-u${i}`, title: it.href, dir: 'ltr' });
    url.value = it.href;
    const urlCommit = typeCommit((v) => { const next = items.slice(); next[i] = { label: it.label, href: v }; commit(next); });
    url.addEventListener('input', (e) => urlCommit.call(e.target.value));
    url.addEventListener('focus', () => { url.style.borderColor = 'var(--ed-accent)'; url.style.outline = 'none'; });
    url.addEventListener('blur', () => { url.style.borderColor = 'var(--ed-line)'; urlCommit.flush(); });
    const del = el('button', { width: '22px', height: '22px', flex: 'none', border: '0', borderRadius: '6px', background: 'transparent', color: 'var(--ed-faint)', cursor: 'pointer', fontSize: '13px', lineHeight: '1' }, { type: 'button', title: 'Remove ' + (it.label || 'network'), text: '✕' });
    del.addEventListener('mouseenter', () => { del.style.background = 'var(--ed-danger-soft)'; del.style.color = 'var(--ed-danger)'; });
    del.addEventListener('mouseleave', () => { del.style.background = 'transparent'; del.style.color = 'var(--ed-faint)'; });
    del.addEventListener('click', () => commit(items.filter((x, xi) => xi !== i)));
    row.append(chip, name, url, del);
    list.appendChild(row);
  });

  if (!items.length) {
    list.appendChild(el('div', { fontSize: '11px', color: 'var(--ed-faint)', padding: '8px 2px' }, { text: 'No networks yet — add one below.' }));
  }

  const used = new Set(items.map((it) => socialKey(it.label)));
  const add = el('select', { width: '100%', boxSizing: 'border-box', background: 'var(--ed-panel-2)', border: '1px dashed var(--ed-line-2)', borderRadius: '9px', color: 'var(--ed-muted)', font: 'inherit', fontSize: '11.5px', fontWeight: '600', padding: '7px 8px', cursor: 'pointer' }, { title: 'Add network' });
  const ph = document.createElement('option'); ph.value = ''; ph.textContent = '＋  Add network…'; add.appendChild(ph);
  NETWORKS.filter(([label]) => !used.has(socialKey(label))).forEach(([label, href]) => {
    const o = document.createElement('option'); o.value = label + '|' + href; o.textContent = label; add.appendChild(o);
  });
  const custom = document.createElement('option'); custom.value = 'Link|https://'; custom.textContent = 'Custom link…'; add.appendChild(custom);
  add.addEventListener('change', (e) => {
    if (!e.target.value) return;
    const [label, href] = e.target.value.split('|');
    commit(items.concat([{ label, href }]));
  });
  add.addEventListener('focus', () => { add.style.borderColor = 'var(--ed-accent)'; add.style.outline = 'none'; });
  add.addEventListener('blur', () => { add.style.borderColor = 'var(--ed-line-2)'; });
  list.appendChild(add);

  box.appendChild(list);
  return box;
}

/**
 * Friendly link editing for rich-text blocks. The block still stores one HTML
 * string; each commit clones that markup, updates only the indexed anchor and
 * serializes it back, preserving all surrounding formatting and content.
 */
function renderRichLinks(f) {
  const box = el('div');
  box.appendChild(fieldLabel(f.label));
  const source = el('div');
  source.innerHTML = f.html || '';
  const anchors = Array.from(source.querySelectorAll('a'));
  const list = el('div', { display: 'flex', flexDirection: 'column', gap: '7px' });
  const change = (index, update) => {
    const next = el('div');
    next.innerHTML = f.html || '';
    const anchor = next.querySelectorAll('a')[index];
    if (!anchor) return;
    update(anchor);
    f.onChange(next.innerHTML);
  };

  anchors.forEach((anchor, i) => {
    const card = el('div', { padding: '8px', border: '1px solid var(--ed-line)', borderRadius: '9px', background: 'var(--ed-panel-2)' });
    const head = el('div', { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '7px' });
    const name = el('span', { flex: '1', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--ed-font)', fontSize: '11.5px', fontWeight: '600', color: 'var(--ed-text)' }, { text: (anchor.textContent || '').trim() || 'Link ' + (i + 1), title: (anchor.textContent || '').trim(), dir: 'auto' });
    const remove = el('button', { flex: 'none', border: '0', borderRadius: '6px', background: 'transparent', color: 'var(--ed-faint)', cursor: 'pointer', padding: '3px 6px', fontFamily: 'var(--ed-font)', fontSize: '10.5px', fontWeight: '600' }, { type: 'button', text: 'Remove', title: 'Remove link', 'aria-label': 'Remove link from ' + ((anchor.textContent || '').trim() || 'text'), 'data-focus-key': `f${f.key}-link-remove-${i}` });
    remove.addEventListener('mouseenter', () => { remove.style.background = 'var(--ed-danger-soft)'; remove.style.color = 'var(--ed-danger)'; });
    remove.addEventListener('mouseleave', () => { remove.style.background = 'transparent'; remove.style.color = 'var(--ed-faint)'; });
    remove.addEventListener('click', () => change(i, (a) => a.replaceWith(...a.childNodes)));
    head.append(name, remove);

    const url = el('input', { width: '100%', boxSizing: 'border-box', background: 'var(--ed-panel)', border: '1px solid var(--ed-line)', borderRadius: '7px', color: 'var(--ed-text)', fontFamily: 'ui-monospace, monospace', fontSize: '11px', padding: '6px 8px' }, { placeholder: 'https://', 'aria-label': 'Link destination for ' + ((anchor.textContent || '').trim() || 'link ' + (i + 1)), 'data-focus-key': `f${f.key}-link-url-${i}`, dir: 'ltr' });
    url.value = anchor.getAttribute('href') || '';
    const urlCommit = typeCommit((v) => change(i, (a) => a.setAttribute('href', v)));
    url.addEventListener('input', (e) => urlCommit.call(e.target.value));
    url.addEventListener('focus', () => { url.style.borderColor = 'var(--ed-accent)'; url.style.outline = 'none'; });
    url.addEventListener('blur', () => { url.style.borderColor = 'var(--ed-line)'; urlCommit.flush(); });

    const targetLabel = el('label', { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '7px', width: 'fit-content', color: 'var(--ed-muted)', cursor: 'pointer', fontFamily: 'var(--ed-font)', fontSize: '10.5px', fontWeight: '500' });
    const target = el('input', { accentColor: 'var(--ed-accent)', cursor: 'pointer' }, { type: 'checkbox', 'data-focus-key': `f${f.key}-link-target-${i}` });
    target.checked = anchor.target === '_blank';
    target.addEventListener('change', (e) => change(i, (a) => {
      if (e.target.checked) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); }
      else { a.removeAttribute('target'); a.removeAttribute('rel'); }
    }));
    targetLabel.append(target, 'Open in new tab');
    card.append(head, url, targetLabel);
    list.appendChild(card);
  });

  box.appendChild(list);
  return box;
}

/**
 * The table block's cell editor: an actual grid of inputs mirroring the
 * table (bold first row when the header toggle is on), with per-row/column
 * remove buttons and add-row/add-column actions -- replacing the raw
 * "one line per row, split by |" textarea. Data stays that same string.
 */
function renderTableGrid(f) {
  const box = el('div');
  box.appendChild(fieldLabel(f.label));
  const rows = String(f.value || '').split('\n').map((r) => r.split('|'));
  const cols = Math.max(1, ...rows.map((r) => r.length));
  rows.forEach((r) => { while (r.length < cols) r.push(''); });
  // Pipes typed into a cell become '/' -- '|' is the column separator in the
  // stored string (same rule as inline cell editing on the canvas).
  const commit = (rs) => f.onChange(rs.map((r) => r.map((c) => String(c).replace(/\|/g, '/')).join('|')).join('\n'));
  const grid = el('div', { display: 'flex', flexDirection: 'column', gap: '4px' });
  const iconBtnStyle = { border: '0', borderRadius: '5px', background: 'transparent', color: 'var(--ed-faint)', cursor: 'pointer', fontSize: '11px', lineHeight: '1', padding: '2px' };
  const dangerHover = (btn) => {
    btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--ed-danger-soft)'; btn.style.color = 'var(--ed-danger)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; btn.style.color = 'var(--ed-faint)'; });
  };

  if (cols > 1) {
    // The right padding mirrors the per-row ✕ (18px + 4px gap) so the column
    // ✕s line up over their columns -- but that ✕ only exists when there is
    // more than one row, so pad only then or the strip drifts 22px left.
    const strip = el('div', { display: 'flex', gap: '4px', paddingRight: rows.length > 1 ? '22px' : '0' });
    for (let ci = 0; ci < cols; ci++) {
      const cbtn = el('button', Object.assign({ flex: '1', minWidth: '0' }, iconBtnStyle), { type: 'button', title: 'Remove column ' + (ci + 1), text: '✕' });
      dangerHover(cbtn);
      cbtn.addEventListener('click', () => commit(rows.map((r) => r.filter((x, i) => i !== ci))));
      strip.appendChild(cbtn);
    }
    grid.appendChild(strip);
  }

  rows.forEach((r, ri) => {
    const rowEl = el('div', { display: 'flex', gap: '4px', alignItems: 'center' });
    r.forEach((cell, ci) => {
      const input = el('input', {
        flex: '1', minWidth: '0', boxSizing: 'border-box', background: 'var(--ed-panel-2)', border: '1px solid var(--ed-line)',
        borderRadius: '6px', color: 'var(--ed-text)', font: 'inherit', fontSize: '11px',
        fontWeight: f.header && ri === 0 ? '700' : '400', padding: '5px 6px',
      }, { 'data-focus-key': `f${f.key}-r${ri}c${ci}`, dir: 'auto' });
      input.value = cell;
      const cellCommit = typeCommit((v) => { const next = rows.map((row) => row.slice()); next[ri][ci] = v; commit(next); });
      input.addEventListener('input', (e) => cellCommit.call(e.target.value));
      input.addEventListener('focus', () => { input.style.borderColor = 'var(--ed-accent)'; input.style.outline = 'none'; });
      input.addEventListener('blur', () => { input.style.borderColor = 'var(--ed-line)'; cellCommit.flush(); });
      rowEl.appendChild(input);
    });
    if (rows.length > 1) {
      const del = el('button', Object.assign({ width: '18px', flex: 'none' }, iconBtnStyle), { type: 'button', title: 'Remove row ' + (ri + 1), text: '✕' });
      dangerHover(del);
      del.addEventListener('click', () => commit(rows.filter((x, i) => i !== ri)));
      rowEl.appendChild(del);
    }
    grid.appendChild(rowEl);
  });

  const actions = el('div', { display: 'flex', gap: '6px', marginTop: '2px' });
  [['＋ Row', () => commit(rows.concat([new Array(cols).fill('')]))], ['＋ Column', () => commit(rows.map((r) => r.concat('')))]].forEach(([label, fn]) => {
    const btn = el('button', { flex: '1', border: '1px dashed var(--ed-line-2)', borderRadius: '8px', background: 'transparent', color: 'var(--ed-muted)', cursor: 'pointer', fontFamily: 'var(--ed-font)', fontSize: '11px', fontWeight: '600', padding: '6px' }, { type: 'button', text: label });
    btn.addEventListener('mouseenter', () => { btn.style.borderColor = 'var(--ed-accent)'; btn.style.color = 'var(--ed-accent)'; btn.style.background = 'var(--ed-soft)'; });
    btn.addEventListener('mouseleave', () => { btn.style.borderColor = 'var(--ed-line-2)'; btn.style.color = 'var(--ed-muted)'; btn.style.background = 'transparent'; });
    btn.addEventListener('click', fn);
    actions.appendChild(btn);
  });
  grid.appendChild(actions);
  box.appendChild(grid);
  return box;
}

/**
 * The stepper: ONE bordered box holding bare -/+ hit areas flanking the
 * centered value + unit. The previous design nested raised, bordered buttons
 * inside an inset pill; the boxes-in-boxes read as visual noise, so the
 * inner borders, shadows and track fill are gone -- a single line now
 * carries the whole control. The focus ring lives on the box, not the inner
 * input: the global `#mc input:focus` ring drew a stray box around the bare
 * value in the middle of the control (`.mc-stepper-input` opts out,
 * render/style.js).
 */
function stepper(f, width) {
  const ctl = el('div', { display: 'flex', alignItems: 'stretch', width: width || '100%', height: '32px', flex: 'none', boxSizing: 'border-box', border: '1px solid var(--ed-line)', borderRadius: '8px', background: 'var(--ed-panel)', overflow: 'hidden', transition: 'border-color 0.16s, box-shadow 0.16s' }, { class: 'mc-field-control mc-stepper' });
  const stepBtn = (name, title, onClick) => {
    const b = el('button', { width: '27px', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0', border: '0', background: 'transparent', color: 'var(--ed-muted)', cursor: 'pointer', transition: 'background 0.14s, color 0.14s' }, { type: 'button', title });
    b.appendChild(icon(name, 11));
    b.addEventListener('mouseenter', () => { b.style.background = 'var(--ed-soft)'; b.style.color = 'var(--ed-accent)'; });
    b.addEventListener('mouseleave', () => { b.style.background = 'transparent'; b.style.color = 'var(--ed-muted)'; });
    b.addEventListener('click', onClick);
    return b;
  };
  const dec = stepBtn('minus', 'Decrease', () => f.onDec());
  const mid = el('div', { flex: '1', minWidth: '0', display: 'flex', alignItems: 'baseline', alignSelf: 'center', justifyContent: 'center', gap: '3px', padding: '0 2px' });
  // type="text" + inputmode, NOT type="number": browsers refuse the
  // selection APIs on number inputs, so the per-keystroke re-render could
  // never restore the caret -- typing multi-digit values scrambled them.
  // The -/+ buttons and blur clamp cover what the number type provided.
  const input = el('input', { width: '44px', minWidth: '0', flex: '0 1 auto', textAlign: 'center', boxSizing: 'border-box', background: 'transparent', border: '0', outline: 'none', color: 'var(--ed-text)', fontFamily: 'var(--ed-font)', fontSize: '12.5px', fontWeight: '600', padding: '0' }, { type: 'text', inputmode: 'decimal', class: 'mc-stepper-input', 'data-focus-key': `f${f.key}` });
  input.value = f.value;
  const rangeCommit = typeCommit(f.onInput);
  input.addEventListener('input', (e) => rangeCommit.call(e.target.value));
  // Flush before the clamp: onBlur reads/normalizes committed state, so a
  // still-pending keystroke commit firing after it would undo the clamp.
  input.addEventListener('blur', (e) => { rangeCommit.flush(); f.onBlur(e.target.value); });
  input.addEventListener('focus', () => { ctl.style.borderColor = 'var(--ed-accent)'; ctl.style.boxShadow = '0 0 0 3px var(--ed-soft)'; });
  input.addEventListener('blur', () => { ctl.style.borderColor = 'var(--ed-line)'; ctl.style.boxShadow = 'none'; });
  mid.appendChild(input);
  if (f.unit) mid.appendChild(el('span', { flex: 'none', fontSize: '12px', fontFamily: 'var(--ed-font)', fontWeight: '500', color: 'var(--ed-text)' }, { text: f.unit }));
  const inc = stepBtn('plus', 'Increase', () => f.onInc());
  ctl.append(dec, mid, inc);
  return ctl;
}

/**
 * A grid of linked steppers for multi-side props (core/binder.js `group`):
 * optional header row carrying the group label and a "More options" switch
 * (which swaps the linked pair for per-side fields), then two columns of
 * small-captioned flat steppers. One grid instead of a stack of full-width
 * label+control rows: the sides read as one unit and the panel loses a
 * border-to-border line per side.
 */
function renderRangeGroup(f) {
  const box = el('div');
  if (f.label || f.toggle) {
    const head = el('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '9px' });
    head.appendChild(fieldLabel(f.label || '', true));
    if (f.toggle) {
      // Namespaced anim key so this switch's slide (see pendingSwitchAnim)
      // never collides with a plain toggle that shares the group's label.
      const animKey = (f.label || '') + '::more';
      const more = el('div', { display: 'flex', alignItems: 'center', gap: '7px', flex: 'none', cursor: 'pointer' }, { class: 'mc-switch-row' });
      more.addEventListener('click', () => { pendingSwitchAnim = animKey; f.toggle.onChange(); });
      more.appendChild(el('span', { fontFamily: 'var(--ed-font)', fontSize: '12.5px', lineHeight: '1.35', fontWeight: '500', color: 'var(--ed-text)' }, { text: 'More options', class: 'mc-field-label' }));
      const track = el('button', null, { type: 'button', class: 'mc-switch', role: 'switch', 'aria-checked': String(!!f.toggle.on), 'aria-label': (f.label ? f.label + ' — ' : '') + 'more options' });
      track.appendChild(el('span', null, { class: 'mc-switch-knob' }));
      if (pendingSwitchAnim === animKey) { track.classList.add('mc-switch-anim'); pendingSwitchAnim = null; }
      more.appendChild(track);
      head.appendChild(more);
    }
    box.appendChild(head);
  }
  const grid = el('div', { display: 'grid', gridTemplateColumns: f.items.length === 1 ? '1fr' : '1fr 1fr', gap: '10px 12px' });
  f.items.forEach((it) => {
    const cell = el('div');
    cell.appendChild(fieldLabel(it.label));
    cell.appendChild(stepper(it));
    grid.appendChild(cell);
  });
  box.appendChild(grid);
  return box;
}

/**
 * Builds one field row exactly as the template's `sc-if` cascade over
 * `f.isHead/isArea/isBtn/isSeg/isRange/isToggle/isRow(isText/isNum/isColor/isSelect)`
 * (template lines 172-236, and the theme-tab variant at 385-406 which only
 * has isHead/isField(isNum/isColor/isSelect) -- `renderThemeField` covers that subset).
 */
export function renderField(f) {
  const wrap = el('div', { minWidth: '0' }, { class: 'mc-field' });

  if (f.isSocial) {
    wrap.appendChild(renderSocialItems(f));
    return wrap;
  }

  if (f.isTableGrid) {
    wrap.appendChild(renderTableGrid(f));
    return wrap;
  }

  if (f.isRichLinks) {
    wrap.appendChild(renderRichLinks(f));
    return wrap;
  }

  // No isHead branch: heads never reach renderField -- renderFieldCards
  // consumes them as card kickers. A field list rendered without the card
  // grouper would drop its headings, which is the loud failure we want.

  if (f.isArea) {
    const box = el('div');
    box.appendChild(fieldLabel(f.label));
    // dir=auto here and on the other content fields below: these hold the
    // email's own text, whose language is independent of the editor chrome's
    // locale -- inheriting the chrome's `dir=rtl` bidi-scrambled English copy
    // (trailing periods jumping to the line start). Value-shaped fields
    // (URLs, color codes) pin dir=ltr instead, since they are never RTL.
    const ta = el('textarea', { width: '100%', minHeight: '76px', boxSizing: 'border-box', background: 'var(--ed-panel-2)', border: '1px solid var(--ed-line)', color: 'var(--ed-text)', fontFamily: 'ui-monospace, monospace', fontSize: '11.5px', lineHeight: '1.5', padding: '7px 8px', resize: 'vertical' }, { placeholder: f.placeholder, 'data-focus-key': `f${f.key}`, dir: 'auto' });
    ta.value = f.value;
    const taCommit = typeCommit(f.onChange);
    ta.addEventListener('input', (e) => taCommit.call(e.target.value));
    ta.addEventListener('focus', () => { ta.style.borderColor = 'var(--ed-accent)'; ta.style.outline = 'none'; });
    ta.addEventListener('blur', () => { ta.style.borderColor = 'var(--ed-line)'; taCommit.flush(); });
    box.appendChild(ta);
    wrap.appendChild(box);
    return wrap;
  }

  if (f.isBtn) {
    // Soft accent action chip -- same recipe as the panel's other secondary
    // actions, replacing the retired mono-uppercase ghost button that
    // clashed with the card system it sits in.
    const btn = el('button', { width: '100%', border: '0', borderRadius: '8px', background: 'var(--ed-soft)', color: 'var(--ed-accent)', cursor: 'pointer', padding: '8px 10px', fontFamily: 'var(--ed-font)', fontSize: '11.5px', fontWeight: '600', transition: 'background 0.16s, color 0.16s' }, { type: 'button', text: f.label });
    btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--ed-accent)'; btn.style.color = 'var(--ed-accent-ink)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'var(--ed-soft)'; btn.style.color = 'var(--ed-accent)'; });
    btn.addEventListener('click', f.onClick);
    wrap.appendChild(btn);
    return wrap;
  }

  if (f.isSeg) {
    const box = el('div');
    box.appendChild(fieldLabel(f.label));
    const seg = el('div', { display: 'flex', gap: '3px', padding: '3px', border: '0', borderRadius: '10px', background: 'var(--ed-panel-2)' }, { class: 'mc-segment mc-field-segment' });
    f.options.forEach((o) => {
      const active = o.bg === 'var(--ed-accent)';
      const b = el('button', { flex: '1', minWidth: '0', border: '0', borderRadius: '7px', cursor: 'pointer', background: o.bg, color: o.fg, fontFamily: 'var(--ed-font)', fontSize: '10px', fontWeight: '600', padding: '0 6px', height: '28px', textTransform: 'none', letterSpacing: '0.01em', transition: 'background 0.16s, color 0.16s' }, { type: 'button', text: o.label, 'aria-pressed': String(active) });
      b.addEventListener('click', o.onClick);
      seg.appendChild(b);
    });
    box.appendChild(seg);
    wrap.appendChild(box);
    return wrap;
  }

  if (f.isRangeGroup) {
    wrap.appendChild(renderRangeGroup(f));
    return wrap;
  }

  if (f.isSlider) {
    // Drag-to-resize slider (core/binder.js `slider`): the value stays in a
    // stable header badge instead of riding over the thumb, where it collided
    // with the label/track at common widths. The fill and badge still update
    // as pure DOM writes; the document commits once, on release.
    wrap.classList.add('mc-slider-field');
    const box = el('div');
    const head = el('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' });
    head.appendChild(fieldLabel(f.label, true));
    const value = el('output', { minWidth: '58px', height: '25px', padding: '0 8px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--ed-line)', borderRadius: '7px', background: 'var(--ed-panel-2)', color: 'var(--ed-accent)', fontFamily: 'var(--ed-font)', fontSize: '11.5px', fontWeight: '600', whiteSpace: 'nowrap' }, { 'aria-live': 'polite' });
    head.appendChild(value);
    const holder = el('div', { padding: '11px 0 4px' });
    const input = el('input', { width: '100%', margin: '0', display: 'block', boxSizing: 'border-box' }, { type: 'range', min: f.min, max: f.max, step: f.step, class: 'mc-slider', 'aria-label': f.label, 'data-focus-key': `f${f.key}` });
    input.value = f.value;
    const place = () => {
      const pct = (input.value - f.min) / (f.max - f.min || 1);
      value.textContent = input.value + f.unit;
      input.style.background = `linear-gradient(to right, var(--ed-accent) ${pct * 100}%, var(--ed-line-2) ${pct * 100}%)`;
    };
    place();
    input.addEventListener('input', place);
    input.addEventListener('change', (e) => f.onCommit(e.target.value));
    holder.appendChild(input);
    box.append(head, holder);
    wrap.appendChild(box);
    return wrap;
  }

  if (f.isRange) {
    const box = el('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }, { class: 'mc-field-row' });
    box.appendChild(fieldLabel(f.label, true));
    box.appendChild(stepper(f, '132px'));
    wrap.appendChild(box);
    return wrap;
  }

  if (f.isToggle) {
    // The pill track and its knob live in CSS (`.mc-switch` in render/style.js)
    // rather than inline styles: the on/off look is driven purely off
    // `aria-checked`, which keeps the accessible state and the visual state
    // from ever drifting apart, and lets `:hover`/`:focus-visible` style it
    // without a JS listener per state.
    const row = el('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', minHeight: '32px', cursor: 'pointer' }, { class: 'mc-switch-row mc-field-row' });
    // Only the row listens: a click on the switch bubbles up to it, so the
    // handler still fires exactly once (including for keyboard Enter/Space,
    // which the browser dispatches as a click on the button).
    row.addEventListener('click', () => { pendingSwitchAnim = f.label; f.onChange(); });
    const togLabel = fieldLabel(f.label, true);
    togLabel.style.cursor = 'pointer';
    row.appendChild(togLabel);
    const track = el('button', null, { type: 'button', class: 'mc-switch', role: 'switch', 'aria-checked': String(!!f.on), 'aria-label': f.label });
    track.appendChild(el('span', null, { class: 'mc-switch-knob' }));
    // See `pendingSwitchAnim`: this is the rebuilt switch for the click that
    // just happened, so it (and only it) plays the slide.
    if (pendingSwitchAnim === f.label) { track.classList.add('mc-switch-anim'); pendingSwitchAnim = null; }
    row.appendChild(track);
    wrap.appendChild(row);
    return wrap;
  }

  if (f.isColor) {
    // Flat-accordion design: label at left, one bordered pill at right
    // holding the swatch (which doubles as the native picker) and the hex
    // field -- the swatch-and-loose-hex layout read as two stray controls.
    const row = el('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }, { class: 'mc-field-row' });
    row.appendChild(fieldLabel(f.label, true));
    const pill = el('div', { display: 'flex', alignItems: 'center', flex: 'none', height: '32px', border: '1px solid var(--ed-line)', borderRadius: '8px', background: 'var(--ed-panel)', overflow: 'hidden', transition: 'border-color 0.16s, box-shadow 0.16s' }, { class: 'mc-field-control mc-color-control' });
    const swatch = el('label', { position: 'relative', width: '29px', alignSelf: 'stretch', flex: 'none', borderRight: '1px solid var(--ed-line)', background: f.swatch, cursor: 'pointer' }, { title: f.label });
    // A transparent value has no colour to show, so the swatch shows the
    // conventional checkerboard instead -- otherwise "no fill" and "white"
    // are the same white square.
    if (f.transparent) {
      Object.assign(swatch.style, {
        backgroundColor: '#ffffff',
        backgroundImage: 'linear-gradient(45deg,#c3c9d2 25%,transparent 25%,transparent 75%,#c3c9d2 75%),linear-gradient(45deg,#c3c9d2 25%,transparent 25%,transparent 75%,#c3c9d2 75%)',
        backgroundSize: '8px 8px',
        backgroundPosition: '0 0, 4px 4px',
      });
    }
    const picker = el('input', { position: 'absolute', inset: '0', width: '100%', height: '100%', opacity: '0', cursor: 'pointer', padding: '0', border: '0' }, { type: 'color' });
    picker.value = f.swatch;
    // The native picker fires `input` continuously while dragging the hue
    // wheel -- committed raw, that is a full re-render per mouse move.
    const pickCommit = typeCommit(f.onChange);
    picker.addEventListener('input', (e) => pickCommit.call(e.target.value));
    picker.addEventListener('change', () => pickCommit.flush());
    swatch.appendChild(picker);
    const hex = el('input', { width: '82px', boxSizing: 'border-box', background: 'transparent', border: '0', outline: 'none', color: 'var(--ed-text)', fontFamily: 'ui-monospace, monospace', fontSize: '11px', padding: '0 9px' }, { placeholder: 'inherit', class: 'mc-stepper-input', 'data-focus-key': `f${f.key}`, dir: 'ltr' });
    hex.value = f.value;
    const hexCommit = typeCommit(f.onChange);
    hex.addEventListener('input', (e) => hexCommit.call(e.target.value));
    hex.addEventListener('focus', () => { pill.style.borderColor = 'var(--ed-accent)'; pill.style.boxShadow = '0 0 0 3px var(--ed-soft)'; });
    hex.addEventListener('blur', () => { pill.style.borderColor = 'var(--ed-line)'; pill.style.boxShadow = 'none'; hexCommit.flush(); });
    pill.append(swatch, hex);
    if (f.clearable) {
      const none = el('button', { flex: 'none', alignSelf: 'stretch', width: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '0', borderLeft: '1px solid var(--ed-line)', background: f.transparent ? 'var(--ed-accent)' : 'transparent', color: f.transparent ? 'var(--ed-accent-ink)' : 'var(--ed-muted)', cursor: 'pointer', padding: '0' }, { type: 'button', title: f.transparent ? 'Transparent — click for a solid colour' : 'Make transparent (no fill)', 'aria-pressed': String(!!f.transparent) });
      none.appendChild(icon(f.transparent ? 'check' : 'clear', 12));
      none.addEventListener('click', () => f.onToggleTransparent());
      pill.appendChild(none);
    }
    row.appendChild(pill);
    wrap.appendChild(row);
    return wrap;
  }

  if (f.isRow) {
    const row = el('div', { display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'space-between' }, { class: 'mc-field-row' });
    row.appendChild(fieldLabel(f.label, true));
    if (f.isText) {
      const input = el('input', { width: '168px', boxSizing: 'border-box', background: 'var(--ed-panel-2)', border: '1px solid var(--ed-line)', color: 'var(--ed-text)', font: 'inherit', fontSize: '12px', padding: '6px 8px' }, { placeholder: f.placeholder, class: 'mc-field-control', 'data-focus-key': `f${f.key}`, dir: 'auto' });
      input.value = f.value;
      // Optional suggestions (e.g. the host's merge variables on a marker's
      // expression field): a datalist keeps the input free-text -- pick one
      // of the host's names from the dropdown, or type any other.
      if (f.suggestions) {
        const dl = el('datalist', null, { id: `mc-dl-f${f.key}` });
        f.suggestions.forEach((s) => { const opt = document.createElement('option'); opt.value = s; dl.appendChild(opt); });
        input.setAttribute('list', dl.id);
        row.appendChild(dl);
      }
      const textInputCommit = typeCommit(f.onChange);
      input.addEventListener('input', (e) => textInputCommit.call(e.target.value));
      input.addEventListener('focus', () => { input.style.borderColor = 'var(--ed-accent)'; input.style.outline = 'none'; });
      input.addEventListener('blur', () => { input.style.borderColor = 'var(--ed-line)'; textInputCommit.flush(); });
      row.appendChild(input);
    } else if (f.isNum) {
      // text + inputmode for the same caret-restoration reason as the range
      // field above.
      const input = el('input', { width: '78px', boxSizing: 'border-box', background: 'var(--ed-panel-2)', border: '1px solid var(--ed-line)', color: 'var(--ed-text)', font: 'inherit', fontSize: '12px', padding: '6px 8px' }, { type: 'text', inputmode: 'numeric', class: 'mc-field-control', 'data-focus-key': `f${f.key}` });
      input.value = f.value;
      const numCommit = typeCommit(f.onChange);
      input.addEventListener('input', (e) => numCommit.call(e.target.value));
      // Flush before the clamp, same reason as the stepper above.
      input.addEventListener('blur', (e) => { input.style.borderColor = 'var(--ed-line)'; numCommit.flush(); if (f.onBlur) f.onBlur(e.target.value); });
      input.addEventListener('focus', () => { input.style.borderColor = 'var(--ed-accent)'; input.style.outline = 'none'; });
      row.appendChild(input);
    } else if (f.isSelect) {
      // Focus key so changing a value (which rebuilds the panel) hands focus
      // back to the rebuilt select -- without it every dropdown change threw
      // keyboard users back to the top of the page.
      const select = el('select', { width: '168px', boxSizing: 'border-box', background: 'var(--ed-panel-2)', border: '1px solid var(--ed-line)', color: 'var(--ed-text)', font: 'inherit', fontSize: '12px', padding: '6px 8px' }, { class: 'mc-field-control', 'data-focus-key': `f${f.key}` });
      f.options.forEach((o) => { const opt = document.createElement('option'); opt.value = o.value; opt.textContent = o.label; select.appendChild(opt); });
      // An unset prop arrives as undefined; assigning that to a <select>
      // coerces to the string "undefined" and selects nothing -- coerce to ''
      // so it lands on the empty-value option (e.g. Font's "Inherit").
      select.value = f.value == null ? '' : f.value;
      select.addEventListener('change', (e) => f.onChange(e.target.value));
      select.addEventListener('focus', () => { select.style.borderColor = 'var(--ed-accent)'; select.style.outline = 'none'; });
      select.addEventListener('blur', () => { select.style.borderColor = 'var(--ed-line)'; });
      row.appendChild(select);
    }
    wrap.appendChild(row);
    return wrap;
  }

  return wrap;
}

export function renderFieldList(container, fields) {
  fields.forEach((f) => container.appendChild(renderField(f)));
}
