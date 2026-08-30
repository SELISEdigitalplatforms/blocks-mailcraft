/**
 * A DOM for the tests that need one.
 *
 * The rest of the suite is deliberately DOM-free, and that covers `src/core/`
 * well -- but `mailcraft-editor.js` and everything under `src/render/` is DOM
 * from the first line, so without a document they sat at 0%. jsdom is a
 * devDependency, like esbuild and c8: nothing a consumer installs changes.
 *
 * Two things this file exists to get right, both of which fail silently:
 *
 * 1. Node ships its own `CustomEvent`, `Event`, `Blob` and `URL`. jsdom's
 *    `dispatchEvent` rejects instances of Node's versions with a bare
 *    "parameter 1 is not of type 'Event'", so the window's constructors have
 *    to win outright rather than only filling gaps.
 * 2. Some globals (`navigator` in Node 22) are getter-only, and a plain
 *    assignment throws -- which silently aborts the rest of the install and
 *    leaves a half-shimmed environment behind. Everything goes through
 *    `defineProperty`.
 */

import { JSDOM } from 'jsdom';

/** Everything the editor reaches for through a global. Order is irrelevant; all are forced. */
const GLOBALS = [
  'window', 'document', 'customElements', 'navigator', 'location', 'history',
  'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLAnchorElement',
  'Node', 'Element', 'DocumentFragment', 'NodeFilter', 'ShadowRoot',
  'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'DragEvent', 'InputEvent', 'EventTarget',
  'DOMParser', 'XMLSerializer', 'getComputedStyle', 'matchMedia',
  'requestAnimationFrame', 'cancelAnimationFrame',
  'Image', 'FileReader', 'File', 'FileList', 'Blob', 'URL', 'DataTransfer',
  'localStorage', 'sessionStorage', 'MutationObserver', 'AbortController', 'AbortSignal',
  'getSelection', 'Range', 'Selection',
];

let dom = null;
const saved = new Map();

/** Installs a value on globalThis even when the existing one is getter-only. */
function force(key, value) {
  if (!saved.has(key)) saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { value, writable: true, configurable: true, enumerable: false });
}

/**
 * Installs a document. Call once, before importing anything under `src/`:
 * the element module registers itself on import and needs `HTMLElement` to
 * exist by then.
 */
export function installDom(html) {
  dom = new JSDOM(html || '<!doctype html><html><body></body></html>', {
    pretendToBeVisual: true,
    url: 'https://host.test/',
  });
  const w = dom.window;
  GLOBALS.forEach((k) => { if (w[k] !== undefined) force(k, typeof w[k] === 'function' && !/^[A-Z]/.test(k) ? w[k].bind(w) : w[k]); });
  // jsdom lays nothing out, so every box is 0x0. Enough of the editor asks for
  // a rectangle (drop targets, the zoom frame, focus restoration) that a flat
  // zero makes those paths behave as if the element were not on screen.
  w.Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return { x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 800, width: 1200, height: 800, toJSON() { return this; } };
  };
  // Not implemented by jsdom; the RTE and the code editor both call them.
  w.document.execCommand = () => true;
  w.document.queryCommandState = () => false;
  w.document.queryCommandValue = () => '';
  if (!w.Element.prototype.scrollIntoView) w.Element.prototype.scrollIntoView = () => {};

  // jsdom has no canvas, no image decoding and no clipboard, so the screenshot
  // path would throw at the first `getContext`. These stand-ins let the real
  // code run end to end -- it still walks the document, clones it, serializes
  // the SVG and asks for a blob; only the rasterization is faked.
  w.HTMLCanvasElement.prototype.getContext = function getContext() {
    return { drawImage() {}, fillRect() {}, clearRect() {}, setTransform() {}, scale() {}, translate() {} };
  };
  w.HTMLCanvasElement.prototype.toBlob = function toBlob(cb) {
    cb(new w.Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }));
  };
  // jsdom never fires load for a data: URL image; the capture awaits it.
  Object.defineProperty(w.HTMLImageElement.prototype, 'src', {
    configurable: true,
    set(value) {
      this.setAttribute('src', value);
      w.setTimeout(() => { if (this.onload) this.onload(new w.Event('load')); }, 0);
    },
    get() { return this.getAttribute('src') || ''; },
  });
  w.HTMLImageElement.prototype.decode = () => Promise.resolve();
  // Offset sizes are 0 in jsdom; the capture uses them for the SVG viewport.
  Object.defineProperty(w.HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return 680; } });
  Object.defineProperty(w.HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return 900; } });
  if (!w.ClipboardItem) w.ClipboardItem = function ClipboardItem(items) { this.items = items; };
  if (!w.navigator.clipboard) Object.defineProperty(w.navigator, 'clipboard', { configurable: true, value: { write: async () => {}, writeText: async () => {} } });
  force('ClipboardItem', w.ClipboardItem);

  // jsdom implements neither, and the editor leans on both: `isContentEditable`
  // decides whether a keystroke is typing or a shortcut, and ShadowRoot's own
  // getSelection is the only way to read a caret inside a shadow tree. Without
  // them the inline-editing paths are unreachable, not merely untested.
  Object.defineProperty(w.HTMLElement.prototype, 'isContentEditable', {
    configurable: true,
    get() {
      for (let n = this; n && n.getAttribute; n = n.parentElement) {
        const v = n.getAttribute('contenteditable');
        if (v === 'true' || v === '') return true;
        if (v === 'false') return false;
      }
      return false;
    },
  });
  if (!w.ShadowRoot.prototype.getSelection) {
    w.ShadowRoot.prototype.getSelection = function getSelection() { return w.getSelection(); };
  }
  // jsdom implements neither; the story viewer and the html download both
  // mint object URLs, and an unhandled throw there kills the whole run.
  if (!w.URL.createObjectURL) w.URL.createObjectURL = (blob) => 'blob:host.test/' + (blob && blob.size);
  if (!w.URL.revokeObjectURL) w.URL.revokeObjectURL = () => {};
  force('URL', w.URL);
  return w;
}

/** The window, for tests that need to build events or reach into the page. */
export function win() {
  if (!dom) throw new Error('installDom() has not been called');
  return dom.window;
}

/**
 * Empties both storages. The editor autosaves every edit and restores it on
 * mount, and one jsdom window is one origin -- so without this each test would
 * inherit the previous test's document and assert against the wrong tree.
 */
export function resetStorage() {
  try { win().localStorage.clear(); } catch { /* nothing stored yet */ }
  try { win().sessionStorage.clear(); } catch { /* nothing stored yet */ }
}

/** Mounts an editor on a clean slate and waits for the first render. */
export async function mountEditor(attrs) {
  resetStorage();
  const w = win();
  const el = w.document.createElement('mailcraft-editor');
  Object.keys(attrs || {}).forEach((k) => el.setAttribute(k, attrs[k]));
  w.document.body.appendChild(el);
  await settle();
  return el;
}

/** Lets the rAF-batched render and any queued microtasks land. */
export function settle(frames) {
  const n = frames || 2;
  return new Promise((resolve) => {
    let left = n;
    const step = () => { if (--left <= 0) setTimeout(resolve, 0); else win().requestAnimationFrame(step); };
    win().requestAnimationFrame(step);
  });
}

/**
 * Tears the page down. The editor's `mount()` starts a 1s interval, so without
 * this (or an explicit exit) a test process never becomes idle and just hangs.
 */
export function closeDom() {
  if (!dom) return;
  dom.window.document.body.innerHTML = '';
  dom.window.close();
  saved.forEach((desc, key) => {
    if (desc) Object.defineProperty(globalThis, key, desc);
    else delete globalThis[key];
  });
  saved.clear();
  dom = null;
}
