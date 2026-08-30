/**
 * Pure style-computation functions shared by the live renderer and the export
 * builder, ported verbatim. Objects use camelCase keys so they can be applied
 * directly via `Object.assign(el.style, obj)`.
 */

import { cssUrl } from './sanitize.js';
export function pad(p) {
  return (p.py || 0) + 'px ' + (p.px || 0) + 'px';
}

export function boxStyle(p) {
  const on = (key) => p[key] !== false;
  const side = (key) => (p.bBorder && on(key) ? p.bBorder + 'px ' + (p.bStyle || 'solid') + ' ' + (p.bLine || '#e2e2e5') : '0');
  return {
    background: p.bBg || 'transparent',
    borderTop: side('bTop'), borderRight: side('bRight'), borderBottom: side('bBottom'), borderLeft: side('bLeft'),
    borderRadius: (p.bRadius || 0) + 'px',
    padding: (p.bPad || 0) + 'px',
  };
}

export function boxCss(p) {
  const bits = [];
  if (p.bBg) bits.push('background:' + p.bBg);
  if (p.bBorder) {
    const value = p.bBorder + 'px ' + (p.bStyle || 'solid') + ' ' + (p.bLine || '#e2e2e5');
    const sides = { top: p.bTop !== false, right: p.bRight !== false, bottom: p.bBottom !== false, left: p.bLeft !== false };
    if (sides.top && sides.right && sides.bottom && sides.left) bits.push('border:' + value);
    else Object.keys(sides).filter((key) => sides[key]).forEach((key) => bits.push('border-' + key + ':' + value));
  }
  if (p.bRadius) bits.push('border-radius:' + p.bRadius + 'px');
  if (p.bPad) bits.push('padding:' + p.bPad + 'px');
  return bits.length ? bits.join(';') + ';' : 'margin:0';
}

/** A row's effective padding as a four-value CSS shorthand. `pt/pb/pl/pr` are optional per-side overrides (set by the inspector's "Per-side padding" split, or by the importer for asymmetric source padding); wherever a side is absent it follows the linked `py`/`px` pair, so documents that never split keep behaving exactly as before. */
export function rowPad(p) {
  const t = p.pt ?? p.py ?? 0;
  const b = p.pb ?? p.py ?? 0;
  const l = p.pl ?? p.px ?? 0;
  const r = p.pr ?? p.px ?? 0;
  return t + 'px ' + r + 'px ' + b + 'px ' + l + 'px';
}

/** A row's outside spacing in CSS clockwise order, with the old vertical `my` value as a saved-document fallback. Empty horizontal margins can remain `auto` in the live canvas so the advanced max-width control stays centered. */
export function rowMargin(p, centerEmpty) {
  const t = p.mt ?? p.my ?? 0;
  const r = p.mr ?? 0;
  const b = p.mb ?? p.my ?? 0;
  const l = p.ml ?? 0;
  const emptyHorizontal = centerEmpty && !r && !l;
  return t + 'px ' + (emptyHorizontal ? 'auto' : r + 'px') + ' ' + b + 'px ' + (emptyHorizontal ? 'auto' : l + 'px');
}

/** Which sides a row's border draws on. Sides default ON (`!== false`) so documents saved before per-side toggles existed keep their full border. */
export function rowBorderSides(p) {
  return { top: p.bTop !== false, right: p.bRight !== false, bottom: p.bBottom !== false, left: p.bLeft !== false };
}

/** The row border as an inline-CSS string (export path). Empty when the width is 0 or every side is toggled off. */
export function rowBorderCss(p) {
  if (!p.border) return '';
  const s = rowBorderSides(p);
  const value = p.border + 'px ' + (p.borderStyle || 'solid') + ' ' + (p.lineColor || '#e2e2e5');
  if (s.top && s.right && s.bottom && s.left) return 'border:' + value + ';';
  return ['top', 'right', 'bottom', 'left'].filter((k) => s[k]).map((k) => 'border-' + k + ':' + value + ';').join('');
}

export function rowBg(p) {
  const ov = (p.overlay || 0) / 100;
  const layers = [];
  if (p.bgImage && ov) layers.push('linear-gradient(rgba(20,22,24,' + ov + '),rgba(20,22,24,' + ov + '))');
  if (p.bgImage) layers.push('url("' + cssUrl(p.bgImage) + '")');
  const s = rowBorderSides(p);
  const side = (on) => (p.border && on ? p.border + 'px ' + (p.borderStyle || 'solid') + ' ' + (p.lineColor || '#e2e2e5') : '0');
  return {
    backgroundColor: p.bg || 'transparent',
    backgroundImage: layers.length ? layers.join(',') : 'none',
    backgroundSize: p.bgSize || 'cover',
    backgroundPosition: p.bgPos || 'center',
    backgroundRepeat: p.bgRepeat || 'no-repeat',
    borderTop: side(s.top),
    borderRight: side(s.right),
    borderBottom: side(s.bottom),
    borderLeft: side(s.left),
    borderRadius: (p.radius || 0) + 'px',
    // A raw CSS string, not a boolean: imports keep the source's exact
    // shadow; the inspector toggle writes/clears a standard one.
    boxShadow: p.shadow || 'none',
    maxWidth: (p.maxW || 100) + '%',
    margin: rowMargin(p, true),
  };
}

export function colsWrap(p) {
  const gap = p.gap || 0;
  if (p.layout === 'grid') return { display: 'grid', gridTemplateColumns: 'repeat(' + (p.gridCols || 2) + ', minmax(0, 1fr))', gap: gap + 'px' };
  if (p.layout === 'flex') {
    return {
      display: 'flex', flexDirection: p.flexDir || 'row', justifyContent: p.justify || 'flex-start',
      alignItems: p.alignItems || 'stretch', flexWrap: p.wrap ? 'wrap' : 'nowrap', gap: gap + 'px',
    };
  }
  return { display: 'flex', alignItems: 'stretch', margin: '0 ' + (-gap / 2) + 'px' };
}

export function colStyle(p, c) {
  if (p.layout === 'grid') return { minWidth: 0 };
  if (p.layout === 'flex') return { flex: (p.flexDir || 'row').indexOf('column') === 0 ? '0 0 auto' : c.span + ' 1 auto', minWidth: 0 };
  return {
    flex: c.span + ' 1 0%', minWidth: 0, padding: '0 ' + (p.gap || 0) / 2 + 'px',
    alignSelf: p.valign === 'middle' ? 'center' : (p.valign === 'bottom' ? 'flex-end' : 'flex-start'),
  };
}
