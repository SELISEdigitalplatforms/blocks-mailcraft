/**
 * Mount-into-a-container API, for hosts that would rather call a function than
 * write a tag -- the shape a JS widget usually ships with (`new Map(el, opts)`).
 *
 *   const editor = createEditor('#mail', { html, toolbar: false });
 *   const out = editor.exportHtml();
 *   editor.destroy();
 *
 * This is a thin wrapper, not a second implementation: it creates the same
 * `<mailcraft-editor>`, applies the options to it, and returns a handle whose
 * methods forward to it. `editor.element` is the escape hatch to everything
 * the wrapper does not surface, and markup usage stays exactly as it was.
 *
 * Options that are attributes on the element (`locale`, `theme`, ...) are set
 * as attributes; the ones that carry objects or functions (`storageProvider`,
 * `messages`, ...) are set as properties, because attributes hold strings.
 * Callers do not have to know which is which.
 */

import { MailCraftEditor } from './mailcraft-editor.js';

/** Options that map 1:1 onto an attribute. `uiFont` is spelled `ui-font` in markup. */
const ATTRS = { variables: 'variables', locale: 'locale', dir: 'dir', theme: 'theme', uiFont: 'ui-font', accent: 'accent' };

/** Options that must be assigned as properties -- objects and functions cannot travel through an attribute. */
const PROPS = ['storageProvider', 'storageLimits', 'aiProvider', 'iconProvider', 'messages', 'footer'];

/** Methods forwarded verbatim onto the returned handle. */
const METHODS = ['exportHtml', 'importHtml', 'loadTemplate', 'undo', 'redo', 'screenshotPng', 'previewScreenshot', 'downloadScreenshot', 'copyScreenshot'];

function resolveTarget(target) {
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (!el || el.nodeType !== 1) {
    throw new Error('[mailcraft] createEditor: no element matched ' + JSON.stringify(target));
  }
  return el;
}

const px = (v) => (typeof v === 'number' ? v + 'px' : v);

/**
 * Creates an editor inside `container`.
 *
 * @param {string|Element} target  CSS selector or element to mount into.
 * @param {Object} [options]
 * @param {string} [options.html]            initial email HTML, applied through the importer
 * @param {string|string[]} [options.variables]
 * @param {string} [options.locale] @param {string} [options.dir] @param {string} [options.theme] @param {string} [options.uiFont]
 * @param {string} [options.accent]          brand color for the editor chrome -- a CSS color, `var(--token)`, or `inherit`
 * @param {boolean|Object} [options.toolbar] which parts of the top bar to show -- see core/toolbar.js
 * @param {boolean|string|Object} [options.footer] the attribution strip: false to remove, a string to replace it, or { text, href } -- see core/footer.js
 * @param {Object} [options.storageProvider] @param {Object} [options.storageLimits]
 * @param {Function} [options.aiProvider] @param {Function} [options.iconProvider] @param {Object} [options.messages]
 * @param {string|number} [options.height]   sets the container's height; otherwise your CSS decides
 * @param {boolean} [options.replace]        empty the container first (default: append)
 * @param {Function} [options.onChange]      (doc) => void
 * @param {Function} [options.onExport]      (html) => void
 * @returns {Object} handle with the editor's methods, `element`, and `destroy()`
 */
export function createEditor(target, options) {
  const o = options || {};
  const container = resolveTarget(target);
  const el = document.createElement('mailcraft-editor');

  Object.keys(ATTRS).forEach((key) => {
    if (o[key] == null) return;
    el.setAttribute(ATTRS[key], Array.isArray(o[key]) ? o[key].join(',') : String(o[key]));
  });

  // Before insertion: `toolbar` decides whether the header row is built at all,
  // and the providers are wanted by the first render, not one frame after it.
  if (o.toolbar !== undefined) el.toolbar = o.toolbar;
  PROPS.forEach((key) => { if (o[key] !== undefined) el[key] = o[key]; });

  const onChange = o.onChange ? (e) => o.onChange(e.detail) : null;
  const onExport = o.onExport ? (e) => o.onExport(e.detail) : null;
  if (onChange) el.addEventListener('change', onChange);
  if (onExport) el.addEventListener('export', onExport);

  // The element is `display: block; height: 100%`, so the container's height is
  // the editor's height. Left to the host's CSS unless `height` says otherwise --
  // guessing one here would silently override a layout that was already correct.
  if (o.replace) container.textContent = '';
  if (o.height) container.style.height = px(o.height);
  container.appendChild(el);

  // Applied last: this is an undoable edit, and it should land on an editor
  // that is already mounted and configured.
  if (typeof o.html === 'string' && o.html.trim()) el.loadTemplate({ name: o.name || '', html: o.html });

  const handle = {
    /** The underlying custom element -- everything the wrapper does not forward. */
    element: el,
    /** Removes the editor and detaches the listeners this call attached. Leaves anything else in the container alone. */
    destroy() {
      if (onChange) el.removeEventListener('change', onChange);
      if (onExport) el.removeEventListener('export', onExport);
      if (el.parentNode) el.parentNode.removeChild(el);
    },
  };
  METHODS.forEach((name) => { handle[name] = (...args) => el[name](...args); });

  return handle;
}

/** True once the element is registered -- the import above is what registers it, so this is a sanity check for hosts loading scripts out of order. */
export function isReady() {
  return typeof customElements !== 'undefined' && customElements.get('mailcraft-editor') === MailCraftEditor;
}
