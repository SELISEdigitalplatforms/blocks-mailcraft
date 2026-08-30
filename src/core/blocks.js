import { uid } from './ids.js';
import { PH } from './placeholder.js';
import { THEME } from './theme.js';

export const BLOCKS = [
  { type: 'text', code: 'TXT', label: 'Text', hint: 'Rich text — edit inline', make: () => ({ html: 'Hi {{ first_name }} — we cut three things from the fall line and kept the two that mattered. Here they are.', size: 16, lh: 1.6, color: '', align: 'left', weight: '400', py: 10, px: 0 }) },
  { type: 'image', code: 'IMG', label: 'Image', hint: 'Image from the library', make: () => ({ src: PH('hero image 600 × 320', 600, 320), alt: 'Hero image', width: 100, align: 'center', href: '', radius: 10, py: 0, px: 0 }) },
  { type: 'button', code: 'BTN', label: 'Button', hint: 'Call to action', make: () => ({ label: 'Shop the drop', href: 'https://example.com', bg: '#0065b3', color: '#ffffff', radius: 8, py: 13, px: 26, align: 'left', size: 15, full: false, borderW: 0, borderStyle: 'solid', borderColor: '' }) },
  { type: 'divider', code: 'DIV', label: 'Divider', hint: 'Horizontal rule', make: () => ({ thickness: 1, lineStyle: 'solid', color: '#e2e8f0', width: 100, py: 14 }) },
  { type: 'spacer', code: 'SPC', label: 'Spacer', hint: 'Vertical space', make: () => ({ height: 32 }) },
  { type: 'social', code: 'SOC', label: 'Social', hint: 'Social icon row', make: () => ({ items: 'Instagram|https://instagram.com\nX|https://x.com\nLinkedIn|https://linkedin.com\nYouTube|https://youtube.com', align: 'center', size: 20, gap: 12, color: '#0065b3', palette: 'custom', shape: 'outline', showLabel: false }) },
  { type: 'video', code: 'VID', label: 'Video', hint: 'Thumbnail + play badge', make: () => ({ src: PH('video thumbnail 600 × 330', 600, 330), href: 'https://example.com/watch', caption: 'Two minutes inside the workshop', badge: '#172033' }) },
  { type: 'html', code: 'HTM', label: 'HTML', hint: 'Raw HTML block', make: () => ({ code: '<p style="font:13px/1.6 ui-monospace,monospace;margin:0">&lt;!-- raw HTML passes through untouched --&gt;</p>' }) },
  { type: 'countdown', code: 'CDN', label: 'Countdown', hint: 'Live countdown', make: () => ({ target: new Date(Date.now() + 2.4 * 86400000).toISOString().slice(0, 16), label: 'Subscriber pricing ends in', color: '#172033' }) },
  { type: 'menu', code: 'NAV', label: 'Menu', hint: 'Navigation row', make: () => ({ items: 'New in|https://example.com/new\nOuterwear|https://example.com/outerwear\nArchive|https://example.com/archive', align: 'center', size: 12, gap: 20, color: '#172033' }) },
];
BLOCKS.push(
  { type: 'heading', code: 'HED', label: 'Heading', hint: 'Display heading', make: () => ({ text: 'What we kept', level: 'h2', size: 34, lh: 1.12, align: 'left', color: '', weight: '600', font: 'body', py: 8, px: 0 }) },
  { type: 'list', code: 'LST', label: 'List', hint: 'Bulleted or numbered list', make: () => ({ items: 'Import your list\nPick a template\nSend the first one', ordered: false, size: 15, lh: 1.7, color: '', gap: 4, py: 8, px: 0 }) },
  { type: 'table', code: 'TBL', label: 'Table', hint: 'Data table — edit cells inline', make: () => ({ data: 'Plan|Price|Seats\nStarter|$19|3\nTeam|$49|10\nStudio|$99|25', header: true, borders: true, borderWidth: 1, borderStyle: 'solid', striped: true, pad: 10, size: 14, headBg: '#f8fafc', lineColor: '#e2e8f0', align: 'left', width: 100 }) },
  { type: 'embed', code: 'EMB', label: 'Embed', hint: 'Iframe embed — map, form, player', make: () => ({ src: 'https://example.com/embed', height: 320, label: 'Embedded content', py: 8 }) },
  { type: 'css', code: 'CSS', label: 'Raw CSS', hint: 'Inject a style block', make: () => ({ code: '.mc-note { font: 13px/1.6 "Helvetica Neue", Helvetica, Arial, sans-serif; color: #0065b3; letter-spacing: 0.04em; }', note: 'Styles apply to raw HTML blocks below.' }) },
  { type: 'codeblock', code: 'PRE', label: 'Code', hint: 'Preformatted code sample', make: () => ({ code: 'curl -X POST https://api.example.com/v1/sends \\\n  -H "Authorization: Bearer $KEY" \\\n  -d campaign=mc-4471', bg: '#172033', color: '#e8e9ea', size: 12.5, pad: 14 }) },
);
BLOCKS.push(
  { type: 'box', code: 'BOX', label: 'Section box', hint: 'Styled container with free content', make: () => ({ html: '<strong style="font-size:19px;display:block;margin-bottom:6px">Section title</strong>Drop copy here, or paste markup. The box takes background, padding, border and radius.', bg: '#f8fafc', bgImage: '', border: 1, borderStyle: 'solid', lineColor: '#e2e8f0', topBorder: true, rightBorder: true, bottomBorder: true, leftBorder: true, radius: 12, pad: 22, align: 'left', minH: 0, maxW: 100, shadow: false }) },
  { type: 'svg', code: 'SVG', label: 'Inline SVG', hint: 'Paste SVG markup', make: () => ({ code: '<svg viewBox="0 0 120 40" width="120" height="40" fill="none" stroke="#0065b3" stroke-width="1.5"><rect x="0.75" y="0.75" width="118.5" height="38.5"/><path d="M12 28l14-16 12 10 10-8 18 14"/></svg>', align: 'left', width: 100, py: 10 }) },
);

export const DEF = (t) => BLOCKS.find((b) => b.type === t);
export const mk = (t) => ({ id: uid(), type: t, props: DEF(t).make() });
export const blk = (type, over) => { const b = mk(type); Object.assign(b.props, over || {}); return b; };

export const LAYOUTS = [
  { spans: [100], label: '1 col' },
  { spans: [50, 50], label: '50 / 50' },
  { spans: [33, 67], label: '33 / 67' },
  { spans: [67, 33], label: '67 / 33' },
  { spans: [33, 34, 33], label: '3 col' },
  { spans: [25, 25, 25, 25], label: '4 col' },
];

export const mkRow = (spans, blocks) => ({
  id: uid(),
  props: {
    bg: '', bgImage: '', bgSize: 'cover', bgPos: 'center', bgRepeat: 'no-repeat', overlay: 0,
    border: 0, borderStyle: 'solid', lineColor: '#e2e2e5', bTop: true, bRight: true, bBottom: true, bLeft: true, radius: 0, shadow: '', maxW: 100,
    mt: 0, mr: 0, mb: 0, ml: 0,
    layout: 'columns', flexDir: 'row', justify: 'flex-start', alignItems: 'stretch', wrap: true, gridCols: 2,
    py: 20, px: 24, padSplit: false, gap: 20, valign: 'top', stackMobile: true,
  },
  cols: spans.map((s, i) => ({ id: uid(), span: s, blocks: i === 0 && blocks ? blocks : [] })),
});

export const groupRows = (id) => (GROUPS[id] ? GROUPS[id].build() : []);

/** Compound presets: `build()` returns full row(s) built from ordinary blocks -- once inserted, a group is indistinguishable from any other row/blocks (no groupId persists), so every part stays individually selectable and editable. */
export const GROUPS = {
  hero: {
    label: 'Hero', icon: 'hero',
    build: () => {
      const row = mkRow([100]);
      Object.assign(row.props, { py: 56, px: 36, bgImage: PH('hero background 1200 × 560', 1200, 560), overlay: 46, gap: 0 });
      row.cols[0].blocks = [
        blk('text', { html: 'AUTUMN 2026', size: 11, align: 'center', color: '#ffffff', py: 0 }),
        blk('heading', { text: 'Built for the long haul', size: 44, align: 'center', color: '#ffffff', py: 10 }),
        blk('text', { html: 'Waxed cotton, storm cuffs, and a repair promise that outlives the season.', size: 15, align: 'center', color: '#ffffff', py: 4 }),
        blk('button', { label: 'Shop the drop', align: 'center', bg: '#ffffff', color: '#172033', radius: 8 }),
      ];
      return [row];
    },
  },
  card: {
    label: 'Card', icon: 'card',
    build: () => {
      const row = mkRow([100]);
      Object.assign(row.props, { bg: '#f8fafc', border: 1, lineColor: '#e2e8f0', radius: 12, py: 0, px: 0, gap: 0 });
      row.cols[0].blocks = [
        blk('image', { src: PH('card image 520 × 300', 520, 300), alt: 'Inside the workshop', py: 0, px: 0 }),
        blk('heading', { text: 'Inside the workshop', size: 22, py: 16, px: 20 }),
        blk('text', { html: 'Three benches, two machines, and a rule about finishing what you start.', size: 13.5, py: 0, px: 20 }),
        blk('button', { label: 'Read the story', bg: '#0065b3', color: '#ffffff', size: 13, py: 10, px: 18, align: 'left' }),
      ];
      return [row];
    },
  },
  product: {
    label: 'Product', icon: 'product',
    build: () => {
      const row = mkRow([45, 55]);
      Object.assign(row.props, { valign: 'middle', py: 16 });
      row.cols[0].blocks = [blk('image', { src: PH('product shot 520 × 520', 520, 520), alt: 'Field Jacket 03', py: 0, px: 0 })];
      row.cols[1].blocks = [
        blk('heading', { text: 'Field Jacket 03', size: 26, py: 0 }),
        blk('text', { html: '<strong>$248</strong> — waxed cotton, storm cuffs, cut and sewn in Portugal.', size: 14, py: 8 }),
        blk('button', { label: 'View product' }),
      ];
      return [row];
    },
  },
  stats: {
    label: 'Stats', icon: 'stats',
    build: () => {
      const row = mkRow([33, 34, 33]);
      Object.assign(row.props, { py: 22, gap: 8 });
      [['12k', 'Subscribers'], ['41%', 'Open rate'], ['8.2%', 'Click rate']].forEach((pair, i) => {
        row.cols[i].blocks = [
          blk('heading', { text: pair[0], size: 32, align: 'center', color: '#0065b3', py: 0 }),
          blk('text', { html: pair[1].toUpperCase(), size: 11, align: 'center', py: 4 }),
        ];
      });
      return [row];
    },
  },
  quote: {
    label: 'Quote', icon: 'quote',
    build: () => {
      const row = mkRow([100]);
      Object.assign(row.props, { py: 18, gap: 0 });
      row.cols[0].blocks = [
        blk('text', { html: '<em>“It shipped in a week and nobody asked me for a spec.”</em>', size: 19, lh: 1.45, py: 0 }),
        blk('text', { html: 'RAE OKONKWO, FOUNDRY SUPPLY', size: 11, py: 6 }),
      ];
      return [row];
    },
  },
  gallery: {
    label: 'Gallery', icon: 'gallery',
    build: () => {
      const row = mkRow([50, 50]);
      Object.assign(row.props, { py: 10, gap: 10 });
      row.cols[0].blocks = [
        blk('image', { src: PH('image 01', 400, 300), alt: '', py: 0, px: 0 }),
        blk('image', { src: PH('image 03', 400, 300), alt: '', py: 10, px: 0 }),
      ];
      row.cols[1].blocks = [
        blk('image', { src: PH('image 02', 400, 300), alt: '', py: 0, px: 0 }),
        blk('image', { src: PH('image 04', 400, 300), alt: '', py: 10, px: 0 }),
      ];
      return [row];
    },
  },
  footer: {
    label: 'Footer', icon: 'footer',
    build: () => {
      const row = mkRow([100]);
      Object.assign(row.props, { py: 22, gap: 0 });
      row.cols[0].blocks = [
        blk('divider', { py: 0 }),
        blk('social', { align: 'center', size: 18, shape: 'bare' }),
        blk('text', { html: '<strong>MailCraft, Inc.</strong><br />220 Foundry Street, Suite 4, Portland OR 97209<br />You are receiving this because you signed up at mailcraft.co.', size: 11.5, align: 'center', py: 6 }),
        blk('text', { html: '<a href="{{ unsubscribe_url }}">Unsubscribe</a> · <a href="#">Update preferences</a>', size: 11.5, align: 'center', py: 0 }),
      ];
      return [row];
    },
  },
};

export const PALETTE = [
  { t: 'heading' }, { t: 'text' }, { t: 'list' }, { g: 'quote' }, { t: 'image' }, { g: 'gallery' },
  { t: 'button' }, { t: 'table' }, { g: 'card' }, { g: 'product' }, { g: 'hero' }, { g: 'stats' },
  { t: 'box' }, { t: 'divider' }, { t: 'spacer' }, { t: 'social' }, { t: 'video' },
  { t: 'embed' }, { t: 'menu' }, { g: 'footer' }, { t: 'html' }, { t: 'css' }, { t: 'svg' },
  { t: 'codeblock' }, { t: 'countdown' },
];

/** Documents saved before compound components became groups of ordinary blocks carry retired block types -- rebuild each from its own props so nothing is lost. */
export const LEGACY = {
  hero: (p) => [
    blk('text', { html: p.kicker || '', size: 11, align: p.align || 'center', color: p.color || '#ffffff', py: 0 }),
    blk('heading', { text: p.title || '', size: 40, align: p.align || 'center', color: p.color || '#ffffff', py: 10 }),
    blk('text', { html: p.sub || '', size: 15, align: p.align || 'center', color: p.color || '#ffffff', py: 4 }),
    blk('button', { label: p.cta || 'Learn more', href: p.href || '#', align: p.align || 'center', bg: p.color || '#ffffff', color: '#1d1f20' }),
  ],
  card: (p) => [
    blk('image', { src: p.src, alt: p.title || '', py: 0, px: 0 }),
    blk('heading', { text: p.title || '', size: 22, py: 14, px: 0 }),
    blk('text', { html: p.desc || '', size: 13.5, py: 0 }),
    blk('button', { label: p.cta || 'Read more', href: p.href || '#', size: 13, py: 10, px: 18 }),
  ],
  product: (p) => [
    blk('image', { src: p.src, alt: p.title || '', py: 0, px: 0 }),
    blk('heading', { text: p.title || '', size: 24, py: 10 }),
    blk('text', { html: '<strong>' + (p.price || '') + '</strong> — ' + (p.desc || ''), size: 14, py: 6 }),
    blk('button', { label: p.cta || 'View product', href: p.href || '#' }),
  ],
  stats: (p) => String(p.items || '').split('\n').filter(Boolean).reduce((acc, line) => {
    const parts = line.split('|');
    return acc.concat([
      blk('heading', { text: parts[0] || '', size: 30, align: 'center', color: p.accent || '#5980a6', py: 0 }),
      blk('text', { html: String(parts[1] || '').toUpperCase(), size: 11, align: 'center', py: 4 }),
    ]);
  }, []),
  quote: (p) => [
    blk('text', { html: '<em>“' + (p.text || '') + '”</em>', size: p.size || 19, lh: 1.45, py: 0 }),
    blk('text', { html: String(p.cite || '').toUpperCase(), size: 11, py: 6 }),
  ],
  gallery: (p) => {
    const list = String(p.images || '').split('\n').map((l) => l.trim()).filter(Boolean);
    return (list.length ? list : [PH('image 01', 400, 300), PH('image 02', 400, 300)]).map((src) => blk('image', { src, alt: '', py: 6, px: 0 }));
  },
  grid: (p) => String(p.cells || '').split(/\n\s*\n/).map((c) => c.trim()).filter(Boolean).map((c) => blk('text', { html: c, size: 14, py: 6 })),
  footer: (p) => [
    blk('divider', { py: 0 }),
    blk('text', { html: '<strong>' + (p.company || '') + '</strong><br />' + (p.address || '') + '<br />' + (p.note || ''), size: 11.5, align: 'center', py: 6 }),
    blk('text', { html: '<a href="{' + '{ unsubscribe_url }}">' + (p.unsub || 'Unsubscribe') + '</a> · <a href="#">' + (p.pref || 'Update preferences') + '</a>', size: 11.5, align: 'center', py: 0 }),
  ],
};

/** Documents saved when compound components were first-class block types get converted on load; rows left with zero blocks after conversion are dropped, but rows the user left empty on purpose are preserved. */
/**
 * The document a fresh editor opens on: one empty row, default theme.
 *
 * Deliberately not a sample template. Template galleries belong to the host's
 * own UI (pushed in via `editor.loadTemplate`), so booting into a built-in
 * marketing layout would both pull a template catalogue into every bundle and
 * put content in a host's editor that they never chose.
 */
export const blankDoc = () => ({ theme: THEME(), rows: [mkRow([100])] });

export function migrateDoc(doc) {
  const defaults = mkRow([100]).props;
  const emptied = [];
  (doc.rows || []).forEach((r) => {
    const hadBlocks = r.cols.some((c) => c.blocks.length);
    // Outside spacing used to be one vertical `my` value. Seed the complete
    // four-side model before defaults are applied so old documents keep their
    // top/bottom spacing and gain neutral left/right values.
    const legacyMarginY = r.props.my ?? 0;
    if (r.props.mt === undefined) r.props.mt = legacyMarginY;
    if (r.props.mr === undefined) r.props.mr = 0;
    if (r.props.mb === undefined) r.props.mb = legacyMarginY;
    if (r.props.ml === undefined) r.props.ml = 0;
    r.cols.forEach((c) => {
      c.blocks = c.blocks.reduce((acc, b) => {
        if (DEF(b.type)) return acc.concat(b);
        const conv = LEGACY[b.type];
        return conv ? acc.concat(conv(b.props || {})) : acc;
      }, []);
      // `social.shape` used to have a 'solid' value meaning "filled badge, no
      // particular shape" -- now that shape is split into 'circle'/'square'
      // badges, an old 'solid' document reads as the (arbitrary but stable)
      // 'square' choice rather than silently becoming an unrecognized value.
      c.blocks.forEach((b) => { if (b.type === 'social' && b.props.shape === 'solid') b.props.shape = 'square'; });
    });
    Object.keys(defaults).forEach((k) => { if (r.props[k] === undefined) r.props[k] = defaults[k]; });
    if (hadBlocks && !r.cols.some((c) => c.blocks.length)) emptied.push(r.id);
  });
  doc.rows = (doc.rows || []).filter((r) => emptied.indexOf(r.id) < 0);
  return doc;
}
