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

export function buildHtml(state, root, boxCss) {
  const d = state.doc; const t = d.theme;
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
    const colInner = (c) => c.blocks.map((b) => {
      if (b.type === 'css') return '<style>' + (b.props.code || '') + '</style>';
      if (b.type === 'html') return b.props.code || '';
      if (b.type === 'svg') return '<div style="text-align:' + b.props.align + ';padding:' + b.props.py + 'px 0">' + (b.props.code || '') + '</div>';
      return '<div style="' + boxCss(b.props) + '">' + grab(b.id) + '</div>';
    }).join('\n            ') || '&nbsp;';
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
      ? 'background-color:' + (rp.bg || t.contentBg) + ';background-image:' + (rp.overlay ? 'linear-gradient(rgba(20,22,24,' + (rp.overlay / 100) + '),rgba(20,22,24,' + (rp.overlay / 100) + ')),' : '') + 'url(&quot;' + cssUrl(rp.bgImage) + '&quot;);background-size:' + (rp.bgSize || 'cover') + ';background-position:' + (rp.bgPos || 'center') + ';background-repeat:' + (rp.bgRepeat || 'no-repeat') + ';'
      : 'background:' + (rp.bg || t.contentBg) + ';';
    const tdBorder = rowBorderCss(rp)
      + (rp.radius ? 'border-radius:' + rp.radius + 'px;' : '')
      + (rp.shadow ? 'box-shadow:' + rp.shadow + ';' : '')
      + ((rp.mt || rp.mr || rp.mb || rp.ml || rp.my) ? 'margin:' + rowMargin(rp) + ';' : '');
    return '      <tr>\n        <td style="padding:' + rowPad(rp) + ';' + tdBg + tdBorder + '">\n          ' + body + '\n        </td>\n      </tr>';
  }).join('\n');
  return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<meta name="color-scheme" content="light dark">\n<title>' + 'Email' + '</title>\n</head>\n<body style="margin:0;padding:0;background:' + t.bg + ';font-family:' + t.font.replace(/"/g, "'") + ';color:' + t.text + ';-webkit-font-smoothing:antialiased;">\n<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + t.bg + ';">\n  <tr><td align="center" style="padding:24px 12px;">\n    <table role="presentation" width="' + t.width + '" cellpadding="0" cellspacing="0" border="0" style="width:' + t.width + 'px;max-width:100%;background:' + t.contentBg + ';">\n' + rows + '\n    </table>\n  </td></tr>\n</table>\n</body>\n</html>';
}
