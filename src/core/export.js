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
 * The two Word-engine declarations that have to be applied to the finished
 * markup rather than to the DOM the renderer builds.
 *
 * `mso-*` are not real CSS properties, and CSSOM silently drops anything it
 * does not recognise -- `style.msoLineHeightRule = 'exactly'` and
 * `setProperty('mso-line-height-rule', ...)` both no-op, and the canvas is
 * built through `Object.assign(node.style, ...)`. Since the exporter reads
 * that DOM back as `outerHTML`, a string pass over the result is the only
 * place these can be added. They are also meaningless anywhere but Outlook,
 * so the canvas is better off without them.
 *
 * - `mso-line-height-rule:exactly` -- Classic Outlook otherwise ignores
 *   `line-height` outright and sets text solid. Added only where a real
 *   line-height is already declared, so it never invents spacing of its own.
 * - `mso-table-lspace/rspace:0pt` -- Word adds its own horizontal space
 *   around a table, which shows up as phantom gaps between columns.
 *
 * Both are idempotent: a second pass finds its own marker and skips.
 */
export function msoHarden(html) {
  return html
    .replace(/style="([^"]*line-height:[^"]*)"/g, (m0, css) => {
      if (/mso-line-height-rule/.test(css)) return m0;
      // A ratio resolved against the font size in the same declaration.
      // `exactly` tells Word to use the line-height verbatim, and a unitless
      // 1.65 is not a length -- the pair is ambiguous at best and collapses
      // the leading at worst. Every block that sets a line-height sets its
      // font-size beside it, so the multiplication is exact rather than a
      // guess; anything the renderer did not author (imported markup with a
      // bare ratio, or a keyword like `normal`) is left exactly as it is and
      // gets no `exactly` either, since there would be no length to honour.
      const fs = css.match(/font-size:\s*([\d.]+)px/);
      const out = fs
        ? css.replace(/line-height:\s*([\d.]+)\s*(;|$)/g, (s0, ratio, end) => 'line-height:' + Math.round(parseFloat(fs[1]) * parseFloat(ratio)) + 'px' + end)
        : css;
      if (!/line-height:\s*[\d.]+px/.test(out)) return 'style="' + out + '"';
      return 'style="' + out + (out.trim().endsWith(';') ? '' : ';') + 'mso-line-height-rule:exactly;"';
    })
    .replace(/<table\b([^>]*)>/g, (m0, attrs) => {
      if (/mso-table-lspace/.test(attrs)) return m0;
      const spacing = 'mso-table-lspace:0pt;mso-table-rspace:0pt;';
      // Appended, never prepended: the declarations the template actually
      // authored stay at the front of the attribute, where both the importer
      // and a human reading the source expect to find them.
      return /style="/.test(attrs)
        ? '<table' + attrs.replace(/style="([^"]*)"/, (s0, css) => 'style="' + css + (!css.trim() || css.trim().endsWith(';') ? '' : ';') + spacing + '"') + '>'
        : '<table' + attrs + ' style="' + spacing + '">';
    });
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
      // Editor bookkeeping (caret restoration): a fresh random id every
      // import, so leaving it in shipped mail also made export -> import ->
      // export never converge byte-for-byte.
      .replace(/\sdata-focus-key="[^"]*"/g, '')
      .replace(/\sdata-mc-[a-z-]+="[^"]*"/g, '')
      .replace(/\sspellcheck="[^"]*"/g, '')
      .replace(/\sdata-(?:gramm|gramm_editor|enable-grammarly|lt-active)="[^"]*"/g, '')
      .replace(/\sdraggable="[^"]*"/g, '');
  };
  /*
   * Which mobile rules this document actually needs. Only the ones a row (or
   * a block) asks for are emitted, and rows that ask for the same thing share
   * one class -- so a template that never leaves the defaults ships exactly
   * the stylesheet it shipped before this feature existed, and one that uses
   * every mode still ships a handful of rules rather than BEE's one selector
   * per block with no deduplication.
   */
  const need = { stack: false, twoUp: false, reverse: false, hideM: false, hideD: false };
  /**
   * One decision per row, made once: what goes on the row box (`<tr>`, or the
   * flex/grid wrapper) and what goes on each cell.
   *
   * The plain one-up stack keeps the exact markup and rule it had before this
   * feature -- `mc-col` on the cells, no flex anywhere -- so the overwhelmingly
   * common case cannot regress, and if a sanitiser ever strips `display:flex`
   * the fancy modes degrade to the desktop layout rather than taking ordinary
   * stacking down with them.
   */
  const mobilePlan = (rp, cols) => {
    const mode = rp.mobileCols === undefined ? 1 : rp.mobileCols;
    if (cols < 2 || mode === 'keep') return { row: '', cell: '' };
    const rowCls = [];
    // Two-up and reverse both need the row to become a flex container, which
    // is safe precisely because it only ever runs inside the media query: a
    // client that cannot do flex is a client that ignored the query and is
    // still being shown the desktop table.
    if (String(mode) === '2') { rowCls.push('mc-2up'); need.twoUp = true; }
    if (rp.mobileOrder === 'reverse') { rowCls.push('mc-rev'); need.reverse = true; }
    // Cells only carry `mc-col` in one-up; in two-up the row's own rule sizes
    // them, so the two never fight over width.
    const cell = String(mode) === '2' ? '' : 'mc-col';
    if (cell) need.stack = true;
    return { row: rowCls.join(' '), cell };
  };
  /** Per-block device visibility. Absent means "all devices", so nothing is emitted. */
  const visClass = (bp) => {
    if (bp.vis === 'desktop') { need.hideM = true; return ' class="mc-only-d"'; }
    if (bp.vis === 'mobile') { need.hideD = true; return ' class="mc-only-m"'; }
    return '';
  };
  const rows = d.rows.map((r) => {
    const rp = r.props;
    const plan = mobilePlan(rp, r.cols.length);
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
      return '<div' + visClass(b.props) + ' style="' + boxCss(b.props) + '">' + grab(b.id) + '</div>';
    }).filter(Boolean).join('\n            ') || '&nbsp;';
    const cells = r.cols.map((c) => {
      // Column-level styling (bg/radius/inner padding) renders as a wrapper
      // <div> inside the cell so the gutter padding stays unpainted --
      // mirrors render/canvas.js's `host` wrapper.
      const inner = (c.bg || c.border || c.radius || c.padY || c.padX)
        ? '<div style="background:' + (c.bg || 'transparent') + ';' + (c.border ? 'border:' + c.border + 'px ' + (c.borderStyle || 'solid') + ' ' + (c.lineColor || '#e2e2e5') + ';' : '') + 'border-radius:' + (c.radius || 0) + 'px;padding:' + (c.padY || 0) + 'px ' + (c.padX || 0) + 'px">\n            ' + colInner(c) + '\n            </div>'
        : colInner(c);
      return '<td' + (plan.cell ? ' class="' + plan.cell + '"' : '') + ' width="' + c.span + '%" valign="' + rp.valign + '" style="padding:0 ' + Math.round(rp.gap / 2) + 'px;">\n            ' + inner + '\n          </td>';
    }).join('\n          ');
    // The CSS-layout rows reach the same behaviour through their wrapper: one
    // class on the flex/grid container, so the markup stays exactly as it was
    // for every wide client.
    const wrapCls = [plan.cell ? 'mc-stack' : '', plan.row].filter(Boolean).join(' ');
    const stackWrap = wrapCls ? ' class="' + wrapCls + '"' : '';
    const cssBody = rp.layout === 'grid'
      ? '<div' + stackWrap + ' style="display:grid;grid-template-columns:repeat(' + (rp.gridCols || 2) + ',minmax(0,1fr));gap:' + rp.gap + 'px">\n            ' + r.cols.map((c) => '<div>' + colInner(c) + '</div>').join('\n            ') + '\n          </div>'
      : '<div' + stackWrap + ' style="display:flex;flex-direction:' + (rp.flexDir || 'row') + ';justify-content:' + (rp.justify || 'flex-start') + ';align-items:' + (rp.alignItems || 'stretch') + ';flex-wrap:' + (rp.wrap ? 'wrap' : 'nowrap') + ';gap:' + rp.gap + 'px">\n            ' + r.cols.map((c) => '<div style="flex:' + c.span + ' 1 auto;min-width:0">' + colInner(c) + '</div>').join('\n            ') + '\n          </div>';
    const body = rp.layout && rp.layout !== 'columns'
      ? cssBody
      // The `<tr>` is what becomes the flex container for two-up and reverse;
      // in the default one-up stack it carries no class at all, exactly as before.
      : '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr' + (plan.row ? ' class="' + plan.row + '"' : '') + '>\n          ' + cells + '\n          </tr></table>';
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
  const contentShape = (t.radius ? 'border-radius:' + t.radius + 'px;overflow:hidden;' : '')
    + (t.borderW ? 'border:' + t.borderW + 'px ' + (t.borderStyle || 'solid') + ' ' + (t.borderColor || '#e2e2e5') + ';' : '')
    // Patchy in mail clients (Outlook drops it), but honest: what the user
    // styled ships, and capable clients render it.
    + (t.shadow ? 'box-shadow:' + t.shadow + ';' : '');
  /*
   * The content column is `width:100%` capped by `max-width`, never a fixed
   * `width:<n>px`.
   *
   * The fixed width was what made the sent email unresponsive, and not only
   * for itself: a px width becomes the table's min-content contribution, so
   * it propagated outward and pinned the full-width wrapper open too. A plain
   * text-only template measured 620px of horizontal scroll on a 390px phone,
   * and `max-width:100%` -- already sitting right there -- never got the
   * chance to engage, because 100% of a container the table had itself forced
   * to 620px is 620px. Swapping the two makes the cap the real constraint:
   * measured 500px (fits) on the phone, unchanged 620px on the desktop.
   *
   * The `<!--[if mso]>` pair is the price of that. Word-based Outlook honours
   * neither `max-width` nor the media query below, so on its own it would now
   * render the column edge to edge across the whole window; the ghost table
   * is a fixed-width cage only Outlook sees, which holds the old geometry for
   * exactly the client that cannot do better. Every other client skips the
   * conditional comment entirely and gets the fluid table.
   */
  const ghostOpen = '<!--[if mso]><table role="presentation" width="' + t.width + '" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->';
  const ghostClose = '<!--[if mso]></td></tr></table><![endif]-->';
  const shell = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:' + t.width + 'px;background:' + (t.contentBg || 'transparent') + ';' + contentShape + '">\n' + rows + '\n    </table>';
  /*
   * The one embedded stylesheet in the document, and the only place the
   * exporter is not inline-styled -- a media query cannot be expressed
   * inline, and every rule here is a narrow-screen override of an inline
   * style, hence `!important` throughout.
   *
   * `mc-col` / `mc-stack` are what finally make "Stack columns on mobile" do
   * something: the toggle has shipped in the row inspector since columns
   * existed, but nothing read the prop -- no media query was emitted and the
   * canvas ignored it -- so a 4-column row stayed 4 columns of 60px on a
   * phone. The image rule is the other half of being responsive: a fixed-width
   * image from an import would otherwise hold a stacked column open.
   */
  const stackCss = '\n<style>\n'
    + '/* Apple Mail and iOS auto-detect dates, addresses and phone numbers and\n'
    + '   repaint them as blue underlined links. This hands them back to the\n'
    + '   surrounding text; links the template actually declares are untouched,\n'
    + '   because they carry their own inline colour. */\n'
    + 'a[x-apple-data-detectors] { color:inherit !important; text-decoration:none !important; }\n'
    /*
     * No `p { line-height: inherit }` here, though it is standard in
     * hand-written email and BEE emits it. This document is also an *input*:
     * core/css-cascade.js folds every non-`@media` rule into inline styles on
     * import, so that one rule came back stamped on every paragraph and an
     * export -> import -> export cycle stopped converging. The pixel
     * line-heights it would have protected are already inline on the block
     * that owns them, which is the stronger guarantee anyway.
     */
    // A mobile-only block has to be hidden here, outside the query, because
    // Classic Outlook never reads the query -- `display:none` alone would
    // leave it visible in exactly the client that cannot be told otherwise.
    // `mso-hide` is the half Word understands; the rest is for everyone else.
    + (need.hideD ? '.mc-only-m, .mc-only-m table { mso-hide:all; display:none; max-height:0; overflow:hidden; }\n' : '')
    + '@media only screen and (max-width:' + t.width + 'px) {\n'
    + (need.stack ? '  .mc-col { display:block !important; width:100% !important; padding-left:0 !important; padding-right:0 !important; }\n'
      + '  .mc-stack { display:block !important; }\n'
      + '  .mc-stack > div { width:100% !important; }\n' : '')
    // Two-up: the row becomes a flex container and each cell takes half.
    // `box-sizing` is load-bearing -- with the default content box, a cell's
    // own padding pushes 50% over the line and every cell wraps to its own row.
    + (need.twoUp ? '  .mc-2up { display:flex !important; flex-wrap:wrap !important; }\n'
      + '  .mc-2up > td, .mc-2up > div { box-sizing:border-box !important; flex:0 0 50% !important; max-width:50% !important; }\n' : '')
    // Reverse: `column-reverse` flips a stack of any depth, where the usual
    // `table-header-group` trick has only two usable slots and so cannot
    // reverse a three- or four-column row at all. Two-up reverses along both
    // axes so the last cell ends up first.
    + (need.reverse ? '  .mc-rev { display:flex !important; flex-wrap:wrap !important; flex-direction:column-reverse !important; }\n'
      + '  .mc-2up.mc-rev { flex-direction:row-reverse !important; flex-wrap:wrap-reverse !important; }\n' : '')
    + (need.hideM ? '  .mc-only-d, .mc-only-d table { display:none !important; max-height:0 !important; overflow:hidden !important; }\n' : '')
    + (need.hideD ? '  .mc-only-m, .mc-only-m table { display:block !important; max-height:none !important; overflow:visible !important; }\n' : '')
    + '  img { max-width:100% !important; height:auto !important; }\n'
    + '}\n</style>';
  /*
   * `xmlns:o` earns its place; `xmlns:v` does not. The Office namespace is
   * what makes `<o:OfficeDocumentSettings>` parse, and `PixelsPerInch` 96 is
   * a live bug fix rather than a legacy one: on a high-DPI Windows display
   * Outlook renders at 120dpi and scales the whole template about 25% larger
   * than authored. VML's namespace is deliberately absent -- nothing here
   * emits VML, and declaring a namespace for markup that never appears is
   * noise in every other client.
   */
  const msoHead = '\n<!--[if mso]>\n<xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>\n<![endif]-->';
  // `text-size-adjust` at 100%, never `none`: both stop a mobile client
  // inflating the type, but `none` also blocks legitimate scaling and leaves
  // text unreadably small on some Android clients.
  const bodyStyle = 'margin:0;padding:0;background:' + pageBg + ';font-family:' + t.font.replace(/"/g, "'") + ';color:' + t.text + ';-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;text-size-adjust:100%;';
  return msoHarden('<!doctype html>\n<html lang="en" xmlns:o="urn:schemas-microsoft-com:office:office">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<meta name="color-scheme" content="light">\n<meta name="supported-color-schemes" content="light">\n<title>' + 'Email' + '</title>' + msoHead + stackCss + '\n</head>\n<body style="' + bodyStyle + '">\n<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + pageBg + ';">\n  <tr><td align="center" style="padding:' + pagePad + ';">\n    ' + ghostOpen + '\n    ' + shell + '\n    ' + ghostClose + '\n  </td></tr>\n</table>\n</body>\n</html>');
}
