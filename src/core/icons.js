/**
 * Thin-stroke icon set, stroke 1.5 on a 24 grid. The shapes are this
 * project's own, carried over path-for-path from its earlier prototype;
 * the thin-stroke grammar follows the convention Lucide popularised, but
 * no path data is taken from Lucide or any other set. Keep it that way --
 * new glyphs get drawn here, not pasted in.
 */
const ICONS = {
  text: ['M4 6h16', 'M4 12h12', 'M4 18h9'],
  image: [['rect', 3, 4, 18, 16], ['circle', 8.5, 9.5, 1.5], 'M3 17l5-5 4 4 3-3 6 6'],
  folder: ['M3 7h7l2 2h9v10H3z', 'M3 7V5h7l2 2'],
  button: [['rect', 3, 8, 18, 8], 'M8 12h8'],
  divider: ['M3 12h18', 'M6 7h12', 'M6 17h12'],
  spacer: ['M3 5h18', 'M3 19h18', 'M12 9v6', 'M9.5 11.5L12 9l2.5 2.5', 'M9.5 12.5L12 15l2.5-2.5'],
  social: [['rect', 3, 9, 5, 6], ['rect', 9.5, 9, 5, 6], ['rect', 16, 9, 5, 6]],
  video: [['rect', 3, 5, 18, 14], 'M10 9.5l5 2.5-5 2.5z'],
  html: ['M9 8l-4 4 4 4', 'M15 8l4 4-4 4'],
  product: [['rect', 3, 6, 18, 14], 'M3 11h18', 'M9 6v5'],
  countdown: [['circle', 12, 13, 8], 'M12 9.5V13l2.5 1.5', 'M9 3h6'],
  menu: [['rect', 3, 4, 18, 5], 'M6 14h5', 'M13 14h5', 'M6 18h12'],
  grip: [['circle', 9, 7, 1], ['circle', 15, 7, 1], ['circle', 9, 12, 1], ['circle', 15, 12, 1], ['circle', 9, 17, 1], ['circle', 15, 17, 1]],
  move: ['M12 3v18', 'M3 12h18', 'M9.5 5.5L12 3l2.5 2.5', 'M9.5 18.5L12 21l2.5-2.5', 'M5.5 9.5L3 12l2.5 2.5', 'M18.5 9.5L21 12l-2.5 2.5'],
  sliders: ['M4 7h9', 'M19 7h1', ['circle', 16, 7, 2.2], 'M4 17h3', 'M13 17h7', ['circle', 10, 17, 2.2]],
  footer: [['rect', 3, 4, 18, 16], 'M3 15h18', 'M7 19h6'],
  up: ['M12 19V5', 'M6 11l6-6 6 6'],
  down: ['M12 5v14', 'M6 13l6 6 6-6'],
  copy: [['rect', 9, 9, 12, 12], 'M15 5H5a2 2 0 0 0-2 2v10'],
  trash: ['M4 7h16', 'M9 7V5h6v2', 'M6 7l1 12h10l1-12'],
  undo: ['M3 8h11a5 5 0 0 1 0 10H8', 'M7 4L3 8l4 4'],
  redo: ['M21 8H10a5 5 0 0 0 0 10h6', 'M17 4l4 4-4 4'],
  eye: ['M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z', ['circle', 12, 12, 3]],
  monitor: [['rect', 3, 4, 18, 13], 'M8 21h8', 'M12 17v4'],
  phone: [['rect', 7, 2, 10, 20], 'M10.5 5h3', 'M11.5 19h1'],
  download: ['M12 4v11', 'M7.5 11L12 15.5 16.5 11', 'M4 20h16'],
  upload: ['M12 20V9', 'M7.5 13.5L12 9l4.5 4.5', 'M4 4h16'],
  moon: ['M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z'],
  sun: [['circle', 12, 12, 4.2], 'M12 3v2', 'M12 19v2', 'M3 12h2', 'M19 12h2', 'M5.6 5.6l1.4 1.4', 'M17 17l1.4 1.4', 'M18.4 5.6L17 7', 'M7 17l-1.4 1.4'],
  spark: ['M12 4l1.7 4.8L18.5 10.5l-4.8 1.7L12 17l-1.7-4.8L5.5 10.5l4.8-1.7z', 'M18 17l.8 2.2L21 20l-2.2.8L18 23l-.8-2.2L15 20l2.2-.8z'],
  code: ['M8 7l-5 5 5 5', 'M16 7l5 5-5 5', 'M13 5l-2 14'],
  bold: ['M7 5h6a3.5 3.5 0 0 1 0 7H7z', 'M7 12h7a3.5 3.5 0 0 1 0 7H7z'],
  italic: ['M15 5h-4', 'M13 19H9', 'M14 5l-3 14'],
  underline: ['M7 4v7a5 5 0 0 0 10 0V4', 'M6 20h12'],
  strike: ['M4 12h16', 'M8 7a4 3 0 0 1 8 0', 'M8 16a4 3 0 0 0 8 0'],
  link: ['M10 13a4 4 0 0 0 6 .5l2-2a4 4 0 0 0-5.5-5.5l-1 1', 'M14 11a4 4 0 0 0-6-.5l-2 2A4 4 0 0 0 11.5 18l1-1'],
  list: ['M9 6h11', 'M9 12h11', 'M9 18h11', 'M4.5 6h.6', 'M4.5 12h.6', 'M4.5 18h.6'],
  clear: ['M6 6l12 12', 'M18 6L6 18'],
  tag: ['M4 8h4', 'M4 16h4', 'M20 8h-4', 'M20 16h-4', 'M10 5l4 14'],
  play: ['M8 5.5l10 6.5-10 6.5z'],
  pause: ['M9.5 5v14', 'M14.5 5v14'],
  refresh: ['M20 11a8 8 0 1 0-2.3 6.3', 'M20 5v6h-6'],
  check: ['M4 12.5l5 5L20 7'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  superscript: ['M4 18 9 6l5 12', 'M6 14h6', 'M16 5h4l-4 5h4'],
  subscript: ['M4 16 9 4l5 12', 'M6 12h6', 'M16 15h4l-4 5h4'],
  typeColor: ['M5 18 11 5h2l6 13', 'M7.5 13h9', 'M4 21h16'],
  highlighter: ['M7 15 16 6l3 3-9 9z', 'M5 17l2 2', 'M4 21h16'],
  eraser: ['M4 16 13 7l5 5-8 8H6z', 'M12 20h8'],
  formatClear: ['M5 18 11 5h2l4 9', 'M7.5 13h7', 'M16 17l5 5', 'M21 17l-5 5'],
  chevronDown: ['M7 9l5 5 5-5'],
  x: ['M4 4l16 16', 'M20 4L4 20'],
  xSocial: [['rect', 3, 3, 18, 18], 'M8.5 8.5l7 7', 'M15.5 8.5l-7 7'],
  instagram: [['rect', 3, 3, 18, 18], ['circle', 12, 12, 4], ['circle', 17, 7, 0.9]],
  linkedin: [['rect', 3, 3, 18, 18], 'M8 10v7', ['circle', 8, 7.2, 0.9], 'M12 17v-4a2.5 2.5 0 0 1 5 0v4'],
  facebook: [['rect', 3, 3, 18, 18], 'M15 8h-1.5A2.5 2.5 0 0 0 11 10.5V21', 'M8.5 13h5'],
  youtube: [['rect', 2.5, 6, 19, 12], 'M11 10l4 2-4 2z'],
  mail: [['rect', 3, 5, 18, 14], 'M3 7l9 6 9-6'],
  mailSpark: [['rect', 3, 6, 16, 12], 'M4 8l7 5 7-5', 'M21 3v4', 'M19 5h4'],
  globe: [['circle', 12, 12, 9], 'M3 12h18', 'M12 3a15 15 0 0 1 0 18', 'M12 3a15 15 0 0 0 0 18'],
  heading: ['M6 5v14', 'M18 5v14', 'M6 12h12'],
  quote: [['rect', 4, 6, 5, 5], ['rect', 15, 6, 5, 5], 'M9 11c0 4-1.7 5.7-5 6.4', 'M20 11c0 4-1.7 5.7-5 6.4'],
  table: [['rect', 3, 4, 18, 16], 'M3 9h18', 'M3 14.5h18', 'M9 9v11', 'M15 9v11'],
  card: [['rect', 3, 4, 18, 16], 'M3 12h18', 'M7 16h8'],
  hero: [['rect', 3, 4, 18, 16], 'M6 11h12', 'M6 15h6', ['rect', 14.5, 13.5, 4, 3]],
  stats: ['M5 19v-7', 'M12 19V5', 'M19 19v-4', 'M3 19h18'],
  gallery: [['rect', 3, 4, 7.5, 7.5], ['rect', 13.5, 4, 7.5, 7.5], ['rect', 3, 12.5, 7.5, 7.5], ['rect', 13.5, 12.5, 7.5, 7.5]],
  css: ['M5 4h14l-1.5 15L12 21l-5.5-2z', 'M8.5 9h7', 'M9 13h5'],
  codeblock: [['rect', 3, 4, 18, 16], 'M9.5 10l-2 2 2 2', 'M14.5 10l2 2-2 2'],
  data: ['M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z', 'M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6', 'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'],
  condition: ['M12 4v5', 'M12 9c0 4-5.5 3-5.5 9', 'M12 9c0 4 5.5 3 5.5 9', 'M4.5 15.5L6.5 18l2-2.5', 'M15.5 15.5l2 2.5 2-2.5'],
  loop: ['M17 3l4 4-4 4', 'M3 11V9a2 2 0 0 1 2-2h16', 'M7 21l-4-4 4-4', 'M21 13v2a2 2 0 0 1-2 2H3'],
  box: [['rect', 3, 4, 18, 16], ['rect', 7, 8, 10, 8]],
  grid: [['rect', 3, 5, 8, 14], ['rect', 13, 5, 8, 14]],
  svg: ['M4 19L10 5l4 9 2-3 4 8z', ['circle', 7.5, 7.5, 2]],
  form: [['rect', 3, 5, 18, 5], ['rect', 3, 13, 11, 5], 'M17 15.5h4'],
  script: ['M9 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h3', 'M15 5h3a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-3', 'M13 8l-2 8'],
  anchor: [['circle', 12, 6, 2.5], 'M12 8.5V20', 'M5 14a7 7 0 0 0 14 0'],
  paint: ['M5 11V6a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v5H5z', 'M5 11h13', 'M11 11v4', 'M9 15h4v5H9z'],
  alignLeft: ['M4 6h16', 'M4 12h10', 'M4 18h13'],
  alignCenter: ['M4 6h16', 'M7 12h10', 'M6 18h12'],
  alignRight: ['M4 6h16', 'M10 12h10', 'M7 18h13'],
  alignJustify: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  listOrdered: ['M9 6h11', 'M9 12h11', 'M9 18h11', 'M4 5.5h1.5V9', 'M4 15h2v3H4'],
  indent: ['M11 6h9', 'M11 12h9', 'M11 18h9', 'M4 9l3 3-3 3'],
  search: [['circle', 11, 11, 6.5], 'M15.8 15.8L21 21'],
  wrap: ['M4 6h16', 'M4 12h11.5a3.25 3.25 0 0 1 0 6.5H13', 'M15.5 16l-2.5 2.5 2.5 2.5', 'M4 18h5'],
  outdent: ['M11 6h9', 'M11 12h9', 'M11 18h9', 'M7 9l-3 3 3 3'],
  unlink: ['M10 13a4 4 0 0 0 4.6 1.4', 'M14 11a4 4 0 0 0-4.6-1.4', 'M4 4l16 16'],
  inlineCode: ['M8.5 9l-3 3 3 3', 'M15.5 9l3 3-3 3'],
  tiktok: [['circle', 9, 16, 3], 'M12 16V4', 'M12 6c1.5 1.5 3 2 5 2v2'],
  pinterest: [['circle', 12, 12, 9], 'M9 16c1-2 1.5-4 2-7a2.2 2.2 0 1 1 4.4 0.3c-0.2 2-1.4 3.7-3.4 3.7'],
  snapchat: ['M12 4c3 0 5 2.2 5 5.2 0 1 0.2 2 0.8 2.6 0.6 0.6 1.2 0.8 1.2 1.4 0 0.8-1 1-1.8 1.2-0.2 1 0.4 1.6 1.4 1.8-0.2 0.8-1.4 1-2.2 1-0.6 1.6-2 2.6-4.4 2.6s-3.8-1-4.4-2.6c-0.8 0-2-0.2-2.2-1 1-0.2 1.6-0.8 1.4-1.8-0.8-0.2-1.8-0.4-1.8-1.2 0-0.6 0.6-0.8 1.2-1.4 0.6-0.6 0.8-1.6 0.8-2.6C7 6.2 9 4 12 4z'],
  whatsapp: [['circle', 12, 12, 9], 'M8.5 15.5l0.8-2.8a5 5 0 1 1 2.9 2.6z'],
  threads: ['M8 8c-2 1-3 3-3 5.5 0 3.5 2.5 5.5 6 5.5 3 0 5-1.5 5-4 0-1.8-1.2-3-3-3.3 1.3-0.3 2.2-1.2 2.2-2.5 0-1.8-1.7-3-4-3-2 0-3.3 0.8-4 2'],
  discord: ['M7 8c3-1.3 7-1.3 10 0', 'M6 9c-1.5 3-2 6-1.5 8.5 1.8 1.3 3.5 2 3.5 2l1-1.7c-0.6-0.2-1.2-0.5-1.7-0.8', 'M18 9c1.5 3 2 6 1.5 8.5-1.8 1.3-3.5 2-3.5 2l-1-1.7c0.6-0.2 1.2-0.5 1.7-0.8', ['circle', 9, 13, 1.1], ['circle', 15, 13, 1.1]],
  telegram: [['circle', 12, 12, 9], 'M7.5 12.3l9-4.3-3 9-2.3-3.2-2 1.7-0.2-2.7z'],
  reddit: [['circle', 12, 14, 6], 'M12 8V5', ['circle', 12, 4.3, 0.9], ['circle', 9.5, 14, 1], ['circle', 14.5, 14, 1], 'M9 17c1 1 5 1 6 0'],
  spotify: [['circle', 12, 12, 9], 'M7.5 10c3-1 6-1 9 0', 'M7.8 13c2.5-0.8 5-0.8 7.5 0', 'M8.2 16c2-0.6 4-0.6 6 0'],
  behance: ['M4 7h6a2.5 2.5 0 0 1 0 5H4z', 'M4 12h6.5a2.7 2.7 0 0 1 0 5.4H4z', 'M14 12a4 4 0 0 1 8 0', 'M14 14h8', 'M15.5 9h5'],
  dribbble: [['circle', 12, 12, 9], 'M4 10c4 1.2 12 1.2 16.5 0', 'M8.5 4.5c2.5 3 5 8.5 5 14.5', 'M9 20c2-4 7-6 11.5-5'],
};


/** One representative brand hex per platform, for the social block's "Brand" palette mode. Flat approximations, not exact brand-guideline swatches. */
export const SOCIAL_BRAND = {
  instagram: '#E1306C', facebook: '#1877F2', linkedin: '#0A66C2', youtube: '#FF0000',
  x: '#0F1419', mail: '#6B6F73', globe: '#6B6F73',
  tiktok: '#111111', pinterest: '#E60023', snapchat: '#FFFC00', whatsapp: '#25D366',
  threads: '#101010', discord: '#5865F2', telegram: '#26A5E4', reddit: '#FF4500',
  spotify: '#1DB954', behance: '#1769FF', dribbble: '#EA4C89',
};

/** Perceived-luminance black/white pick for text or an icon drawn on top of a `hex` fill -- keeps brand-colored badges (some of which are very light, e.g. Snapchat yellow) legible without a per-platform ink override table. */
export function contrastInk(hex) {
  const h = String(hex || '').replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  const r = parseInt(n.slice(0, 2), 16) || 0;
  const g = parseInt(n.slice(2, 4), 16) || 0;
  const b = parseInt(n.slice(4, 6), 16) || 0;
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma > 0.6 ? '#14171a' : '#ffffff';
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Builds an SVG element for `name` at `size` (default 18), matching the original's stroke-1.5 style. */
export function icon(name, size) {
  const shapes = ICONS[name] || ICONS.globe;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(size || 18));
  svg.setAttribute('height', String(size || 18));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.style.display = 'block';
  svg.style.flex = 'none';
  shapes.forEach((shape) => svg.appendChild(shapeNode(shape)));
  return svg;
}

/** Social keys whose glyph differs from the same-named UI icon. */
const SOCIAL_ALIAS = { x: 'xSocial' };

/**
 * Social-platform icon. Every glyph resolves into the same in-house stroke
 * set as the rest of the chrome -- geometric marks that identify where a
 * link goes without reproducing anyone's registered logo artwork. Kept as
 * its own entry point because the social key 'x' must not resolve to the
 * UI's close glyph; resolve through brandIcon(), never icon().
 */
export function brandIcon(name, size) {
  return icon(SOCIAL_ALIAS[name] || name, size);
}

function shapeNode(shape) {
  if (typeof shape === 'string') {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', shape);
    return p;
  }
  const [kind, ...args] = shape;
  if (kind === 'rect') {
    const [x, y, w, h] = args;
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('x', String(x));
    r.setAttribute('y', String(y));
    r.setAttribute('width', String(w));
    r.setAttribute('height', String(h));
    return r;
  }
  const [cx, cy, cr] = args;
  const c = document.createElementNS(SVG_NS, 'circle');
  c.setAttribute('cx', String(cx));
  c.setAttribute('cy', String(cy));
  c.setAttribute('r', String(cr));
  return c;
}

export function socialKey(label) {
  const l = String(label || '').toLowerCase();
  if (l.includes('insta')) return 'instagram';
  if (l.includes('linked')) return 'linkedin';
  if (l.includes('face')) return 'facebook';
  if (l.includes('you') || l.includes('tube')) return 'youtube';
  if (l === 'x' || l.includes('twitter')) return 'x';
  if (l.includes('tiktok') || l.includes('tik tok')) return 'tiktok';
  if (l.includes('pinterest')) return 'pinterest';
  if (l.includes('snap')) return 'snapchat';
  if (l.includes('whatsapp')) return 'whatsapp';
  if (l.includes('thread')) return 'threads';
  if (l.includes('discord')) return 'discord';
  if (l.includes('telegram')) return 'telegram';
  if (l.includes('reddit')) return 'reddit';
  if (l.includes('spotify')) return 'spotify';
  if (l.includes('behance')) return 'behance';
  if (l.includes('dribbble') || l.includes('dribble')) return 'dribbble';
  if (l.includes('mail') || l.includes('email')) return 'mail';
  return 'globe';
}

