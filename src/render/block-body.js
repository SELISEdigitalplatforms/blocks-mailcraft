import { icon, brandIcon, socialKey, SOCIAL_BRAND, contrastInk } from '../core/icons.js';
import { pad } from '../core/layout-style.js';
import { parseItems, cellsOf } from '../core/parse.js';

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

/** An explicit block font owns every rich descendant; an empty value deliberately leaves imported inline typography untouched. */
function overrideRichFont(root, fontFamily) {
  if (!fontFamily) return;
  root.querySelectorAll('[style]').forEach((node) => node.style.removeProperty('font-family'));
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
        padding: pad(p), fontSize: p.size + 'px', lineHeight: p.lh, textAlign: p.align, fontWeight: p.weight, color: p.color || t.text, outline: 'none', fontFamily: p.fontFamily || t.font,
      }, { ...attr, contenteditable: edit ? 'true' : undefined, spellcheck: 'false', html: m(p.html), 'data-focus-key': edit ? 'block:' + b.id : undefined });
      // Imported email HTML keeps inline font-family declarations so an
      // untouched block retains its source typography. Once the user chooses
      // a block font, however, those nested declarations outrank inheritance
      // from this wrapper and made the Font control appear broken. Remove only
      // that imported property from descendants; their size, color, spacing
      // and other inline formatting remain intact, while the selected family
      // now applies consistently in the canvas and exported read-back DOM.
      overrideRichFont(content, p.fontFamily);
      if (edit) wireEditable(content, b, 'html', ctx, false);
      if (!live) return content;
      return wrapWithRte(b, ctx, edit && ctx.editingId === b.id, content);
    }
    case 'image': {
      const wrap = el('div', { padding: pad(p), textAlign: p.align, fontSize: '0' }, attr);
      if (p.href) {
        // The % width must live on the anchor, not the img: a percentage on a
        // child of a shrink-to-fit inline-block resolves against the image's
        // own intrinsic size (i.e. not at all), which rendered every linked
        // logo/icon at full intrinsic width no matter what `width` said.
        const a = el('a', { display: 'inline-block', width: p.width + '%' }, { href: p.href });
        a.appendChild(el('img', { width: '100%', borderRadius: p.radius + 'px', display: 'block', border: '0' }, { src: p.src, alt: p.alt }));
        wrap.appendChild(a);
      } else {
        wrap.appendChild(el('img', { width: p.width + '%', maxWidth: '100%', borderRadius: p.radius + 'px', display: 'inline-block', border: '0' }, { src: p.src, alt: p.alt }));
      }
      return wrap;
    }
    case 'button': {
      const wrap = el('div', { textAlign: p.align, padding: '4px 0' }, attr);
      const a = el('a', {
        display: p.full ? 'block' : 'inline-block', background: p.bg, color: p.color, textDecoration: 'none',
        padding: p.py + 'px ' + p.px + 'px', borderRadius: p.radius + 'px', fontFamily: p.fontFamily || t.font, fontSize: p.size + 'px',
        fontWeight: '600', letterSpacing: '0.02em', outline: 'none',
        // Outline-style buttons (transparent fill + border) are a standard
        // email pattern; the color falls back to the label color so a bare
        // "outline thickness" bump looks right without a second step.
        border: p.borderW ? p.borderW + 'px ' + (p.borderStyle || 'solid') + ' ' + (p.borderColor || p.color) : '0',
      }, { href: p.href, contenteditable: live ? 'true' : undefined, spellcheck: 'false', text: p.label });
      a.addEventListener('click', (e) => e.preventDefault());
      // Button editing is deliberately plain: no focus-tracked `editing` state, no
      // paste handling, no floating RTE toolbar -- only its label commits on blur.
      if (live) a.addEventListener('blur', (e) => { if (e.target.textContent !== p.label) ctx.onBlur(b, 'label', e.target.textContent); });
      wrap.appendChild(a);
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
        }, { href: it.href, title: it.label });
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
      const a = el('a', { display: 'block', position: 'relative' }, { href: p.href });
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
      const content = el('div', { padding: '6px 0', fontFamily: t.font, color: t.text, outline: 'none' }, { ...attr, contenteditable: edit ? 'true' : undefined, spellcheck: 'false', html: m(safe), 'data-focus-key': edit ? 'block:' + b.id : undefined });
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
      const row = el('div', { display: 'flex', justifyContent: 'center', gap: '10px' });
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
        const a = el('a', { color: p.color, fontSize: p.size + 'px', fontFamily: p.fontFamily || t.font, textDecoration: 'none', margin: '0 ' + p.gap / 2 + 'px', letterSpacing: '0.12em', textTransform: 'uppercase' }, { href: it.href, text: it.label });
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
        color: p.color || t.text, outline: 'none',
        // An explicit per-block font beats the Condensed/Body style toggle.
        fontFamily: p.fontFamily || (p.font === 'condensed' ? "'Arial Narrow', 'Helvetica Neue Condensed', Helvetica, Arial, sans-serif" : t.font),
      }, { ...attr, contenteditable: edit ? 'true' : undefined, spellcheck: 'false', text: m(p.text), 'data-focus-key': edit ? 'block:' + b.id : undefined });
      if (edit) wireEditable(head, b, 'text', ctx, true);
      if (!live) return head;
      return wrapWithRte(b, ctx, ctx.editingId === b.id, head);
    }
    case 'list': {
      const items = String(p.items || '').split('\n').filter((l) => l.trim());
      const list = el(p.ordered ? 'ol' : 'ul', { margin: '0', padding: (p.py || 0) + 'px 0 ' + (p.py || 0) + 'px 22px', fontFamily: p.fontFamily || t.font, fontSize: p.size + 'px', lineHeight: p.lh, color: p.color || t.text }, attr);
      items.forEach((it) => {
        const li = el('li', { marginBottom: p.gap + 'px' }, { html: m(it) });
        list.appendChild(li);
      });
      overrideRichFont(list, p.fontFamily);
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
          }, { contenteditable: edit ? 'true' : undefined, spellcheck: 'false', text: m(cell), 'data-focus-key': edit ? 'block:' + b.id + ':c' + ri + '-' + ci : undefined });
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
    case 'embed': {
      const wrap = el('div', { padding: p.py + 'px 0' }, attr);
      wrap.appendChild(el('iframe', { width: '100%', height: p.height + 'px', border: '1px solid rgba(29,31,32,0.14)', background: '#fff', display: 'block' }, { src: p.src, title: p.label }));
      return wrap;
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
        minHeight: p.minH ? p.minH + 'px' : 'auto', maxWidth: p.maxW + '%', margin: p.align === 'center' ? '0 auto' : '0',
        boxShadow: p.shadow ? '0 10px 30px rgba(29,31,32,0.12)' : 'none',
        fontFamily: t.font, color: t.text, fontSize: '15px', lineHeight: '1.6',
      }, { ...attr, contenteditable: edit ? 'true' : undefined, spellcheck: 'false', html: m(p.html), 'data-focus-key': edit ? 'block:' + b.id : undefined });
      if (edit) wireEditable(box, b, 'html', ctx, false);
      if (!live) return box;
      return wrapWithRte(b, ctx, ctx.editingId === b.id, box);
    }
    case 'svg':
      return el('div', { padding: p.py + 'px 0', textAlign: p.align }, { ...attr, html: '<span style="display:inline-block;width:' + p.width + '%">' + p.code + '</span>' });
    case 'codeblock':
      return el('pre', { margin: '0', padding: p.pad + 'px', background: p.bg, color: p.color, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: p.size + 'px', lineHeight: '1.6', overflowX: 'auto', whiteSpace: 'pre' }, { ...attr, text: m(p.code) });
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
