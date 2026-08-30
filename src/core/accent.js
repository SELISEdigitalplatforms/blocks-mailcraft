/**
 * Host brand color -> the editor's four accent tokens.
 *
 * A host that passes `accent="#e11d48"` means "make the chrome my brand",
 * not "set one variable": `--ed-accent` alone would leave hover states on the
 * old blue, white text sitting on a pale brand color, and the selection wash
 * tinted the wrong hue. So one input color derives the whole set --
 * `--ed-accent`, `--ed-accent-strong` (hover/active), `--ed-accent-ink` (what
 * is legible *on* the accent) and `--ed-soft` (the tinted wash behind
 * selected rows and active tabs).
 *
 * Two rules do the work, both contrast-driven rather than taste-driven,
 * because the brand color arrives at runtime and nobody gets to eyeball it:
 *
 * 1. The accent has to stay readable against the chrome it sits on -- it is
 *    used for text and 1px icon strokes, not just fills. A brand yellow on
 *    the light panels, or a brand navy on the dark ones, is darkened or
 *    lightened just far enough to clear WCAG AA (4.5:1) and no further, so a
 *    brand that already passes is used exactly as given.
 * 2. `--ed-accent-ink` picks white or near-black by whichever wins contrast
 *    against the resolved accent, so a label on a filled accent button is
 *    never the wrong one for a mid-tone brand.
 *
 * Deliberately DOM-free and pure: the element resolves the attribute down to
 * a color string, this module does the color math -- which keeps the math
 * testable without a document.
 */

/** The chrome the accent has to survive against: `--ed-panel` in each palette (render/style.js). */
const LIGHT_BG = { r: 255, g: 255, b: 255 };
const DARK_BG = { r: 17, g: 24, b: 39 };
const WHITE = { r: 255, g: 255, b: 255 };
/** Not pure black: near `--ed-text`, so accent buttons don't read harsher than the rest of the UI. */
const NEAR_BLACK = { r: 11, g: 17, b: 32 };

/** WCAG AA for normal text. The accent renders as 11-12px labels and hairline icon strokes, so AA is the floor, not a nicety. */
const MIN_CONTRAST = 4.5;

const clamp255 = (n) => Math.max(0, Math.min(255, Math.round(n)));

/** sRGB channel -> linear light, per WCAG's relative-luminance definition. */
function toLinear(channel) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(c) {
  return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrast(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Linear blend, `t` = how far from `a` toward `b`. */
function mix(a, b, t) {
  return {
    r: clamp255(a.r + (b.r - a.r) * t),
    g: clamp255(a.g + (b.g - a.g) * t),
    b: clamp255(a.b + (b.b - a.b) * t),
  };
}

export const toHex = (c) => '#' + [c.r, c.g, c.b].map((n) => clamp255(n).toString(16).padStart(2, '0')).join('');

const rgba = (c, alpha) => `rgba(${clamp255(c.r)},${clamp255(c.g)},${clamp255(c.b)},${alpha})`;

/** `hue` in degrees, `s`/`l` as 0..1. Mirrors the CSS hsl() definition so `hsl(340 82% 52%)` lands where a browser would put it. */
function hslToRgb(hue, s, l) {
  const h = (((hue % 360) + 360) % 360) / 60;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x]
    : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return { r: clamp255((r + m) * 255), g: clamp255((g + m) * 255), b: clamp255((b + m) * 255) };
}

/**
 * Parses the color notations a host actually types into an attribute --
 * `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()/rgba()` and `hsl()/hsla()`,
 * comma- or space-separated, with or without `%`. Alpha parses but is
 * dropped: the accent is a solid color, and `--ed-soft` owns the translucent
 * tint. Named CSS colors are not resolved here (that needs a browser); the
 * element falls back to a DOM probe for those.
 *
 * @returns {{r:number,g:number,b:number}|null} null when it isn't a color.
 */
export function parseColor(value) {
  const raw = String(value == null ? '' : value).trim().toLowerCase();
  if (!raw) return null;

  const hex = /^#([0-9a-f]{3,8})$/.exec(raw);
  if (hex) {
    const h = hex[1];
    if (h.length === 3 || h.length === 4) {
      return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16) };
    }
    if (h.length === 6 || h.length === 8) {
      return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
    }
    return null;
  }

  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(raw);
  if (!fn) return null;
  const parts = fn[2].replace(/\//g, ' ').split(/[\s,]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const num = (s) => parseFloat(s);
  let out;
  if (fn[1].startsWith('rgb')) {
    const chan = (s) => (s.endsWith('%') ? (num(s) / 100) * 255 : num(s));
    out = { r: clamp255(chan(parts[0])), g: clamp255(chan(parts[1])), b: clamp255(chan(parts[2])) };
  } else {
    const pct = (v) => (v.endsWith('%') ? num(v) / 100 : num(v));
    const unit = (v) => Math.max(0, Math.min(1, pct(v)));
    out = hslToRgb(num(parts[0]), unit(parts[1]), unit(parts[2]));
  }
  return Number.isNaN(out.r + out.g + out.b) ? null : out;
}

/**
 * Walks the color toward black (light chrome) or white (dark chrome) until it
 * clears `MIN_CONTRAST` against the panel behind it. Steps are small and it
 * stops at the first passing one, so a brand color that already has enough
 * contrast comes back untouched -- the goal is legibility, not repainting
 * someone's brand.
 */
function fitContrast(color, bg) {
  const toward = luminance(bg) > 0.5 ? NEAR_BLACK : WHITE;
  let out = color;
  for (let step = 1; step <= 20 && contrast(out, bg) < MIN_CONTRAST; step += 1) {
    out = mix(color, toward, step / 20);
  }
  return out;
}

/** White or near-black, whichever is legible on `bg`. */
const inkFor = (bg) => (contrast(bg, WHITE) >= contrast(bg, NEAR_BLACK) ? WHITE : NEAR_BLACK);

/**
 * Every accent token, for one brand color in one chrome.
 *
 * Two families, because the editor paints on two surfaces:
 *
 *   --ed-accent*   panel chrome (header, inspector, tabs, sliders), which
 *                  follows the light/dark theme.
 *   --ed-accent-sheet*  everything drawn *on the email sheet* -- the row grip,
 *                  the block toolbars, the drop outlines. The sheet is a white
 *                  page in both themes, so these are always fitted against
 *                  white; a dark-theme accent light enough to read on the dark
 *                  panels would disappear on the page.
 *
 * `strong` moves *away* from the surface (darker on light, lighter on dark) so
 * hover always reads as "more", the way both built-in palettes behave.
 *
 * @param {{r:number,g:number,b:number}} color  parsed brand color
 * @param {string} chrome                       'light' | 'dark'
 * @returns {Object} token name -> CSS value
 */
export function accentTokens(color, chrome) {
  const dark = chrome === 'dark';
  const base = fitContrast(color, dark ? DARK_BG : LIGHT_BG);
  const strong = dark ? mix(base, WHITE, 0.22) : mix(base, NEAR_BLACK, 0.2);
  // In light chrome the panel *is* white, so the two families coincide and
  // this costs nothing.
  const sheet = dark ? fitContrast(color, LIGHT_BG) : base;
  return {
    '--ed-accent': toHex(base),
    '--ed-accent-strong': toHex(strong),
    '--ed-accent-ink': toHex(inkFor(base)),
    // The lighter stop of the brand mark's gradient -- a highlight, so it
    // moves toward white regardless of chrome.
    '--ed-accent-tint': toHex(mix(base, WHITE, 0.34)),
    // The same alphas the built-in palettes use -- a wash has to stay a hint
    // of color over its surface, not a second surface.
    '--ed-soft': rgba(base, dark ? 0.13 : 0.09),
    '--ed-glow': rgba(base, 0.28),
    // Text selection: heavier than a wash (it has to be visible under type)
    // and heavier still on dark, where the same alpha reads fainter.
    '--ed-select': rgba(base, dark ? 0.3 : 0.22),
    '--ed-accent-sheet': toHex(sheet),
    '--ed-accent-sheet-strong': toHex(mix(sheet, NEAR_BLACK, 0.22)),
    '--ed-accent-sheet-ink': toHex(inkFor(sheet)),
    // Drop-target dashes and hairlines on the page.
    '--ed-accent-sheet-line': rgba(sheet, 0.5),
  };
}

/** The tokens this module owns, so the element can clear exactly what it set when `accent` goes away. */
export const ACCENT_VARS = Object.keys(accentTokens({ r: 0, g: 0, b: 0 }, 'light'));
