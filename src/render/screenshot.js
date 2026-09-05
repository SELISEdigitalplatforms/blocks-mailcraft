import { renderDoc } from './canvas.js';

/**
 * Full-template screenshot, zero dependencies: render the same static tree
 * the preview modal uses (inline styles only), wrap it in an SVG
 * `<foreignObject>`, rasterize that through an `<img>` onto a canvas, and
 * hand back a PNG Blob.
 *
 * Two hard rules of SVG-loaded-as-image. The first is that the SVG has to
 * reach the `<img>` as a `data:` URI, never a `blob:` one: Chromium treats a
 * blob-loaded SVG that contains a `<foreignObject>` as cross-origin content,
 * so the canvas comes out tainted and `toBlob()` throws
 * ("Tainted canvases may not be exported") -- i.e. every capture fails, with
 * nothing in the console to say why. A `data:` URI of the same bytes is
 * origin-clean and rasterizes identically.
 *
 * The second is that it may not fetch ANY
 * external resource -- not "CORS applies", but a total network ban -- so
 * every image has to already be a data: URI when the SVG is built. A block
 * placeholder is one by construction (core/placeholder.js), and so is a file
 * dropped into the local library; anything else (a provider URL, a hand-typed
 * URL) is inlined here via a best-effort fetch, and a fetch the remote
 * server refuses (no CORS header) degrades to a blank pixel instead of
 * silently producing a tainted, unexportable canvas.
 *
 * Known limits, accepted: `<iframe>` embeds never paint inside foreignObject
 * (they render as their reserved box), and web fonts are unavailable, so
 * text falls back through the theme's system font stack -- which is what an
 * email client would show anyway.
 */

const BLANK_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** Encodings the capture can produce. Anything unrecognized falls back to PNG. */
const MIME = { png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', webp: 'image/webp' };

/**
 * `{ scale, format, quality }` with every hole filled. A bare number is the
 * legacy third argument (scale). `quality` only matters to the lossy formats;
 * canvas encoders take 0..1, and out-of-range input falls back to the default
 * rather than clamping to an extreme the caller clearly did not mean.
 */
function shotOptions(options) {
  const o = typeof options === 'number' ? { scale: options } : options || {};
  const q = Number(o.quality);
  return {
    scale: Number(o.scale) > 0 ? Number(o.scale) : 2,
    mime: MIME[String(o.format || 'png').toLowerCase()] || 'image/png',
    quality: q >= 0 && q <= 1 ? q : 0.85,
  };
}

/**
 * `canvas.toBlob` wrapped as a promise. A browser that cannot encode the
 * requested type is allowed by spec to hand back PNG instead (Safari does
 * this for WebP), so callers read `blob.type` rather than trusting the
 * request.
 */
function encodeCanvas(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('image encoding failed'))), mime, quality);
  });
}

// Inlined bytes are cached per URL for the session: every capture (open,
// retry, reopen) used to re-fetch each remote image, which is most of a slow
// open on a photo-heavy template. A failed fetch is evicted so a transient
// network error does not pin the blank-pixel fallback forever.
const inlineCache = new Map();

function toDataUri(url) {
  if (inlineCache.has(url)) return inlineCache.get(url);
  const job = fetch(url, { mode: 'cors' }).then((res) => {
    if (!res.ok) throw new Error('fetch failed: ' + res.status);
    return res.blob();
  }).then((blob) => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  })).catch((err) => {
    inlineCache.delete(url);
    throw err;
  });
  inlineCache.set(url, job);
  return job;
}

async function inlineExternalImages(root) {
  const jobs = [];
  root.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || '';
    if (!src || src.startsWith('data:')) return;
    jobs.push(toDataUri(src).then(
      (uri) => { img.setAttribute('src', uri); },
      () => { img.setAttribute('src', BLANK_PIXEL); },
    ));
  });
  root.querySelectorAll('[style]').forEach((el) => {
    const m = (el.style.backgroundImage || '').match(/url\(["']?(?!data:)([^"')]+)["']?\)/);
    if (!m) return;
    jobs.push(toDataUri(m[1]).then(
      (uri) => { el.style.backgroundImage = 'url("' + uri + '")'; },
      () => { el.style.backgroundImage = 'none'; },
    ));
  });
  await Promise.all(jobs);
}

/**
 * Renders the current document full-length (desktop width, independent of
 * the device toggle and zoom) and returns an image Blob. `options` is either
 * a bare scale number (the legacy signature) or
 * `{ scale = 2, format = 'png' | 'jpeg' | 'webp', quality = 0.85 }` --
 * `format`/`quality` are the compression dial: PNG is lossless and biggest,
 * JPEG and WebP are lossy and typically a fraction of the size on a long
 * template. Check the returned `blob.type` for what was actually encoded
 * (a browser without a WebP encoder hands back PNG).
 * `mountInto` is any attached container inside the editor's shadow root --
 * the tree must live in the live document briefly, off-screen, to lay out
 * and be measured before serialization.
 *
 * (`export const` + async function expression, not `export async function`:
 * build.js's transform only recognizes `export (const|function|class)`.)
 */
export const captureTemplatePng = async function (core, mountInto, options) {
  const { scale, mime, quality } = shotOptions(options);
  const theme = core.state.doc.theme;
  const pad = 32;
  const wrapper = document.createElement('div');
  // Off-screen but attached (fixed keeps it out of any scroll container's
  // scrollHeight, so capturing never moves the user's canvas position).
  // The document's own page padding sits inside renderDoc's page element, so
  // the wrapper has to be wide enough for it -- sized off the content width
  // alone, `max-width:100%` would shrink the sheet below `theme.width` by
  // exactly the padding and the capture would come out narrower than the
  // template really is.
  const pageW = theme.width + (Number(theme.padX) || 0) * 2;
  wrapper.style.cssText = `position: fixed; left: -100000px; top: 0; width: ${pageW + pad * 2}px; background: ${theme.bg}; padding: ${pad}px; box-sizing: border-box; display: flex; justify-content: center;`;
  wrapper.setAttribute('aria-hidden', 'true');
  // renderDoc sizes the sheet from `state.device`, so with the mobile toggle
  // on it would return a 375px sheet floating inside this desktop-width
  // wrapper. Borrow the state for the length of one synchronous render --
  // nothing observes it in between, and no re-render is triggered.
  const device = core.state.device;
  core.state.device = 'desktop';
  try {
    wrapper.appendChild(renderDoc(core, false));
  } finally {
    core.state.device = device;
  }
  mountInto.appendChild(wrapper);
  try {
    await inlineExternalImages(wrapper);
    // Heights depend on images' intrinsic ratios (blocks set width, not
    // height) -- decode everything before measuring or tall images collapse.
    await Promise.all(Array.from(wrapper.querySelectorAll('img')).map(
      (img) => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()),
    ));
    const w = wrapper.offsetWidth;
    const h = wrapper.offsetHeight;
    // Serialize a *clone* with the off-screen positioning stripped -- the
    // wrapper's own `fixed; left: -100000px` would carry into the SVG and
    // place the content outside the drawable area.
    const copy = wrapper.cloneNode(true);
    copy.style.position = 'static';
    copy.style.left = 'auto';
    const xml = new XMLSerializer().serializeToString(copy);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%">${xml}</foreignObject></svg>`;

    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('SVG rasterization failed'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
    // WebKit fires `load` on an SVG-as-image before it is reliably
    // drawable, and drawing on that tick yields a blank or half-laid-out
    // frame. Same `decode()` guard the inner images get above.
    if (img.decode) await img.decode().catch(() => {});
    // Safari caps total canvas area, and past the cap it hands back a
    // *blank* canvas that still encodes successfully -- a silently empty
    // PNG with nothing thrown to catch. Long newsletters reach it easily
    // at 2x (a 680x4000 template is 10.9M device pixels). Scale the
    // capture down to fit instead of returning an empty image.
    const MAX_CANVAS_AREA = 16e6;
    const fit = Math.min(scale, Math.sqrt(MAX_CANVAS_AREA / Math.max(1, w * h)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * fit));
    canvas.height = Math.max(1, Math.round(h * fit));
    const ctx = canvas.getContext('2d');
    // The lossy formats carry no alpha channel, and an unpainted canvas pixel
    // encodes as black in JPEG -- lay the page colour down first.
    if (mime !== 'image/png') {
      ctx.fillStyle = theme.bg || '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await encodeCanvas(canvas, mime, quality);
  } finally {
    wrapper.remove();
  }
};

/**
 * Re-encodes an already-captured shot without rendering the template again:
 * the story viewer captures once as PNG (lossless for the preview and the
 * clipboard, which only accepts `image/png`) and converts here only when the
 * user downloads as JPG or WebP. `bg` fills behind the pixels for the lossy
 * formats. Same caveat as the capture: read the returned `blob.type`.
 */
export const transcodeShot = async function (blob, options, bg) {
  const { mime, quality } = shotOptions(options);
  if (mime === 'image/png' && blob.type === 'image/png') return blob;
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('shot decode failed'));
      img.src = url;
    });
    if (img.decode) await img.decode().catch(() => {});
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, img.naturalWidth);
    canvas.height = Math.max(1, img.naturalHeight);
    const ctx = canvas.getContext('2d');
    if (mime !== 'image/png') {
      ctx.fillStyle = bg || '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0);
    return await encodeCanvas(canvas, mime, quality);
  } finally {
    URL.revokeObjectURL(url);
  }
};
