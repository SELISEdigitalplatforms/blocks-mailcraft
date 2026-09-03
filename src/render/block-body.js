import { icon, brandIcon, socialKey, SOCIAL_BRAND, contrastInk } from '../core/icons.js';
import { pad } from '../core/layout-style.js';
import { parseItems, cellsOf } from '../core/parse.js';
import { linkHref } from '../core/sanitize.js';

function el(tag, style, attrs) {
  const node = document.createElement(tag);
  if (style) Object.assign(node.style, style);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (v !== undefined) node.setAttribute(k, v);
  }
  return node;
}

function m(v) { return String(v == null ? '' : v); }

/**
 * Writing assistants (Grammarly, LanguageTool and friends) treat any
 * `contenteditable` as a field of their own: they float a button over its
 * bottom-right corner -- squarely on top of this editor's own block toolbar --
 * and inject their highlight/overlay DOM into it, which `syncLiveEdit`
 * (mailcraft-editor.js) then reads back as innerHTML and stores in the
 * template, so their markup ends up in the exported email. Every one of them
 * honours an opt-out attribute on the field itself, so each editable surface
 * declares all of them here rather than repeating the list six times below.
 * The `spellcheck="false"` that already rode along stays on every copy,
 * editable or not, and `core/export.js` strips all of it back out on the way
 * to the recipient.
 */
const NO_ASSIST = {
  'data-gramm': 'false',
  'data-gramm_editor': 'false',
  'data-enable-grammarly': 'false',
  'data-lt-active': 'false',
};

function editableAttrs(on) {
  return on ? { contenteditable: 'true', spellcheck: 'false', ...NO_ASSIST } : { spellcheck: 'false' };
}

/**
 * What keeps a text-bearing block inside the column it was dropped in.
 *
 * A long unbroken token -- a tracking URL, a concatenated word -- has a
 * min-content width of the whole token, and nothing above clips it: the block
 * wrapper (render/canvas.js) and the exported `<td>` both let it through, so
 * the run either paints across the next column on the canvas or, in the sent
 * email, widens its own cell and steals the width from its siblings (a 25%
 * column measured 511px against its neighbours' 24px).
 *
 * `anywhere` rather than the more familiar `break-word` on purpose: only
 * `anywhere` lowers the min-content contribution, which is the number table
 * and flex layout actually size against -- `break-word` wraps the glyphs but
 * leaves the box's intrinsic width at the full token, so the column blows out
 * exactly as before. `word-break` carries the same meaning for engines that
 * predate `anywhere`. Neither breaks a token that already fits.
 *
 * It has to live here, in the inline style, rather than in the editor's
 * stylesheet: this is the DOM `core/export.js` reads back and sends. The
 * canvas *looked* fine without it only because Chrome's UA sheet gives
 * `[contenteditable]` an `overflow-wrap: break-word` -- and export strips
 * `contenteditable`, so the editor was hiding the defect that shipped.
 */
const FIT = { overflowWrap: 'anywhere', wordBreak: 'break-word' };

/** An explicit block font owns every rich descendant; an empty value deliberately leaves imported inline typography untouched. */
function overrideRichFont(root, fontFamily) {
  if (!fontFamily) return;
  root.querySelectorAll('[style]').forEach((node) => node.style.removeProperty('font-family'));
}

/** An anchor merely restating the document link color drops it, so the sheet rule -- and a later Link color edit -- owns it again. The exporter stamps `theme.link` on every colorless anchor (mail clients need the value inline), and an import keeps that stamp in the block's html; left in place it froze the link color at whatever the theme said on the day of the save. A genuinely different inline color is the user's and stays. Compared through the same rgb-vs-hex fold the importer uses, since CSSOM serializes one and pickers speak the other. */
function overrideLinkColor(root, link) {
  if (!link) return;
  const key = (v) => {
    const m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(String(v || '').trim());
    const hex = m ? '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('') : String(v || '');
    return hex.toLowerCase();
  };
  const want = key(link);
  root.querySelectorAll('a[style]').forEach((a) => {
    if (a.style.color && key(a.style.color) === want) a.style.removeProperty('color');
  });
}

/**
 * Ported from the original `blockBody(b, theme, live)`. `ctx` supplies the
 * editing wiring that in the original lived on `this` (Component instance):
 * `ctx.editingId`, `ctx.onFocus(block, el, key)`, `ctx.onBlur(block, key, value)`,
 * `ctx.onPaste(block, plainOnly)`, `ctx.renderRte(block)` (returns the floating
 * toolbar node or null), `ctx.onTableCellBlur(block, ri, ci, value)`, `ctx.now`
 * (for the countdown), `ctx.vars` and `ctx.onInsertVariable` for the code-view escape hatch.
 */
export function blockBody(b, theme, live, ctx) {
  const p = b.props; const t = theme;
  const attr = live ? { 'data-mc-content': b.id } : {};

  switch (b.type) {
    case 'text': {
      const edit = live;
      const content = el('div', {
        padding: pad(p), fontSize: p.size + 'px', lineHeight: p.lh, textAlign: p.align, fontWeight: p.weight, color: p.color || t.text, outline: 'none', fontFamily: p.fontFamily || t.font, ...FIT,
      }, { ...attr, ...editableAttrs(edit), html: m(p.html), 'data-focus-key': edit ? 'block:' + b.id : undefined });
      // Imported email HTML keeps inline font-family declarations so an
      // untouched block retains its source typography. Once the user chooses
      // a block font, however, those nested declarations outrank inheritance
      // from this wrapper and made the Font control appear broken. Remove only
      // that imported property from descendants; their size, color, spacing
      // and other inline formatting remain intact, while the selected family
      // now applies consistently in the canvas and exported read-back DOM.
      overrideRichFont(content, p.fontFamily);
      overrideLinkColor(content, t.link);
      if (edit) wireEditable(content, b, 'html', ctx, false);
      if (!live) return content;
      return wrapWithRte(b, ctx, edit && ctx.editingId === b.id, content);
    }
    case 'image': {
      const wrap = el('div', { padding: pad(p), textAlign: p.align, fontSize: '0' }, attr);
      const imgHref = linkHref(p.href);
      if (imgHref) {
        // The % width must live on the anchor, not the img: a percentage on a
        // child of a shrink-to-fit inline-block resolves against the image's
        // own intrinsic size (i.e. not at all), which rendered every linked
        // logo/icon at full intrinsic width no matter what `width` said.
        const a = el('a', { display: 'inline-block', width: p.width + '%' }, { href: imgHref });
        // Same guard as every other anchor the canvas draws: without it a
        // click on a linked logo navigates the host application away from the
        // editor, taking the uncommitted document with it.
        a.addEventListener('click', (e) => e.preventDefault());
        a.appendChild(el('img', { width: '100%', borderRadius: p.radius + 'px', display: 'block', border: '0' }, { src: p.src, alt: p.alt }));
        wrap.appendChild(a);
      } else {
        wrap.appendChild(el('img', { width: p.width + '%', maxWidth: '100%', borderRadius: p.radius + 'px', display: 'inline-block', border: '0' }, { src: p.src, alt: p.alt }));
      }
      return wrap;
    }
    /*
     * A one-cell table, not a bare padded anchor.
     *
     * Classic Outlook's Word engine does not lay out `display:inline-block`
     * and treats padding on an inline `<a>` inconsistently, so the pill drawn
     * by an anchor alone collapses to bare coloured text there -- the single
     * most-reported defect in hand-written email. A `<td>` is the one box
     * Word sizes and paints reliably, so the background, the padding and the
     * corner live on the cell and the anchor becomes the label inside it.
     * Every other client renders the two identically.
     *
     * VML `<v:roundrect>` is the usual alternative and is deliberately not
     * used: it needs an explicit pixel width and height, which an auto-width
     * button sized by its own label does not have. The only thing this gives
     * up against VML is the rounded corner in Classic Outlook, which squares
     * off there and is correct everywhere else.
     */
    case 'button': {
      const wrap = el('div', { textAlign: p.align, padding: '4px 0' }, attr);
      // `inline-table` so the wrapper's text-align still positions it; the
      // `align` attribute is the same instruction for Word, which ignores the
      // display value. A full-width button is a plain 100% table instead.
      // `float:none` is load-bearing: browsers map `align="left|right"` on a
      // table to a float presentational hint, which takes the pill out of
      // flow -- the block collapses to its padding on the canvas and the
      // button paints over the next block. The inline style outranks the
      // hint everywhere floats work, and Word ignores CSS float, so the
      // `align` attribute still does its one job there.
      const table = el('table', {
        display: p.full ? 'table' : 'inline-table', width: p.full ? '100%' : 'auto', borderCollapse: 'separate', cssFloat: 'none',
      }, { role: 'presentation', cellpadding: '0', cellspacing: '0', border: '0', align: p.full ? undefined : p.align });
      const td = el('td', {
        background: p.bg, borderRadius: p.radius + 'px', padding: p.py + 'px ' + p.px + 'px', textAlign: 'center',
        // Outline-style buttons (transparent fill + border) are a standard
        // email pattern; the color falls back to the label color so a bare
        // "outline thickness" bump looks right without a second step.
        border: p.borderW ? p.borderW + 'px ' + (p.borderStyle || 'solid') + ' ' + (p.borderColor || p.color) : '0',
      }, { align: 'center', bgcolor: p.bg || undefined });
      const a = el('a', {
        display: 'block', color: p.color, textDecoration: 'none',
        // Kept on the anchor as well as the cell: `classifyButton` reads the
        // element carrying the background to decide something is a button at
        // all, and a foreign client that drops the cell's paint still shows
        // the pill. It costs one declaration.
        background: p.bg, borderRadius: p.radius + 'px',
        fontFamily: p.fontFamily || t.font, fontSize: p.size + 'px',
        fontWeight: '600', letterSpacing: '0.02em', outline: 'none', ...FIT,
      }, { href: linkHref(p.href), ...editableAttrs(live), text: p.label });
      a.addEventListener('click', (e) => e.preventDefault());
      // Button editing is deliberately plain: no focus-tracked `editing` state, no
      // paste handling, no floating RTE toolbar -- only its label commits on blur.
      if (live) a.addEventListener('blur', (e) => { if (e.target.textContent !== p.label) ctx.onBlur(b, 'label', e.target.textContent); });
      td.appendChild(a);
      const tr = el('tr'); tr.appendChild(td);
      const tbody = el('tbody'); tbody.appendChild(tr);
      table.appendChild(tbody);
      wrap.appendChild(table);
      return wrap;
    }
    case 'divider': {
      const wrap = el('div', { padding: p.py + 'px 0' }, attr);
      wrap.appendChild(el('div', { height: '0', width: p.width + '%', margin: '0 auto', borderTop: p.thickness + 'px ' + (p.lineStyle || 'solid') + ' ' + p.color }));
      return wrap;
    }
    case 'spacer':
      return el('div', { height: p.height + 'px' }, attr);
    case 'social': {
      // Two independent axes cover every style the block offers without a
      // second hand-drawn icon set per platform: `palette` picks the source
      // color (the block's one `color` prop, or each platform's own brand
      // hex), `shape` picks the container -- bordered tap-target, bare icon,
      // or a filled circle/square badge (the badge's icon color auto-flips
      // black/white via `contrastInk` so light brand colors like Snapchat
      // yellow stay legible).
      const shape = p.shape || 'outline';
      const palette = p.palette || 'custom';
      const badge = shape === 'circle' || shape === 'square';
      const box = Math.round((p.size || 20) * 1.9);
      const wrap = el('div', { textAlign: p.align, padding: '8px 0' }, attr);
      parseItems(p.items).forEach((it) => {
        const key = socialKey(it.label);
        const source = palette === 'brand' ? (SOCIAL_BRAND[key] || p.color) : p.color;
        const iconColor = badge ? contrastInk(source) : source;
        const a = el('a', {
          display: 'inline-flex', flexDirection: p.showLabel ? 'column' : 'row', alignItems: 'center', justifyContent: 'center', gap: '5px',
          width: p.showLabel ? 'auto' : box + 'px', height: p.showLabel ? 'auto' : box + 'px', padding: p.showLabel ? '7px 9px' : '0',
          margin: '0 ' + (p.gap || 12) / 2 + 'px', verticalAlign: 'middle', textDecoration: 'none',
          borderRadius: shape === 'circle' ? '50%' : shape === 'square' ? Math.round(box * 0.28) + 'px' : '0',
          color: iconColor, background: badge ? source : 'transparent',
          border: shape === 'outline' ? '1px solid ' + source : '0',
        }, { href: linkHref(it.href), title: it.label });
        a.addEventListener('click', (e) => e.preventDefault());
        let provided = null;
        if (ctx && ctx.iconProvider) { try { provided = ctx.iconProvider(key, { label: it.label, size: p.size, color: iconColor }); } catch { provided = null; } }
        a.appendChild(provided instanceof Node ? provided : brandIcon(key, p.size));
        if (p.showLabel) {
          const span = el('span', { fontFamily: p.fontFamily || t.font, fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase' }, { text: it.label });
          a.appendChild(span);
        }
        wrap.appendChild(a);
      });
      return wrap;
    }
    case 'video': {
      const wrap = el('div', { padding: '4px 0', textAlign: 'center' }, attr);
      const a = el('a', { display: 'block', position: 'relative' }, { href: linkHref(p.href) });
      a.addEventListener('click', (e) => e.preventDefault());
      a.appendChild(el('img', { width: '100%', display: 'block', border: '0' }, { src: p.src, alt: p.caption }));
      const badge = el('span', { position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center' });
      const circle = el('span', { width: '54px', height: '54px', borderRadius: '50%', background: p.badge, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', paddingLeft: '4px' }, { text: '▶' });
      badge.appendChild(circle);
      a.appendChild(badge);
      wrap.appendChild(a);
      wrap.appendChild(el('div', { fontFamily: t.font, fontSize: '12.5px', color: p.badge, opacity: '0.7', marginTop: '8px' }, { text: p.caption }));
      return wrap;
    }
    case 'html': {
      const raw = String(p.code || '');
      const edit = live && !/<style|<scr/i.test(raw);
      const safe = live
        ? raw.replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, (mm, at, css) => '<style' + at + '>' + ctx.scopeCss(css, '[data-mc-sheet]') + '</style>')
        : raw;
      const content = el('div', { padding: '6px 0', fontFamily: t.font, color: t.text, outline: 'none' }, { ...attr, ...editableAttrs(edit), html: m(safe), 'data-focus-key': edit ? 'block:' + b.id : undefined });
      if (edit) wireEditable(content, b, 'code', ctx, false);
      if (!live) return content;
      return wrapWithRte(b, ctx, edit && ctx.editingId === b.id, content);
    }
    case 'countdown': {
      const ms = Math.max(0, new Date(p.target).getTime() - ctx.now);
      const parts = [['days', Math.floor(ms / 86400000)], ['hrs', Math.floor(ms / 3600000) % 24], ['min', Math.floor(ms / 60000) % 60], ['sec', Math.floor(ms / 1000) % 60]];
      // The data-mc-countdown/data-mc-count hooks (live canvas only -- export
      // reads this DOM back) let the 1s tick repaint just these digits
      // instead of re-rendering the editor (see the tick in editor-core.js).
      const wrap = el('div', { padding: '10px 0', textAlign: 'center', fontFamily: p.fontFamily || t.font, color: p.color }, live ? Object.assign({ 'data-mc-countdown': p.target }, attr) : attr);
      wrap.appendChild(el('div', { fontSize: '12px', letterSpacing: '0.14em', textTransform: 'uppercase', opacity: '0.6', marginBottom: '10px' }, { text: p.label }));
      // Wraps rather than overhangs. Four 84px boxes plus their gaps need
      // 366px, so in any column narrower than that -- a 50/50 split of a
      // 620px sheet is 296px -- the unwrapped row used to run out over the
      // next column, and in the sent email it dragged its own cell open to
      // 386px against its neighbours' 94px. Wrapping keeps the digits legible
      // at any width; a row with the space for one line still gets one line.
      const row = el('div', { display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '10px' });
      parts.forEach(([lab, v]) => {
        const box = el('div', { border: '1px solid ' + p.color + '33', padding: '9px 12px', minWidth: '58px' });
        box.appendChild(el('div', { fontSize: '25px', fontFamily: p.fontFamily || t.font, fontWeight: '700', lineHeight: '1' }, live ? { text: String(v).padStart(2, '0'), 'data-mc-count': lab } : { text: String(v).padStart(2, '0') }));
        box.appendChild(el('div', { fontSize: '9.5px', letterSpacing: '0.16em', textTransform: 'uppercase', opacity: '0.55', marginTop: '4px' }, { text: lab }));
        row.appendChild(box);
      });
      wrap.appendChild(row);
      return wrap;
    }
    case 'menu': {
      const wrap = el('div', { textAlign: p.align, padding: '10px 0' }, attr);
      parseItems(p.items).forEach((it) => {
        // `inline-block`, not the default inline: adjacent inline *text* runs
        // offer no soft-wrap opportunity between them, and these anchors are
        // appended with no whitespace in between -- so a menu too wide for its
        // column ran straight off the edge instead of wrapping onto a second
        // line (item 3 of a 3-item menu started 18px past a 148px column). An
        // inline-block is an atomic inline, which does get a break opportunity
        // either side of it, exactly as the social row already relied on.
        const a = el('a', { display: 'inline-block', color: p.color, fontSize: p.size + 'px', fontFamily: p.fontFamily || t.font, textDecoration: 'none', margin: '0 ' + p.gap / 2 + 'px', letterSpacing: '0.12em', textTransform: 'uppercase' }, { href: linkHref(it.href), text: it.label });
        a.addEventListener('click', (e) => e.preventDefault());
        wrap.appendChild(a);
      });
      return wrap;
    }
    case 'heading': {
      const edit = live;
      const head = el(p.level || 'h2', {
        margin: '0', padding: pad(p), fontSize: p.size + 'px', lineHeight: p.lh, textAlign: p.align,
        fontWeight: p.weight, letterSpacing: p.font === 'condensed' ? '0.005em' : '-0.01em',
        color: p.color || t.text, outline: 'none', ...FIT,
        // An explicit per-block font beats the Condensed/Body style toggle.
        fontFamily: p.fontFamily || (p.font === 'condensed' ? "'Arial Narrow', 'Helvetica Neue Condensed', Helvetica, Arial, sans-serif" : t.font),
      }, { ...attr, ...editableAttrs(edit), text: m(p.text), 'data-focus-key': edit ? 'block:' + b.id : undefined });
      if (edit) wireEditable(head, b, 'text', ctx, true);
      if (!live) return head;
      return wrapWithRte(b, ctx, ctx.editingId === b.id, head);
    }
    case 'list': {
      const items = String(p.items || '').split('\n').filter((l) => l.trim());
      const list = el(p.ordered ? 'ol' : 'ul', { margin: '0', padding: (p.py || 0) + 'px 0 ' + (p.py || 0) + 'px 22px', fontFamily: p.fontFamily || t.font, fontSize: p.size + 'px', lineHeight: p.lh, color: p.color || t.text, ...FIT }, attr);
      items.forEach((it) => {
        const li = el('li', { marginBottom: p.gap + 'px' }, { html: m(it) });
        list.appendChild(li);
      });
      overrideRichFont(list, p.fontFamily);
      overrideLinkColor(list, t.link);
      return list;
    }
    case 'table': {
      const rows = cellsOf(p);
      const edit = live;
      const line = p.borders ? (p.borderWidth || 1) + 'px ' + (p.borderStyle || 'solid') + ' ' + p.lineColor : '0';
      const table = el('table', { width: p.width + '%', borderCollapse: 'collapse', fontFamily: p.fontFamily || t.font, fontSize: p.size + 'px', color: t.text, border: line }, { ...attr, cellpadding: '0', cellspacing: '0' });
      const tbody = el('tbody');
      rows.forEach((row, ri) => {
        const isHead = p.header && ri === 0;
        const tr = el('tr', { background: isHead ? p.headBg : (p.striped && ri % 2 === 0 ? 'rgba(29,31,32,0.028)' : 'transparent') });
        row.forEach((cell, ci) => {
          const td = el(isHead ? 'th' : 'td', {
            border: line, padding: p.pad + 'px ' + Math.round(p.pad * 1.2) + 'px', textAlign: ci === 0 ? p.align : (isHead ? p.align : 'left'),
            fontWeight: isHead ? '600' : '400', outline: 'none',
            fontFamily: p.fontFamily || t.font,
            letterSpacing: isHead ? '0.06em' : 'normal', textTransform: isHead ? 'uppercase' : 'none', fontSize: isHead ? p.size + 1 + 'px' : p.size + 'px',
            // See FIT: a `<table>` cannot be laid out narrower than its
            // min-content width, so `width:100%` alone never made it fit a
            // column smaller than the sum of its longest cells (224px for the
            // stock three-column table -- wider than a 3- or 4-way split).
            // Letting the cells break brings that floor down to the column.
            // Deliberately *not* `table-layout:fixed`, the usual reflex here:
            // fixed would also fit, but it divides the width evenly and would
            // silently re-proportion every table already in a saved document.
            // Breaking keeps the content-proportional columns (measured
            // 53/42/39 against fixed's 45/45/45).
            ...FIT,
          }, { ...editableAttrs(edit), text: m(cell), 'data-focus-key': edit ? 'block:' + b.id + ':c' + ri + '-' + ci : undefined });
          if (edit) {
            // stopPropagation is load-bearing (a bubbled click would select
            // via the block wrapper AND deselect via the workspace), but it
            // also meant clicking a cell never selected the table at all --
            // the cells cover the whole block. Selecting on *focus* instead,
            // with the focus key above letting focus-preserve restore the
            // caret across the selection re-render, gives the table the same
            // click-to-select behavior as a text block.
            td.addEventListener('click', (e) => e.stopPropagation());
            td.addEventListener('focus', () => { if (ctx.selectBlock) ctx.selectBlock(b); });
            td.addEventListener('blur', () => ctx.onTableCellBlur(b, ri, ci, td.textContent));
          }
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      return table;
    }
    case 'css': {
      const wrap = el('div', { fontSize: '0', lineHeight: '0' }, attr);
      wrap.appendChild(el('style', {}, { html: live ? ctx.scopeCss(p.code, '[data-mc-sheet]') : p.code }));
      if (live) {
        wrap.appendChild(el('div', { fontFamily: 'ui-monospace, monospace', fontSize: '10px', lineHeight: '1.5', letterSpacing: '0.06em', textTransform: 'uppercase', color: '#7d8791', border: '1px dashed rgba(89,128,166,0.5)', padding: '8px 10px' }, { text: 'style block — ' + (p.code || '').length + ' chars, hidden when sent' }));
      }
      return wrap;
    }
    case 'box': {
      const edit = live;
      const borderSide = (on) => (p.border && on !== false ? p.border + 'px ' + (p.borderStyle || 'solid') + ' ' + p.lineColor : '0');
      const box = el('div', {
        background: p.bgImage ? 'linear-gradient(rgba(0,0,0,0), rgba(0,0,0,0)), url("' + p.bgImage + '")' : p.bg,
        backgroundSize: 'cover', backgroundPosition: 'center',
        borderTop: borderSide(p.topBorder), borderRight: borderSide(p.rightBorder),
        borderBottom: borderSide(p.bottomBorder), borderLeft: borderSide(p.leftBorder),
        borderRadius: p.radius + 'px', padding: p.pad + 'px', textAlign: p.align,
        // `maxWidth` has to cap the box the reader sees, not its text area:
        // under the default content-box sizing the padding and border were
        // added *outside* the cap, so a box set to 60% of a 296px column
        // painted 212px wide instead of 178. The default 100% is unaffected
        // either way -- an auto-width block already stops at the column edge.
        boxSizing: 'border-box',
        minHeight: p.minH ? p.minH + 'px' : 'auto', maxWidth: p.maxW + '%', margin: p.align === 'center' ? '0 auto' : '0',
        boxShadow: p.shadow ? '0 10px 30px rgba(29,31,32,0.12)' : 'none',
        fontFamily: t.font, color: t.text, fontSize: '15px', lineHeight: '1.6', ...FIT,
      }, { ...attr, ...editableAttrs(edit), html: m(p.html), 'data-focus-key': edit ? 'block:' + b.id : undefined });
      overrideLinkColor(box, t.link);
      if (edit) wireEditable(box, b, 'html', ctx, false);
      if (!live) return box;
      return wrapWithRte(b, ctx, ctx.editingId === b.id, box);
    }
    case 'svg':
      return el('div', { padding: p.py + 'px 0', textAlign: p.align }, { ...attr, html: '<span style="display:inline-block;width:' + p.width + '%">' + p.code + '</span>' });
    // Dynamic-content markers. Editor furniture, never sent: the exporter
    // emits the template tag itself at this position (core/export.js) and
    // never reads this DOM back. The band renders in the preview too -- the
    // preview shows the template the way it shows merge tokens, so the logic
    // structure stays visible there rather than silently vanishing.
    case 'condition':
    case 'loop': {
      const isLoop = b.type === 'loop';
      const color = isLoop ? '#7c3aed' : '#0e7490';
      const word = p.end ? (isLoop ? 'end loop' : 'end if') : (isLoop ? 'repeat each' : 'show if');
      const band = el('div', {
        display: 'flex', alignItems: 'center', gap: '8px', boxSizing: 'border-box',
        border: '1.5px dashed ' + color, borderRadius: '7px', background: color + '14',
        padding: '6px 12px', margin: '2px 0', color,
      }, attr);
      band.appendChild(el('span', { fontFamily: 'ui-monospace,monospace', fontSize: '9.5px', fontWeight: '700', letterSpacing: '0.12em', textTransform: 'uppercase', flex: 'none' }, { text: (p.end ? '⏶ ' : '⏷ ') + word }));
      if (!p.end) band.appendChild(el('span', { fontFamily: 'ui-monospace,monospace', fontSize: '11.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, { text: '{{ ' + (p.expr || '…') + ' }}' }));
      return band;
    }
    // `pre-wrap`, not `pre`: `overflow-x:auto` gives the canvas a scrollbar
    // and so looked contained here, but a mail client has no scrollbar to
    // offer and sizes the cell to the longest line anyway -- a 33% column
    // measured 371px against its neighbours' ~100px. Wrapping the long lines
    // is the one option that keeps the sample readable and the row intact;
    // `anywhere` covers a single unbroken line with no spaces to break at.
    // The horizontal scroll stays for the canvas, where it still helps.
    case 'codeblock':
      return el('pre', { margin: '0', padding: p.pad + 'px', background: p.bg, color: p.color, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: p.size + 'px', lineHeight: '1.6', overflowX: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }, { ...attr, text: m(p.code) });
    default:
      return el('div');
  }
}

function wireEditable(node, block, key, ctx, isPlainText) {
  node.addEventListener('paste', (e) => ctx.onPaste(e, isPlainText));
  node.addEventListener('focus', (e) => ctx.onFocus(block, e.currentTarget, key, isPlainText));
  node.addEventListener('blur', (e) => {
    if (ctx.rteActiveRef && ctx.rteActiveRef.current) return;
    const val = isPlainText ? e.target.textContent : e.target.innerHTML;
    ctx.onBlur(block, key, val);
  });
}

/** `h('div',{style:{position:'relative'}}, editing===b.id ? this.rte(b) : null, content)` */
function wrapWithRte(block, ctx, showRte, content) {
  const wrap = el('div', { position: 'relative' });
  if (showRte) wrap.appendChild(ctx.renderRte(block));
  wrap.appendChild(content);
  return wrap;
}
