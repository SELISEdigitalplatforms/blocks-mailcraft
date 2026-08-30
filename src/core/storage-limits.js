/**
 * Upload validation -- mechanism only, no policy.
 *
 * Sizes and counts stay undefaulted: what an email template may carry depends
 * on the sending platform (ESP attachment caps) and the host's own product
 * rules, so those numbers are the host's to set -- `editor.storageLimits`, or
 * `limits` on the provider. Formats are the one axis with a default: every
 * image type the sniffer can name is allowed unless the host narrows `accept`.
 * With a provider wired and no `maxBytes` declared, uploads are refused rather
 * than waved through.
 *
 * Checks run *before* the provider is called, so a rejected file never reaches
 * the backend. That matters for any store where minting an upload URL also
 * creates the file record: validating afterwards would leave an orphan behind
 * for every rejection.
 *
 * Types are decided by sniffing the leading bytes, not by trusting `file.type`:
 * the browser fills that in from the file extension, so renaming `payload.svg`
 * to `photo.png` is enough to walk a script-bearing document past a MIME check
 * and into the editor's own DOM, where the library preview renders it.
 */

import { KB } from './assets.js';

const ascii = (b, at, s) => s.split('').every((c, i) => b[at + i] === c.charCodeAt(0));

/**
 * The leading bytes of every raster format a mail client might plausibly be
 * asked to show, plus the ones it can't -- knowing a file is AVIF is what lets
 * the rejection say "AVIF" instead of "unsupported".
 */
function sniff(b) {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && ascii(b, 1, 'PNG')) return 'image/png';
  if (ascii(b, 0, 'GIF8')) return 'image/gif';
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return 'image/webp';
  if (ascii(b, 0, 'BM')) return 'image/bmp';
  if ((ascii(b, 0, 'II') && b[2] === 0x2a && b[3] === 0) || (ascii(b, 0, 'MM') && b[2] === 0 && b[3] === 0x2a)) return 'image/tiff';
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return 'image/x-icon';
  if (ascii(b, 4, 'ftyp')) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    return 'image/heic';
  }
  // Markup: an SVG may open with a BOM, an XML declaration, a doctype or a
  // comment before the root element, so the reliable tell is "text that starts
  // with '<'", not a literal "<svg" at offset zero.
  let i = 0;
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) i = 3;
  while (i < b.length && (b[i] === 0x20 || b[i] === 0x09 || b[i] === 0x0a || b[i] === 0x0d)) i++;
  if (b[i] === 0x3c) return 'image/svg+xml';
  return null;
}

/** First bytes of a file. `Blob.arrayBuffer` where it exists, FileReader where it doesn't. */
function head(file) {
  const slice = file.slice(0, 32);
  if (typeof slice.arrayBuffer === 'function') {
    return slice.arrayBuffer().then((buf) => new Uint8Array(buf)).catch(() => null);
  }
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(new Uint8Array(fr.result));
    fr.onerror = () => resolve(null);
    fr.readAsArrayBuffer(slice);
  });
}

/** Decoded pixel dimensions, or `null` when the browser can't decode it -- which is itself a reason to refuse the file. */
function probe(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const done = (v) => { URL.revokeObjectURL(url); resolve(v); };
    img.onload = () => done({ w: img.naturalWidth || img.width, ht: img.naturalHeight || img.height });
    img.onerror = () => done(null);
    img.src = url;
  });
}

/**
 * Strips directory separators, control characters and anything a storage
 * backend is likely to treat as path syntax, and caps the length. A name
 * arrives from the user's disk and ends up in a URL.
 */
export function sanitizeName(name) {
  const clean = String(name || 'file')
    .replace(/[\\/]/g, '-')
    .replace(/[<>:"|?*]/g, '')
    .split('').filter((c) => c.charCodeAt(0) > 31).join('')
    .trim()
    .replace(/^\.+/, '') || 'file';
  if (clean.length <= 120) return clean;
  const dot = clean.lastIndexOf('.');
  const ext = dot > 0 && clean.length - dot <= 8 ? clean.slice(dot) : '';
  return clean.slice(0, 120 - ext.length) + ext;
}

/** The host has to have said how big a file may be; the format list is optional and defaults to all of these. */
export function limitsProblem(limits) {
  if (!limits) return 'storage.errNoLimits';
  if (!(Number(limits.maxBytes) > 0)) return 'storage.errNoMaxBytes';
  return null;
}

/**
 * Splits a FileList into what may be uploaded and what may not.
 *
 * Rejections carry an i18n key and its params rather than a sentence, so the
 * reason is translated by the same table as the rest of the chrome.
 *
 * @returns {Promise<{accepted: Array<{file: File, name: string, w: number, ht: number, size: number, type: string}>, rejected: Array<{name: string, key: string, params: Object}>}>}
 */
export async function validateFiles(list, limits) {
  const files = Array.from(list || []);
  const accepted = [];
  const rejected = [];
  if (!files.length) return { accepted, rejected };

  const problem = limitsProblem(limits);
  if (problem) return { accepted, rejected: files.map((f) => ({ name: f.name, key: problem, params: {} })) };

  // An omitted or empty `accept` means every image type the sniffer can name,
  // not "nothing" -- a host that wants a narrower list has to say so, but the
  // starting point is that an image is uploadable.
  const accept = Array.isArray(limits.accept) && limits.accept.length
    ? limits.accept.map((m) => String(m).toLowerCase())
    : null;
  const max = Number(limits.maxBytes);
  const maxW = Number(limits.maxWidth) || 0;
  const maxH = Number(limits.maxHeight) || 0;
  const perDrop = Number(limits.maxFilesPerDrop) || 0;

  const queue = perDrop && files.length > perDrop ? files.slice(0, perDrop) : files;
  if (queue.length < files.length) {
    files.slice(queue.length).forEach((f) => rejected.push({ name: f.name, key: 'storage.errTooMany', params: { max: perDrop } }));
  }

  for (const file of queue) {
    const name = sanitizeName(file.name);

    if (file.size > max) {
      rejected.push({ name, key: 'storage.errTooLarge', params: { name, size: KB(file.size), max: KB(max) } });
      continue;
    }

    const bytes = await head(file);
    const type = bytes && sniff(bytes);
    if (!type) {
      rejected.push({ name, key: 'storage.errUnreadable', params: { name } });
      continue;
    }
    if (accept && !accept.includes(type)) {
      rejected.push({ name, key: 'storage.errFormat', params: { name, type: type.replace(/^image\//, '').toUpperCase() } });
      continue;
    }
    // Listing SVG in `accept` is not on its own enough. It is the one image
    // type that is also a script host, and it renders inside the editor's own
    // shadow root the moment it appears as a library tile -- so a host that
    // genuinely wants it has to say so twice, and can never enable it by
    // pasting a permissive MIME list.
    if (type === 'image/svg+xml' && !limits.allowSvg) {
      rejected.push({ name, key: 'storage.errSvg', params: { name } });
      continue;
    }

    let dims = { w: 0, ht: 0 };
    if (type !== 'image/svg+xml') {
      const measured = await probe(file);
      if (!measured) { rejected.push({ name, key: 'storage.errUnreadable', params: { name } }); continue; }
      dims = measured;
      if ((maxW && dims.w > maxW) || (maxH && dims.ht > maxH)) {
        rejected.push({ name, key: 'storage.errDimensions', params: { name, w: dims.w, ht: dims.ht, maxW: maxW || dims.w, maxH: maxH || dims.ht } });
        continue;
      }
    }

    accepted.push({ file, name, type, size: file.size, w: dims.w, ht: dims.ht });
  }

  return { accepted, rejected };
}

/** An `accept` attribute for the file picker, so the OS dialog greys out what validation would refuse anyway. */
export function acceptAttribute(limits) {
  if (!limits || !Array.isArray(limits.accept) || !limits.accept.length) return 'image/*';
  return limits.accept.join(',');
}