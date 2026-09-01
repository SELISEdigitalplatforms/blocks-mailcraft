import { mkRow, blk } from './blocks.js';
import { cleanImportHtml } from './sanitize.js';
import { inlineStylesheets } from './css-cascade.js';

/**
 * HTML -> doc importer. Mirrors the canonical shapes `render/block-body.js`
 * renders (a table-based layout, one wrapping `<div>` per non-typographic
 * block) so that MailCraft's own exported HTML round-trips back into the
 * same block types it started as, while arbitrary/foreign email HTML
 * degrades gracefully: anything recognizable becomes a native block,
 * everything else becomes plain `text` (inline content) or a raw `html`
 * block (structural content) rather than being dropped.
 */

function PX(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/** Font size only when absolute (px/pt/bare number). With the CSS cascade folding stylesheet rules inline, relative sizes reach the classifiers -- the classic `sub,sup{font-size:75%}` must not read as 75 pixels. */
function fontPx(v) {
  const s = String(v || '').trim();
  if (!s || s.endsWith('%') || s.endsWith('em')) return 0;
  if (s.endsWith('pt')) return Math.round(PX(s) * 4 / 3);
  return PX(s);
}

function onlyChild(el, tag) {
  return el.children.length === 1 && el.firstElementChild.tagName === tag ? el.firstElementChild : null;
}

/** Font stacks for equality only: CSSOM and the exporter disagree on quoting (`"DM Sans"` vs `'DM Sans'`), spacing and case, so families are compared with quotes stripped, whitespace collapsed and case folded. Never used as a value -- the original string is what gets stored. */
function fontKey(v) {
  return String(v || '').replace(/["']/g, '').replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Whether `el` (its own style, or any styled descendant) declares a font family different from `family`. The guard that keeps a block-level font read from flattening a mixed-typography run: once a block owns a font, the renderer's overrideRichFont strips every descendant's family, so a run whose pieces genuinely differ must stay font-less at block level and keep its inline declarations instead. */
function mixedFamily(el, family) {
  const key = fontKey(family);
  const off = (v) => { const k = fontKey(v); return !!k && k !== key; };
  if (el.style && off(el.style.fontFamily)) return true;
  return !!el.querySelectorAll && Array.from(el.querySelectorAll('[style*="font-family"]')).some((d) => d.style && off(d.style.fontFamily));
}

/** The heading block's Condensed style ships as this exact stack (render/block-body.js); read back, it becomes the `font: 'condensed'` toggle again rather than an opaque per-block family. */
const CONDENSED_KEY = fontKey("'Arial Narrow', 'Helvetica Neue Condensed', Helvetica, Arial, sans-serif");

function textAlignOf(el) {
  let n = el;
  while (n && n.nodeType === 1) {
    // `align` on a TABLE floats the table itself (the classic
    // `align="center"` content wrapper) and says nothing about text
    // alignment inside it -- honoring it centered every left-aligned
    // paragraph in a centered-layout email.
    const a = (n.style && n.style.textAlign) || (n.tagName === 'TABLE' ? '' : n.getAttribute('align'));
    if (a) return a;
    n = n.parentElement;
  }
  return 'left';
}

/** First value of a style property found walking from `el` up through its ancestors -- table emails set typography on the `<td>` and let cells inherit, so a block's base style usually lives above the content itself. */
function inheritedStyle(el, prop) {
  let n = el;
  while (n && n.nodeType === 1) {
    const v = n.style && n.style[prop];
    if (v) return v;
    n = n.parentElement;
  }
  return '';
}

/** Innermost fixed-pixel width among the element's table/td ancestors -- the closest thing source HTML offers to "how wide is this column", for converting a px-sized image into MailCraft's %-of-column width. A percent-width `<td>` on the way up (a 50% column between the image and the 680px content table) scales the eventual pixel answer, so an icon in a half-width column resolves against ~340px, not 680. A percent width on a `<table>` (the ubiquitous width="100%" block wrapper) says nothing and is skipped. */
function ancestorPxWidth(el) {
  let n = el.parentElement;
  let factor = 1;
  while (n) {
    if (n.tagName === 'TABLE' || n.tagName === 'TD') {
      const w = n.getAttribute('width') || (n.style && n.style.width) || '';
      if (w && String(w).endsWith('%')) {
        const pct = PX(w);
        if (n.tagName === 'TD' && pct > 0 && pct < 100) factor *= pct / 100;
      } else if (w) {
        const px = PX(w);
        if (px >= 100) return Math.round(px * factor);
      }
    }
    n = n.parentElement;
  }
  return 0;
}

/** Legacy `cellpadding` on a block-wrapper table -- the padding source when the inner td carries no style padding at all. */
function cellPadOf(tb) {
  const cp = tb && tb.getAttribute ? PX(tb.getAttribute('cellpadding')) : 0;
  return cp ? { t: cp, b: cp, l: cp, r: cp, py: cp, px: cp } : null;
}

/**
 * Content invisible in a desktop mail render must not import as text:
 * `display:none` (hidden preheaders, hamburger machinery, mobile-only
 * mirrors), `visibility:hidden`, `opacity:0`, and the other preheader idiom
 * -- collapsed to nothing via `max-height:0` with `overflow:hidden` or a
 * zero font. A zero font-size ALONE is not hidden: emails set it on
 * whitespace-collapsing wrappers around buttons and menus.
 */
/**
 * A device-visibility wrapper, as a `vis` value -- or '' for ordinary content.
 *
 * Both this exporter's `mc-only-d`/`mc-only-m` and the `desktop_hide`/
 * `mobile_hide` convention every other builder uses (BEE, Stripo, Mailchimp)
 * are recognised, so a foreign template's device variants import as an
 * editable property instead of being silently thrown away.
 *
 * This has to be consulted *before* `isHidden`, and that is the whole point:
 * a mobile-only block is deliberately `display:none` in the base stylesheet
 * so Classic Outlook -- which never reads a media query -- does not show it.
 * The importer folds those base rules inline (core/css-cascade.js drops the
 * `@media` block that would have un-hidden it), so without this the block
 * looked exactly like a hidden preheader and was dropped on re-import,
 * losing content the user had authored.
 */
function visibilityOf(el) {
  const cls = (el && el.getAttribute && el.getAttribute('class')) || '';
  if (!cls) return '';
  if (/\b(?:mc-only-m|mobile_hide|mobile-hide)\b/.test(cls)) return 'mobile';
  if (/\b(?:mc-only-d|desktop_hide|desktop-hide)\b/.test(cls)) return 'desktop';
  return '';
}

function isHidden(el) {
  // Hidden *on this device* is not hidden: see visibilityOf.
  if (visibilityOf(el)) return false;
  const st = el.style;
  if (!st) return false;
  if (st.display === 'none' || st.visibility === 'hidden') return true;
  if (st.opacity === '0') return true;
  const collapsed = st.maxHeight === '0' || st.maxHeight === '0px';
  const invisible = st.overflow === 'hidden' || st.fontSize === '0' || st.fontSize === '0px';
  return collapsed && invisible;
}

/** The url() of a background image declared on the element (style shorthand or longhand, or the legacy `background` attribute). A gradient-only background yields nothing. */
function bgImageOf(el) {
  if (!el) return '';
  const st = el.style;
  if (st) {
    const m = ((st.backgroundImage || '') + ' ' + (st.background || '')).match(/url\(["']?([^"')]+)["']?\)/);
    if (m) return m[1];
  }
  return (el.getAttribute && el.getAttribute('background')) || '';
}

/** The exporter's own overlay idiom, read back: a section image ships as `linear-gradient(rgba(20,22,24,a),rgba(20,22,24,a)),url(...)` (core/export.js), and the alpha is the row's `overlay` percentage. Only that exact neutral-dark signature is folded back -- a foreign gradient says nothing about MailCraft's tint and stays out of the model, exactly as before. Without this the tint silently vanished on every save/reload while the photo survived. */
function overlayOf(el) {
  const st = el.style;
  if (!st) return 0;
  const m = ((st.backgroundImage || '') + ' ' + (st.background || '')).match(/linear-gradient\(rgba\(20,\s*22,\s*24,\s*(0?\.\d+|1|0)\s*\)/);
  return m ? Math.round(parseFloat(m[1]) * 100) : 0;
}

/** Carries a wrapper's background image (hero photo sections) onto the rows it produced, mirroring applyBg -- fit/position/repeat come along when declared. */
function applyBgImage(rows, el) {
  const url = bgImageOf(el);
  if (!url) return rows;
  const st = el.style || {};
  const ov = overlayOf(el);
  rows.forEach((r) => {
    if (r.props.bgImage) return;
    r.props.bgImage = url;
    if (ov) r.props.overlay = ov;
    if (st.backgroundSize) r.props.bgSize = st.backgroundSize;
    if (st.backgroundPosition) r.props.bgPos = st.backgroundPosition;
    if (st.backgroundRepeat) r.props.bgRepeat = st.backgroundRepeat;
  });
  return rows;
}

/**
 * A wrapper that paints one background image is one visual band: builders
 * (Beefree, Stripo) write a hero section as `table.row[background-image]`
 * holding a single-column stack of per-block tables, and letting the generic
 * walk turn each block into its own row stamped the image onto every one --
 * so the export re-drew the hero's top slice once per block instead of one
 * image flowing behind the section. Folds those rows back into a single row,
 * moving each row's padding onto its blocks (same convention as the
 * block-table unwrap in `blocksFromNodes`). Deliberately conservative: only
 * single-column rows with no styling of their own (a differing background,
 * frame or image on a row is a real band boundary) are merged, so everything
 * that isn't the hero shape walks exactly as before.
 */
function mergeBandRows(rows, el) {
  if (rows.length < 2 || !bgImageOf(el)) return rows;
  const bg0 = rows[0].props.bg || '';
  const plain = rows.every((r) => r.cols.length === 1
    && !r.props.bgImage && !r.props.border && !r.props.radius && !r.props.shadow
    && (r.props.bg || '') === bg0);
  if (!plain) return rows;
  const merged = mkRow([100]);
  merged.props.py = 0; merged.props.px = 0; merged.props.gap = 0;
  if (bg0) merged.props.bg = bg0;
  merged.cols[0].blocks = rows.reduce((acc, r) => {
    const padded = r.props.py || r.props.px || r.props.pt !== undefined;
    r.cols[0].blocks.forEach((b) => {
      if (padded && b.type !== 'button' && 'py' in b.props) {
        b.props.py = r.props.py;
        if ('px' in b.props) b.props.px = r.props.px;
      }
      acc.push(b);
    });
    return acc;
  }, []);
  return merged.cols[0].blocks.length ? [merged] : rows;
}

/** Padding read from the longhands, which are populated by the `padding` shorthand too -- but not vice versa: builders that write `padding-top/-left/...` individually (Beefree et al.) read back an empty `style.padding`, which is how every one of their cells imported with zero padding. Carries the exact per-side values plus the averaged py/px pair for consumers that only have a pair to store. */
function paddingOf(st) {
  if (!st) return null;
  const t = PX(st.paddingTop); const b = PX(st.paddingBottom);
  const l = PX(st.paddingLeft); const r = PX(st.paddingRight);
  if (!t && !b && !l && !r) return null;
  return { t, b, l, r, py: Math.round((t + b) / 2), px: Math.round((l + r) / 2) };
}

/** Rows can hold padding exactly: the linked py/px pair when the source is symmetric, plus per-side overrides (and the split flag, so the inspector opens showing four sliders) when it isn't. */
function setRowPad(row, pad) {
  row.props.py = pad.py; row.props.px = pad.px;
  if (pad.t !== pad.b || pad.l !== pad.r) {
    row.props.pt = pad.t; row.props.pb = pad.b; row.props.pl = pad.l; row.props.pr = pad.r;
    row.props.padSplit = true;
  }
}

/** MailCraft's `text` block treats `lh` as a bare multiplier of the block's own font size (e.g. `1.6`), same as CSS's unitless `line-height`. Source HTML overwhelmingly writes `line-height` in `px` (or `%`) instead, which is a different scale entirely -- reading `parseFloat('24px')` as `24` would hand the block a line height of 24x its font size. Converts to the multiplier MailCraft expects, and refuses anything that still doesn't look like one (a typo, a unitless value some tool emitted by mistake) rather than risk a blown-up line box. */
function lineHeightRatio(raw, fontPx) {
  if (!raw) return null;
  const size = fontPx || 16;
  let ratio;
  if (raw.endsWith('%')) ratio = PX(raw) / 100;
  else if (raw.endsWith('em')) ratio = PX(raw); // already a multiplier of the font size, by definition
  else if (raw.endsWith('pt')) ratio = (PX(raw) * 4 / 3) / size;
  else if (raw.endsWith('px')) ratio = PX(raw) / size;
  else ratio = parseFloat(raw);
  return Number.isFinite(ratio) && ratio > 0 && ratio <= 4 ? ratio : null;
}

function escapeText(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ---- per-shape classifiers (each returns a block, or null if it doesn't match) ----

function classifyImage(el) {
  let img = null; let href = '';
  if (el.tagName === 'IMG') img = el;
  else if (el.tagName === 'A') {
    img = onlyChild(el, 'IMG');
    if (img) href = el.getAttribute('href') || '';
  } else if (el.tagName === 'DIV' || el.tagName === 'TD') {
    img = onlyChild(el, 'IMG');
    if (!img) {
      const a = onlyChild(el, 'A');
      if (a) { img = onlyChild(a, 'IMG'); if (img) href = a.getAttribute('href') || ''; }
    }
  }
  if (!img) return null;
  // A pixel size wins over a percent one wherever either appears: builders
  // routinely write `width:100%` on the img and put the real constraint on a
  // `width` attribute or a wrapper's `max-width` (`<div style="max-width:88px">
  // <img style="width:100%" width="88">`), and trusting the percent first is
  // exactly what blew an 88px logo up to the full content width.
  const isPct = (v) => String(v || '').endsWith('%');
  const pxCandidates = [
    img.style.width, img.getAttribute('width'), img.style.maxWidth,
    el !== img && el.style ? el.style.width : '', el !== img && el.style ? el.style.maxWidth : '',
  ];
  const pxHint = pxCandidates.find((v) => v && !isPct(v) && PX(v));
  let width = 100;
  if (pxHint) {
    // Convert to % of the nearest fixed-width ancestor.
    const colPx = ancestorPxWidth(img) || 600;
    width = Math.max(2, Math.min(100, Math.round((PX(pxHint) / colPx) * 100)));
  } else if (isPct(img.style.width) && PX(img.style.width)) {
    width = PX(img.style.width);
  }
  const over = {
    src: img.getAttribute('src') || '',
    alt: img.getAttribute('alt') || '',
    href,
    width,
    align: textAlignOf(el),
    // Always explicit: the block *default* is 10px, which quietly rounded
    // the corners of every imported image that had none.
    radius: PX(img.style.borderRadius) || 0,
  };
  // The block's own spacing lives on the wrapper the exporter writes
  // (`padding: py px`); unread, it reset to 0/0 on every save.
  if (el !== img && el.style) {
    const pd = paddingOf(el.style);
    if (pd) { over.py = pd.py; over.px = pd.px; }
  }
  return blk('image', over);
}

function classifyButton(el) {
  let a = null; let outerAlign = ''; let pillTable = null;
  if (el.tagName === 'A') a = el;
  else if (el.tagName === 'DIV' || el.tagName === 'TD') {
    a = onlyChild(el, 'A');
    // The bulletproof shape: the anchor is wrapped in a one-cell table so
    // Word has a `<td>` to paint and pad (this exporter emits that, and so
    // does every hand-written bulletproof button). Reached through the
    // wrapper rather than the cell because that is the node the row walker
    // offers, and the wrapper is also what carries the alignment.
    if (!a) {
      pillTable = onlyChild(el, 'TABLE');
      // Direct row cells only. A descendant search would count the `<td>`s
      // inside whatever the cell contains, so a layout row holding one block
      // could look like a one-cell button table -- or stop looking like one
      // the moment the block itself contained a table.
      const cells = pillTable ? pillTable.querySelectorAll(':scope > tbody > tr > td, :scope > tr > td') : [];
      if (cells.length === 1) a = onlyChild(cells[0], 'A');
      if (!a) pillTable = null;
    }
    if (a) outerAlign = el.style.textAlign || el.getAttribute('align') || '';
  }
  if (!a) return null;
  if (a.querySelector('img,table,div')) return null;
  // The visual pill isn't always the anchor itself: bulletproof-button
  // generators (Beefree et al.) leave the `<a>` bare and hang the background,
  // radius and padding on nested `<span>`s inside it. Whichever element
  // carries the background is the pill; padding may sit a level deeper still.
  const hasBg = (e) => !!(e.style && (e.style.backgroundColor || e.style.background)) || !!(e.getAttribute && e.getAttribute('bgcolor'));
  // The cell is checked last and only as a fallback: an anchor that paints
  // its own pill still describes the button best (that is where the radius
  // and the label colour sit), and the cell is what carries them when the
  // source put the paint and the padding on the `<td>` instead.
  const cell = a.closest ? a.closest('td') : null;
  const pill = hasBg(a) ? a : (Array.from(a.querySelectorAll('span')).find(hasBg) || (cell && hasBg(cell) ? cell : null));
  if (!pill) return null;
  const st = pill.style;
  let pad = paddingOf(a.style) || paddingOf(st) || (cell ? paddingOf(cell.style) : null);
  if (!pad) {
    const padded = Array.from(pill.querySelectorAll('span')).find((s) => paddingOf(s.style));
    if (padded) pad = paddingOf(padded.style);
  }
  const display = st.display || a.style.display || '';
  if (!pad && display.indexOf('inline-block') < 0 && display !== 'block') return null;
  const over = {
    label: (a.textContent || '').trim() || 'Button',
    href: a.getAttribute('href') || '#',
    bg: st.backgroundColor || st.background || (pill.getAttribute && pill.getAttribute('bgcolor')) || '',
    color: a.style.color || st.color || '#ffffff',
    radius: radiusOf(st),
    py: (pad && pad.py) || 13,
    px: (pad && pad.px) || 26,
    // The anchor's own `text-align` centers the *label inside the pill*
    // (boilerplate on almost every bulletproof button) and says nothing
    // about where the pill sits in the row -- that's the container's call,
    // so alignment is read starting at the parent, never at the anchor.
    align: outerAlign || textAlignOf(a.parentElement || a),
    // In the one-cell shape the anchor is always `display:block` (it fills
    // the padded cell), so full-width has to be read off the table instead --
    // otherwise every bulletproof button imports as a full-width one.
    full: pillTable
      ? /100%/.test((pillTable.style && pillTable.style.width) || pillTable.getAttribute('width') || '')
      : a.style.display === 'block',
  };
  const size = fontPx(st.fontSize) || fontPx(a.style.fontSize);
  if (size) over.size = size;
  // The label's family sits on the anchor in this exporter's shape, on the
  // pill in most foreign ones. The theme-equality fold in htmlToDoc turns a
  // value that merely restates the document font back into "inherit".
  const family = a.style.fontFamily || st.fontFamily || inheritedStyle(a, 'fontFamily');
  if (family) over.fontFamily = family;
  // Outline buttons: transparent fill, the pill drawn by its border. The
  // border is looked for on the cell as well as the pill, because in the
  // one-cell shape the paint and the frame are on different elements -- the
  // anchor is the pill (it carries the background) while the `<td>` draws the
  // outline. Reading only the pill dropped `borderW` on every round trip.
  const frame = borderSidesOf(st).width ? st : (cell && cell.style && borderSidesOf(cell.style).width ? cell.style : st);
  const bw = borderSidesOf(frame).width;
  if (bw) { over.borderW = bw; over.borderStyle = borderStyleOf(frame); over.borderColor = borderColorOf(frame) || over.color; }
  return blk('button', over);
}

const SOCIAL_HOSTS = /facebook|twitter|x\.com|instagram|linkedin|youtube|tiktok|pinterest|threads|whatsapp|telegram|github|discord|snapchat|medium|dribbble|behance|mastodon|bluesky|bsky/i;

/** A run of small image-links, mostly pointing at social networks (every footer's icon strip), becomes a native social block -- MailCraft draws its own icon art from the network name (alt text, or the link's hostname). Imported as loose images they'd neither line up nor be editable as a set. */
function classifySocial(el) {
  if (!/^(DIV|TD|TABLE)$/.test(el.tagName)) return null;
  if ((el.textContent || '').trim()) return null;
  const anchors = Array.from(el.querySelectorAll('a'));
  if (anchors.length < 2) return null;
  // `svg` alongside `img`: MailCraft's own social block renders inline-SVG
  // icons, so accepting both is what lets an exported strip round-trip back
  // into a social block instead of dissolving.
  const imgs = anchors.map((a) => a.querySelector('img,svg'));
  if (imgs.some((im) => !im)) return null;
  const sizes = imgs.map((im) => PX(im.getAttribute('width') || (im.style && im.style.width)) || 32);
  if (sizes.some((s) => s > 64)) return null;
  const names = anchors.map((a, i) => {
    const named = (imgs[i].getAttribute('alt') || a.getAttribute('title') || a.getAttribute('aria-label') || '').trim();
    if (named) return named;
    const host = ((a.getAttribute('href') || '').match(/\/\/(?:www\.)?([^/?#]+)/) || [])[1] || '';
    return host.split('.')[0] || 'link';
  });
  const social = anchors.filter((a, i) => SOCIAL_HOSTS.test((a.getAttribute('href') || '') + ' ' + names[i]));
  if (social.length < Math.ceil(anchors.length / 2)) return null;
  const a0 = anchors[0];
  const over = {
    items: anchors.map((a, i) => names[i] + '|' + (a.getAttribute('href') || '#')).join('\n'),
    // From the first anchor's ancestry, not `el`: the alignment usually sits
    // on an inner td between the icons and the table this classifier sees.
    align: textAlignOf(a0),
    size: Math.round(sizes.reduce((x, y) => x + y, 0) / sizes.length),
  };
  // Presentation from the strip's own styling where it exists (MailCraft's
  // exported strips carry shape/color on the anchors). A foreign image-icon
  // strip has none of it -- render those as bare, brand-colored glyphs, the
  // closest match to how such strips actually look. The block *default*
  // (outlined boxes at 1.9x the icon size) both looked wrong and wrapped in
  // narrow footer columns.
  const aBg = a0.style && (a0.style.backgroundColor || a0.style.background);
  const aBorder = a0.style ? PX(a0.style.borderWidth) || PX(a0.style.borderTopWidth) : 0;
  over.shape = aBg ? (String(a0.style.borderRadius || '').indexOf('50%') > -1 ? 'circle' : 'square') : (aBorder ? 'outline' : 'bare');
  const aColor = a0.style && a0.style.color;
  if (aColor) over.color = aColor; else over.palette = 'brand';
  // Icon spacing: inter-cell padding on image strips, anchor margins on
  // exported ones.
  const cell = a0.closest ? a0.closest('td') : null;
  const cellGap = cell && cell !== el && el.contains(cell) ? PX(cell.style.paddingRight) + PX(cell.style.paddingLeft) : 0;
  const marginGap = a0.style ? PX(a0.style.marginRight) + PX(a0.style.marginLeft) : 0;
  const gap = cellGap || marginGap;
  if (gap) over.gap = gap;
  return blk('social', over);
}

/** A run of two or more sibling links with nothing else in the container (Beefree/MJML nav bars) is a menu block, not a text run -- as text, each link imports mid-paragraph with the wrapper's junk around it. */
function classifyMenu(el) {
  if (el.tagName !== 'DIV' && el.tagName !== 'TD') return null;
  if (el.querySelector('img,table,div,p,input,h1,h2,h3,h4,h5,h6')) return null;
  const anchors = Array.from(el.children).filter((c) => c.tagName === 'A');
  if (anchors.length < 2) return null;
  const linkText = anchors.map((a) => (a.textContent || '')).join('').replace(/\s+/g, '');
  if (linkText !== (el.textContent || '').replace(/\s+/g, '')) return null;
  const over = {
    items: anchors.map((a) => ((a.textContent || '').trim() + '|' + (a.getAttribute('href') || '#'))).join('\n'),
    align: textAlignOf(el),
  };
  const size = fontPx(inheritedStyle(anchors[0], 'fontSize'));
  if (size) over.size = size;
  const color = inheritedStyle(anchors[0], 'color');
  if (color) over.color = color;
  const family = inheritedStyle(anchors[0], 'fontFamily');
  if (family) over.fontFamily = family;
  // Item spacing ships as symmetric horizontal margins on each anchor
  // (`margin: 0 gap/2`); unread, a chosen gap snapped back to the default.
  const mg = PX(anchors[0].style.marginLeft) + PX(anchors[0].style.marginRight);
  if (mg) over.gap = mg;
  return blk('menu', over);
}

function classifyDivider(el) {
  if (el.tagName === 'HR') {
    const sw = el.style.width || '';
    return blk('divider', {
      thickness: PX(el.style.height) || PX(el.style.borderTopWidth) || 1,
      lineStyle: borderStyleOf(el.style),
      color: el.style.backgroundColor || el.style.borderTopColor || el.style.borderColor || '#d9dade',
      width: sw.endsWith('%') ? PX(sw) : 100,
    });
  }
  if (el.tagName !== 'DIV' && el.tagName !== 'TD') return null;
  const bar = el.children.length === 1 ? el.firstElementChild : (!el.children.length ? el : null);
  if (!bar || bar.tagName !== 'DIV' || bar.children.length || String(bar.textContent || '').trim()) return null;
  const h = PX(bar.style.height) || PX(bar.style.borderTopWidth);
  const bg = bar.style.backgroundColor || bar.style.background || bar.style.borderTopColor;
  if (!(h > 0 && h <= 10 && bg)) return null;
  const sw = bar.style.width || '';
  const over = { thickness: h, lineStyle: borderStyleOf(bar.style), color: bg, width: sw.endsWith('%') ? PX(sw) : 100 };
  // The wrapper's vertical padding is the block's own spacing (the exporter
  // writes `padding: py 0` around the rule); a declared zero counts too, so
  // a tightened divider does not spring back to the 14px default on reload.
  if (bar !== el && el.style && el.style.paddingTop !== '') over.py = PX(el.style.paddingTop);
  return blk('divider', over);
}

function classifySpacer(el) {
  if (el.tagName !== 'DIV' || el.children.length || String(el.textContent || '').trim()) return null;
  const h = PX(el.style.height);
  if (!h) return null;
  if (el.style.backgroundColor || el.style.background) return null;
  return blk('spacer', { height: h });
}

function classifyHeading(el) {
  if (!/^H[1-6]$/.test(el.tagName)) return null;
  const st = el.style;
  const over = { text: (el.textContent || '').trim(), level: el.tagName.toLowerCase() };
  const size = fontPx(st.fontSize); if (size) over.size = size;
  // Color and alignment inherit in CSS, and hero sections declare them on
  // the section `<td>` -- a white heading over a dark photo whose color
  // lived on the cell imported in the default dark ink and vanished into
  // the image. Own values still win; the walk up only fills the gaps,
  // exactly like the text-run path.
  const align = st.textAlign || inheritedStyle(el.parentElement, 'textAlign');
  if (align) over.align = align;
  const color = st.color || inheritedStyle(el.parentElement, 'color');
  if (color) over.color = hexOf(color);
  if (st.fontWeight) over.weight = st.fontWeight;
  // The family, like color, may live on the section cell. The renderer's own
  // Condensed stack folds back into the style toggle it came from; any other
  // family is a per-block font (the theme-equality fold in htmlToDoc turns a
  // restated document font back into "inherit").
  const family = st.fontFamily || inheritedStyle(el.parentElement, 'fontFamily');
  if (fontKey(family) === CONDENSED_KEY) over.font = 'condensed';
  else if (family) over.fontFamily = family;
  return blk('heading', over);
}

function classifyList(el) {
  if (el.tagName !== 'UL' && el.tagName !== 'OL') return null;
  // Through the same whitelist as a text run: this was the one classifier
  // that carried raw source innerHTML into props, so classes, ids and event
  // handlers (`onerror` on an <img> in a list item) rode into the canvas DOM
  // and the export while every other path stripped them. The newline swap is
  // because `items` is a one-fragment-per-line string -- a linebreak inside a
  // source <li> would otherwise split it into two items on render.
  const lis = Array.from(el.children).filter((c) => c.tagName === 'LI');
  if (!lis.length) return null;
  const over = { ordered: el.tagName === 'OL' };
  // The list's own typography lives on the UL/OL (this exporter stamps it
  // there; table emails may hang it on the cell above). Unread, a styled
  // list reset to the 15px default ink on every save/reload.
  const st = el.style;
  const size = fontPx(st.fontSize) || fontPx(inheritedStyle(el.parentElement, 'fontSize'));
  if (size) over.size = size;
  const color = st.color || inheritedStyle(el.parentElement, 'color');
  if (color) over.color = hexOf(color);
  const lh = lineHeightRatio(st.lineHeight || inheritedStyle(el.parentElement, 'lineHeight'), size);
  if (lh) over.lh = lh;
  // Same mixed-run guard as a text block: a block-level family makes the
  // renderer strip descendant families, so it is only claimed when no item
  // declares a different one -- and a claimed family folds the items' own
  // restated declarations away (same byte-stability reasoning as flush).
  const family = st.fontFamily || inheritedStyle(el.parentElement, 'fontFamily');
  if (family && !mixedFamily(el, family)) over.fontFamily = family;
  over.items = lis
    .map((li) => cleanImportHtml(li.innerHTML, over.fontFamily ? ['font-family'] : null).replace(/\n/g, ' '))
    .join('\n');
  // Declared zeros count: `padding-top:0` / `margin-bottom:0` are choices,
  // absence is what falls to the defaults.
  if (st.paddingTop !== '') over.py = PX(st.paddingTop);
  const li0 = el.querySelector(':scope > li');
  if (li0 && li0.style.marginBottom !== '') over.gap = PX(li0.style.marginBottom);
  return blk('list', over);
}

function classifyTable(el) {
  if (el.tagName !== 'TABLE') return null;
  const rows = Array.from(el.querySelectorAll(':scope > tbody > tr, :scope > tr'));
  if (!rows.length) return null;
  if (el.querySelector('img, table')) return null;
  const counts = rows.map((r) => r.children.length);
  if (Math.min(...counts) < 2) return null;
  const header = !!el.querySelector('th');
  const data = rows.map((r) => Array.from(r.children).map((c) => (c.textContent || '').trim().replace(/\|/g, '/')).join('|')).join('\n');
  const firstCell = rows[0] && rows[0].children[0];
  const cellStyle = firstCell && firstCell.style;
  const borderWidth = cellStyle ? borderSidesOf(cellStyle).width : 0;
  const borders = !!borderWidth;
  const over = {
    data, header, borders, borderWidth: borderWidth || 1,
    borderStyle: cellStyle ? borderStyleOf(cellStyle) : 'solid',
    lineColor: cellStyle ? (borderColorOf(cellStyle) || '#e2e8f0') : '#e2e8f0',
  };
  // Presentation the renderer writes on the table and its cells, read back so
  // a styled table stops resetting to the stock look on every save/reload.
  const st = el.style;
  const size = fontPx(st.fontSize);
  if (size) over.size = size;
  if (st.fontFamily) over.fontFamily = st.fontFamily;
  const w = st.width || el.getAttribute('width') || '';
  if (String(w).endsWith('%') && PX(w)) over.width = PX(w);
  if (cellStyle) {
    // The renderer's cell padding is `pad` on top, `pad*1.2` at the sides --
    // the top edge is the stored prop. A declared zero is a choice.
    if (cellStyle.paddingTop !== '') over.pad = PX(cellStyle.paddingTop);
    if (cellStyle.textAlign) over.align = cellStyle.textAlign;
  }
  if (header) {
    const hb = bgOf(rows[0]) || bgOf(firstCell);
    if (hb && hb !== 'transparent') over.headBg = hb;
  }
  // Striping is claimed only from this renderer's own signature tint; with
  // enough body rows to tell, its absence means the source is not striped --
  // the old behaviour striped every imported table by default.
  const stripeAt = header ? 2 : 0;
  if (rows.length > stripeAt) {
    over.striped = rows.some((r, i) => !(header && i === 0) && i % 2 === 0
      && /rgba\(29,\s*31,\s*32/.test((r.style && (r.style.backgroundColor || r.style.background)) || ''));
  }
  return blk('table', over);
}

const CLASSIFIERS = [classifyImage, classifyButton, classifySocial, classifyMenu, classifyDivider, classifySpacer, classifyHeading, classifyList, classifyTable];

function classifyNode(el) {
  for (const fn of CLASSIFIERS) {
    const b = fn(el);
    if (!b) continue;
    // The class sits on the wrapper the exporter puts around each block, and
    // on a foreign template it can be a level or two further out, so a short
    // walk up finds it. Only ever set when a wrapper actually says so --
    // absent means "all devices", which is what every ordinary block wants.
    let n = el;
    for (let i = 0; n && i < 4; i += 1) {
      const v = visibilityOf(n);
      if (v) { b.props.vis = v; break; }
      n = n.parentElement;
    }
    return b;
  }
  return null;
}

function isStructural(el) {
  return /^(TABLE|FORM|IFRAME|SCRIPT|STYLE|VIDEO|OBJECT|EMBED)$/.test(el.tagName) || !!el.querySelector('table,form,iframe,script,video,object,embed');
}

/** `core/export.js` wraps every block in a column with `<div style="{boxCss(b.props)}">`, which for every block type shipped today (none define the `bBg/bBorder/bLine/bRadius/bPad` props `boxCss` reads) always resolves to a bare `<div style="margin:0">` -- a see-through spacing wrapper, not real content. Unwraps that one level so the classifiers see the block's own signature div directly; leaves any div that carries other styling (an intentionally-styled container someone pasted in) alone, since that's real content, not framework wrapper. */
function unwrapBoxDiv(el) {
  if (el.tagName !== 'DIV' || el.children.length !== 1) return el;
  // A device-visibility wrapper is framework too, and the declarations that
  // hide it are the framework's, not the author's: a mobile-only block is
  // `display:none` in the base stylesheet so Classic Outlook never shows it,
  // and css-cascade folds that inline on import. Without this exemption the
  // wrapper looked like a deliberately styled container, never unwrapped, and
  // the heading inside it came back as an untyped run of text. `classifyNode`
  // reads the visibility off this same wrapper by walking back up, so the
  // property survives the unwrap.
  const framework = visibilityOf(el)
    ? /^(?:margin|display|max-height|overflow|mso-)/
    : /^margin/;
  const extra = Array.from(el.style).filter((prop) => !framework.test(prop));
  if (extra.length) return el;
  const child = el.firstElementChild;
  if ((el.textContent || '') !== (child.textContent || '')) return el;
  return unwrapBoxDiv(child);
}

/** Walks a column's (or the body's) child nodes and turns them into blocks -- recognized shapes become native blocks, runs of unrecognized inline content are buffered and flushed as a single sanitized `text` block, and structural content that can't be classified falls back to a raw `html` block. Never throws, never drops content. */
/** Tags whose inline styles describe a local run of characters, not the block around them -- a bold lead-in `<span>`'s weight must not become the whole block's weight. */
const INLINE_TAGS = /^(SPAN|A|B|STRONG|I|EM|U|S|STRIKE|CODE|SUP|SUB|FONT)$/;

/**
 * A text run that is nothing but dynamic-content tags -- what the exporter
 * writes for marker blocks inside a column -- becomes those marker blocks
 * again. Consecutive markers export joined by whitespace into one text node,
 * so every line must parse or none do: mixed prose keeps its tags as
 * pass-through content (an inline {{#if}} inside a sentence is the user's
 * text, not row structure), exactly like merge tags.
 */
function logicMarkersOf(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const out = [];
  for (const line of lines) {
    let m = line.match(/^\{\{#(if|each)\s+([^{}]+?)\s*\}\}$/);
    if (m) { out.push(blk(m[1] === 'if' ? 'condition' : 'loop', { expr: m[2], end: false })); continue; }
    m = line.match(/^\{\{\/(if|each)\}\}$/);
    if (m) { out.push(blk(m[1] === 'if' ? 'condition' : 'loop', { expr: '', end: true })); continue; }
    return null;
  }
  return out;
}

/** Whether an element (or the transparent single-child chain under it) carries its own padding -- the shape the exporter writes for a block's py/px, and a builder section's own spacing. Such a wrapper is one block, never part of a text run. */
function hasOwnRunPad(el) {
  let e = el;
  if (e.style && paddingOf(e.style)) return true;
  while (
    e.children && e.children.length === 1
    && !INLINE_TAGS.test(e.firstElementChild.tagName)
    && (e.textContent || '') === (e.firstElementChild.textContent || '')
  ) {
    e = e.firstElementChild;
    if (e.style && paddingOf(e.style)) return true;
  }
  return false;
}

function blocksFromNodes(nodes) {
  const out = [];
  let buf = [];
  let bufFirstEl = null;
  // Every element buffered into the current run, for the mixed-family check
  // below: the first element alone cannot say whether a *later* piece of the
  // run declares its own font.
  let bufEls = [];
  // The parent of a leading bare text node. A run with no element of its own
  // (`<td style="font-size:30px;...">{{Code}}</td>`) still has real
  // typography -- it lives on the ancestors, and with no bufFirstEl the
  // inheritedStyle reads below were skipped wholesale, so the run imported
  // at the theme default (a 30px/800 verification code became 16px plain).
  let bufTextEl = null;
  const flush = () => {
    const raw = buf.join('');
    const html = cleanImportHtml(raw);
    // A run with nothing visible in it -- no text beyond whitespace/hair
    // spaces, no image or line break (an `<nbsp;>` still counts as a blank
    // line someone wrote) -- is markup residue (`<p style="margin:0"></p>`),
    // not content; as a block it rendered as a phantom padded row.
    const visible = html && (/<(img|br|hr)\b/i.test(html)
      || html.replace(/<[^>]*>/g, '').replace(/[ \t\r\n\u2009\u200a\u200b]/g, '') !== '');
    if (visible) {
      const over = { html };
      if (!bufFirstEl && bufTextEl) {
        const size = fontPx(inheritedStyle(bufTextEl, 'fontSize')); if (size) over.size = size;
        const color = inheritedStyle(bufTextEl, 'color'); if (color) over.color = hexOf(color);
        over.align = textAlignOf(bufTextEl);
        const weight = inheritedStyle(bufTextEl, 'fontWeight'); if (weight) over.weight = weight;
        const lh = lineHeightRatio(inheritedStyle(bufTextEl, 'lineHeight'), size);
        if (lh) over.lh = lh;
        // A bare run has no inline tags to carry a family, so the ancestor's
        // is the block's -- no mixed-run risk here.
        const family = inheritedStyle(bufTextEl, 'fontFamily');
        if (family) over.fontFamily = family;
      }
      if (bufFirstEl) {
        // The block's *base* style: the first buffered element when it's a
        // block-level thing (a styled <p>/<div> speaks for the run), else its
        // ancestors -- table emails hang typography on the containing <td>
        // (`font-size:12px` on a footer cell), which the old
        // first-element-only read never saw. Per-element differences inside
        // the run survive as the inline styles `cleanImportHtml` now keeps.
        let baseEl = INLINE_TAGS.test(bufFirstEl.tagName) ? (bufFirstEl.parentElement || bufFirstEl) : bufFirstEl;
        // The run's own spacing: the exporter writes a text block's py/px as
        // padding on the wrapper div the descent below walks straight past
        // (it lands on the <p>), so a padded block came back at the default
        // 10px/0 on every save. First padding on the wrapper chain wins.
        let runPad = paddingOf(baseEl.style);
        // Then descend through transparent single-child wrappers: builders
        // nest a `font-family:sans-serif` shim div around the div that
        // carries the real typography, and `inheritedStyle` below walks *up*
        // from wherever this lands -- so start at the deepest element that
        // still spans the whole run.
        while (
          baseEl.children.length === 1
          && !INLINE_TAGS.test(baseEl.firstElementChild.tagName)
          && (baseEl.textContent || '') === (baseEl.firstElementChild.textContent || '')
        ) { baseEl = baseEl.firstElementChild; if (!runPad) runPad = paddingOf(baseEl.style); }
        if (runPad) { over.py = runPad.py; over.px = runPad.px; }
        const size = fontPx(inheritedStyle(baseEl, 'fontSize')); if (size) over.size = size;
        const color = inheritedStyle(baseEl, 'color'); if (color) over.color = hexOf(color);
        over.align = textAlignOf(baseEl);
        const weight = inheritedStyle(baseEl, 'fontWeight'); if (weight) over.weight = weight;
        const lh = lineHeightRatio(inheritedStyle(baseEl, 'lineHeight'), size);
        if (lh) over.lh = lh;
        // The run's base family, read exactly like size/color -- but claimed
        // at block level only when no piece of the run declares a different
        // one, since the renderer strips descendant families the moment the
        // block owns a font (overrideRichFont). A mixed run keeps its inline
        // declarations instead, exactly as before. The theme-equality fold in
        // htmlToDoc turns a restated document font back into "inherit".
        const family = inheritedStyle(baseEl, 'fontFamily');
        if (family && !bufEls.some((e) => mixedFamily(e, family))) {
          over.fontFamily = family;
          // Claimed means consumed: every family in the run restates the one
          // just read (the mixed check above), so the inline declarations
          // fold into the block prop instead of shipping twice. This is also
          // what keeps export -> import -> export byte-stable -- left in the
          // html, the renderer strips them from the live DOM (overrideRichFont)
          // and the re-serialized attributes drift on the next save.
          over.html = cleanImportHtml(raw, ['font-family']);
        }
      }
      out.push(blk('text', over));
    }
    buf = []; bufFirstEl = null; bufTextEl = null; bufEls = [];
  };
  nodes.forEach((n) => {
    if (n.nodeType === 3) {
      const markers = logicMarkersOf(n.textContent);
      if (markers) { flush(); markers.forEach((mb) => out.push(mb)); return; }
      if (n.textContent && n.textContent.trim()) {
        if (!bufFirstEl && !bufTextEl) bufTextEl = n.parentElement;
        buf.push(escapeText(n.textContent));
      }
      return;
    }
    if (n.nodeType !== 1) return;
    if (isHidden(n)) return;
    const target = unwrapBoxDiv(n);
    const b = classifyNode(target);
    if (b) { flush(); out.push(b); return; }
    // A one-cell scaffolding table inside a column (Beefree's per-block
    // `table.text_block` / `image_block` wrappers) is transparent here just
    // as it is at row level -- without this it fell through to `isStructural`
    // and the whole cell imported as one opaque raw-html block. The wrapping
    // `td.pad`'s padding is the block's spacing, so it lands on the produced
    // blocks' own py/px -- except buttons, where py/px mean the pill's inner
    // padding, not outer spacing.
    if (target.tagName === 'TABLE' && isPassthroughTable(target)) {
      flush();
      const tr = target.querySelector(':scope > tbody > tr, :scope > tr');
      const td = Array.from(tr.children).find((c) => c.tagName === 'TD' || c.tagName === 'TH');
      const pad = paddingOf(td.style) || cellPadOf(target);
      const inner = blocksFromNodes(Array.from(td.childNodes));
      if (pad) inner.forEach((ib) => {
        if (ib.type === 'button') return;
        if ('py' in ib.props) ib.props.py = pad.py;
        if ('px' in ib.props) ib.props.px = pad.px;
      });
      out.push(...inner);
      return;
    }
    if (isStructural(target)) { flush(); out.push(blk('html', { code: n.outerHTML })); return; }
    // A wrapper carrying its own padding is a block boundary, not part of a
    // run: the exporter writes every text block as exactly such a padded div,
    // and buffering two of them together merged neighbouring blocks into one
    // -- the second lost its padding, size, everything -- on every save.
    if (n.nodeType === 1 && !INLINE_TAGS.test(target.tagName) && hasOwnRunPad(target) && buf.length) flush();
    if (!bufFirstEl) bufFirstEl = target;
    bufEls.push(target);
    buf.push(n.outerHTML);
    if (n.nodeType === 1 && !INLINE_TAGS.test(target.tagName) && hasOwnRunPad(target)) flush();
  });
  flush();
  return out;
}

function normalizeSpans(spans) {
  const total = spans.reduce((a, v) => a + v, 0) || 1;
  const scaled = spans.map((v) => Math.round((v / total) * 100));
  scaled[scaled.length - 1] += 100 - scaled.reduce((a, v) => a + v, 0);
  return scaled;
}

function spansFromCells(cells, tableWidthPx) {
  const parsed = cells.map((td) => {
    const sw = td.style.width || '';
    // `max-width` before `width`, but only where `width` says nothing useful.
    // A CSS-layout column is written `width:100%;max-width:50%` -- the 100%
    // is the fluid instruction and the cap is the actual share of the row, so
    // reading `width` first would score every column at 100.
    const mw = td.style.maxWidth || '';
    if (mw.endsWith('%') && (!sw || PX(sw) >= 100)) return { pct: PX(mw) };
    if (sw.endsWith('%')) return { pct: PX(sw) };
    const aw = td.getAttribute('width') || '';
    if (aw.endsWith('%')) return { pct: PX(aw) };
    const px = PX(sw) || PX(aw) || (mw.endsWith('px') ? PX(mw) : 0);
    return px ? { px } : null;
  });
  if (parsed.every((p) => p && p.pct != null)) {
    const total = parsed.reduce((a, p) => a + p.pct, 0);
    if (total >= 90 && total <= 110) return normalizeSpans(parsed.map((p) => p.pct));
  }
  if (tableWidthPx && parsed.every((p) => p && p.px)) return normalizeSpans(parsed.map((p) => Math.round((p.px / tableWidthPx) * 100)));
  const even = Math.floor(100 / cells.length);
  const spans = cells.map(() => even);
  spans[spans.length - 1] += 100 - even * cells.length;
  return spans;
}

/*
 * Columns that are not table cells.
 *
 * A row's columns do not have to be `<td>`s. MJML, and to a degree Unlayer and
 * Stripo, emit them as sibling `<div>`s that sit side by side through
 * `display:inline-block` and a percentage cap, with the table version hidden
 * inside `<!--[if mso]>` conditionals for Outlook. Those comments are comments
 * to a DOM parser, so all the walker ever saw was one `<td>` holding two
 * divs -- and a real 50/50 row imported as two stacked full-width rows. The
 * blocks all survived; the layout relationship did not.
 *
 * Returning the divs here hands them to exactly the same machinery the table
 * path already uses -- `spansFromCells` for the widths, gap and gutter
 * detection, per-column background and padding -- so there is no second
 * column model, only a second way of recognising one.
 *
 * Deliberately conservative, because a wrong grouping is worse than none: a
 * false positive welds unrelated sections into one row, which the user then
 * has to take apart by hand. Every one of these has to hold.
 */
/*
 * A column's share of its row is not always in its inline style.
 *
 * MJML writes the column as `width:100%` inline and puts the real share in a
 * class rule inside `@media only screen and (min-width:480px)` -- a *desktop*
 * query, so it carries the layout rather than overriding it. `css-cascade.js`
 * strips every at-rule before folding, by design (a mobile override cannot be
 * represented in the model), which means that share never reaches the element
 * and three columns looked like three widthless divs.
 *
 * So the stylesheets are read once per document for `.class { width: N% }`,
 * from top-level rules and from `min-width` blocks -- never from `max-width`
 * blocks, which are the mobile overrides the cascade is right to drop.
 */
const CLASS_WIDTHS = new WeakMap();

function scanWidthRules(css, map) {
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf('@', i);
    const plain = css.slice(i, at < 0 ? css.length : at);
    plain.replace(/([^{}]+)\{([^{}]*)\}/g, (m0, sel, decl) => {
      const w = decl.match(/(?:^|;)\s*width\s*:\s*([\d.]+)%/i);
      if (w) {
        sel.split(',').forEach((one) => {
          const cm = one.trim().match(/^\.([-\w]+)$/);
          if (cm && !map[cm[1]]) map[cm[1]] = parseFloat(w[1]);
        });
      }
      return m0;
    });
    if (at < 0) break;
    const brace = css.indexOf('{', at);
    if (brace < 0) break;
    const prelude = css.slice(at, brace);
    let depth = 0;
    let j = brace;
    for (; j < css.length; j += 1) {
      if (css[j] === '{') depth += 1;
      else if (css[j] === '}') { depth -= 1; if (!depth) break; }
    }
    // `max-width` is a narrow-screen override, which says nothing about the
    // desktop layout this is trying to recover.
    if (!/max-width/i.test(prelude)) scanWidthRules(css.slice(brace + 1, j), map);
    i = j + 1;
  }
}

function classWidths(doc) {
  if (!doc || !doc.querySelectorAll) return {};
  const hit = CLASS_WIDTHS.get(doc);
  if (hit) return hit;
  const map = {};
  Array.from(doc.querySelectorAll('style')).forEach((st) => {
    scanWidthRules(String(st.textContent || '').replace(/\/\*[\s\S]*?\*\//g, ''), map);
  });
  CLASS_WIDTHS.set(doc, map);
  return map;
}

function inlineColumnGroup(nodes) {
  const kids = Array.from(nodes).filter((n) => {
    if (n.nodeType === 8) return false;                                  // the MSO conditionals themselves
    if (n.nodeType === 3) return !!String(n.textContent || '').trim();   // layout whitespace between the divs
    return n.nodeType === 1 && !/^(STYLE|SCRIPT)$/.test(n.tagName);
  });
  // Two to six siblings, all plain containers. A run of one is not a row, and
  // a run of many is far more likely to be stacked content than columns.
  if (kids.length < 2 || kids.length > 6) return null;
  if (!kids.every((k) => k.nodeType === 1 && k.tagName === 'DIV')) return null;
  // Side-by-side has to be stated, not guessed. `inline-block` is the email
  // idiom; floats are the older one. A plain block div is stacked content and
  // must not be swept up.
  const sideBySide = (k) => {
    const s = k.style || {};
    return /inline-block|inline-flex/.test(s.display || '') || /^(left|right)$/.test(s.cssFloat || s.float || '');
  };
  if (!kids.every(sideBySide)) return null;
  // Every sibling must declare a share of the row, and the shares must add up
  // to one row. Anything else is a layout this cannot claim to understand.
  const shareOf = (k) => {
    const s = k.style || {};
    const mw = s.maxWidth || '';
    if (mw.endsWith('%')) return PX(mw);
    const w = s.width || '';
    if (w.endsWith('%') && PX(w) < 100) return PX(w);
    // Nothing inline: the share may be carried by one of the element's
    // classes (see classWidths).
    const byClass = classWidths(k.ownerDocument);
    const named = ((k.getAttribute && k.getAttribute('class')) || '').split(/\s+/);
    for (let i = 0; i < named.length; i += 1) {
      const v = byClass[named[i]];
      if (v && v < 100) return v;
    }
    return 0;
  };
  const shares = kids.map(shareOf);
  if (!shares.every((w) => w > 0)) return null;
  const total = shares.reduce((a, b) => a + b, 0);
  if (total < 90 || total > 110) return null;
  kids.shares = shares;
  return kids;
}

/** Detects MailCraft's own two-table row shape -- an outer `<td>` (row padding/bg/border) wrapping a single-row `role="presentation"` table that holds the actual column(s), per `core/export.js` -- and widens to its cells (one or many) so rows round-trip back into real columns instead of one opaque `html` block. */
function unwrapNestedLayout(td) {
  const only = onlyChild(td, 'TABLE');
  if (!only) return null;
  // Not every single-row table is layout. A bulletproof button is a one-cell
  // table too, and reading it as a row made its cell the row's `bgSource` --
  // so a pink button in a white section repainted the whole band pink and
  // the section's own background was lost. A component table is one block,
  // never a row; the same guard covers a social strip built the same way.
  if (classifyButton(td) || classifySocial(only)) return null;
  const trs = only.querySelectorAll(':scope > tbody > tr, :scope > tr');
  if (trs.length !== 1) return null;
  if (only.querySelector('th')) return null;
  const cells = Array.from(trs[0].children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH');
  return cells.length ? cells : null;
}

/** A table with exactly one `<tr>` and one cell is pure scaffolding (a per-section wrapper, an Outlook-only shim, a bulletproof-button frame) -- it carries no row/column intent of its own, so it should be seen through rather than turned into a one-cell row. Real email builders (MJML, most ESPs) nest several layers of these around every actual section. */
function isPassthroughTable(tb) {
  const trs = tb.querySelectorAll(':scope > tbody > tr, :scope > tr');
  if (trs.length !== 1) return false;
  // A synthetic marker row (see foldLogicWrappers) is a real row, not
  // scaffolding -- passing through it would silently drop the marker that
  // rowsFromContentTable mints from it.
  if (trs[0].getAttribute('data-mc-logic')) return false;
  const cells = Array.from(trs[0].children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH');
  return cells.length === 1;
}

/** CSSOM hands colors back as `rgb(r, g, b)` even when the source (and the
 * user's own value) was hex -- so every save visibly rewrote colour fields.
 * Solid rgb() flattens back to hex; anything else (rgba, keywords,
 * `transparent`) passes through untouched. */
function hexOf(value) {
  const m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(String(value == null ? '' : value).trim());
  if (!m) return value;
  return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
}

function bgOf(el) {
  const st = el.style;
  if (st && st.backgroundColor) return hexOf(st.backgroundColor);
  // The `background` shorthand is only a usable *color* when it holds no
  // image/gradient -- browsers populate `backgroundColor` from a shorthand
  // that includes a color, so reaching here with a url() means there is no
  // color to take (and taking the raw string set broken values).
  const short = (st && st.background) || '';
  if (short && short.indexOf('url(') < 0 && short.indexOf('gradient(') < 0) return hexOf(short);
  return hexOf((el.getAttribute && el.getAttribute('bgcolor')) || '');
}

function padOf(el) {
  return el.style ? paddingOf(el.style) : null;
}

/*
 * One column of a row, on its own.
 *
 * The same container the multi-column detector groups, but appearing singly --
 * a full-width MJML section is one of these. It matters because of what is
 * *inside* it: a table whose every `<tr>` is one block. The generic walk turns
 * every `<tr>` into a MailCraft row, so a section holding a heading and a
 * subheading came back as two rows, each repainted with the section's
 * background and each carrying the inner cell's padding while the section's
 * own padding was dropped. A source `<tr>` inside a column is a block slot,
 * not a row.
 *
 * Recognising the boundary keeps the column's blocks together in one row, and
 * lets the section's `<td>` supply that row's padding, which is where it
 * belonged all along. `tr -> row` is untouched everywhere else, which is what
 * keeps MailCraft's own export round-tripping.
 */
function isColumnContainer(el) {
  if (!el || el.nodeType !== 1 || el.tagName !== 'DIV') return false;
  const s = el.style || {};
  const sideBySide = /inline-block|inline-flex/.test(s.display || '') || /^(left|right)$/.test(s.cssFloat || s.float || '');
  if (!sideBySide) return false;
  if (!(s.width || s.maxWidth)) return false;
  // A column holds its blocks in a table; a lone inline-block div with no
  // table is a badge or a pill, and is content in its own right.
  return Array.from(el.children).some((c) => c.tagName === 'TABLE');
}

/** Every block a set of rows holds, in order -- a MailCraft column is a flat list. */
function blocksOfRows(rows) {
  return rows.reduce((acc, r) => acc.concat(r.cols.reduce((a, c) => a.concat(c.blocks), [])), []);
}

/** A div/center that itself nests a div/table/center is acting as a structural container (a section wrapper, an outer page wrapper holding several sections) rather than as one piece of content -- its children need to be walked in their own right, not folded into one block. A div holding only inline content (text, spans, an image not otherwise recognized) is real content and is left to `blocksFromNodes`. */
function looksLikeContainer(el) {
  return Array.from(el.children).some((c) => c.tagName === 'TABLE' || c.tagName === 'DIV' || c.tagName === 'CENTER');
}

function applyBg(rows, bg) {
  if (bg) rows.forEach((r) => { if (!r.props.bg) r.props.bg = bg; });
  return rows;
}

/** Rows built from a genuine content table (`rowsFromContentTable`) already carry real, per-line padding read off their own `<td>`; rows built from a plain buffered run of content (`collectRows`'s `flushBuf`) start at a neutral zero, since there's no source padding to point to at that level. Once one of those zeroed rows bubbles up through a passthrough table or container div that DOES carry padding (the common shape for a single-line MJML/ESP section), that's the closest real signal available, and gets applied -- but only to rows still at zero, so it never overwrites a more specific value a deeper table already set. */
function applyPad(rows, pad) {
  if (pad) rows.forEach((r) => { if (!r.props.py && !r.props.px && r.props.pt === undefined) setRowPad(r, pad); });
  return rows;
}

/** Longhand side colors are always a single value; the `borderColor` shorthand reads back as a per-side list when the sides differ (`rgb(...) rgb(...) currentcolor`), which is not a usable color. */
function borderColorOf(st) {
  const ok = (v) => (v && v !== 'currentcolor' ? hexOf(v) : '');
  return ok(st.borderTopColor) || ok(st.borderLeftColor) || ok(st.borderRightColor) || ok(st.borderBottomColor) || '';
}

/** One usable CSS border style for models that expose a single style across
 * all enabled edges. Old/imported documents fall back to solid. */
function borderStyleOf(st) {
  const allowed = new Set(['solid', 'dashed', 'dotted', 'double']);
  const values = [st.borderTopStyle, st.borderRightStyle, st.borderBottomStyle, st.borderLeftStyle, st.borderStyle];
  return values.find((v) => allowed.has(v)) || 'solid';
}

/** MailCraft rows have one radius for all corners; a per-corner source value (`16px 16px 0 0` on a stacked card) resolves to the largest corner rather than whatever corner happened to be listed first. */
function radiusOf(st) {
  const parts = String(st.borderRadius || '').split(/\s+/).map(PX);
  return parts.length ? Math.max(0, ...parts) : 0;
}

/** Per-side border widths (the longhands are populated by the `border` shorthand too) plus the overall width -- the largest side, since MailCraft rows have one width shared by every enabled side. */
function borderSidesOf(st) {
  const sides = {
    top: PX(st.borderTopWidth), right: PX(st.borderRightWidth),
    bottom: PX(st.borderBottomWidth), left: PX(st.borderLeftWidth),
  };
  const width = Math.max(sides.top, sides.right, sides.bottom, sides.left) || PX(st.borderWidth);
  return { width, sides };
}

function setRowBorder(row, width, sides, color, style) {
  row.props.border = width;
  row.props.borderStyle = style || 'solid';
  row.props.lineColor = color || '#e2e2e5';
  row.props.bTop = sides.top > 0;
  row.props.bRight = sides.right > 0;
  row.props.bBottom = sides.bottom > 0;
  row.props.bLeft = sides.left > 0;
}

/**
 * Border/radius on a passthrough wrapper describe one visual card. With
 * per-side borders the card decomposes faithfully even across several rows:
 * every row keeps the card's left/right edges, the first row alone keeps the
 * top edge, the last alone keeps the bottom -- stacked, they redraw the
 * source's single box with no horizontal lines through the middle. Radius
 * still transfers only to a lone row (MailCraft rounds all four corners, so
 * splitting it across rows would notch the card's sides).
 */
function applyFrame(rows, el) {
  if (!rows.length || !el || !el.style) return rows;
  const st = el.style;
  const { width, sides } = borderSidesOf(st);
  if (width) {
    const color = borderColorOf(st);
    rows.forEach((row, i) => {
      if (row.props.border) return;
      setRowBorder(row, width, {
        top: i === 0 ? sides.top : 0,
        bottom: i === rows.length - 1 ? sides.bottom : 0,
        left: sides.left,
        right: sides.right,
      }, color, borderStyleOf(st));
    });
  }
  if (rows.length === 1) {
    const radius = radiusOf(st);
    if (radius && !rows[0].props.radius) rows[0].props.radius = radius;
    // Shadow follows the radius rule -- one visual card, one shadow; split
    // across rows it would draw shadows through the card's middle.
    if (st.boxShadow && st.boxShadow !== 'none' && !rows[0].props.shadow) rows[0].props.shadow = st.boxShadow;
  }
  return rows;
}

function rowsFromContentTable(table) {
  const tableWidthPx = PX(table.getAttribute('width') || table.style.width || '0') || null;
  const trs = Array.from(table.querySelectorAll(':scope > tbody > tr, :scope > tr'));
  return trs.map((tr) => {
    // A synthetic marker row minted by foldLogicWrappers: one dynamic-content
    // marker block, at the exact place the tag held in the source.
    const logicTag = tr.getAttribute('data-mc-logic');
    if (logicTag) {
      const open = logicTag.match(/^#(if|each)\s+(.+)$/);
      const row = mkRow([100]);
      row.props.py = 4; row.props.px = 0; row.props.gap = 0;
      row.cols[0].blocks = [open
        ? blk(open[1] === 'if' ? 'condition' : 'loop', { expr: open[2].trim(), end: false })
        : blk(/\/if$/.test(logicTag) ? 'condition' : 'loop', { expr: '', end: true })];
      return row;
    }
    const outerCells = Array.from(tr.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH');
    if (!outerCells.length) return null;
    const bgSource = outerCells[0];
    let cells = outerCells;
    if (outerCells.length === 1) {
      // The table shape first, since it is unambiguous; the CSS-layout shape
      // only when there is no table row to read.
      const nested = unwrapNestedLayout(outerCells[0]);
      if (nested) cells = nested;
      else {
        const inline = inlineColumnGroup(outerCells[0].childNodes);
        if (inline) cells = inline;
      }
    }
    // Spacer columns: a content-free `<td>` (often `class="column gap"`,
    // holding only an empty fixed-width table) between real columns exists
    // purely to space them apart. Counted as a column it wrecks the spans
    // (50/50 + gap became thirds); recognized, it becomes the row's `gap`.
    let gapPx = 0;
    if (cells.length > 2) {
      const isGapCell = (td) => {
        if ((td.textContent || '').trim()) return false;
        if (td.querySelector('img,a,input,p,h1,h2,h3,h4,h5,h6,ul,ol')) return false;
        const w = PX(td.getAttribute('width') || (td.style && td.style.width) || '');
        return !w || w <= 30;
      };
      const kept = cells.filter((c) => !isGapCell(c));
      if (kept.length >= 2 && kept.length < cells.length) {
        cells.filter(isGapCell).forEach((g) => {
          const inner = g.querySelector('table');
          const w = PX((inner && (inner.getAttribute('width') || inner.style.width)) || g.getAttribute('width') || '');
          gapPx = Math.max(gapPx, w || 10);
        });
        cells = kept;
      }
    }
    // Gutter-as-padding: cells that all carry the identical pure-horizontal
    // padding (`0 Xpx` -- exactly what MailCraft's own export writes for a
    // column gap) describe a gap, not row padding. Recognizing it keeps
    // gap -> export -> import a fixed point instead of drifting into padding.
    let gutter = false;
    if (!gapPx && cells.length > 1) {
      const pads = cells.map((c) => paddingOf(c.style));
      const p0 = pads[0];
      gutter = !!(p0 && !p0.t && !p0.b && p0.l > 0 && p0.l === p0.r && p0.l <= 60
        && pads.every((pp) => pp && !pp.t && !pp.b && pp.l === p0.l && pp.r === p0.r));
      if (gutter) gapPx = p0.l * 2;
    }
    const spans = cells.length === 1 ? [100] : spansFromCells(cells, tableWidthPx);
    const row = mkRow(spans);
    row.props.py = 0; row.props.px = 0; row.props.gap = gapPx;
    // Background and frame can live on the first cell OR on the table itself
    // (builders style `table.row-content`, not its tds) -- read the cell
    // first, the table as fallback. Cell-derived values only count when every
    // cell agrees: a row of differently-colored card columns (pastel feature
    // grids) must not paint the whole row in the first card's color --
    // MailCraft has no per-column background, so those columns' colors are a
    // known loss rather than a wrong repaint.
    // Uniformity is judged among the cells THEMSELVES: after a nested-layout
    // unwrap, `bgSource` is the outer td (whose background legitimately wraps
    // the whole row) while `cells` are the inner columns -- comparing the two
    // wrongly read "non-uniform" and threw the row's own bg/padding away.
    const cellBg = bgOf(cells[0]);
    const cellsUniform = cells.every((c) => bgOf(c) === cellBg);
    // The bgSource fallback is for the nested-unwrap case only, where it's an
    // outer wrapper around all columns. When bgSource IS cells[0] (flat rows),
    // falling back to it would re-promote the first card's color to the row.
    const outerBg = cells.indexOf(bgSource) > -1 ? '' : bgOf(bgSource);
    // The tr between the cells and the table carries the legacy per-row
    // `bgcolor` old-school templates still set; it sits between the two in
    // specificity.
    const bg = (cellsUniform && cellBg) || bgOf(tr) || outerBg || bgOf(table);
    if (bg) row.props.bg = bg;
    // Differently-styled cells become per-column styling: each column keeps
    // its own background/radius/padding (the pastel-cards pattern).
    if (!cellsUniform) {
      cells.forEach((cell, i) => {
        const col = row.cols[i]; if (!col) return;
        const cbg = bgOf(cell); if (cbg) col.bg = cbg;
        const crad = radiusOf(cell.style); if (crad) col.radius = crad;
        const cframe = borderSidesOf(cell.style);
        if (cframe.width) {
          col.border = cframe.width;
          col.borderStyle = borderStyleOf(cell.style);
          col.lineColor = borderColorOf(cell.style) || '#e2e2e5';
        }
        const cpd = paddingOf(cell.style);
        if (cpd) { col.padY = cpd.py; col.padX = cpd.px; }
      });
    }
    // Read the border per side (the card idiom `border: 1px solid X;
    // border-bottom: none` keeps its exact shape now that rows support
    // per-side toggles), from the cell first, the table as fallback.
    const cellFrame = borderSidesOf(bgSource.style);
    const frameSrc = cellFrame.width ? bgSource.style : table.style;
    const frame = cellFrame.width ? cellFrame : borderSidesOf(table.style);
    if (frame.width) setRowBorder(row, frame.width, frame.sides, borderColorOf(frameSrc), borderStyleOf(frameSrc));
    const radius = (cellsUniform ? radiusOf(bgSource.style) : 0) || radiusOf(table.style);
    if (radius) row.props.radius = radius;
    const shadow = (cellsUniform ? bgSource.style.boxShadow : '') || table.style.boxShadow || '';
    if (shadow && shadow !== 'none') row.props.shadow = shadow;
    const bgiEl = (cellsUniform && bgImageOf(bgSource)) ? bgSource : (bgImageOf(table) ? table : null);
    if (bgiEl) applyBgImage([row], bgiEl);
    // The table itself can carry section padding (Beefree writes
    // `padding-top: 60px` on `.row-content`) on top of the cell's own -- the
    // two nest in the source, so they sum here.
    const tPad = paddingOf(table.style);
    // When cells differ, the first cell's padding just moved onto its own
    // column above -- counting it at row level too would double it up. A
    // detected gutter already became the row gap, so it must not double as
    // padding either -- but only when the gutter actually lives on bgSource
    // (the flat case); after a nested unwrap, bgSource is the outer td whose
    // padding is genuine row padding.
    const gutterOnBgSource = gutter && cells.indexOf(bgSource) > -1;
    const cPad = cellsUniform && !gutterOnBgSource ? paddingOf(bgSource.style) : null;
    if (tPad || cPad) {
      const z = { t: 0, b: 0, l: 0, r: 0 };
      const sum = ['t', 'b', 'l', 'r'].reduce((acc, k) => { acc[k] = ((tPad || z)[k] || 0) + ((cPad || z)[k] || 0); return acc; }, {});
      sum.py = Math.round((sum.t + sum.b) / 2);
      sum.px = Math.round((sum.l + sum.r) / 2);
      setRowPad(row, sum);
    }
    cells.forEach((cell, i) => {
      // A cell whose lone child is a background/radius-carrying div is the
      // "styled column" shape (MailCraft's own export writes it; other
      // builders use it too) -- hoist its styling onto the column and walk
      // its children, or the whole card collapses into one opaque text blob.
      let contentEl = cell;
      const lone = onlyChild(cell, 'DIV');
      if (lone && (bgOf(lone) || radiusOf(lone.style)) && !classifyNode(lone)) {
        const col = row.cols[i];
        if (col) {
          const cbg = bgOf(lone); if (cbg && !col.bg) col.bg = cbg;
          const crad = radiusOf(lone.style); if (crad && !col.radius) col.radius = crad;
          // The column's own border ships on this same wrapper (core/export.js
          // writes bg, border, radius and padding together); reading everything
          // but the border dropped a column frame on every save/reload.
          const cframe = borderSidesOf(lone.style);
          if (cframe.width && !col.border) {
            col.border = cframe.width;
            col.borderStyle = borderStyleOf(lone.style);
            col.lineColor = borderColorOf(lone.style) || '#e2e2e5';
          }
          const cpd = paddingOf(lone.style);
          if (cpd && col.padY === undefined) { col.padY = cpd.py; col.padX = cpd.px; }
        }
        contentEl = lone;
      }
      row.cols[i].blocks = blocksFromNodes(Array.from(contentEl.childNodes));
    });
    return row;
  }).filter((r) => r && r.cols.some((c) => c.blocks.length));
}

/**
 * Walks a list of sibling nodes and returns the ordered rows they represent.
 * Rather than picking one "best" table for the whole document (which breaks
 * the moment more than one section exists -- everything outside that table
 * silently vanished), this recurses through every layer of transparent
 * scaffolding -- a passthrough table, or a single-child `<div>`/`<center>`
 * wrapper that isn't itself a recognizable block -- to find each genuinely
 * content-bearing table, and expands each one into rows in document order.
 * "Transparent scaffolding" here means a passthrough table (see
 * `isPassthroughTable`) or a `<div>`/`<center>` that nests further
 * divs/tables and isn't itself a recognizable block (see
 * `looksLikeContainer`) -- not just a single-child wrapper, since real
 * builders often nest several section wrappers side by side under one
 * outer page wrapper. Runs of non-table content between/around them become
 * their own single-column rows via `blocksFromNodes`. A wrapper's own
 * background color and padding (common on a per-section `<div>`/table pair)
 * carry onto the rows it produces -- but only where a row doesn't already
 * have a more specific value of its own -- so a colored, padded banner
 * section survives even when it decomposes into several stacked rows,
 * without a deeper row's own real per-line padding getting overwritten by
 * its ancestor's.
 */
function collectRows(nodes) {
  /*
   * Before anything else: are these siblings one row's columns rather than a
   * sequence of sections? This has to be asked here, of the whole list, and
   * not inside the loop below -- that loop's job is to walk each structural
   * container in its own right, which is exactly what flattened a real 50/50
   * row into two stacked full-width ones. The relationship between the
   * siblings is only visible while they are still siblings.
   */
  const columns = inlineColumnGroup(nodes);
  if (columns) {
    // The resolved shares win over the inline widths: a CSS-layout column is
    // `width:100%` inline, so reading the elements again would score every
    // column at 100 and fall back to an even split -- right for 33/33/34,
    // wrong for 40/60.
    const row = mkRow(columns.shares ? normalizeSpans(columns.shares) : spansFromCells(columns, 0));
    row.props.py = 0; row.props.px = 0; row.props.gap = 0;
    columns.forEach((k, i) => {
      // A MailCraft column holds a flat list of blocks, so whatever the
      // column div decomposes into is flattened into it. Recursing through
      // collectRows rather than blocksFromNodes is what lets a column hold a
      // content table (the usual MJML shape) instead of one opaque blob.
      row.cols[i].blocks = blocksOfRows(collectRows(Array.from(k.childNodes)));
      const cbg = bgOf(k); if (cbg) row.cols[i].bg = cbg;
      const crad = radiusOf(k.style); if (crad) row.cols[i].radius = crad;
      const cpd = padOf(k); if (cpd) { row.cols[i].padY = cpd.py; row.cols[i].padX = cpd.px; }
    });
    // If nothing recognisable came out of it, it was not a row after all --
    // fall through and let the ordinary walk have it.
    if (row.cols.some((c) => c.blocks.length)) return [row];
  }
  const rows = [];
  let buf = [];
  const flushBuf = () => {
    const blocks = blocksFromNodes(buf);
    if (blocks.length) {
      const row = mkRow([100]);
      row.props.py = 0; row.props.px = 0; row.props.gap = 0;
      row.cols[0].blocks = blocks;
      rows.push(row);
    }
    buf = [];
  };
  nodes.forEach((n) => {
    if (n.nodeType === 8) return; // HTML comments (Outlook/MSO conditionals) -- inert
    if (n.nodeType === 1 && /^(SCRIPT|STYLE)$/.test(n.tagName)) return;
    if (n.nodeType === 1 && isHidden(n)) return;
    // A lone column: its blocks belong to one row, not one row each.
    if (n.nodeType === 1 && isColumnContainer(n) && !classifyNode(unwrapBoxDiv(n))) {
      flushBuf();
      const blocks = blocksOfRows(collectRows(Array.from(n.childNodes)));
      if (blocks.length) {
        const row = mkRow([100]);
        row.props.py = 0; row.props.px = 0; row.props.gap = 0;
        row.cols[0].blocks = blocks;
        rows.push(...applyBgImage(applyFrame(applyPad(applyBg([row], bgOf(n)), padOf(n)), n), n));
        return;
      }
    }
    if (n.nodeType === 1 && (n.tagName === 'DIV' || n.tagName === 'CENTER') && looksLikeContainer(n) && !classifyNode(unwrapBoxDiv(n))) {
      flushBuf();
      const inner = mergeBandRows(collectRows(Array.from(n.childNodes)), n);
      rows.push(...applyBgImage(applyFrame(applyPad(applyBg(inner, bgOf(n)), padOf(n)), n), n));
      return;
    }
    if (n.nodeType === 1 && n.tagName === 'TABLE') {
      if (n.closest('form,svg')) { buf.push(n); return; } // a form/svg's own table, not page layout -- leave for the html fallback
      // A social-icon table at row level must classify as one block BEFORE
      // the layout machinery sees it -- rowsFromContentTable would otherwise
      // shred it into one column per icon. Only the social classifier runs
      // here: the others (classifyTable especially) would misread genuine
      // layout tables that this walker exists to decompose.
      const social = classifySocial(n);
      if (social) {
        flushBuf();
        const row = mkRow([100]);
        row.props.py = 0; row.props.px = 0; row.props.gap = 0;
        // The strip's spacing lives on the td holding the icons; the social
        // block itself has no padding props, so it becomes the row's.
        const anchor = n.querySelector('a');
        const holder = anchor && anchor.closest ? anchor.closest('td') : null;
        const pd = holder ? paddingOf(holder.style) : null;
        if (pd) setRowPad(row, pd);
        row.cols[0].blocks = [social];
        rows.push(row);
        return;
      }
      if (isPassthroughTable(n)) {
        const tr = n.querySelector(':scope > tbody > tr, :scope > tr');
        const td = Array.from(tr.children).find((c) => c.tagName === 'TD' || c.tagName === 'TH');
        flushBuf();
        // The `height`-styled empty cell (a `&nbsp;` and nothing else) is the
        // table-email idiom for vertical space -- keep it as a spacer block
        // rather than letting the empty text run evaporate.
        const spacerH = PX(td.style.height);
        if (spacerH && !td.children.length && !(td.textContent || '').replace(/ /g, '').trim()) {
          const row = mkRow([100]);
          row.props.py = 0; row.props.px = 0; row.props.gap = 0;
          row.cols[0].blocks = [blk('spacer', { height: spacerH })];
          rows.push(row);
          return;
        }
        // The other table-email rule idiom: a content-free cell whose only
        // drawing is a `border-top` (Beefree's `td.divider_inner`, usually in
        // a width="20%" inner table). As a text run it imported as a junk row
        // holding one hair space; recognized, it is the divider it draws.
        const dSides = borderSidesOf(td.style);
        if (dSides.sides.top > 0 && dSides.sides.top <= 10
          && !dSides.sides.right && !dSides.sides.bottom && !dSides.sides.left
          && !bgOf(td) && !bgImageOf(td)
          && !Array.from(td.children).some((c) => c.tagName !== 'SPAN' && c.tagName !== 'BR')
          && !(td.textContent || '').replace(/\s/g, '')) {
          const dw = String(n.getAttribute('width') || n.style.width || '');
          const row = mkRow([100]);
          row.props.py = 0; row.props.px = 0; row.props.gap = 0;
          row.cols[0].blocks = [blk('divider', {
            thickness: dSides.sides.top,
            lineStyle: borderStyleOf(td.style),
            color: borderColorOf(td.style) || '#d9dade',
            width: dw.endsWith('%') ? PX(dw) : 100,
          })];
          rows.push(row);
          return;
        }
        const inner = mergeBandRows(mergeBandRows(collectRows(Array.from(td.childNodes)), td), n);
        // Frame styles live on the td for some builders and on the table
        // itself for others (`table.row-content` carries the card border) --
        // applyFrame fills only what's still unset, so trying both is safe.
        // The td is the more specific background-color source -- a dark hero
        // cell inside a white content table keeps its own color, not the
        // wrapper's (the image already reads td-first via the applyBgImage
        // order). The tr between them carries the legacy per-row bgcolor.
        rows.push(...applyBgImage(applyBgImage(applyFrame(applyFrame(applyPad(applyBg(inner, bgOf(td) || bgOf(tr) || bgOf(n)), padOf(td) || padOf(n) || cellPadOf(n)), td), n), td), n));
        return;
      }
      flushBuf();
      rows.push(...rowsFromContentTable(n));
      return;
    }
    buf.push(n);
  });
  flushBuf();
  return rows;
}

/**
 * Best-effort document theme, read off the source's own signals: the page
 * background from the body (or the outermost full-width wrapper, where email
 * builders usually put it), the content width as the most common fixed pixel
 * width among layout tables, and the font stack from the first styled element
 * that actually holds text. Without this, every import kept the previous
 * document's theme -- a DM Sans email on #F1F5F9 came back in the default
 * Georgia on the default parchment, which read as "the import broke".
 */
/**
 * A layout table's committed pixel width, however it declares one: the
 * `width` attribute, a `width` style, or -- for a responsive template -- the
 * `max-width` that caps a fluid `width:100%`.
 *
 * `max-width` is not a nicety. It is how this exporter now writes the content
 * column (`width:100%;max-width:620px`, so the email can narrow to a phone),
 * and it is the shape every other modern email builder emits too. Reading
 * only the fixed forms meant an export -> import round trip came back with no
 * `theme.width` at all and silently fell to the default. Returns 0 for a
 * purely proportional table, which the callers already skip.
 */
function fixedWidthOf(tb) {
  const w = tb.getAttribute('width') || (tb.style && tb.style.width) || '';
  if (w && !String(w).endsWith('%')) return PX(w);
  const cap = tb.style && tb.style.maxWidth;
  if (cap && !String(cap).endsWith('%')) return PX(cap);
  return 0;
}

/** A border present on some sides but not all, or a radius rounding some corners but not all -- the signature of one piece of a card that was drawn across several stacked tables, never of a standalone card. */
function partialFrame(st) {
  if (!st) return false;
  const { sides } = borderSidesOf(st);
  const on = ['top', 'right', 'bottom', 'left'].filter((k) => sides[k] > 0).length;
  const corners = String(st.borderRadius || '').split(/\s+/).map(PX);
  const uneven = corners.length > 1 && corners.some((v) => v > 0) && corners.some((v) => !v);
  return (on > 0 && on < 4) || uneven;
}

function themeFromParsedDoc(doc) {
  const theme = {};
  const body = doc.body;
  let bg = hexOf((body.style && (body.style.backgroundColor || body.style.background)) || body.getAttribute('bgcolor') || '');
  if (!bg) {
    const outer = body.querySelector('table');
    if (outer) bg = bgOf(outer) || (outer.querySelector('td') ? bgOf(outer.querySelector('td')) : '');
  }
  if (bg) theme.bg = bg;
  const widthCounts = {};
  body.querySelectorAll('table').forEach((tb) => {
    const px = fixedWidthOf(tb);
    if (px >= 320 && px <= 900) widthCounts[px] = (widthCounts[px] || 0) + 1;
  });
  const bestWidth = Object.keys(widthCounts).sort((a, b) => widthCounts[b] - widthCounts[a])[0];
  if (bestWidth) theme.width = Number(bestWidth);
  // Page padding and content shape, read off the same content table the
  // width vote just picked: the padding on the cell that centers it is the
  // band the template sits in, and the table's own radius is the content
  // column's corner. Without this an import flattened both, and the next
  // export silently squared the template off and closed the gap around it.
  if (bestWidth) {
    const content = Array.from(body.querySelectorAll('table')).find((tb) => fixedWidthOf(tb) === Number(bestWidth));
    if (content) {
      // Read before the frame is consumed below -- a fragment here means the
      // sibling tables hold the rest of the same card (see the pass further
      // down).
      const contentPartial = partialFrame(content.style);
      // The content column's own background -- including the literal
      // `transparent` the exporter always writes for a see-through column.
      // Without this the round trip lost it: export wrote
      // `background:transparent`, the import never read it back, and the
      // blank-doc default repainted the content area white on every
      // save/reload. Only an explicit value is taken, so a foreign email
      // whose content table declares nothing keeps the white default.
      const cbg = bgOf(content);
      if (cbg) theme.contentBg = cbg;
      const r = PX(content.style && content.style.borderRadius);
      if (r > 0) theme.radius = r;
      // The content column's full border, written by the exporter as a
      // `border` shorthand on the same table -- read back so it survives the
      // round trip like the radius above.
      const bw = content.style ? PX(content.style.borderWidth) || PX(content.style.borderTopWidth) : 0;
      if (bw > 0) {
        theme.borderW = bw;
        theme.borderStyle = borderStyleOf(content.style);
        theme.borderColor = borderColorOf(content.style) || '';
      }
      const sh = content.style && content.style.boxShadow;
      if (sh && sh !== 'none') theme.shadow = sh;
      // CLAIMED MEANS CONSUMED. These styles now live on the theme; leaving
      // them on the node let the row walker's card-folding (applyFrame /
      // applyPad) absorb the very same border, radius, shadow and page
      // padding into the rows -- so one save doubled every frame the user
      // had set at canvas level. htmlToDoc runs this pass before the row
      // pass for exactly this reason.
      if (content.style) {
        content.style.border = '';
        content.style.borderRadius = '';
        content.style.boxShadow = '';
      }
      const cell = content.closest ? content.closest('td') : null;
      if (cell && cell.style) {
        const padY = PX(cell.style.paddingTop);
        const padX = PX(cell.style.paddingLeft);
        if (padY > 0) theme.padY = padY;
        if (padX > 0) theme.padX = padX;
        cell.style.padding = '';
      }
      // A card drawn across several sibling content-width tables (top piece:
      // `border-radius:16px 16px 0 0; border-bottom:none`, middle pieces:
      // side borders only, bottom piece: `border-radius:0 0 16px 16px`) is
      // ONE visual frame -- the one just claimed. Left in place, the sibling
      // fragments imported as row borders inside the already-framed canvas:
      // doubled verticals down every row and a second rounded, shadowed box
      // around the last section. Only the split-card idiom trips this: the
      // claimed table must itself be a fragment (partial border or uneven
      // corners), and only fragments are stripped -- a template of genuinely
      // separate full cards has neither and is untouched. Horizontal edges
      // stay, since between two sections they read as a real separator; the
      // last fragment's bottom edge coincides with the frame's and goes.
      if (contentPartial) {
        const same = Array.from(body.querySelectorAll('table'))
          .filter((tb) => tb !== content && tb.style && fixedWidthOf(tb) === Number(bestWidth));
        same.forEach((tb, k) => {
          if (!partialFrame(tb.style)) return;
          tb.style.borderLeft = '';
          tb.style.borderRight = '';
          tb.style.borderRadius = '';
          tb.style.boxShadow = '';
          if (k === same.length - 1) tb.style.borderBottom = '';
        });
      }
    }
  }
  // The body's own family first: it is where this exporter writes the theme
  // font, and `querySelectorAll` never sees the body itself -- so the scan
  // below used to crown the *first block's* effective font instead, and one
  // custom-font heading at the top of a document flipped the whole theme on
  // reload. The element scan stays as the fallback for foreign emails that
  // declare nothing on the body, preferring the first *real* stack (has a
  // comma or quotes) over a lone generic keyword: builders wrap everything in
  // a `font-family:sans-serif` shim div with the actual `'DM Sans', Arial,
  // ...` declared a level deeper.
  const bodyFont = (body.style && body.style.fontFamily) || '';
  const fonts = Array.from(body.querySelectorAll('[style*="font-family"]'))
    .filter((el) => (el.textContent || '').trim())
    .map((el) => el.style.fontFamily)
    .filter(Boolean);
  const font = bodyFont || fonts.find((v) => /[,"']/.test(v)) || fonts[0];
  if (font) theme.font = font;
  // Link color: the most common inline anchor color -- skipping button
  // pills, whose (usually white) label color would otherwise dominate a
  // CTA-heavy email.
  const isPill = (a) => !!((a.style && (a.style.backgroundColor || a.style.background))
    || Array.from(a.querySelectorAll('span')).some((s) => s.style && (s.style.backgroundColor || s.style.background)));
  const linkCounts = {};
  body.querySelectorAll('a[style*="color"]').forEach((a) => {
    const c = a.style.color;
    // Only text links vote -- icon links (social strips) carry an icon
    // color, not the document's link color.
    if (!c || c === 'inherit' || !(a.textContent || '').trim() || isPill(a)) return;
    linkCounts[c] = (linkCounts[c] || 0) + 1;
  });
  const link = Object.keys(linkCounts).sort((a, b) => linkCounts[b] - linkCounts[a])[0];
  if (link) theme.link = hexOf(link);
  if (body.style && body.style.color) theme.text = hexOf(body.style.color);
  return theme;
}

/**
 * Dynamic-content tags that sit BETWEEN table rows (what the exporter writes
 * for marker rows, and what hand-written Handlebars emails do around a <tr>)
 * cannot survive DOMParser as-is: stray text inside a <table> is
 * foster-parented out of it, divorcing the tags from their position. So
 * before parsing, each row-adjacent tag becomes a synthetic marker <tr> of
 * its own (`data-mc-logic`), which rowsFromContentTable turns back into a
 * marker-block row at the same place in the document. Tags inside a cell are
 * legal text and are left alone -- `logicMarkersOf` classifies the bare ones
 * into marker blocks, and tags mixed into prose pass through as content,
 * exactly like merge tags. Looped because consecutive tags share adjacency
 * (an {{/each}} right before an {{/if}} only touches a <tr> once the
 * {{/if}} has been converted).
 */
function foldLogicWrappers(src) {
  let s = String(src);
  const rowFor = (tag) => '<tr data-mc-logic="' + tag.replace(/"/g, '&quot;') + '"><td></td></tr>';
  for (let i = 0; i < 6; i++) {
    const before = s;
    s = s.replace(/\{\{(#(?:if|each)\s+[^{}]+?|\/(?:if|each))\s*\}\}(?=\s*(?:<tr[\s>]|<\/table))/gi, (m, tag) => rowFor(tag));
    s = s.replace(/(<\/tr>\s*)\{\{(#(?:if|each)\s+[^{}]+?|\/(?:if|each))\s*\}\}/gi, (m, pre, tag) => pre + rowFor(tag));
    if (s === before) break;
  }
  return s;
}

/**
 * The exporter writes every inherited value as a concrete declaration
 * (`p.fontFamily || t.font`, `p.color || t.text`, a row's
 * `rp.bg || t.contentBg || 'transparent'`), so a round trip used to come back
 * with the theme stamped onto every block and row as an explicit override --
 * visually identical, but the inherit relationship was gone: a later theme
 * edit (font, text ink, content background) no longer reached anything. A
 * value that merely restates what the imported theme already says folds back
 * to "inherit"; anything genuinely different is a real override and stays.
 */
function foldThemeInherits(rows, theme) {
  const tFont = fontKey(theme.font);
  const tText = String(theme.text || '').toLowerCase();
  const cBg = String(theme.contentBg || '').toLowerCase();
  // Only the types whose renderer falls back `p.color || t.text` -- an empty
  // color means "theme ink" for exactly these; other blocks' colors are
  // structural (a button label, a divider line) and must stay explicit.
  const inheritsInk = { text: 1, heading: 1, list: 1 };
  rows.forEach((row) => {
    const bg = String(row.props.bg || '').toLowerCase();
    if (bg && bg === cBg) row.props.bg = '';
    row.cols.forEach((col) => {
      // A see-through column wrapper is the exporter's own scaffolding
      // (`background: transparent` is always written on a styled column),
      // never a chosen paint.
      if (String(col.bg || '').toLowerCase() === 'transparent') col.bg = '';
      col.blocks.forEach((b) => {
        if (tFont && b.props.fontFamily && fontKey(b.props.fontFamily) === tFont) b.props.fontFamily = '';
        if (tText && inheritsInk[b.type] && String(b.props.color || '').toLowerCase() === tText) b.props.color = '';
      });
    });
  });
}

/** Full import entry point: the rows plus the theme patch read from the same source. `theme` only carries keys the source actually declared -- the caller merges it over the current theme so unspecified fields keep their values. */
export function htmlToDoc(src) {
  let doc;
  try { doc = new DOMParser().parseFromString(foldLogicWrappers(src || ''), 'text/html'); } catch { return { rows: [], theme: {} }; }
  // Fold <style> rules into inline styles first, so class-styled templates
  // (never-inlined exports, hand-written emails) classify like inlined ones.
  // Best-effort: a pathological stylesheet must never block the import.
  try { inlineStylesheets(doc); } catch { /* proceed with inline styles only */ }
  // Theme first: themeFromParsedDoc consumes the styles it claims off the
  // scaffold nodes, and the row walker must see the cleaned DOM.
  const theme = themeFromParsedDoc(doc);
  const rows = collectRows(Array.from(doc.body.childNodes));
  foldThemeInherits(rows, theme);
  return { rows, theme };
}

export function htmlToRows(src) {
  return htmlToDoc(src).rows;
}
