/**
 * Ported verbatim from the original `buildHtml()`, including its defining
 * trait: it does not re-template each block from `props` a second time, it
 * reads back the already-rendered live DOM node for each block (`grab`) and
 * strips editor-only attributes. The one adaptation: the original queried
 * plain `document` (the whole prototype ran outside any shadow tree); this
 * package renders inside a Shadow DOM, so `grab` is parameterized on the root
 * to search (the element's `shadowRoot`) instead of hardcoding `document`.
 */

import { cssUrl } from './sanitize.js';
import { rowBorderCss, rowMargin, rowPad } from './layout-style.js';

const LOGIC_OPEN = { condition: '{{#if ', loop: '{{#each ' };
const LOGIC_CLOSE = { condition: '{{/if}}', loop: '{{/each}}' };

/**
 * What each dynamic-content marker block actually emits, decided over the
 * whole document in reading order so the output template is always balanced
 * no matter how the markers were arranged or mangled: an end with no open of
 * its kind on top of the stack emits nothing, and opens still unclosed after
 * the last row are closed in `tail`, appended after the final row. Markers
 * emit literal template tags -- like merge tags, the editor never evaluates
 * them; the host's engine runs before any mail client parses the HTML, so raw
 * {{#each}} text in the markup is the standard pattern, not invalid HTML.
 * Angle brackets are stripped from expressions: no Handlebars-style
 * expression contains them, and it keeps a typed '<' from opening a tag in
 * the sent document.
 */
function logicPlan(doc) {
  const expr = (v) => String(v || '').replace(/[<>]/g, '').trim();
  const emit = new Map();
  const stack = [];
  doc.rows.forEach((r) => r.cols.forEach((c) => c.blocks.forEach((b) => {
    if (b.type !== 'condition' && b.type !== 'loop') return;
    if (!b.props.end) {
      const e = expr(b.props.expr);
      emit.set(b.id, e ? LOGIC_OPEN[b.type] + e + '}}' : '');
      if (e) stack.push(b.type);
    } else if (stack[stack.length - 1] === b.type) {
      stack.pop();
      emit.set(b.id, LOGIC_CLOSE[b.type]);
    } else {
      emit.set(b.id, '');
    }
  })));
  const tail = stack.reverse().map((k) => LOGIC_CLOSE[k]).join('\n      ');
  return { emit, tail };
}

/**
 * Display-only dressing for the Code modal's live-preview iframe: the
 * exported template carries literal {{#if}}/{{#each}} tags, which an iframe
 * renders as bare text at odd positions (a browser even foster-parents the
 * between-row ones out of the table entirely). For *viewing*, each tag
 * becomes the same dashed band the canvas draws -- tags between <tr>s become
 * a slim full-width row so they hold their place in the table, tags inside a
 * cell become an inline chip. Never applied to the HTML the host receives:
 * exportHtml/copy/download all carry the real tags.
 */
export function decorateLogicTags(html) {
  const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const chip = (kind, expr, end) => {
    const color = kind === 'each' ? '#7c3aed' : '#0e7490';
    const word = end ? (kind === 'each' ? 'END LOOP' : 'END IF') : (kind === 'each' ? 'REPEAT EACH' : 'SHOW IF');
    return '<span style="display:inline-flex;align-items:center;gap:7px;box-sizing:border-box;border:1.5px dashed ' + color + ';border-radius:7px;background:' + color + '14;padding:4px 10px;margin:2px 0;color:' + color + ';font-family:ui-monospace,monospace;font-size:9.5px;font-weight:700;letter-spacing:0.12em;">'
      + (end ? '⏶ ' : '⏷ ') + word
      + (expr ? ' <span style="font-weight:400;font-size:11px;letter-spacing:0;">{{ ' + esc(expr) + ' }}</span>' : '')
      + '</span>';
  };
  const bandRow = (kind, expr, end) => '<tr><td colspan="99" style="padding:2px 8px;">' + chip(kind, expr, end) + '</td></tr>';
  let s = String(html || '');
  // Between-row tags first (adjacent to a <tr> or after a </tr>), looped for
  // the same adjacency reason as import-html's foldLogicWrappers.
  const parse = (tag) => { const m = tag.match(/^#(if|each)\s+(.+)$/); return m ? [m[1], m[2].trim(), false] : [tag.slice(1), '', true]; };
  for (let i = 0; i < 6; i++) {
    const before = s;
    s = s.replace(/\{\{(#(?:if|each)\s+[^{}]+?|\/(?:if|each))\s*\}\}(?=\s*(?:<tr[\s>]|<\/table))/gi, (m, tag) => bandRow(...parse(tag)));
    s = s.replace(/(<\/tr>\s*)\{\{(#(?:if|each)\s+[^{}]+?|\/(?:if|each))\s*\}\}/gi, (m, pre, tag) => pre + bandRow(...parse(tag)));
    if (s === before) break;
  }
  // Whatever remains sits inside a cell (or prose): inline chips in place.
  s = s.replace(/\{\{#(if|each)\s+([^{}]+?)\s*\}\}/gi, (m, kind, expr) => chip(kind.toLowerCase(), expr, false));
  s = s.replace(/\{\{\/(if|each)\s*\}\}/gi, (m, kind) => chip(kind.toLowerCase(), '', true));
  return s;
}

export function buildHtml(state, root, boxCss) {
  const d = state.doc; const t = d.theme;
  const logic = logicPlan(d);
  const grab = (id) => {
    const el = root.querySelector('[data-mc-content="' + id + '"]');
    if (!el) return '';
    return el.outerHTML
      .replace(/\scontenteditable="[^"]*"/g, '')
      .replace(/\sdata-mc-[a-z-]+="[^"]*"/g, '')
      .replace(/\sspellcheck="[^"]*"/g, '')
      .replace(/\sdata-(?:gramm|gramm_editor|enable-grammarly|lt-active)="[^"]*"/g, '')
      .replace(/\sdraggable="[^"]*"/g, '');
  };
  const rows = d.rows.map((r) => {
    const rp = r.props;
    // A row holding nothing but logic markers exists to wrap the *sections*
    // around it (drop a Condition onto the canvas above and below a group of
    // rows). Emitting its <tr> scaffolding would leave an empty padded band
    // in the sent email, so only the tags themselves are emitted -- they sit
    // between <tr>s as plain text, which the host's engine consumes before
    // any mail client parses the markup.
    const blocksOf = r.cols.reduce((a, c) => a.concat(c.blocks), []);
    if (blocksOf.length && blocksOf.every((b) => b.type === 'condition' || b.type === 'loop')) {
      return blocksOf.map((b) => logic.emit.get(b.id) || '').filter(Boolean).map((s) => '      ' + s).join('\n');
    }
    const colInner = (c) => c.blocks.map((b) => {
      if (b.type === 'css') return '<style>' + (b.props.code || '') + '</style>';
      if (b.type === 'html') return b.props.code || '';
      if (b.type === 'svg') return '<div style="text-align:' + b.props.align + ';padding:' + b.props.py + 'px 0">' + (b.props.code || '') + '</div>';
      if (b.type === 'condition' || b.type === 'loop') return logic.emit.get(b.id) || '';
      return '<div style="' + boxCss(b.props) + '">' + grab(b.id) + '</div>';
    }).filter(Boolean).join('\n            ') || '&nbsp;';
    const cells = r.cols.map((c) => {
      // Column-level styling (bg/radius/inner padding) renders as a wrapper
      // <div> inside the cell so the gutter padding stays unpainted --
      // mirrors render/canvas.js's `host` wrapper.
      const inner = (c.bg || c.border || c.radius || c.padY || c.padX)
        ? '<div style="background:' + (c.bg || 'transparent') + ';' + (c.border ? 'border:' + c.border + 'px ' + (c.borderStyle || 'solid') + ' ' + (c.lineColor || '#e2e2e5') + ';' : '') + 'border-radius:' + (c.radius || 0) + 'px;padding:' + (c.padY || 0) + 'px ' + (c.padX || 0) + 'px">\n            ' + colInner(c) + '\n            </div>'
        : colInner(c);
      return '<td width="' + c.span + '%" valign="' + rp.valign + '" style="padding:0 ' + Math.round(rp.gap / 2) + 'px;">\n            ' + inner + '\n          </td>';
    }).join('\n          ');
    const cssBody = rp.layout === 'grid'
      ? '<div style="display:grid;grid-template-columns:repeat(' + (rp.gridCols || 2) + ',minmax(0,1fr));gap:' + rp.gap + 'px">\n            ' + r.cols.map((c) => '<div>' + colInner(c) + '</div>').join('\n            ') + '\n          </div>'
      : '<div style="display:flex;flex-direction:' + (rp.flexDir || 'row') + ';justify-content:' + (rp.justify || 'flex-start') + ';align-items:' + (rp.alignItems || 'stretch') + ';flex-wrap:' + (rp.wrap ? 'wrap' : 'nowrap') + ';gap:' + rp.gap + 'px">\n            ' + r.cols.map((c) => '<div style="flex:' + c.span + ' 1 auto;min-width:0">' + colInner(c) + '</div>').join('\n            ') + '\n          </div>';
    const body = rp.layout && rp.layout !== 'columns'
      ? cssBody
      : '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>\n          ' + cells + '\n          </tr></table>';
    const tdBg = rp.bgImage
      ? 'background-color:' + (rp.bg || t.contentBg || 'transparent') + ';background-image:' + (rp.overlay ? 'linear-gradient(rgba(20,22,24,' + (rp.overlay / 100) + '),rgba(20,22,24,' + (rp.overlay / 100) + ')),' : '') + 'url(&quot;' + cssUrl(rp.bgImage) + '&quot;);background-size:' + (rp.bgSize || 'cover') + ';background-position:' + (rp.bgPos || 'center') + ';background-repeat:' + (rp.bgRepeat || 'no-repeat') + ';'
      // Falls all the way through to `transparent`: a row inherits the
      // content column's background, and that column may itself be unpainted
      // now that it can be -- 'background:;' is not a declaration.
      : 'background:' + (rp.bg || t.contentBg || 'transparent') + ';';
    const tdBorder = rowBorderCss(rp)
      + (rp.radius ? 'border-radius:' + rp.radius + 'px;' : '')
      + (rp.shadow ? 'box-shadow:' + rp.shadow + ';' : '')
      + ((rp.mt || rp.mr || rp.mb || rp.ml || rp.my) ? 'margin:' + rowMargin(rp) + ';' : '');
    return '      <tr>\n        <td style="padding:' + rowPad(rp) + ';' + tdBg + tdBorder + '">\n          ' + body + '\n        </td>\n      </tr>';
  }).join('\n') + (logic.tail ? '\n      ' + logic.tail : '');
  // The page section -- the full-width area the content column sits on. Its
  // padding is the band a mail client shows around the template, and `radius`
  // is the content column's own shape. The padding used to be a hard-coded
  // `24px 12px` here -- an unreachable strip around every sent template -- so
  // it now comes from the document and starts at 0. A background of
  // `transparent` (or any rgba value) is passed through untouched: clients
  // that honour it let their own surface show through, the rest fall back to
  // their default page colour.
  const pageBg = t.bg || 'transparent';
  const pagePad = (t.padY || t.padX) ? (t.padY || 0) + 'px ' + (t.padX || 0) + 'px' : '0';
  // `overflow:hidden` is what actually clips a row's own background to the
  // rounded corner; without it the first and last rows paint square over it.
  const contentShape = t.radius ? 'border-radius:' + t.radius + 'px;overflow:hidden;' : '';
  return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<meta name="color-scheme" content="light dark">\n<title>' + 'Email' + '</title>\n</head>\n<body style="margin:0;padding:0;background:' + pageBg + ';font-family:' + t.font.replace(/"/g, "'") + ';color:' + t.text + ';-webkit-font-smoothing:antialiased;">\n<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + pageBg + ';">\n  <tr><td align="center" style="padding:' + pagePad + ';">\n    <table role="presentation" width="' + t.width + '" cellpadding="0" cellspacing="0" border="0" style="width:' + t.width + 'px;max-width:100%;background:' + (t.contentBg || 'transparent') + ';' + contentShape + '">\n' + rows + '\n    </table>\n  </td></tr>\n</table>\n</body>\n</html>';
}
