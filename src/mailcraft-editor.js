import { EditorCore, AI_GOALS, AI_TONES } from './core/editor-core.js';
import { GROUPS, LAYOUTS, DEF, PALETTE } from './core/blocks.js';
import { KB } from './core/assets.js';
import { acceptAttribute } from './core/storage-limits.js';
import { renderDoc } from './render/canvas.js';
import { renderRte } from './render/rte.js';
import { renderField, renderFieldCards, typeCommit } from './render/fields.js';
import { icon } from './core/icons.js';
import { brandLockup } from './core/brand.js';
import { TOKEN } from './core/variables.js';
import { hl, cssUrl } from './core/sanitize.js';
import { decorateLogicTags } from './core/export.js';
import { formatHtml, scanElements, elementAtOffset, findMatches, markRanges } from './core/code-tools.js';
import { withFocusPreserved } from './render/focus-preserve.js';
import { captureTemplatePng } from './render/screenshot.js';
import { resolveToolbar, toolbarKey } from './core/toolbar.js';
import { resolveFooter } from './core/footer.js';
import { createStoryViewer } from './render/story.js';
import { STYLE } from './render/style.js';
import { createTranslator, isRtl } from './core/i18n/index.js';
import { ACCENT_VARS, accentTokens, parseColor } from './core/accent.js';
import { localeTable, loadLocale } from './core/i18n/loaders.js';

/** `elS` mirrors the template's literal `style="..."` attribute strings verbatim -- copied, not re-derived, to keep the port pixel-exact. */
function elS(tag, styleStr, attrs = {}, ...children) {
  const node = document.createElement(tag);
  if (styleStr) node.style.cssText = styleStr;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) continue;
    if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
    else node.setAttribute(k, v);
  }
  children.flat().forEach((c) => { if (c != null && c !== false) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
  return node;
}

/** Built from `t` at render time (not a module-level const) since the active translator can change at runtime via `.messages`/`.locale`. Icon-only tabs: `label` carries the full name for aria-label/tooltip, `title` is the native-title fallback/hint. */
function tabsFor(t) {
  return [
    { key: 'design', label: t('tab.design'), title: t('tab.designHint'), iconName: 'paint' },
    { key: 'blocks', label: t('tab.blocks'), title: t('tab.blocksHint'), iconName: 'grid' },
    { key: 'rows', label: t('tab.rows'), title: t('tab.rowsHint'), iconName: 'table' },
    { key: 'files', label: t('tab.files'), title: t('tab.filesHint'), iconName: 'image' },
    { key: 'layers', label: t('tab.layers'), title: t('tab.layersHint'), iconName: 'list' },
    { key: 'theme', label: t('tab.settings'), title: t('tab.settingsHint'), iconName: 'sliders' },
    { key: 'data', label: t('tab.data'), title: t('tab.dataHint'), iconName: 'data' },
  ];
}

/**
 * Appends a shared CSS-only tooltip bubble (`.mc-tooltip`, render/style.js) to
 * `node` and marks it `data-tip` so `:hover`/`:focus-visible`
 * on the node itself reveals it -- no JS show/hide logic. `dir` picks which
 * side it renders on ('down' for tabs/segments, 'up' for anything hugging the
 * bottom of the header). Also sets `aria-label` (icon-only controls have no
 * visible text) and keeps `title` as the native-tooltip fallback.
 */
function tip(node, label, dir, align) {
  node.style.position = node.style.position || 'relative';
  node.setAttribute('data-tip', '1');
  if (!node.hasAttribute('aria-label')) node.setAttribute('aria-label', label);
  // The bubble replaces the native tooltip -- with `title` left on the node
  // both would pop on hover.
  node.removeAttribute('title');
  // align 'end' pins the bubble to the control's right edge instead of
  // centering it -- for controls hugging a right edge, where a centered
  // bubble would overflow its scroll container (see .mc-tooltip-end).
  const direction = dir || 'down';
  node.tipNode = elS('span', '', { class: `mc-tooltip mc-tooltip-${direction}${direction === 'down' ? ' mc-tab-tooltip' : ''}${align === 'end' ? ' mc-tooltip-end' : ''}`, text: label });
  node.appendChild(node.tipNode);
  return node;
}

/**
 * `<mailcraft-editor>` -- a pixel-faithful port of the MailCraft prototype to
 * a zero-dependency Web Component. Shadow DOM for isolation; no bundled
 * framework -- `core/editor-core.js` owns all state and logic (ported
 * near-verbatim from the original `Component` class), this file only builds
 * and re-builds DOM from it.
 *
 * Attributes: `variables`, `locale` (picks the shipped UI language
 * and, via `dir` defaulting, RTL), `dir`, `theme` ("light"/"dark" -- host-owned),
 * `ui-font` (a CSS font-family value; use "inherit" for the host app's font),
 * `accent` (the host's brand color -- a CSS color, `var(--your-token)`, or
 * "inherit" to read the host's `accent-color`; the whole accent token set is
 * derived from it, contrast-corrected per chrome),
 * chrome; while present the built-in toggle is hidden), `footer` ("none" to
 * remove the attribution strip, or any string to replace its text).
 * Properties: `.variables`, `.toolbar` (which parts of the top bar are shown),
 * `.aiProvider` (optional async fn, replaces the original's `window.claude.complete`),
 * `.iconProvider` (optional social-icon override), `.storageProvider` (host-supplied
 * file storage -- see `core/storage.js`), `.storageLimits` (host-set upload ceilings,
 * required whenever a provider is set), `.messages` (UI string overrides --
 * a host's own table, an imported locale from `core/i18n/`, or both merged via
 * `defineMessages`; see `core/i18n/index.js`).
 * Methods: `getContent()`, `setContent(doc)`, `importHtml(html)`, `exportHtml()`,
 * `loadTemplate(tpl)`, `screenshotPng(options)`
 * (full-template image as a Blob; `options.format`/`quality`/`scale` pick
 * PNG, JPEG or WebP and the compression), `previewScreenshot()` (story-style
 * viewer with its own format picker),
 * `downloadScreenshot()`, `copyScreenshot()`, `undo()`, `redo()`.
 * Events: `change` (detail: doc), `export` (detail: html string).
 */
// `extends HTMLElement` is evaluated at module scope, so a bare
// `import 'mailcraft-editor'` threw ReferenceError anywhere there is no DOM --
// an SSR render pass, or a Node test runner reaching for a named export. The
// stand-in keeps the module importable there; the element is only ever
// constructed by the browser, which always has the real base class.
const ElementBase = typeof HTMLElement !== 'undefined' ? HTMLElement : class {};

export class MailCraftEditor extends ElementBase {
  static get observedAttributes() { return ['variables', 'locale', 'dir', 'theme', 'ui-font', 'accent', 'toolbar', 'footer']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    // Created here (not connectedCallback) so `.variables` and the document
    // work even before the element is inserted into the document -- a common pattern
    // (`document.createElement(...)`, configure, then append).
    this.core = new EditorCore({
      variables: this.hasAttribute('variables') ? this.getAttribute('variables') : undefined,
    });
  }

  connectedCallback() {
    this.buildShell();
    this.applyUiFont();
    this.applyAccent();
    this.applyDir();
    this._toolbarKey = toolbarKey(this.toolbarConfig());
    this.core.mount(this.shadowRoot);
    // After mount() on purpose: mount restores the persisted chrome/doc, and
    // a host-supplied `theme`/`locale` must win over what was persisted.
    this.applyTheme();
    this.refreshTranslator();
    this.core.mountKeyboard((target) => {
      const tag = (target && target.tagName || '').toLowerCase();
      return tag === 'input' || tag === 'textarea' || (target && target.isContentEditable);
    });
    this.core.onFormatChange = () => this.scheduleRteRefresh();
    this.core.onFoldLiveEdit = () => this.syncLiveEdit();
    this.core.onCodeSourceChange = () => this.refreshCodeSource();
    this.core.onSavedChange = () => this.refreshSavedLabel();
    this.core.onToast = () => this.refreshToast();
    this.core.onTick = () => this.refreshCountdowns();
    this.unsubscribe = this.core.subscribe(() => {
      withFocusPreserved(this.shadowRoot, () => this.render());
      this.dispatchEvent(new CustomEvent('change', { detail: this.core.state.doc }));
    });
    this.render();
  }

  disconnectedCallback() {
    this.unsubscribe?.();
    this.core.onFormatChange = null;
    this.core.onFoldLiveEdit = null;
    this.core.onCodeSourceChange = null;
    this.core.onSavedChange = null;
    this.core.onToast = null;
    this.core.onTick = null;
    if (this._rteFrame != null) cancelAnimationFrame(this._rteFrame);
    this._rteFrame = null;
    this.core.unmount();
  }

  attributeChangedCallback(name, _old, value) {
    if (!this.core) return;
    if (name === 'variables') { this.core.variablesRaw = value; this.core.emit(); }
    if (name === 'locale' || name === 'dir') this.applyDir();
    if (name === 'locale') this.refreshTranslator();
    if (name === 'theme') this.applyTheme();
    if (name === 'ui-font') this.applyUiFont();
    // Forced: setting the attribute is also how a host asks for a re-derive
    // after its own `--token` changed -- see applyAccent.
    if (name === 'accent') this.applyAccent(true);
    if (name === 'toolbar') this.applyToolbar();
    if (name === 'footer') this.applyFooter();
  }

  /**
   * Editor-chrome typography only. The default lives in `--ed-font`; a host
   * may pass any valid CSS font-family string, or `inherit` to snapshot the
   * host element's computed family. Email-document typography remains owned
   * by the document theme and is deliberately unaffected.
   */
  applyUiFont() {
    if (!this.mc) return;
    const requested = (this.getAttribute('ui-font') || '').trim();
    if (!requested) {
      this.mc.style.removeProperty('--ed-font');
      return;
    }
    const resolved = requested.toLowerCase() === 'inherit'
      ? getComputedStyle(this).fontFamily
      : requested;
    this.mc.style.setProperty('--ed-font', resolved || 'inherit');
  }

  /**
   * Resolves the `accent` attribute to a plain color string. Three spellings,
   * because a host's brand color lives in a different place in each app:
   *
   *   accent="#e11d48"           a literal color
   *   accent="var(--brand)"      a design-system token, read off the host
   *                              element (custom properties inherit through
   *                              the shadow boundary, so the host's value is
   *                              the one that resolves), with the optional
   *                              `var(--brand, #fallback)` fallback honored
   *   accent="inherit"           the host's computed `accent-color` -- the
   *                              standard CSS property for exactly this, so a
   *                              host that already sets it gets the editor for
   *                              free
   *
   * Returns '' when there is nothing usable, which leaves the built-in accent
   * in place rather than guessing.
   */
  resolveAccentValue(requested) {
    if (typeof getComputedStyle !== 'function') return requested;
    const hostStyle = getComputedStyle(this);
    if (requested.toLowerCase() === 'inherit') {
      const declared = (hostStyle.accentColor || '').trim();
      return !declared || declared === 'auto' ? '' : declared;
    }
    const ref = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/.exec(requested);
    if (!ref) return requested;
    return (hostStyle.getPropertyValue(ref[1]) || '').trim() || (ref[2] || '').trim();
  }

  /**
   * Host brand color for the editor chrome. One attribute drives all four
   * accent tokens (`core/accent.js` does the derivation) instead of asking a
   * host to hand-pick a hover shade, a legible ink color and a wash alpha --
   * and it re-derives per chrome, since the shade that reads on white panels
   * is not the one that reads on the dark ones.
   *
   * Applied as inline custom properties on `#mc`: the stylesheet declares the
   * defaults on that same element, so only an inline value can outrank them.
   * Email-document colors are untouched -- those belong to the template, not
   * to the app hosting the editor.
   *
   * `force` skips the memo. Nothing notifies an element that a CSS custom
   * property it reads has changed, so a host whose own `--brand` moved (a
   * brand switcher, a tenant theme) re-sets the attribute to the same string
   * to ask for a re-derive -- and the memo would otherwise swallow that.
   */
  applyAccent(force) {
    if (!this.mc) return;
    const requested = (this.getAttribute('accent') || '').trim();
    const chrome = this.core.state?.chrome || 'light';
    // Both halves matter: the same brand color resolves to different tokens in
    // light and dark chrome, so a toggle has to re-derive.
    const key = requested + '|' + chrome;
    if (!force && key === this._accentKey) return;
    this._accentKey = key;
    const clear = () => ACCENT_VARS.forEach((name) => this.mc.style.removeProperty(name));
    if (!requested) { clear(); return; }

    const value = this.resolveAccentValue(requested);
    // Named colors ("rebeccapurple") and anything else only a browser can
    // resolve go through a throwaway probe: set it as a color, read back what
    // the engine computed. Parsing first keeps the common case DOM-free.
    const color = parseColor(value) || parseColor(this.probeColor(value));
    if (!color) {
      clear();
      console.warn('[mailcraft] accent="' + requested + '" is not a usable color -- keeping the built-in accent.');
      return;
    }
    const tokens = accentTokens(color, chrome);
    for (const [name, v] of Object.entries(tokens)) this.mc.style.setProperty(name, v);
  }

  /** Asks the engine what a color string computes to. Returns '' when there is no layout to ask (SSR, a test DOM) or the value was rejected. */
  probeColor(value) {
    if (!value || typeof getComputedStyle !== 'function' || typeof document === 'undefined') return '';
    const probe = document.createElement('span');
    probe.style.display = 'none';
    probe.style.color = value;
    // CSSOM drops a value it cannot parse, leaving `color` empty -- and a
    // probe with no color of its own computes to the *inherited* one, which
    // would sail through parseColor and repaint the chrome in --ed-text.
    if (!probe.style.color) return '';
    // A detached node computes to nothing in some engines -- park it inside
    // the shadow root, where it can neither be seen nor affect layout.
    this.mc.appendChild(probe);
    const computed = (getComputedStyle(probe).color || '').trim();
    probe.remove();
    return computed;
  }

  /**
   * Host-controlled chrome: a `theme` attribute ("light"/"dark") wins over
   * whatever chrome was persisted, and while it's present the built-in
   * light/dark toggle is hidden (see renderInner) -- the host owns the
   * control, so the two can never fight. Removing the attribute hands
   * control back to the built-in toggle.
   */
  applyTheme() {
    const v = this.getAttribute('theme');
    if (v) this.core.setState({ chrome: v === 'dark' ? 'dark' : 'light' });
    else if (this.core.state) this.core.emit();
  }

  /**
   * Resolves the `locale` attribute to its shipped message table
   * (core/i18n/loaders.js) and overlays any host-set `.messages` on top --
   * attribute picks the language, `.messages` stays the documented way to
   * override individual strings. With no locale attribute this degrades to
   * the old behavior: `.messages` alone over built-in English.
   *
   * Tables load lazily (a literal dynamic import per tag, so app bundlers
   * code-split them instead of shipping all 31). A not-yet-loaded locale
   * renders English for the tick the chunk takes to arrive, then this method
   * re-runs; the load is a no-op re-render if the attribute changed again
   * meanwhile -- the guard re-reads the live attribute, never the old tag.
   */
  refreshTranslator() {
    const tag = this.getAttribute('locale') || '';
    let table = tag ? localeTable(tag) : null;
    if (table === undefined) {
      table = null;
      loadLocale(tag).then(() => {
        if ((this.getAttribute('locale') || '') === tag) this.refreshTranslator();
      });
    }
    const overrides = this.core.messages;
    this.core.t = createTranslator(table ? Object.assign({}, table, overrides || {}) : overrides);
    this.story?.retranslate();
    this.core.emit();
  }

  /** `dir` wins when the host sets it explicitly; otherwise it defaults from `isRtl(locale)` so `locale="ar"` gets RTL for free. Applied directly to `#mc` (not full state, since it only mirrors the editor chrome). The email sheet, the code editor, and the value-shaped inspector fields pin their own `dir` so the document being built never flips with the chrome (see render/canvas.js renderDoc). */
  applyDir() {
    if (!this.mc) return;
    const explicit = this.getAttribute('dir');
    this.mc.setAttribute('dir', explicit || (isRtl(this.getAttribute('locale')) ? 'rtl' : 'ltr'));
  }

  // ---- public API ----------------------------------------------------

  /**
   * Internal, and deliberately undocumented for hosts: the document object is
   * this package's own representation, not a format anyone else should have to
   * store, version or migrate. The host-facing contract is HTML in, HTML out
   * (`loadTemplate({ html })` / `exportHtml()`), and exported HTML is valid
   * input to the importer, so round-tripping through it is how a draft is
   * saved and restored.
   *
   * These stay because the editor needs them internally (undo, autosave, the
   * tests) and because a host that has genuinely outgrown HTML has somewhere
   * to go -- but nothing in README.md points here, and the shape is free to
   * change between versions.
   */
  getContent() { return JSON.parse(JSON.stringify(this.core.state.doc)); }
  setContent(doc) { this.core.loadDoc(doc); }
  /** Parses arbitrary HTML (a full email, a fragment, MailCraft's own exported output) into native blocks wherever the shape is recognizable, replacing the current document. See `core/import-html.js` for the per-shape rules. */
  importHtml(html) { return this.core.importHtml(html); }
  get variables() { return this.core.vars(); }
  set variables(value) { this.core.variablesRaw = value; this.core.emit(); }

  /**
   * Which parts of the editor's own top bar are shown -- `false` for no bar at
   * all, or an object switching individual parts off:
   *
   *   editor.toolbar = false;                          // no bar
   *   editor.toolbar = { logo: false, ai: false };     // keep the rest
   *   <mailcraft-editor toolbar="none">                // markup, no bar
   *   <mailcraft-editor toolbar="undo,redo,export">    // markup, only these
   *
   * Switchable parts: logo, status, device, undo, redo, theme, ai, code,
   * preview, export. Hiding a control does not remove the capability -- every
   * one of them is also a method here, so a host that renders its own bar
   * keeps all of it. Keyboard shortcuts are unaffected either way.
   *
   * The property wins over the attribute once set, the same way `.messages`
   * wins over `locale`.
   */
  get toolbar() { return this._toolbar !== undefined ? this._toolbar : (this.getAttribute('toolbar') || ''); }
  set toolbar(value) { this._toolbar = value; this.applyToolbar(); }

  /** The resolved `{ item: boolean }` map, or null when there is to be no bar. */
  toolbarConfig() { return resolveToolbar(this._toolbar !== undefined ? this._toolbar : this.getAttribute('toolbar')); }

  /**
   * Rebuilds the shell when, and only when, the resolved config actually
   * changed. The header is built once (it is not part of the per-state render
   * path), so switching a part on or off has to go through buildShell -- and
   * that also re-creates every modal and the story viewer, which is not
   * something to do on a set that changes nothing.
   */
  applyToolbar() {
    if (!this.core || !this.shadowRoot.firstChild) return;
    const key = toolbarKey(this.toolbarConfig());
    if (key === this._toolbarKey) return;
    this._toolbarKey = key;
    this.buildShell();
    this.applyUiFont();
    this.applyAccent();
    this.applyDir();
    this.applyTheme();
    this.render();
  }

  /**
   * The attribution strip: `false`/`"none"` removes it, a string replaces the
   * line, `{ text, href, target }` gives it a link. Unset shows the built-in
   * "Powered by SELISE Blocks" line, which follows `locale` and `.messages`
   * (key `footer.poweredBy`) like every other label. See core/footer.js.
   */
  get footer() { return this._footer !== undefined ? this._footer : (this.getAttribute('footer') || ''); }
  set footer(value) { this._footer = value; this.applyFooter(); }

  get uiFont() { return this.getAttribute('ui-font') || ''; }
  set uiFont(value) {
    if (value == null || String(value).trim() === '') this.removeAttribute('ui-font');
    else this.setAttribute('ui-font', String(value));
  }

  /** The host's brand color for the editor chrome -- a CSS color, `var(--your-token)`, or `inherit` (the host's `accent-color`). Setting '' or null hands the chrome back to the built-in accent. */
  get accent() { return this.getAttribute('accent') || ''; }
  set accent(value) {
    if (value == null || String(value).trim() === '') this.removeAttribute('accent');
    else this.setAttribute('accent', String(value));
  }

  get aiProvider() { return this.core.aiProvider; }
  set aiProvider(fn) { this.core.aiProvider = fn; }

  /** UI string overrides -- an overlay on the built-in English table (or whichever locale table the host also passed in), never a replacement, so a partial translation shows English where it's incomplete rather than a gap. Import a locale from `core/i18n/<tag>.js`, or merge one with your own overrides via `defineMessages` (`core/i18n/index.js`). */
  get messages() { return this.core.messages; }
  set messages(value) { this.core.messages = value; this.refreshTranslator(); }

  /** Optional `(platformKey, {label, size, color}) => Node` -- lets a host app supply its own social-icon art (e.g. brand SVGs) instead of the built-in set. Falls back to the built-in icon whenever it's unset, throws, or returns something that isn't a DOM node. */
  get iconProvider() { return this.core.iconProvider; }
  set iconProvider(fn) { this.core.iconProvider = fn; this.core.emit(); }

  /**
   * Host-supplied file storage -- see `core/storage.js` for the contract, and
   * README.md for a worked example. The package ships no files of its own: with
   * nothing set here the library opens empty and holds only what is dropped
   * into it, in this browser, in this draft. Setting a provider hands the whole
   * library to the backend -- folders, paging, upload and delete all go through
   * it, and nothing is written to localStorage. Set `null` to go back.
   */
  get storageProvider() { return this.core.storageProvider; }
  set storageProvider(provider) { this.core.setStorageProvider(provider); }

  /**
   * What may be uploaded: `{ accept, maxBytes, maxWidth, maxHeight, maxFilesPerDrop, allowSvg }`.
   * Only `maxBytes` is required alongside a provider -- sizes depend on the
   * sending platform and the host's own rules, none of which this package can
   * know. `accept` is optional and defaults to every image type the validator
   * can recognize; list MIME types to narrow it. See `core/storage-limits.js`.
   */
  get storageLimits() { return this.core.storageLimits; }
  set storageLimits(limits) { this.core.setStorageLimits(limits); }

  /**
   * Applies one host-supplied template as an undoable edit. Template galleries
   * are host UI -- the editor has no tab for them and ships no catalogue --
   * so this is the whole seam: the host renders its own picker and pushes the
   * chosen template in. `tpl` carries one of three sources: `doc` (a document
   * object), `build()` (one made per use), or `html` (a raw email string, run
   * through the importer). `examples/templates/` holds ready-made HTML ones.
   * The other direction is `getContent()`, to capture the current document
   * back out as a template of the host's own.
   */
  loadTemplate(tpl) { this.core.loadTemplate(tpl); }

  /** `options.markers: false` omits the fidelity-marker attributes (`data-mc*`, the inert `mc-keep` class) for hosts that want pristine HTML -- at the price of a lossy reload for the few blocks whose rendered shape cannot be read back (countdown, video, section box, code, raw CSS, flex/grid rows). */
  exportHtml(options) {
    const html = this.core.buildHtml(options);
    this.dispatchEvent(new CustomEvent('export', { detail: html }));
    return html;
  }

  /**
   * Full-template screenshot as an image Blob (2x resolution by default,
   * desktop width, independent of the current device/zoom view). `options`
   * is the compression dial: `{ format: 'png' | 'jpeg' | 'webp', quality:
   * 0..1 (lossy formats, default 0.85), scale (default 2) }`. PNG is
   * lossless; JPEG/WebP are typically a fraction of the size on a long
   * template. Read the returned `blob.type` for what was actually encoded --
   * a browser without a WebP encoder hands back PNG. See
   * render/screenshot.js for the technique and its limits.
   */
  screenshotPng(options) { return captureTemplatePng(this.core, this.mc, options); }

  /** Opens the story-style viewer over the editor and captures into it -- what the Screenshot button does. Nothing touches the filesystem until the user picks Download inside it. */
  previewScreenshot() { this.story.open(); }

  /** `screenshotPng(options)` plus the same save-a-file flow as the HTML export download, with success/failure toasts. Pass an already-captured blob (the story viewer does) to save that one instead of rendering a second time; the filename extension follows the blob's actual type. */
  async downloadScreenshot(blob, options) {
    const t = this.core.t;
    try {
      const png = blob || await this.screenshotPng(options);
      const ext = { 'image/jpeg': 'jpg', 'image/webp': 'webp' }[png.type] || 'png';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(png);
      a.download = 'email.' + ext;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1500);
      this.core.flash(t('toast.pngSaved'));
    } catch {
      this.core.flash(t('toast.pngFailed'));
    }
  }

  /** The screenshot onto the system clipboard as an image. Needs a secure context and `ClipboardItem`; where either is missing this reports the failure rather than appearing to succeed. */
  async copyScreenshot(blob) {
    const t = this.core.t;
    try {
      // Safari only honours `clipboard.write()` while the user gesture is
      // still live, and awaiting the capture first (per-image fetch +
      // inline, decode, rasterize, PNG encode) always outlives it --
      // NotAllowedError on every attempt, where Chromium is lenient and
      // lets it through. Handing ClipboardItem the *promise* is the
      // supported shape for exactly this: the write is issued
      // synchronously with the gesture and the capture resolves inside
      // it. Chromium accepts the same form, so there is no branch here.
      const png = blob ? Promise.resolve(blob) : this.screenshotPng();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      this.core.flash(t('toast.pngCopied'));
    } catch {
      this.core.flash(t('toast.pngCopyFailed'));
    }
  }

  undo() { this.core.undo(); }
  redo() { this.core.redo(); }

  // ---- shell (built once) ---------------------------------------------

  buildShell() {
    const root = this.shadowRoot;
    root.innerHTML = '';
    root.appendChild(elS('style', '', { text: STYLE }));

    // A rebuild throws away the `#mc` that carried the inline accent tokens,
    // so the memo of what was last applied has to go with it.
    this._accentKey = null;
    this.mc = elS('div', 'height: 100%; padding: 16px; box-sizing: border-box; background: radial-gradient(circle at 8% 0%, var(--ed-soft), transparent 28%), var(--ed-bg); color: var(--ed-text); font-family: var(--ed-font); font-size: 14px; overflow-x: auto; overflow-y: hidden;', { id: 'mc' });
    root.appendChild(this.mc);

    const outer = elS('div', 'position: relative; height: 100%; min-width: 1180px;');
    this.mc.appendChild(outer);

    // Header nodes are re-created below (or not at all). Clearing them first
    // means a rebuild that drops the bar cannot leave the refreshers pointing
    // at detached nodes they would then keep writing to.
    this.savedLabel = this.savedDot = this.deviceSeg = null;
    this.undoBtn = this.redoBtn = this.chromeBtn = null;
    this.aiBtn = this.codeBtn = this.previewBtn = this.exportBtn = null;

    const bar = this.toolbarConfig();
    this.frame = elS('div', 'position: relative; height: 100%; border: 1px solid var(--ed-line-2); border-radius: var(--ed-radius); background: var(--ed-panel); display: grid; grid-template-rows: ' + (bar ? '54px minmax(0, 1fr)' : 'minmax(0, 1fr)') + '; overflow: hidden; box-shadow: var(--ed-shadow-sm), var(--ed-shadow-md);', { class: 'mc-shell' + (bar ? '' : ' mc-no-header') });
    outer.appendChild(this.frame);

    if (bar) this.frame.appendChild(this.buildHeader(bar));

    this.footerBar = this.footerText = this.footerLink = null;

    this.body = elS('div', 'display: grid; grid-template-columns: minmax(0, 1fr) 340px; grid-template-rows: minmax(0, 1fr) auto; min-height: 0; background: var(--ed-work);', { class: 'mc-layout' });
    this.frame.appendChild(this.body);
    this.body.appendChild(this.buildMain());
    this.body.appendChild(this.buildAside());
    this.body.appendChild(this.buildFooter());

    this.libraryModal = this.buildLibraryModal();
    this.exportModal = this.buildExportModal();
    this.codeModal = this.buildCodeModal();
    this.aiModal = this.buildAiModal();
    this.previewModal = this.buildPreviewModal();
    // Not a state-driven modal like the others: the story viewer is opened
    // imperatively and runs its own timers, so an editor re-render behind it
    // (an autosave, a toast) can never interrupt playback mid-screen.
    this.story = createStoryViewer(this.core, {
      capture: () => this.screenshotPng(),
      download: (blob) => this.downloadScreenshot(blob),
      copy: (blob) => this.copyScreenshot(blob),
    });
    this.toastEl = elS('div', "position: absolute; bottom: 74px; left: 50%; transform: translateX(-50%); z-index: 80; background: var(--ed-text); color: var(--ed-bg); padding: 9px 16px; border-radius: var(--ed-radius-sm); font-family: ui-monospace, monospace; font-size: 10.5px; letter-spacing: 0.08em; box-shadow: var(--ed-shadow-md); animation: mcIn 0.18s ease; display: none;", { class: 'mc-toast' });
    outer.append(this.libraryModal, this.exportModal, this.codeModal, this.aiModal, this.previewModal, this.story.node, this.toastEl);

    this.fileInput = elS('input', 'display: none;', { type: 'file', accept: 'image/*', multiple: 'true' });
    this.fileInput.addEventListener('change', (e) => { this.core.addFiles(e.target.files); e.target.value = ''; });
    outer.appendChild(this.fileInput);
  }

  // ---- header -----------------------------------------------------------

  buildHeader(on) {
    const t = this.core.t;
    const header = elS('header', "display: flex; align-items: center; gap: 14px; padding: 0 16px; border-bottom: 1px solid var(--ed-line); background: linear-gradient(to bottom, var(--ed-panel), var(--ed-panel-2)); position: relative; z-index: 30;", { class: 'mc-header' });

    // The logo itself, not a mark beside a typeset word: the wordmark is part
    // of the artwork, so it keeps the brand's own typeface whatever font the
    // host pushes into --ed-font.
    const brand = elS('div', 'display: flex; align-items: center;', { class: 'mc-brand' });
    brand.appendChild(brandLockup(30));
    if (on.logo) header.append(brand, elS('div', 'width: 1px; height: 22px; background: var(--ed-line);'));

    this.savedLabel = elS('span', 'display: flex; align-items: center; gap: 6px; font-family: ui-monospace, monospace; font-size: 9.5px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ed-faint); white-space: nowrap;');
    // No infinite pulse: a forever-running animation keeps the compositor
    // producing frames while the editor is idle -- constant CPU on low-end
    // hardware for a decorative effect. A solid dot still reads "autosave on".
    this.savedDot = elS('span', 'width: 5px; height: 5px; border-radius: 50%; background: var(--ed-accent);');
    this.savedLabel.appendChild(this.savedDot);
    this.savedLabel.appendChild(document.createTextNode(''));
    if (on.status) header.appendChild(this.savedLabel);
    else this.savedLabel = this.savedDot = null;

    header.appendChild(elS('div', 'flex: 1;'));

    if (on.device) {
      this.deviceSeg = elS('div', '', { class: 'mc-segment mc-device-segment' });
      header.appendChild(this.deviceSeg);
    }

    const iconButtons = elS('div', 'display: flex; align-items: center; gap: 3px;');
    if (on.undo) this.undoBtn = this.iconBtn('undo', t('action.undoHint'), () => this.core.undo(), 'action.undoHint');
    if (on.redo) this.redoBtn = this.iconBtn('redo', t('action.redoHint'), () => this.core.redo(), 'action.redoHint');
    if (on.theme) this.chromeBtn = this.labelIconBtn('moon', t('action.chromeToDark'), t('action.chromeHint'), () => {
      const chrome = this.core.state.chrome === 'light' ? 'dark' : 'light';
      this.core.setState({ chrome }, () => this.core.persist(null, null, chrome));
    }, 'action.chromeHint');
    if (this.chromeBtn) {
      this.chromeBtn.i18nTipKey = this.core.state.chrome === 'light' ? 'action.chromeHintToDark' : 'action.chromeHintToLight';
      this.chromeBtn.tipNode.textContent = t(this.chromeBtn.i18nTipKey);
    }
    if (on.ai) this.aiBtn = this.labelIconBtn('spark', t('action.aiDraft'), t('action.aiDraftHint'), () => this.core.setState({ aiOpen: true }), 'action.aiDraftHint', 'action.aiDraft');
    if (on.code) this.codeBtn = this.labelIconBtn('code', t('action.code'), t('action.codeHint'), () => this.core.openCode(), 'action.codeHint', 'action.code');
    if (on.preview) this.previewBtn = this.labelIconBtn('eye', t('action.preview'), t('action.previewHint') || '', () => this.core.setState({ previewOpen: true }), 'action.previewHint', 'action.preview');
    if (on.export) this.exportBtn = this.labelIconBtn('download', t('action.export'), t('action.exportHint'), () => this.core.openExport(), 'action.exportHint', 'action.export');

    const actions = [this.undoBtn, this.redoBtn, this.chromeBtn, this.aiBtn, this.codeBtn, this.previewBtn, this.exportBtn].filter(Boolean);
    if (actions.length) {
      iconButtons.append(...actions);
      header.appendChild(iconButtons);
    }
    return header;
  }

  /** `titleKey` (when given) is written as `data-i18n-title` so `refreshStrings()` keeps the tooltip in sync with the active translator after `.messages` changes post-mount -- `title` itself only sets the initial value. */
  iconBtn(name, title, onClick, titleKey) {
    const btn = elS('button', 'border: 1px solid var(--ed-line); background: var(--ed-panel); color: var(--ed-text); cursor: pointer; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; transition: border-color 0.16s, background 0.16s;', { type: 'button', title, 'data-i18n-title': titleKey || undefined, class: 'mc-icon-button' });
    btn.appendChild(icon(name, 15));
    btn.addEventListener('mouseenter', () => { if (!btn.disabled) { btn.style.borderColor = 'var(--ed-accent)'; btn.style.background = 'var(--ed-soft)'; } });
    btn.addEventListener('mouseleave', () => { btn.style.borderColor = 'var(--ed-line)'; btn.style.background = 'var(--ed-panel)'; });
    btn.addEventListener('click', onClick);
    tip(btn, title, 'down');
    return btn;
  }

  /**
   * Always creates a real text node for the label (even if empty) and exposes it as `btn.labelNode`, so a caller that updates the label later never has to guess at `lastChild` -- guessing wrong there once already corrupted the chrome-toggle icon (its `lastChild` was the `<svg>`, and `.textContent = ...` on it wiped out the icon's paths).
   * `labelKey`/`titleKey` (when given) are stashed on the button itself (not as `data-i18n`, since a generic textContent sweep would wipe the icon the same way `lastChild` guessing used to) so `refreshStrings()` can target `labelNode`/`title` directly.
   */
  labelIconBtn(iconName, label, title, onClick, titleKey, labelKey) {
    const btn = elS('button', 'border: 1px solid var(--ed-line); background: var(--ed-panel); color: var(--ed-text); cursor: pointer; height: 30px; padding: 0 10px; display: flex; align-items: center; gap: 6px; font-family: ui-monospace, monospace; font-size: 9.5px; letter-spacing: 0.12em; text-transform: uppercase; transition: border-color 0.16s, background 0.16s;', { type: 'button', title, class: 'mc-icon-label' });
    btn.i18nTitleKey = titleKey || null;
    btn.i18nLabelKey = labelKey || null;
    if (iconName) {
      btn.iconNode = icon(iconName, 14);
      btn.iconName = iconName;
      btn.appendChild(btn.iconNode);
    }
    btn.labelNode = document.createTextNode(label || '');
    btn.appendChild(btn.labelNode);
    btn.addEventListener('mouseenter', () => { btn.style.borderColor = 'var(--ed-accent)'; btn.style.background = 'var(--ed-soft)'; });
    btn.addEventListener('mouseleave', () => { btn.style.borderColor = 'var(--ed-line)'; btn.style.background = 'var(--ed-panel)'; });
    btn.addEventListener('click', onClick);
    return tip(btn, title, 'down');
  }

  // ---- shared panel-design helpers (flat-accordion system) ----------------

  /**
   * Flat-accordion section chrome, identical to the Design/Settings tabs'
   * (render/fields.js renderFieldCards): a full-width uppercase bar and a
   * body directly on the panel surface. This replaced the floating white
   * cards on a gray gutter -- three panel languages across the tabs read as
   * three different products, and the card-in-card nesting was exactly the
   * boxes-in-boxes the inspector redesign removed. `right` (element or
   * string) sits flush right for counts/meta. The mc-section-* classes keep
   * these restylable panel-wide (render/style.js).
   */
  sectionBar(label, right) {
    const bar = elS('div', 'display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 11px 14px; background: var(--ed-panel-2); border-top: 1px solid var(--ed-line); border-bottom: 1px solid var(--ed-line); user-select: none;', { class: 'mc-section-bar' });
    bar.appendChild(elS('span', 'font-family: var(--ed-font); font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ed-muted);', { text: label, class: 'mc-section-label' }));
    if (right) bar.appendChild(typeof right === 'string' ? elS('span', 'font-size: 10px; font-weight: 600; color: var(--ed-faint); flex: none;', { text: right }) : right);
    return bar;
  }

  /** The section's content surface, matching renderFieldCards' body. */
  sectionBody(extraStyle) {
    return elS('div', 'padding: 12px 14px 16px; background: var(--ed-panel);' + (extraStyle || ''), { class: 'mc-section-body' });
  }

  /** Every non-field tab shares this shell: white panel to the bottom, sections stacked flush. */
  tabSurface() {
    return elS('div', 'background: var(--ed-panel); min-height: 100%; padding-bottom: 28px;', { class: 'mc-tab-surface' });
  }

  /** The soft accent action chip -- the panel's secondary button (field `btn` fields share the recipe in render/fields.js). */
  softBtn(label, iconName, onClick) {
    const btn = elS('button', 'width: 100%; border: 0; border-radius: 8px; background: var(--ed-soft); color: var(--ed-accent); cursor: pointer; padding: 8px 10px; display: flex; align-items: center; justify-content: center; gap: 6px; font-family: var(--ed-font); font-size: 11.5px; font-weight: 600; transition: background 0.16s, color 0.16s;', { type: 'button' });
    if (iconName) btn.appendChild(icon(iconName, 13));
    btn.appendChild(elS('span', '', { text: label }));
    btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--ed-accent)'; btn.style.color = 'var(--ed-accent-ink)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'var(--ed-soft)'; btn.style.color = 'var(--ed-accent)'; });
    btn.addEventListener('click', onClick);
    return btn;
  }

  /** Show/hide the toast -- driven surgically by core.onToast so its 1.9s
   * auto-dismissal never costs (or interrupts anything with) a full render. */
  refreshToast() {
    const s = this.core.state;
    this.toastEl.style.display = s.toast ? 'block' : 'none';
    this.toastEl.textContent = s.toast || '';
  }

  /** Repaint just the countdown digits on the canvas -- and in the preview,
   * whose sheet is now memoized rather than rebuilt every render -- driven by
   * the core's 1s tick (core.onTick), which used to re-render the whole editor. */
  refreshCountdowns() {
    const now = this.core.state.now;
    const slots = this.core.state.previewOpen && this.previewSlot ? [this.canvasSlot, this.previewSlot] : [this.canvasSlot];
    slots.forEach((slot) => slot.querySelectorAll('[data-mc-countdown]').forEach((wrap) => {
      const ms = Math.max(0, new Date(wrap.getAttribute('data-mc-countdown')).getTime() - now);
      const vals = { days: Math.floor(ms / 86400000), hrs: Math.floor(ms / 3600000) % 24, min: Math.floor(ms / 60000) % 60, sec: Math.floor(ms / 1000) % 60 };
      wrap.querySelectorAll('[data-mc-count]').forEach((n) => {
        n.textContent = String(vals[n.getAttribute('data-mc-count')] ?? 0).padStart(2, '0');
      });
    }));
  }

  /** The header's "Saved HH:MM" label -- autosave updates it through
   * core.onSavedChange, surgically: it is the only thing autosave changes
   * on screen, and a full render for it destroyed open dropdowns. */
  refreshSavedLabel() {
    if (!this.savedLabel) return;
    const s = this.core.state; const t = this.core.t;
    this.savedLabel.lastChild.textContent = s.savedStatus === 'error' ? t('status.saveFailed')
      : s.savedStatus === 'saved' ? t('status.saved', { time: s.savedAt }) : t('status.autosaveOn');
    this.savedDot.style.background = s.savedStatus === 'error' ? 'var(--ed-danger)' : s.savedStatus === 'saved' ? 'var(--ed-success)' : 'var(--ed-accent)';
    this.savedLabel.style.color = s.savedStatus === 'error' ? 'var(--ed-danger)' : 'var(--ed-faint)';
  }

  /** Refresh only the floating rich-text toolbar after a caret/format change.
   * The editable block itself remains mounted, so native selection, IME,
   * pointer capture and scroll position stay untouched. */
  scheduleRteRefresh() {
    if (this._rteFrame != null) return;
    this._rteFrame = requestAnimationFrame(() => {
      this._rteFrame = null;
      if (this.core.rendering || !this.core.state.editing) return;
      const current = this.canvasSlot?.querySelector('[data-mc-rte="1"]');
      const found = this.core.find(this.core.state.doc, this.core.state.editing);
      if (!current || !found.block) return;
      // Skip the rebuild when nothing the toolbar displays changed -- see
      // formatFingerprint (editor-core.js). A drag selection fires this every
      // frame, and rebuilding the toolbar each frame stuttered the selection.
      const print = this.core.formatFingerprint(found.block);
      if (print === this._rtePrint) return;
      this._rtePrint = print;
      current.replaceWith(renderRte(this.core, found.block));
    });
  }

  // ---- footer (attribution strip) -----------------------------------------

  /**
   * Built once with the rest of the shell, then only refreshed -- like the
   * header, it is not part of the state-driven render tree. Both a plain
   * `<span>` and an `<a>` are created up front and toggled in `refreshFooter`:
   * a host can add or drop a link at runtime, and swapping tag names mid-flight
   * would strand whichever node the previous render had left in place.
   */
  buildFooter() {
    this.footerBar = elS('div', 'display: flex; grid-column: 1; grid-row: 2; justify-self: center; align-items: center; justify-content: center; gap: 4px; max-width: calc(100% - 32px); padding: 6px 14px; background: transparent; color: var(--ed-panel-meta); font-family: var(--ed-font); font-size: var(--ed-panel-meta-size); letter-spacing: 0.06em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;', { class: 'mc-footer' });
    this.footerText = elS('span', '', { class: 'mc-footer-text' });
    this.footerLink = elS('a', 'color: inherit; text-decoration: none;', { class: 'mc-footer-link' });
    this.footerBar.appendChild(this.footerText);
    this.footerBar.appendChild(this.footerLink);
    return this.footerBar;
  }

  /** The resolved `{ text, href, target }`, or null when there is to be no strip. */
  footerConfig() { return resolveFooter(this._footer !== undefined ? this._footer : this.getAttribute('footer')); }

  /**
   * Text, link and visibility in one pass, run every render: it is three
   * property writes, and memoizing it would have to account for the
   * translator too -- the default line follows `locale`/`.messages`, so a
   * config-shaped memo would freeze the wrong string.
   */
  refreshFooter() {
    if (!this.footerBar) return;
    const cfg = this.footerConfig();
    if (!cfg) { this.footerBar.style.display = 'none'; return; }
    this.footerBar.style.display = 'flex';
    this.footerBar.style.width = (this.core.state.device === 'mobile' ? 375 : this.core.state.doc.theme.width) + 'px';

    const text = cfg.text == null ? this.core.t('footer.poweredBy') : cfg.text;
    const linked = !!cfg.href;
    this.footerText.style.display = linked ? 'none' : 'inline';
    this.footerLink.style.display = linked ? 'inline' : 'none';
    // The idle node is emptied, not just hidden: display:none still counts
    // toward textContent, and a stale line there would reach anything reading
    // the strip -- a screen reader's text pass included.
    this.footerText.textContent = linked ? '' : text;
    this.footerLink.textContent = linked ? text : '';
    if (linked) {
      this.footerLink.setAttribute('href', cfg.href);
      // A footer link leaves the editor, and the editor is embedded in the
      // host's page -- opening in place would take the user's unsaved work
      // with it. `rel` goes with the new tab, not as an afterthought.
      this.footerLink.setAttribute('target', cfg.target || '_blank');
      this.footerLink.setAttribute('rel', 'noopener noreferrer');
    }
  }

  /** Re-reads the config after an attribute or property change. Never rebuilds: the strip is one node whose contents are cheap to rewrite. */
  applyFooter() { this.refreshFooter(); }

  // ---- main (canvas) ------------------------------------------------------

  buildMain() {
    const main = elS('main', '', { class: 'mc-workspace' });
    this.mainEl = main;
    main.style.cssText = 'grid-column: 1; grid-row: 1; position: relative; overflow-y: auto; min-height: 0;';
    main.addEventListener('click', () => { if (this.core.state.sel) this.core.setState({ sel: null }); });

    const pad = elS('div', 'padding: 28px 40px 150px; display: flex; justify-content: center;', { class: 'mc-canvas-stage' });
    this.zoomFrame = elS('div', 'position: relative; transform-origin: top center; transition: transform 0.22s cubic-bezier(0.22,0.61,0.36,1);');
    this.canvasSlot = elS('div', '', { class: 'mc-sheet-wrap' });
    this.zoomFrame.appendChild(this.canvasSlot);
    pad.appendChild(this.zoomFrame);
    main.appendChild(pad);

    const dock = elS('div', 'position: sticky; bottom: 0; display: flex; justify-content: center; pointer-events: none; padding-bottom: 16px;');
    const pill = elS('div', 'pointer-events: auto; display: flex; align-items: center; gap: 12px; border: 1px solid var(--ed-line-2); border-radius: var(--ed-radius); background: var(--ed-panel); padding: 6px 8px 6px 12px; box-shadow: var(--ed-shadow-md);', { class: 'mc-zoom' });
    this.canvasMetaEl = elS('span', 'font-family: ui-monospace, monospace; font-size: 9.5px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ed-faint); white-space: nowrap;');
    this.zoomSeg = elS('div', 'display: flex; gap: 1px;');
    pill.append(this.canvasMetaEl, elS('span', 'width: 1px; height: 18px; background: var(--ed-line);'), this.zoomSeg);
    dock.appendChild(pill);
    main.appendChild(dock);
    return main;
  }

  // ---- aside (tabbed inspector) -------------------------------------------

  buildAside() {
    const aside = elS('aside', 'grid-column: 2; grid-row: 1 / span 2; border-left: 1px solid var(--ed-line); background: var(--ed-panel); display: grid; grid-template-rows: auto 1fr; min-height: 0;', { class: 'mc-inspector' });
    this.tabBar = elS('div', 'display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr);', { class: 'mc-tabbar', role: 'tablist' });
    aside.appendChild(this.tabBar);
    // overflow-x hidden: `overflow-y: auto` alone computes overflow-x to
    // auto, so anything a pixel too wide (a tooltip's hidden box, a long
    // unbreakable value) grew a horizontal scrollbar under the panel.
    this.tabBody = elS('div', 'overflow-y: auto; overflow-x: hidden; min-height: 0;');
    aside.appendChild(this.tabBody);
    return aside;
  }

  // ---- per-state render ---------------------------------------------------

  render() {
    // The RTE-edited block's own props (e.g. `props.html`) only update on
    // blur (see `blockCtx.onBlur`, canvas.js) -- that's what lets typing stay
    // fast (no per-keystroke commit/undo-history entry). But a render still
    // rebuilds that block's DOM node from `props.html` regardless, and
    // renders can happen while an edit is active (for example when another
    // editor control changes) -- so without syncing first, the next
    // keystroke's re-render would blow away whatever was just typed, reverting
    // it to the last-committed (pre-edit) value. Sync copies the live,
    // uncommitted DOM content into the model right before the rebuild reads
    // it -- a plain mutation, not `setProp`, so it doesn't push an undo entry.
    this.syncLiveEdit();
    // Marks the canvas rebuild below so `blockCtx.onBlur` (canvas.js) can tell
    // a real blur apart from the spurious one fired when this method removes
    // the still-focused block node while tearing down `canvasSlot`.
    this.core.rendering = true;
    // The full render below rebuilds the RTE toolbar on its own path, so the
    // fingerprint that lets scheduleRteRefresh skip no-op rebuilds is stale.
    this._rtePrint = null;
    // The workspace <main> and the inspector tab body are the two scroll
    // containers that survive a render (built once in buildShell) -- but the
    // rebuild below can still zero them: if anything forces synchronous
    // layout while a slot sits momentarily empty, the container's
    // scrollHeight collapses and the browser clamps its scrollTop to 0, and
    // re-appending the new tree never scrolls back. On a long template that
    // read as "click a text block (or touch the RTE at all) and the canvas
    // yanks to the top". Snapshot both here and put them back once the new
    // tree is in place -- focus restoration (focus-preserve.js) already uses
    // `preventScroll`, so nothing later in the same render fights this.
    const mainTop = this.mainEl ? this.mainEl.scrollTop : 0;
    const mainLeft = this.mainEl ? this.mainEl.scrollLeft : 0;
    const tabBefore = this._renderedTab;
    const tabTop = this.tabBody ? this.tabBody.scrollTop : 0;
    try {
      this.renderInner();
    } finally {
      this.core.rendering = false;
      // Every render rebuilds the canvas from props, so by here the live
      // contenteditable is a copy of them again -- whatever `editStale`
      // claimed is now true of the DOM as well (see `syncLiveEdit`).
      this.core.editStale = null;
    }
    if (this.mainEl) {
      if (this.mainEl.scrollTop !== mainTop) this.mainEl.scrollTop = mainTop;
      if (this.mainEl.scrollLeft !== mainLeft) this.mainEl.scrollLeft = mainLeft;
    }
    // A genuine tab switch should start at the top -- only same-tab rebuilds
    // (e.g. per-keystroke commits from a Design-tab field) restore.
    if (this.tabBody && this.core.state.tab === tabBefore && this.tabBody.scrollTop !== tabTop) this.tabBody.scrollTop = tabTop;
    this._renderedTab = this.core.state.tab;
  }

  syncLiveEdit() {
    const c = this.core;
    // One-shot right of way for the two cases where props are deliberately
    // *ahead* of the live contenteditable: a rich-content rewrite
    // (`syncRichContent`) and an undo/redo, both in editor-core.js. Syncing
    // the DOM back then is the "props are the truth" rule pointing the wrong
    // way -- it silently undid every Text size / color / spacing change made
    // while the block was focused, and every undo of one. Props win this one
    // render; the rebuild right after puts the new html into the DOM. The flag
    // The flag is cleared by the rebuild in `render()`, not here: a fold can
    // run several times (once per `setProp`) before the next frame, and
    // clearing it on the first of those handed the render back to the DOM
    // copy -- two quick clicks of the RTE's `+` moved nothing at all.
    if (c.editStale && c.editStale === c.state.editing) return;
    if (!c.state.editing || !c.editEl || !c.editEl.isConnected || !c.editKey) return;
    const found = c.find(c.state.doc, c.state.editing);
    if (!found.block) return;
    const val = c.editPlain ? c.editEl.textContent : c.editEl.innerHTML;
    // Unchanged since the render that built it (`editRendered`, canvas.js
    // `onFocus`) means there is no user edit to fold -- only the render's own
    // DOM decorations, which must not become part of the document.
    if (val === c.editRendered) return;
    if (val !== found.block.props[c.editKey]) found.block.props[c.editKey] = val;
  }

  /** Refreshes every static header/modal string tagged `data-i18n*` at build time, plus the handful of labelIconBtn buttons whose label lives in a `labelNode` text node (a generic textContent sweep would wipe their icon -- see `labelIconBtn`'s doc comment). Runs every render (cheap: property assignments only, no rebuild) so a `.messages`/`.locale` change after mount relabels chrome that was only ever built once. */
  refreshStrings() {
    const t = this.core.t;
    const root = this.shadowRoot;
    root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.getAttribute('data-i18n')); });
    root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.getAttribute('data-i18n-title')); });
    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.getAttribute('data-i18n-placeholder')); });
    [this.aiBtn, this.codeBtn, this.previewBtn, this.exportBtn].forEach((btn) => {
      if (!btn) return;
      if (btn.i18nTitleKey) btn.title = t(btn.i18nTitleKey);
      if (btn.i18nLabelKey) btn.labelNode.textContent = t(btn.i18nLabelKey);
      if (btn.i18nTitleKey && btn.tipNode) btn.tipNode.textContent = t(btn.i18nTitleKey);
    });
    if (this.chromeBtn?.i18nTitleKey) this.chromeBtn.title = t(this.chromeBtn.i18nTitleKey);
  }

  renderInner() {
    const s = this.core.state;
    const t = this.core.t;
    this.refreshStrings();

    this.mc.dataset.chrome = s.chrome;
    // Re-derives only when the brand color or the chrome actually changed --
    // the accent that clears contrast on white panels is not the one that
    // clears it on the dark palette.
    this.applyAccent();
    this.refreshFooter();
    this.refreshSavedLabel();

    if (this.undoBtn) this.undoBtn.disabled = !s.history.length;
    if (this.redoBtn) this.redoBtn.disabled = !s.future.length;
    // A host-supplied `theme` attribute owns light/dark (see applyTheme) --
    // hide the built-in toggle rather than let it fight the host's control.
    // setProperty(..., 'important'): a plain assignment loses to the
    // `!important` on `.mc-icon-label` (render/style.js) that keeps every
    // other label-icon button visible, leaving the toggle rendered anyway.
    if (this.chromeBtn) {
      this.chromeBtn.style.setProperty('display', this.hasAttribute('theme') ? 'none' : 'flex', 'important');
      this.chromeBtn.labelNode.textContent = s.chrome === 'light' ? t('action.chromeToDark') : t('action.chromeToLight');
      this.chromeBtn.i18nTipKey = s.chrome === 'light' ? 'action.chromeHintToDark' : 'action.chromeHintToLight';
      this.chromeBtn.tipNode.textContent = t(this.chromeBtn.i18nTipKey);
      this.chromeBtn.setAttribute('aria-label', t(this.chromeBtn.i18nTipKey));
      this.chromeBtn.title = t(this.chromeBtn.i18nTipKey);
      const chromeIcon = s.chrome === 'light' ? 'moon' : 'sun';
      if (this.chromeBtn.iconName !== chromeIcon) {
        const nextIcon = icon(chromeIcon, 14);
        this.chromeBtn.iconNode.replaceWith(nextIcon);
        this.chromeBtn.iconNode = nextIcon;
        this.chromeBtn.iconName = chromeIcon;
      }
    }

    this.renderDeviceSeg();
    this.renderZoomSeg();

    this.zoomFrame.style.transform = `scale(${s.zoom})`;
    // Build the new canvas tree *before* detaching the old one, and swap the
    // two atomically (`replaceChildren` evaluates its argument first): while
    // a block is being edited, `renderDoc` builds the RTE toolbar mid-tree,
    // and its `document.queryCommandState` calls force a synchronous layout.
    // With the previous `innerHTML = ''`-then-append order, that layout ran
    // while the slot was empty -- the workspace's scrollHeight collapsed for
    // an instant and the browser clamped its scrollTop to 0, which is what
    // scrolled a long template to the top on every RTE interaction.
    this.canvasSlot.replaceChildren(renderDoc(this.core, true));

    const blockCount = s.doc.rows.reduce((n, r) => n + r.cols.reduce((m, c) => m + c.blocks.length, 0), 0);
    this.canvasMetaEl.textContent = t('canvas.meta', { rows: s.doc.rows.length, blocks: blockCount, width: s.device === 'mobile' ? 375 : s.doc.theme.width });

    this.renderTabs();
    this.renderTabBody();

    this.renderLibraryModal();
    this.renderExportModal();
    this.renderCodeModal();
    this.renderAiModal();
    this.renderPreviewModal();

    this.refreshToast();
  }

  segBg(on) { return on ? 'var(--ed-accent)' : 'transparent'; }
  segFg(on) { return on ? 'var(--ed-accent-ink)' : 'var(--ed-muted)'; }

  renderDeviceSeg() {
    if (!this.deviceSeg) return;
    const s = this.core.state;
    const t = this.core.t;
    this.deviceSeg.innerHTML = '';
    [
      { label: t('device.desktop'), title: t('device.desktopHint'), v: 'desktop', iconName: 'monitor' },
      { label: t('device.mobile'), title: t('device.mobileHint'), v: 'mobile', iconName: 'phone' },
    ].forEach((d) => {
      const on = s.device === d.v;
      const btn = elS('button', `width: 32px; height: 26px; display: flex; align-items: center; justify-content: center; background: ${this.segBg(on)}; color: ${this.segFg(on)}; transition: background 0.16s, color 0.16s;`, { type: 'button', title: d.title, 'aria-pressed': String(on) });
      btn.appendChild(icon(d.iconName, 15));
      btn.addEventListener('mouseenter', () => { if (!on) { btn.style.background = 'var(--ed-soft)'; btn.style.color = 'var(--ed-accent)'; } else { btn.style.background = 'var(--ed-accent-strong)'; } });
      btn.addEventListener('mouseleave', () => { btn.style.background = this.segBg(on); btn.style.color = this.segFg(on); });
      btn.addEventListener('click', () => this.core.setState({ device: d.v }));
      tip(btn, d.label, 'down');
      this.deviceSeg.appendChild(btn);
    });
  }

  renderZoomSeg() {
    const s = this.core.state;
    this.zoomSeg.innerHTML = '';
    [0.75, 1, 1.25].forEach((z) => {
      const on = s.zoom === z;
      const btn = elS('button', `border: 0; border-radius: 7px; cursor: pointer; background: ${this.segBg(on)}; color: ${this.segFg(on)}; font-family: var(--ed-font); font-size: 10px; font-weight: 600; padding: 5px 9px; transition: background 0.16s, color 0.16s;`, { type: 'button', text: `${Math.round(z * 100)}%`, 'aria-pressed': String(on) });
      btn.addEventListener('click', () => this.core.setState({ zoom: z }));
      this.zoomSeg.appendChild(btn);
    });
  }

  renderTabs() {
    const s = this.core.state;
    this.tabBar.innerHTML = '';
    tabsFor(this.core.t).forEach((tabDef) => {
      const on = s.tab === tabDef.key;
      const btn = elS('button', `border: 0; border-radius: 8px 8px 0 0; border-bottom: 2px solid ${on ? 'var(--ed-accent)' : 'transparent'}; background: ${on ? 'var(--ed-panel)' : 'transparent'}; color: ${on ? 'var(--ed-accent)' : 'var(--ed-muted)'}; cursor: pointer; height: 39px; display: flex; align-items: center; justify-content: center; transition: color 0.16s, background 0.16s;`, { type: 'button', title: tabDef.title, role: 'tab', 'aria-selected': String(on) });
      btn.appendChild(icon(tabDef.iconName, 16));
      btn.addEventListener('mouseenter', () => { if (!on) { btn.style.color = 'var(--ed-accent)'; btn.style.background = 'var(--ed-soft)'; } });
      btn.addEventListener('mouseleave', () => { btn.style.color = on ? 'var(--ed-accent)' : 'var(--ed-muted)'; btn.style.background = on ? 'var(--ed-panel)' : 'transparent'; });
      btn.addEventListener('click', () => this.core.setState({ tab: tabDef.key }));
      tip(btn, tabDef.label, 'down');
      this.tabBar.appendChild(btn);
    });
  }

  renderTabBody() {
    // The browser's native colour dialog is bound to the identity of its
    // <input type="color"> node: Chromium closes the dialog the moment that
    // node leaves the document -- even if the same node is spliced back into
    // the rebuilt tree within the same task (unlike the range slider's mouse
    // capture, which focus-preserve.js does save that way). The picker lives
    // in this panel, and its `input` events commit (debounced) to the doc, so
    // every colour the user tried used to rebuild the panel ~120ms later and
    // slam the dialog shut. While the picker holds focus -- the only time its
    // dialog can be open -- the panel therefore skips its rebuild: the canvas
    // has already re-rendered above (that is the live preview), and the pill
    // previews itself (fields.js mutates its swatch and hex text directly on
    // every `input`). Nothing else in the panel changes on a colour commit,
    // so nothing is stale; the moment focus moves anywhere else, the next
    // render rebuilds the panel as usual.
    const active = this.shadowRoot.activeElement;
    if (active && active.tagName === 'INPUT' && active.type === 'color' && this.tabBody.contains(active)) return;
    this.tabBody.innerHTML = '';
    const tab = this.core.state.tab;
    if (tab === 'design') this.tabBody.appendChild(this.renderDesignTab());
    else if (tab === 'blocks') this.tabBody.appendChild(this.renderBlocksTab());
    else if (tab === 'rows') this.tabBody.appendChild(this.renderRowsTab());
    else if (tab === 'files') this.tabBody.appendChild(this.renderFilesTab());
    else if (tab === 'layers') this.tabBody.appendChild(this.renderLayersTab());
    else if (tab === 'theme') this.tabBody.appendChild(this.renderThemeTab());
    else if (tab === 'data') this.tabBody.appendChild(this.renderDataTab());
  }

  // ---- Design tab ----------------------------------------------------------

  renderDesignTab() {
    const s = this.core.state;
    const t = this.core.t;
    const selO = this.core.selObj();
    // min-height so the workspace-toned body paints to the bottom of the
    // panel even when the field list is short (tabBody gives the 100%).
    const wrap = elS('div', 'min-height: 100%; display: flex; flex-direction: column;', { class: 'mc-tab-surface mc-design-panel' });
    // "Card groups" inspector (the design direction the user picked): the
    // sticky header carries a block-type icon chip; the body sits on the
    // workspace tone with each property group rendered as a white card
    // (renderFieldCards, render/fields.js).
    const head = elS('div', 'padding: 12px 14px; border-bottom: 1px solid var(--ed-line); display: flex; align-items: center; gap: 10px; position: sticky; top: 0; background: var(--ed-panel); z-index: 5;', { class: 'mc-inspector-head' });
    if (s.sel) {
      const chip = elS('div', 'width: 36px; height: 36px; flex: none; border-radius: 10px; background: var(--ed-soft); color: var(--ed-accent); display: flex; align-items: center; justify-content: center;');
      chip.appendChild(icon(selO.block ? selO.block.type : 'product', 18));
      head.appendChild(chip);
    }
    const headText = elS('div', 'flex: 1; min-width: 0;');
    headText.append(
      elS('div', 'font-family: var(--ed-font); font-weight: 600; font-size: 15px; line-height: 1.2;', { text: selO.block ? DEF(selO.block.type).label : (selO.row ? t('inspector.sectionLabel') : t('inspector.nothingSelected')) }),
      elS('div', 'font-size: 11px; color: var(--ed-muted); margin-top: 1px;', { text: selO.block ? t('inspector.blockProperties') : (selO.row ? t('inspector.sectionProperties') : t('inspector.title')) }),
    );
    head.appendChild(headText);
    if (s.sel) {
      const actions = elS('div', 'display: flex; gap: 4px;');
      const dup = elS('button', 'border: 0; border-radius: 8px; background: var(--ed-panel-2); color: var(--ed-muted); cursor: pointer; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; transition: background 0.16s, color 0.16s;', { type: 'button', title: t('action.duplicateHint'), class: 'mc-icon-button' });
      dup.appendChild(icon('copy', 14));
      dup.addEventListener('mouseenter', () => { dup.style.background = 'var(--ed-soft)'; dup.style.color = 'var(--ed-accent)'; });
      dup.addEventListener('mouseleave', () => { dup.style.background = 'var(--ed-panel-2)'; dup.style.color = 'var(--ed-muted)'; });
      dup.addEventListener('click', () => this.core.dupSel());
      tip(dup, t('action.duplicateHint'), 'down', 'end');
      const del = elS('button', 'border: 0; border-radius: 8px; background: var(--ed-danger-soft); color: var(--ed-danger); cursor: pointer; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; transition: filter 0.16s;', { type: 'button', title: t('action.deleteHint'), class: 'mc-icon-button' });
      del.appendChild(icon('trash', 14));
      del.addEventListener('mouseenter', () => { del.style.filter = 'brightness(0.94)'; });
      del.addEventListener('mouseleave', () => { del.style.filter = ''; });
      del.addEventListener('click', () => this.core.delSel());
      tip(del, t('action.deleteHint'), 'down', 'end');
      actions.append(dup, del);
      head.appendChild(actions);
    }
    wrap.appendChild(head);

    // Flat accordion surface (Beefree-style): the fields render straight on
    // the panel with full-width section bars -- no workspace-toned gutter,
    // no floating cards.
    const body = elS('div', 'background: var(--ed-panel); flex: 1; padding-bottom: 28px;', { class: 'mc-panel-content' });
    if (!s.sel) {
      const empty = elS('div', 'margin: 12px 14px; background: var(--ed-panel); border: 1px solid var(--ed-line); border-radius: 12px; padding: 14px; font-size: 12.5px; color: var(--ed-muted); line-height: 1.6;');
      const p = elS('p', 'margin: 0 0 14px;');
      p.innerHTML = t('inspector.emptyBody');
      empty.appendChild(p);
      const box = elS('div', 'position: relative; border: 1px solid var(--ed-line); border-radius: 10px; padding: 12px;', { class: 'mc-shortcuts' });
      box.appendChild(elS('div', 'font-family: var(--ed-font); font-size: 10px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: var(--ed-muted); margin-bottom: 8px;', { text: t('inspector.shortcuts') }));
      const grid = elS('div', 'display: grid; gap: 5px; font-family: ui-monospace, monospace; font-size: 10.5px; color: var(--ed-muted);');
      [t('shortcut.undoRedo'), t('shortcut.duplicate'), t('shortcut.delete'), t('shortcut.export'), t('shortcut.escape')].forEach((txt) => grid.appendChild(elS('div', '', { text: txt })));
      box.appendChild(grid);
      empty.appendChild(box);
      body.appendChild(empty);
    }
    const fields = this.core.fields().concat(this.core.boxFields());
    renderFieldCards(body, fields);
    wrap.appendChild(body);
    return wrap;
  }

  // ---- Blocks tab ------------------------------------------------------

  renderBlocksTab() {
    const t = this.core.t;
    const wrap = this.tabSurface();
    wrap.appendChild(this.sectionBar(t('blocks.dragHint'), t('blocks.count', { count: PALETTE.length })));
    const body = this.sectionBody();

    const grid = elS('div', 'display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px;');
    paletteTiles(this.core).forEach((tile) => {
      const cell = elS('div', 'border: 1px solid var(--ed-line); border-radius: 10px; background: var(--ed-panel-2); cursor: grab; padding: 11px 4px 8px; display: flex; flex-direction: column; align-items: center; gap: 7px; user-select: none; transition: border-color 0.16s, transform 0.16s, background 0.16s, box-shadow 0.16s;', { draggable: 'true', title: tile.hint });
      const applyHover = () => { cell.style.borderColor = 'var(--ed-accent)'; cell.style.background = 'var(--ed-soft)'; cell.style.transform = 'translateY(-2px)'; cell.style.boxShadow = 'var(--ed-shadow-sm)'; };
      cell.addEventListener('mouseenter', applyHover);
      cell.addEventListener('mouseleave', () => { cell.style.borderColor = 'var(--ed-line)'; cell.style.background = 'var(--ed-panel-2)'; cell.style.transform = ''; cell.style.boxShadow = ''; });
      cell.addEventListener('mousedown', () => { cell.style.cursor = 'grabbing'; cell.style.transform = ''; });
      cell.addEventListener('mouseup', () => { cell.style.cursor = 'grab'; applyHover(); });
      cell.addEventListener('dragstart', tile.onDragStart);
      cell.addEventListener('dragend', () => { this.core.drag = null; this.core.setState({ drop: null, rowDrop: null }); });
      cell.addEventListener('dblclick', tile.onAdd);
      const iconSpan = elS('span', 'color: var(--ed-accent); display: block;');
      iconSpan.appendChild(tile.icon());
      cell.appendChild(iconSpan);
      cell.appendChild(elS('span', 'font-size: 10.5px; color: var(--ed-muted); text-align: center; line-height: 1.2;', { text: tile.label }));
      grid.appendChild(cell);
    });
    body.appendChild(grid);
    wrap.appendChild(body);
    return wrap;
  }

  // ---- Rows tab --------------------------------------------------------

  renderRowsTab() {
    const s = this.core.state;
    const t = this.core.t;
    const wrap = this.tabSurface();
    wrap.appendChild(this.sectionBar(t('rows.sectionLayouts')));
    const layoutBody = this.sectionBody();

    const grid = elS('div', 'display: grid; gap: 6px;');
    LAYOUTS.forEach((l) => {
      const cell = elS('div', 'border: 1px solid var(--ed-line); border-radius: 9px; background: var(--ed-panel-2); cursor: grab; padding: 10px; display: flex; align-items: center; gap: 12px; user-select: none; transition: border-color 0.16s, background 0.16s;', { draggable: 'true' });
      cell.addEventListener('mouseenter', () => { cell.style.borderColor = 'var(--ed-accent)'; cell.style.background = 'var(--ed-soft)'; });
      cell.addEventListener('mouseleave', () => { cell.style.borderColor = 'var(--ed-line)'; cell.style.background = 'var(--ed-panel-2)'; });
      cell.addEventListener('dragstart', this.core.startDrag({ kind: 'row', spans: l.spans }));
      cell.addEventListener('dragend', () => { this.core.drag = null; this.core.setState({ drop: null, rowDrop: null }); });
      cell.addEventListener('dblclick', () => this.core.insertRow(l.spans, s.doc.rows.length));
      const cellsWrap = elS('div', 'display: flex; gap: 3px; flex: 1; height: 26px;');
      l.spans.forEach((sp) => cellsWrap.appendChild(elS('div', `flex: ${sp}; border: 1px solid var(--ed-line-2); background: repeating-linear-gradient(45deg, transparent, transparent 4px, var(--ed-line) 4px, var(--ed-line) 5px);`)));
      cell.append(cellsWrap, elS('span', 'font-family: ui-monospace, monospace; font-size: 10px; color: var(--ed-muted); white-space: nowrap;', { text: l.label }));
      grid.appendChild(cell);
    });
    layoutBody.appendChild(grid);
    wrap.appendChild(layoutBody);

    wrap.appendChild(this.sectionBar(t('rows.customMarkup')));
    const markupBody = this.sectionBody();
    const htmlRow = elS('div', 'border: 1px solid var(--ed-line); border-radius: 9px; background: var(--ed-panel-2); cursor: grab; padding: 11px 12px; display: flex; align-items: center; gap: 11px; user-select: none; transition: border-color 0.16s, background 0.16s;', { draggable: 'true', title: t('rows.htmlRowHint') });
    htmlRow.addEventListener('mouseenter', () => { htmlRow.style.borderColor = 'var(--ed-accent)'; htmlRow.style.background = 'var(--ed-soft)'; });
    htmlRow.addEventListener('mouseleave', () => { htmlRow.style.borderColor = 'var(--ed-line)'; htmlRow.style.background = 'var(--ed-panel-2)'; });
    htmlRow.addEventListener('dragstart', this.core.startDrag({ kind: 'row', spans: [100], html: true }));
    htmlRow.addEventListener('dragend', () => { this.core.drag = null; this.core.setState({ drop: null, rowDrop: null }); });
    htmlRow.addEventListener('click', () => this.core.insertRow([100], s.doc.rows.length, true));
    const htmlIcon = elS('span', 'color: var(--ed-accent); display: block;');
    htmlIcon.appendChild(icon('code', 20));
    const htmlText = elS('span', 'flex: 1;');
    htmlText.append(
      elS('span', 'display: block; font-family: var(--ed-font); font-weight: 600; font-size: 13px; line-height: 1.2;', { text: t('rows.rawHtmlSection') }),
      elS('span', 'display: block; font-size: 11px; color: var(--ed-muted); line-height: 1.4;', { text: t('rows.rawHtmlDesc') }),
    );
    htmlRow.append(htmlIcon, htmlText);
    markupBody.appendChild(htmlRow);
    wrap.appendChild(markupBody);

    wrap.appendChild(this.sectionBar(t('rows.canvasModel')));
    const modelBody = this.sectionBody();
    const modeSeg = elS('div', '', { class: 'mc-segment' });
    [{ label: t('rows.modeRowBased'), v: 'rows' }, { label: t('rows.modeFreeStack'), v: 'stack' }].forEach((m) => {
      const on = s.mode === m.v;
      const btn = elS('button', `flex: 1; background: ${this.segBg(on)}; color: ${this.segFg(on)}; font-family: var(--ed-font); font-size: 10px; font-weight: 600; padding: 8px 4px; transition: background 0.16s, color 0.16s;`, { type: 'button', text: m.label, 'aria-pressed': String(on) });
      btn.addEventListener('click', () => this.core.setState({ mode: m.v }));
      modeSeg.appendChild(btn);
    });
    modelBody.appendChild(modeSeg);
    const hint = s.mode === 'rows' ? t('rows.hintRows') : t('rows.hintStack');
    modelBody.appendChild(elS('p', 'margin: 10px 0 0; font-size: 11.5px; color: var(--ed-muted); line-height: 1.55;', { text: hint }));
    wrap.appendChild(modelBody);
    return wrap;
  }

  // ---- Files tab -------------------------------------------------------

  renderFilesTab() {
    const s = this.core.state;
    const t = this.core.t;
    const wrap = this.tabSurface();
    wrap.appendChild(this.sectionBar(t('files.libraryCount', { count: s.assets.length })));
    const body = this.sectionBody();
    const openBtn = elS('button', 'width: 100%; border: 0; border-radius: 8px; background: var(--ed-accent); color: var(--ed-accent-ink); cursor: pointer; padding: 9px 12px; display: flex; align-items: center; justify-content: center; gap: 7px; font-family: var(--ed-font); font-weight: 600; font-size: 12px; transition: filter 0.16s;', { type: 'button', class: 'mc-icon-label' });
    openBtn.append(icon('folder', 14), elS('span', '', { text: t('files.openManager') }));
    openBtn.addEventListener('mouseenter', () => { openBtn.style.filter = 'brightness(1.1)'; });
    openBtn.addEventListener('mouseleave', () => { openBtn.style.filter = ''; });
    openBtn.addEventListener('click', () => this.core.openLibrary());
    body.appendChild(openBtn);

    const grid = elS('div', 'display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 12px;');
    s.assets.slice(0, 6).forEach((a) => {
      const tile = elS('div', 'border: 1px solid var(--ed-line); border-radius: 9px; overflow: hidden; cursor: grab; background: var(--ed-panel-2); transition: border-color 0.16s;', { draggable: 'true', title: a.name });
      tile.addEventListener('mouseenter', () => { tile.style.borderColor = 'var(--ed-accent)'; });
      tile.addEventListener('mouseleave', () => { tile.style.borderColor = 'var(--ed-line)'; });
      tile.addEventListener('dragstart', this.core.startDrag({ kind: 'asset', assetId: a.id }));
      tile.addEventListener('dragend', () => { this.core.drag = null; this.core.setState({ drop: null, rowDrop: null }); });
      // Touch Safari never fires HTML5 drag events, so drag alone left
      // these tiles unusable on iOS. Click is the same fallback the
      // library modal's tiles already carry; a completed drag ends in
      // `dragend`, not `click`, so the two do not both fire.
      tile.addEventListener('click', () => this.core.useAsset(a));
      tile.appendChild(elS('div', `width: 100%; height: 64px; background-image: url("${a.url}"); background-size: cover; background-position: center; background-color: var(--ed-work);`, { role: 'img', 'aria-label': a.name }));
      tile.appendChild(elS('div', 'font-family: ui-monospace, monospace; font-size: 9px; color: var(--ed-muted); padding: 4px 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;', { text: a.name }));
      grid.appendChild(tile);
    });
    body.appendChild(grid);
    body.appendChild(elS('p', 'margin: 12px 0 0; font-size: 11.5px; color: var(--ed-muted); line-height: 1.55;', { text: t('files.dragToCanvas') }));
    wrap.appendChild(body);
    return wrap;
  }

  // ---- Layers tab --------------------------------------------------------

  renderLayersTab() {
    const s = this.core.state;
    const t = this.core.t;
    const wrap = this.tabSurface();
    wrap.appendChild(this.sectionBar(t('layers.structure')));
    const body = this.sectionBody('display: grid; gap: 0;');
    body.classList.add('mc-layer-tree');
    // Mirror the document model as a real tree: section -> column -> block.
    // Keeping columns visible matters for multi-column rows; flattening every
    // block beneath the section made the structure ambiguous.
    s.doc.rows.forEach((r, i) => {
      const rSel = s.sel && s.sel.id === r.id;
      const card = elS('div', 'background: transparent; padding: 0 0 8px;', { class: `mc-tree-section${rSel ? ' is-selected' : ''}` });
      const blockN = r.cols.reduce((n, c) => n + c.blocks.length, 0);
      const head = elS('div', `display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 6px 7px; border-radius: 7px; background: ${rSel ? 'var(--ed-soft)' : 'transparent'}; transition: background 0.16s;`, { class: 'mc-tree-node mc-tree-section-node' });
      head.addEventListener('mouseenter', () => { head.style.background = 'var(--ed-soft)'; });
      head.addEventListener('mouseleave', () => { head.style.background = rSel ? 'var(--ed-soft)' : 'transparent'; });
      head.addEventListener('click', () => this.core.select('row', r.id));
      head.append(
        elS('span', `width: 22px; height: 22px; flex: none; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-family: ui-monospace, monospace; font-size: 10px; font-weight: 600; background: ${rSel ? 'var(--ed-accent)' : 'var(--ed-panel-2)'}; color: ${rSel ? 'var(--ed-accent-ink)' : 'var(--ed-muted)'};`, { text: String(i + 1).padStart(2, '0'), class: 'mc-tree-index' }),
        elS('span', 'font-family: var(--ed-font); font-weight: 600; font-size: 12.5px; color: var(--ed-text);', { text: r.cols.length === 1 ? t('layers.sectionSingle') : t('layers.sectionMulti', { count: r.cols.length }), class: 'mc-tree-title' }),
        elS('span', 'flex: 1;'),
        elS('span', 'font-family: var(--ed-font); font-size: 10px; font-weight: 500; color: var(--ed-muted);', { text: t('layers.blockCount', { count: blockN }), class: 'mc-tree-count' }),
      );
      card.appendChild(head);
      const columns = elS('div', '', { class: 'mc-tree-children mc-tree-columns' });
      r.cols.forEach((c, colIndex) => {
        const branch = elS('div', '', { class: 'mc-tree-branch' });
        const colHead = elS('div', 'display: flex; align-items: center; gap: 7px; min-height: 28px; padding: 3px 7px; color: var(--ed-muted);', { class: 'mc-tree-node mc-tree-column-node' });
        const colChip = elS('span', 'width: 20px; height: 20px; flex: none; border-radius: 5px; display: flex; align-items: center; justify-content: center; background: var(--ed-panel-2); color: var(--ed-faint);');
        colChip.appendChild(icon('table', 11));
        colHead.append(
          colChip,
          elS('span', 'font-family: var(--ed-font); font-size: 11.5px; font-weight: 600;', { text: t('layers.column', { index: colIndex + 1 }), class: 'mc-tree-title' }),
          elS('span', 'flex: 1;'),
          elS('span', 'font-family: var(--ed-font); font-size: 10px; font-weight: 500; color: var(--ed-muted);', { text: t('layers.blockCount', { count: c.blocks.length }), class: 'mc-tree-count' }),
        );
        branch.appendChild(colHead);
        if (c.blocks.length) {
          const list = elS('div', '', { class: 'mc-tree-children mc-tree-blocks' });
          c.blocks.forEach((b) => {
          const bSel = s.sel && s.sel.id === b.id;
          const typeName = DEF(b.type).label;
          const text = b.type === 'text' ? String(b.props.html || '').replace(/<[^>]+>/g, '').trim().slice(0, 34) : (b.props.label || b.props.title || b.props.caption || '');
          const line = elS('div', `display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 4px 7px; border-radius: 8px; background: ${bSel ? 'var(--ed-soft)' : 'transparent'}; box-shadow: ${bSel ? 'inset 0 0 0 1px var(--ed-accent)' : 'none'}; transition: background 0.16s;`, { class: 'mc-tree-node mc-tree-block-node' });
          line.addEventListener('mouseenter', () => { if (!(s.sel && s.sel.id === b.id)) line.style.background = 'var(--ed-panel)'; });
          line.addEventListener('mouseleave', () => { line.style.background = bSel ? 'var(--ed-soft)' : 'transparent'; });
          line.addEventListener('click', () => this.core.select('block', b.id));
          const chip = elS('span', `width: 22px; height: 22px; flex: none; border-radius: 6px; display: flex; align-items: center; justify-content: center; background: ${bSel ? 'var(--ed-accent)' : 'var(--ed-soft)'}; color: ${bSel ? 'var(--ed-accent-ink)' : 'var(--ed-accent)'};`);
          chip.appendChild(icon(b.type, 12));
          // dir=auto: this excerpt is the email's own copy, not chrome text.
          line.append(chip, elS('span', 'font-family: var(--ed-font); font-size: 12px; font-weight: 500; color: var(--ed-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;', { text: text || typeName, class: 'mc-tree-title', dir: 'auto' }));
          if (text) {
            line.append(
              elS('span', 'flex: 1; min-width: 8px;'),
              elS('span', 'flex: none; font-family: var(--ed-font); font-size: 9.5px; font-weight: 600; letter-spacing: 0.035em; text-transform: uppercase; color: var(--ed-muted);', { text: typeName, class: 'mc-tree-type' }),
            );
          }
          list.appendChild(line);
          });
          branch.appendChild(list);
        }
        columns.appendChild(branch);
      });
      card.appendChild(columns);
      body.appendChild(card);
    });
    wrap.appendChild(body);
    return wrap;
  }

  // ---- Theme tab -------------------------------------------------------

  renderThemeTab() {
    // Same flat-accordion treatment as the Design tab, so the two style
    // surfaces read as one system; the section bars carry the structure.
    const wrap = this.tabSurface();
    renderFieldCards(wrap, this.core.themeFields());
    return wrap;
  }

  // ---- Data (variables) tab ----------------------------------------------

  renderDataTab() {
    const s = this.core.state;
    const t = this.core.t;
    const wrap = this.tabSurface();
    wrap.appendChild(this.sectionBar(t('vars.title'), t('vars.fromCode', { count: this.core.vars().length })));
    const card = this.sectionBody();
    card.appendChild(elS('p', 'margin: 0 0 12px; font-size: 11.5px; color: var(--ed-muted); line-height: 1.55;', { text: t('vars.declaredNote') }));
    const search = elS('input', 'width: 100%; box-sizing: border-box; background: var(--ed-panel-2); border: 1px solid var(--ed-line); border-radius: 8px; color: var(--ed-text); font: inherit; font-size: 12.5px; padding: 7px 9px; margin-bottom: 8px;', { placeholder: t('vars.filterPlaceholder'), 'data-focus-key': 'var-query', dir: 'auto' });
    search.value = s.varQuery || '';
    search.addEventListener('focus', () => { search.style.borderColor = 'var(--ed-accent)'; search.style.outline = 'none'; });
    search.addEventListener('blur', () => { search.style.borderColor = 'var(--ed-line)'; });
    // Debounced: each setState is a full re-render (see typeCommit, fields.js).
    const varSearchCommit = typeCommit((v) => this.core.setState({ varQuery: v }));
    search.addEventListener('input', (e) => varSearchCommit.call(e.target.value));
    card.appendChild(search);

    const all = this.core.vars();
    const filtered = all.filter((v) => !s.varQuery || v.toLowerCase().includes(String(s.varQuery).toLowerCase()));
    const grid = elS('div', 'display: grid; gap: 3px;');
    filtered.forEach((v) => {
      const name = v.replace(/[_.]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      const btn = elS('button', 'display: flex; align-items: center; gap: 9px; text-align: left; border: 1px solid var(--ed-line); border-radius: 8px; background: var(--ed-panel-2); color: var(--ed-text); cursor: pointer; padding: 8px 10px; transition: border-color 0.16s, background 0.16s;', { type: 'button', title: t('vars.insertHint') });
      btn.addEventListener('mouseenter', () => { btn.style.borderColor = 'var(--ed-accent)'; btn.style.background = 'var(--ed-soft)'; });
      btn.addEventListener('mouseleave', () => { btn.style.borderColor = 'var(--ed-line)'; btn.style.background = 'var(--ed-panel-2)'; });
      btn.addEventListener('click', () => this.core.insertTag(v));
      const textSpan = elS('span', 'flex: 1; min-width: 0;');
      textSpan.append(
        elS('span', 'display: block; font-family: var(--ed-font); font-weight: 600; font-size: 12.5px; line-height: 1.2;', { text: name }),
        // dir=ltr keeps the braces on the right ends of {{ token }} under RTL.
        elS('span', 'display: block; font-family: ui-monospace, monospace; font-size: 10px; color: var(--ed-accent); margin-top: 2px;', { text: TOKEN(v), dir: 'ltr' }),
      );
      btn.append(textSpan, elS('span', 'font-family: var(--ed-font); font-size: 9.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ed-faint);', { text: t('vars.insert') }));
      grid.appendChild(btn);
    });
    card.appendChild(grid);
    if (!filtered.length) {
      card.appendChild(elS('p', 'margin: 10px 0 0; font-size: 11.5px; color: var(--ed-muted); line-height: 1.55;', { text: all.length ? t('vars.noMatch') : t('vars.noneDeclared') }));
    }
    card.appendChild(elS('p', 'margin: 14px 0 0; padding-top: 12px; border-top: 1px solid var(--ed-line); font-size: 11.5px; color: var(--ed-muted); line-height: 1.55;', { text: t('vars.rteHint') }));
    wrap.appendChild(card);
    return wrap;
  }

  // ---- modals: library ----------------------------------------------------

  buildLibraryModal() {
    const t = this.core.t;
    const overlay = elS('div', 'position: absolute; inset: 0; background: rgba(10,12,14,0.6); z-index: 50; display: flex; align-items: center; justify-content: center; padding: 34px; animation: mcFade 0.16s ease; display: none;', { class: 'mc-modal-backdrop' });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.core.setState({ libraryOpen: false, exportOpen: false, aiOpen: false, codeOpen: false, assetTarget: null, libHot: false }); });
    const modal = elS('div', 'width: 100%; height: 100%; max-width: 1000px; background: var(--ed-panel); border: 1px solid var(--ed-line-2); border-radius: var(--ed-radius); overflow: hidden; display: grid; grid-template-rows: auto 1fr auto; box-shadow: var(--ed-shadow-lg); animation: mcIn 0.2s cubic-bezier(0.22,0.61,0.36,1);', { class: 'mc-modal' });
    modal.addEventListener('click', (e) => e.stopPropagation());
    overlay.appendChild(modal);

    const head = elS('div', 'display: flex; align-items: center; gap: 12px; padding: 14px 20px; border-bottom: 1px solid var(--ed-line);');
    this.libraryTitleEl = elS('div', 'flex: 1;');
    this.libraryTitleEl.append(
      elS('div', 'font-family: var(--ed-font); font-size: 10px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: var(--ed-muted);', { text: t('modal.fileManager'), 'data-i18n': 'modal.fileManager' }),
      (this.libraryTitleText = elS('div', 'font-family: var(--ed-font); font-weight: 600; font-size: 16px; line-height: 1.25;')),
    );
    this.assetSearch = elS('input', 'width: 210px; box-sizing: border-box; background: var(--ed-panel-2); border: 1px solid var(--ed-line); color: var(--ed-text); font: inherit; font-size: 13px; padding: 7px 9px;', { placeholder: t('library.searchPlaceholder'), 'data-i18n-placeholder': 'library.searchPlaceholder', 'data-focus-key': 'asset-query', dir: 'auto' });
    this.assetSearch.addEventListener('focus', () => { this.assetSearch.style.borderColor = 'var(--ed-accent)'; this.assetSearch.style.outline = 'none'; });
    this.assetSearch.addEventListener('blur', () => { this.assetSearch.style.borderColor = 'var(--ed-line)'; });
    // Debounced re-render; setAssetQuery separately debounces the backend call.
    const assetSearchCommit = typeCommit((v) => this.core.setAssetQuery(v));
    this.assetSearch.addEventListener('input', (e) => assetSearchCommit.call(e.target.value));
    const uploadBtn = elS('button', 'border: 0; background: var(--ed-accent); color: var(--ed-accent-ink); cursor: pointer; height: 32px; padding: 0 12px; display: flex; align-items: center; gap: 7px; font-family: var(--ed-font); font-weight: 600; font-size: 12px; transition: filter 0.16s;', { type: 'button', class: 'mc-icon-label' });
    uploadBtn.append(icon('upload', 14), elS('span', '', { text: t('action.upload'), 'data-i18n': 'action.upload' }));
    uploadBtn.addEventListener('mouseenter', () => { uploadBtn.style.filter = 'brightness(1.1)'; });
    uploadBtn.addEventListener('mouseleave', () => { uploadBtn.style.filter = ''; });
    uploadBtn.addEventListener('click', () => this.fileInput.click());
    const closeBtn = elS('button', 'border: 1px solid var(--ed-line); background: transparent; color: var(--ed-text); cursor: pointer; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; transition: border-color 0.16s, background 0.16s;', { type: 'button', title: t('action.close'), class: 'mc-icon-button' });
    closeBtn.appendChild(icon('x', 14));
    closeBtn.addEventListener('mouseenter', () => { closeBtn.style.borderColor = 'var(--ed-accent)'; });
    closeBtn.addEventListener('mouseleave', () => { closeBtn.style.borderColor = 'var(--ed-line)'; });
    closeBtn.addEventListener('click', () => this.core.setState({ libraryOpen: false, exportOpen: false, aiOpen: false, codeOpen: false, assetTarget: null, libHot: false }));
    tip(closeBtn, t('action.close'), 'down', 'end');
    head.append(this.libraryTitleEl, this.assetSearch, uploadBtn, closeBtn);
    modal.appendChild(head);

    const body = elS('div', 'display: grid; grid-template-columns: 186px 1fr; min-height: 0;');
    this.folderList = elS('div', 'border-right: 1px solid var(--ed-line); padding: 14px; overflow-y: auto;');
    const foldersHead = elS('div', 'font-family: var(--ed-font); font-size: 10px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: var(--ed-muted); margin-bottom: 10px;', { text: t('library.folders'), 'data-i18n': 'library.folders' });
    this.folderGrid = elS('div', 'display: grid; gap: 2px;');
    this.folderList.append(foldersHead, this.folderGrid);
    this.assetGridWrap = elS('div', 'overflow-y: auto; padding: 16px; transition: background 0.16s;');
    this.assetGridWrap.addEventListener('dragover', (e) => { if (this.core.drag) return; e.preventDefault(); if (!this.core.state.libHot) this.core.setState({ libHot: true }); });
    this.assetGridWrap.addEventListener('drop', (e) => { e.preventDefault(); this.core.setState({ libHot: false }); if (e.dataTransfer?.files?.length) this.core.addFiles(e.dataTransfer.files); });
    this.assetStatus = elS('div', 'font-size: 12.5px; color: var(--ed-muted); padding: 0 2px 12px;');
    this.assetGrid = elS('div', 'display: grid; grid-template-columns: repeat(auto-fill, minmax(178px, 1fr)); gap: 14px;');
    this.assetEmpty = elS('div', 'padding: 28px 2px; color: var(--ed-muted); font-size: 12.5px;', { text: t('library.empty'), 'data-i18n': 'library.empty' });
    this.assetMore = elS('button', 'margin-top: 16px; border: 0; border-radius: 8px; background: var(--ed-soft); color: var(--ed-accent); cursor: pointer; height: 30px; padding: 0 14px; font-family: var(--ed-font); font-size: 11.5px; font-weight: 600; transition: background 0.16s, color 0.16s;', { type: 'button', text: t('library.loadMore'), 'data-i18n': 'library.loadMore' });
    this.assetMore.addEventListener('mouseenter', () => { this.assetMore.style.background = 'var(--ed-accent)'; this.assetMore.style.color = 'var(--ed-accent-ink)'; });
    this.assetMore.addEventListener('mouseleave', () => { this.assetMore.style.background = 'var(--ed-soft)'; this.assetMore.style.color = 'var(--ed-accent)'; });
    this.assetMore.addEventListener('click', () => this.core.loadMoreAssets());
    this.assetGridWrap.append(this.assetStatus, this.assetGrid, this.assetEmpty, this.assetMore);
    this.assetGridWrap.appendChild(elS('div', 'margin-top: 20px; border: 1px dashed var(--ed-line-2); padding: 22px; text-align: center; color: var(--ed-muted); font-size: 12.5px;', { text: t('library.dropHint'), 'data-i18n': 'library.dropHint' }));
    body.append(this.folderList, this.assetGridWrap);
    modal.appendChild(body);

    const foot = elS('div', 'padding: 10px 20px; border-top: 1px solid var(--ed-line); display: flex; justify-content: space-between; font-family: ui-monospace, monospace; font-size: 9.5px; letter-spacing: 0.06em; color: var(--ed-faint);');
    this.libraryHintEl = elS('span');
    this.storageLabelEl = elS('span');
    foot.append(this.libraryHintEl, this.storageLabelEl);
    modal.appendChild(foot);
    return overlay;
  }

  renderLibraryModal() {
    const s = this.core.state;
    const t = this.core.t;
    this.libraryModal.style.display = s.libraryOpen ? 'flex' : 'none';
    if (!s.libraryOpen) return;
    this.libraryTitleText.textContent = s.assetTarget ? t('modal.replaceImage') : t('modal.assetsTitle');
    this.libraryHintEl.textContent = s.assetTarget ? t('library.clickToReplace') : t('library.clickToPlace');
    this.storageLabelEl.textContent = t('library.storageLabel', { count: s.assets.length, size: KB(s.assets.reduce((n, a) => n + (a.size || 0), 0)) });
    if (this.assetSearch.value !== (s.assetQuery || '')) this.assetSearch.value = s.assetQuery || '';
    // The OS file dialog greys out what validation would refuse anyway, so the
    // accept list tracks whatever limits the host has set.
    this.fileInput.accept = acceptAttribute(this.core.limits());

    this.folderGrid.innerHTML = '';
    this.core.folderOptions().forEach((f) => {
      const on = s.assetFolder === f.id;
      const btn = elS('button', `text-align: left; border: 0; border-left: 2px solid ${on ? 'var(--ed-accent)' : 'transparent'}; background: ${on ? 'var(--ed-soft)' : 'transparent'}; color: ${on ? 'var(--ed-accent)' : 'var(--ed-text)'}; cursor: pointer; padding: 8px 10px; font-size: 12.5px; display: flex; justify-content: space-between; gap: 8px; transition: background 0.16s;`, { type: 'button' });
      btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--ed-soft)'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = on ? 'var(--ed-soft)' : 'transparent'; });
      btn.addEventListener('click', () => this.core.setAssetFolder(f.id));
      btn.append(
        elS('span', '', { text: f.name }),
        elS('span', 'font-family: ui-monospace, monospace; font-size: 9.5px; color: var(--ed-faint);', { text: f.count == null ? '' : String(f.count) }),
      );
      this.folderGrid.appendChild(btn);
    });

    // One line carries all three transient states -- they can't co-occur, and a
    // separate row for each would push the grid down every time one appeared.
    const status = s.uploading ? t('storage.uploading', { count: s.uploading })
      : s.assetsError ? t('storage.errLoadFailed', { reason: s.assetsError })
        : s.assetsLoading ? t('storage.loading') : '';
    this.assetStatus.textContent = status;
    this.assetStatus.style.display = status ? 'block' : 'none';
    this.assetStatus.style.color = s.assetsError ? 'var(--ed-danger)' : 'var(--ed-muted)';

    this.assetGridWrap.style.background = s.libHot ? 'var(--ed-soft)' : 'transparent';
    const visible = this.core.visibleAssets();
    this.assetGrid.innerHTML = '';
    visible.forEach((a) => {
      const tile = elS('div', 'border: 1px solid var(--ed-line); border-radius: var(--ed-radius-sm); overflow: hidden; background: var(--ed-panel-2); cursor: pointer; transition: border-color 0.16s, transform 0.16s, box-shadow 0.16s;', { draggable: 'true' });
      tile.addEventListener('mouseenter', () => { tile.style.borderColor = 'var(--ed-accent)'; tile.style.transform = 'translateY(-1px)'; tile.style.boxShadow = 'var(--ed-shadow-md)'; });
      tile.addEventListener('mouseleave', () => { tile.style.borderColor = 'var(--ed-line)'; tile.style.transform = ''; tile.style.boxShadow = ''; });
      tile.addEventListener('dragstart', this.core.startDrag({ kind: 'asset', assetId: a.id }));
      tile.addEventListener('click', () => this.core.useAsset(a));
      tile.appendChild(elS('div', `width: 100%; height: 120px; background-image: url("${a.url}"); background-size: cover; background-position: center; background-color: var(--ed-work); border-bottom: 1px solid var(--ed-line);`, { role: 'img', 'aria-label': a.name }));
      const meta = elS('div', 'padding: 8px 9px;');
      meta.appendChild(elS('div', 'font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;', { text: a.name }));
      const metaRow = elS('div', 'display: flex; justify-content: space-between; gap: 6px; margin-top: 3px;');
      metaRow.appendChild(elS('span', 'font-family: ui-monospace, monospace; font-size: 9.5px; color: var(--ed-faint);', { text: `${a.w ? a.w + '×' + a.ht + ' · ' : ''}${KB(a.size || 0)}` }));
      const del = elS('span', 'font-family: ui-monospace, monospace; font-size: 9.5px; color: var(--ed-faint); cursor: pointer;', { title: t('library.deleteFileHint'), text: t('library.del') });
      del.addEventListener('mouseenter', () => { del.style.color = 'var(--ed-danger)'; });
      del.addEventListener('mouseleave', () => { del.style.color = 'var(--ed-faint)'; });
      del.addEventListener('click', (e) => { e.stopPropagation(); this.core.removeAsset(a); });
      metaRow.appendChild(del);
      meta.appendChild(metaRow);
      tile.appendChild(meta);
      this.assetGrid.appendChild(tile);
    });

    // "Nothing here" only once there is an answer -- during the first load, and
    // after a failure, an empty grid means "not known yet", not "no files".
    this.assetEmpty.style.display = (!visible.length && !s.assetsLoading && !s.assetsError) ? 'block' : 'none';
    this.assetMore.style.display = s.assetCursor ? 'block' : 'none';
    this.assetMore.disabled = !!s.assetsLoading;
  }

  // ---- modals: export ----------------------------------------------------

  buildExportModal() {
    const t = this.core.t;
    const overlay = elS('div', 'position: absolute; inset: 0; background: rgba(10,12,14,0.6); z-index: 50; display: flex; align-items: center; justify-content: center; padding: 34px; animation: mcFade 0.16s ease; display: none;', { class: 'mc-modal-backdrop' });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.core.setState({ libraryOpen: false, exportOpen: false, aiOpen: false, codeOpen: false, assetTarget: null, libHot: false }); });
    const modal = elS('div', 'width: 100%; height: 100%; max-width: 900px; background: var(--ed-panel); border: 1px solid var(--ed-line-2); border-radius: var(--ed-radius); overflow: hidden; display: grid; grid-template-rows: auto 1fr auto; box-shadow: var(--ed-shadow-lg); animation: mcIn 0.2s cubic-bezier(0.22,0.61,0.36,1);', { class: 'mc-modal' });
    modal.addEventListener('click', (e) => e.stopPropagation());
    overlay.appendChild(modal);

    const head = elS('div', 'display: flex; align-items: center; gap: 10px; padding: 14px 20px; border-bottom: 1px solid var(--ed-line);');
    const headText = elS('div', 'flex: 1;');
    headText.append(
      elS('div', 'font-family: var(--ed-font); font-size: 10px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: var(--ed-muted);', { text: t('modal.export'), 'data-i18n': 'modal.export' }),
      elS('div', 'font-family: var(--ed-font); font-weight: 600; font-size: 16px; line-height: 1.25;', { text: t('modal.exportTitle'), 'data-i18n': 'modal.exportTitle' }),
    );
    this.copyBtn = elS('button', 'border: 1px solid var(--ed-line); background: transparent; color: var(--ed-text); cursor: pointer; height: 32px; padding: 0 11px; display: flex; align-items: center; gap: 7px; font-family: var(--ed-font); font-size: 12px; font-weight: 600; transition: border-color 0.16s, background 0.16s;', { type: 'button', class: 'mc-icon-label' });
    this.copyBtn.iconNode = icon('copy', 14);
    this.copyBtn.labelNode = elS('span');
    this.copyBtn.append(this.copyBtn.iconNode, this.copyBtn.labelNode);
    this.copyBtn.addEventListener('mouseenter', () => { this.copyBtn.style.borderColor = 'var(--ed-accent)'; this.copyBtn.style.background = 'var(--ed-soft)'; });
    this.copyBtn.addEventListener('mouseleave', () => { this.copyBtn.style.borderColor = 'var(--ed-line)'; this.copyBtn.style.background = 'transparent'; });
    this.copyBtn.addEventListener('click', () => this.core.copyExport());
    this.shotBtn = elS('button', 'border: 1px solid var(--ed-line); background: transparent; color: var(--ed-text); cursor: pointer; height: 32px; padding: 0 11px; display: flex; align-items: center; gap: 7px; font-family: var(--ed-font); font-size: 12px; font-weight: 600; transition: border-color 0.16s, background 0.16s;', { type: 'button', title: t('action.screenshotHint'), 'data-i18n-title': 'action.screenshotHint', class: 'mc-icon-label' });
    this.shotBtn.append(icon('image', 14), elS('span', '', { text: t('action.screenshot'), 'data-i18n': 'action.screenshot' }));
    this.shotBtn.addEventListener('mouseenter', () => { this.shotBtn.style.borderColor = 'var(--ed-accent)'; this.shotBtn.style.background = 'var(--ed-soft)'; });
    this.shotBtn.addEventListener('mouseleave', () => { this.shotBtn.style.borderColor = 'var(--ed-line)'; this.shotBtn.style.background = 'transparent'; });
    // Opens the viewer first and renders into it: the capture takes a beat on
    // a long template, and a modal that is already up with a skeleton reads as
    // progress, where a button that just sits there reads as a dead click.
    this.shotBtn.addEventListener('click', () => this.previewScreenshot());
    const downloadBtn = elS('button', 'border: 0; background: var(--ed-accent); color: var(--ed-accent-ink); cursor: pointer; height: 32px; padding: 0 12px; display: flex; align-items: center; gap: 7px; font-family: var(--ed-font); font-weight: 600; font-size: 12px; transition: filter 0.16s;', { type: 'button', class: 'mc-icon-label' });
    downloadBtn.append(icon('download', 14), elS('span', '', { text: t('action.download'), 'data-i18n': 'action.download' }));
    downloadBtn.addEventListener('mouseenter', () => { downloadBtn.style.filter = 'brightness(1.1)'; });
    downloadBtn.addEventListener('mouseleave', () => { downloadBtn.style.filter = ''; });
    downloadBtn.addEventListener('click', () => this.core.downloadExport());
    const closeBtn = elS('button', 'border: 1px solid var(--ed-line); background: transparent; color: var(--ed-text); cursor: pointer; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; transition: border-color 0.16s, background 0.16s;', { type: 'button', title: t('action.close'), class: 'mc-icon-button' });
    closeBtn.appendChild(icon('x', 14));
    closeBtn.addEventListener('mouseenter', () => { closeBtn.style.borderColor = 'var(--ed-accent)'; });
    closeBtn.addEventListener('mouseleave', () => { closeBtn.style.borderColor = 'var(--ed-line)'; });
    closeBtn.addEventListener('click', () => this.core.setState({ libraryOpen: false, exportOpen: false, aiOpen: false, codeOpen: false, assetTarget: null, libHot: false }));
    tip(closeBtn, t('action.close'), 'down', 'end');
    head.append(headText, this.copyBtn, this.shotBtn, downloadBtn, closeBtn);
    modal.appendChild(head);

    // dir=ltr: this holds HTML source, which bidi-scrambles under the RTL
    // chrome (same reason as buildCodeEditor).
    this.exportTextarea = elS('textarea', 'width: 100%; height: 100%; box-sizing: border-box; border: 0; background: var(--ed-work); color: var(--ed-text); font-family: ui-monospace, monospace; font-size: 11.5px; line-height: 1.55; padding: 18px 20px; resize: none;', { readonly: 'true', dir: 'ltr' });
    modal.appendChild(this.exportTextarea);
    this.exportMetaEl = elS('div', 'padding: 10px 20px; border-top: 1px solid var(--ed-line); font-family: ui-monospace, monospace; font-size: 9.5px; letter-spacing: 0.06em; color: var(--ed-faint);');
    modal.appendChild(this.exportMetaEl);
    return overlay;
  }

  renderExportModal() {
    const s = this.core.state;
    const t = this.core.t;
    this.exportModal.style.display = s.exportOpen ? 'flex' : 'none';
    if (!s.exportOpen) return;
    if (this.exportTextarea.value !== s.exportCode) this.exportTextarea.value = s.exportCode;
    this.copyBtn.labelNode.textContent = s.copied ? t('export.copied') : t('export.copy');
    this.exportMetaEl.textContent = t('export.meta', { kb: (s.exportCode.length / 1024).toFixed(1) });
  }

  // ---- modals: code view --------------------------------------------------

  buildCodeModal() {
    const t = this.core.t;
    const overlay = elS('div', 'position: absolute; inset: 0; background: var(--ed-panel); z-index: 55; display: grid; grid-template-rows: 58px minmax(0, 1fr) auto; animation: mcFade 0.16s ease; display: none;', { class: 'mc-fullscreen-panel mc-code-panel' });
    const head = elS('div', 'display: flex; align-items: center; gap: 10px; padding: 0 18px; border-bottom: 1px solid var(--ed-line); background: linear-gradient(to bottom, var(--ed-panel), var(--ed-panel-2));', { class: 'mc-code-toolbar' });
    const headIcon = elS('span', 'width: 32px; height: 32px; border-radius: 9px; background: var(--ed-soft); color: var(--ed-accent); display: flex; align-items: center; justify-content: center; flex: none;', { class: 'mc-code-badge' });
    headIcon.appendChild(icon('code', 17));
    const headText = elS('div', 'flex: 1; min-width: 0;');
    this.codeStatusEl = elS('div', 'font-family: var(--ed-font); font-size: 10px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: var(--ed-muted);', { class: 'mc-code-kicker' });
    headText.append(this.codeStatusEl, elS('div', 'font-family: var(--ed-font); font-weight: 600; font-size: 15px; line-height: 1.2;', { text: t('modal.rawHtmlTitle'), 'data-i18n': 'modal.rawHtmlTitle', class: 'mc-code-heading' }));
    this.codeWidthSeg = elS('div', '', { class: 'mc-segment' });
    // Ghost-button chrome shared by the header's Copy and Reload.
    const GHOST_BTN = 'border: 1px solid var(--ed-line); background: transparent; color: var(--ed-text); cursor: pointer; height: 30px; padding: 0 11px; display: flex; align-items: center; gap: 6px; font-family: var(--ed-font); font-size: 11px; font-weight: 600; transition: border-color 0.16s, background 0.16s;';
    const copyBtn = elS('button', GHOST_BTN, { type: 'button', title: t('toast.htmlCopied'), 'data-i18n-title': 'toast.htmlCopied', class: 'mc-code-copy' });
    copyBtn.appendChild(icon('copy', 14));
    // Reuses keys every locale already carries (story.copy / export.copied)
    // rather than minting new ones across 32 translations.
    const copyLabel = elS('span', '', { text: t('story.copy'), 'data-i18n': 'story.copy' });
    copyBtn.appendChild(copyLabel);
    copyBtn.addEventListener('mouseenter', () => { copyBtn.style.borderColor = 'var(--ed-accent)'; copyBtn.style.background = 'var(--ed-soft)'; });
    copyBtn.addEventListener('mouseleave', () => { copyBtn.style.borderColor = 'var(--ed-line)'; copyBtn.style.background = 'transparent'; });
    copyBtn.addEventListener('click', () => {
      this.core.copyCode();
      // Momentary "Copied": swap the i18n key itself, not just the text --
      // refreshStrings relabels every [data-i18n] node on each render and
      // would otherwise revert the feedback mid-flash.
      copyLabel.setAttribute('data-i18n', 'export.copied');
      copyLabel.textContent = this.core.t('export.copied');
      clearTimeout(this._codeCopyTimer);
      this._codeCopyTimer = setTimeout(() => {
        copyLabel.setAttribute('data-i18n', 'story.copy');
        copyLabel.textContent = this.core.t('story.copy');
      }, 1600);
    });
    const reloadBtn = elS('button', GHOST_BTN, { type: 'button', title: t('action.reloadHint'), 'data-i18n-title': 'action.reloadHint' });
    reloadBtn.appendChild(icon('refresh', 14));
    reloadBtn.appendChild(elS('span', '', { text: t('action.reload'), 'data-i18n': 'action.reload' }));
    reloadBtn.addEventListener('mouseenter', () => { reloadBtn.style.borderColor = 'var(--ed-accent)'; reloadBtn.style.background = 'var(--ed-soft)'; });
    reloadBtn.addEventListener('mouseleave', () => { reloadBtn.style.borderColor = 'var(--ed-line)'; reloadBtn.style.background = 'transparent'; });
    reloadBtn.addEventListener('click', () => {
      const src = this.core.buildHtml();
      this.core.setState({ codeSrc: src, codeLive: src, codeDirty: false });
      this.core.flash(this.core.t('toast.sourceReloaded'));
    });
    const applyBtn = elS('button', 'border: 0; background: var(--ed-accent); color: var(--ed-accent-ink); cursor: pointer; height: 30px; padding: 0 12px; display: flex; align-items: center; gap: 7px; font-family: var(--ed-font); font-weight: 600; font-size: 11px; transition: filter 0.16s;', { type: 'button', title: t('action.applyToCanvasHint'), 'data-i18n-title': 'action.applyToCanvasHint' });
    applyBtn.appendChild(icon('check', 14));
    applyBtn.appendChild(elS('span', '', { text: t('action.applyToCanvas'), 'data-i18n': 'action.applyToCanvas' }));
    applyBtn.addEventListener('mouseenter', () => { applyBtn.style.filter = 'brightness(1.1)'; });
    applyBtn.addEventListener('mouseleave', () => { applyBtn.style.filter = ''; });
    applyBtn.addEventListener('click', () => this.core.applyCode());
    const closeBtn = elS('button', 'border: 1px solid var(--ed-line); background: transparent; color: var(--ed-text); cursor: pointer; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; transition: border-color 0.16s;', { type: 'button', title: t('action.closeWithoutApplyingHint'), 'data-i18n-title': 'action.closeWithoutApplyingHint', class: 'mc-icon-button' });
    closeBtn.appendChild(icon('x', 14));
    closeBtn.addEventListener('mouseenter', () => { closeBtn.style.borderColor = 'var(--ed-accent)'; });
    closeBtn.addEventListener('mouseleave', () => { closeBtn.style.borderColor = 'var(--ed-line)'; });
    closeBtn.addEventListener('click', () => this.core.setState({ libraryOpen: false, exportOpen: false, aiOpen: false, codeOpen: false, assetTarget: null, libHot: false }));
    tip(closeBtn, t('action.closeWithoutApplyingHint'), 'down', 'end');
    head.append(headIcon, headText, this.codeWidthSeg, copyBtn, reloadBtn, applyBtn, closeBtn);
    overlay.appendChild(head);

    const cols = elS('div', 'display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 12px; min-height: 0; background: var(--ed-work);', { class: 'mc-code-split' });
    const left = elS('div', 'display: grid; grid-template-rows: auto 1fr; min-height: 0; border: 1px solid var(--ed-line); border-radius: 12px; overflow: hidden; background: var(--ed-panel);', { class: 'mc-code-source' });
    const leftHead = elS('div', 'padding: 5px 16px; border-bottom: 1px solid var(--ed-line); font-family: var(--ed-font); font-size: 10px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: var(--ed-muted); display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 30px; box-sizing: border-box;', { class: 'mc-pane-label' });
    this._codeFind = { open: false, q: '', index: 0, matches: [] };
    this.codeMetaEl = elS('span');
    // Native `title` tooltips here on purpose: the pane clips overflow, so the
    // shared tip() bubble would be cut off at this edge.
    const miniBtn = (iconName, key, onClick) => {
      const b = elS('button', 'border: 1px solid var(--ed-line); background: transparent; color: var(--ed-muted); cursor: pointer; width: 26px; height: 22px; display: flex; align-items: center; justify-content: center; border-radius: 6px; flex: none; transition: border-color 0.16s, color 0.16s;', { type: 'button', title: t(key), 'data-i18n-title': key, 'aria-label': t(key) });
      b.appendChild(icon(iconName, 13));
      b.addEventListener('mouseenter', () => { b.style.borderColor = 'var(--ed-accent)'; });
      b.addEventListener('mouseleave', () => { b.style.borderColor = b.getAttribute('aria-pressed') === 'true' ? 'var(--ed-accent)' : 'var(--ed-line)'; });
      b.addEventListener('click', onClick);
      return b;
    };
    this.codeFindBtn = miniBtn('search', 'code.find', () => (this._codeFind.open ? this.closeCodeFind() : this.openCodeFind()));
    this.codeWrapBtn = miniBtn('wrap', 'code.wrap', () => this.toggleCodeWrap());
    this.codeFormatBtn = miniBtn('indent', 'code.format', () => this.formatCodeSource());
    const tools = elS('div', 'display: flex; align-items: center; gap: 5px;', { class: 'mc-code-tools' });
    tools.append(this.codeFindBtn, this.codeWrapBtn, this.codeFormatBtn, this.codeMetaEl);
    leftHead.append(elS('span', '', { text: t('code.source'), 'data-i18n': 'code.source' }), tools);
    left.appendChild(leftHead);
    const editorWrap = elS('div', 'position: relative; min-height: 0;');
    editorWrap.appendChild(this.buildCodeEditor());
    editorWrap.appendChild(this.buildCodeFindBar());
    left.appendChild(editorWrap);
    cols.appendChild(left);
    // VS Code muscle memory, scoped to the panel so the host page's own
    // Ctrl+F is untouched anywhere else.
    overlay.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'f') { e.preventDefault(); e.stopPropagation(); this.openCodeFind(); }
      if (k === 'g') { e.preventDefault(); e.stopPropagation(); this.openCodeFind(true); }
    });

    const right = elS('div', 'display: grid; grid-template-rows: auto 1fr; min-height: 0; border: 1px solid var(--ed-line); border-radius: 12px; overflow: hidden; background: var(--ed-panel);', { class: 'mc-code-preview' });
    right.appendChild(elS('div', 'padding: 7px 16px; border-bottom: 1px solid var(--ed-line); background: var(--ed-panel); font-family: var(--ed-font); font-size: 10px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: var(--ed-muted);', { text: t('code.livePreview'), 'data-i18n': 'code.livePreview', class: 'mc-pane-label' }));
    // Flush, not a card on a mat: the document inside the frame paints its
    // own page background edge to edge, so padding the wrap and framing the
    // iframe stacked a second and third rectangle around a template that
    // already has one -- the pane, a mat, a bordered card, then the email's
    // own page, then its content column. `is-device` (renderCodeModal) puts
    // the mat and the frame back for the 390px phone width, where the card
    // *is* the point.
    const previewWrap = elS('div', 'overflow: auto; display: flex; justify-content: center; background: var(--ed-work);', { class: 'mc-code-preview-body' });
    this.codePreviewBody = previewWrap;
    this.codeFrame = elS('iframe', "width: 100%; height: 100%; min-height: 420px; border: 0; background: #ffffff; transition: width 0.24s cubic-bezier(0.22,0.61,0.36,1);", { title: t('code.liveHtmlPreviewTitle'), 'data-i18n-title': 'code.liveHtmlPreviewTitle', class: 'mc-code-frame' });
    this.codeFrame.addEventListener('load', () => { this.syncCodePreviewScrollbar(); this.wireCodePreviewInspect(); });
    previewWrap.appendChild(this.codeFrame);
    right.appendChild(previewWrap);
    cols.appendChild(right);
    overlay.appendChild(cols);

    overlay.appendChild(elS('div', 'padding: 8px 18px; border-top: 1px solid var(--ed-line); font-family: ui-monospace, monospace; font-size: 9.5px; letter-spacing: 0.06em; color: var(--ed-faint);', { text: t('code.applyNote'), 'data-i18n': 'code.applyNote', class: 'mc-code-footer' }));
    return overlay;
  }

  /** Ported from `codeEditorEl()`: numbered syntax-highlighted rows sit behind
   * a transparent-text/visible-caret `<textarea>`. Both layers share the same
   * fixed width and wrapping rules, so long HTML stays on screen without the
   * highlight or caret drifting away from the editable text. */
  buildCodeEditor() {
    const MONO = 'font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 20px; tab-size: 2;';
    // dir=ltr: HTML source is directional text; under an RTL chrome the
    // inherited direction would bidi-scramble it and, worse, let the caret
    // in the transparent textarea drift off the highlighted layer beneath.
    const root = elS('div', 'position: absolute; inset: 0; overflow-y: auto; overflow-x: hidden; background: var(--ed-work);', { dir: 'ltr' });
    const inner = elS('div', 'position: relative; min-height: 100%; width: 100%; min-width: 0;');
    this.codeScroller = root;
    this.codeInnerEl = inner;
    // Word wrap is a per-user editor preference, not document state -- kept
    // out of the core (and out of the draft) on purpose.
    try { this._codeWrap = localStorage.getItem('mailcraft.codewrap') !== 'off'; } catch { this._codeWrap = true; }
    this.codePre = elS('pre', `${MONO} margin: 0; padding: 14px 0 80px; width: 100%; min-width: 0; min-height: 100%; white-space: normal; color: var(--ed-text); pointer-events: none; background: linear-gradient(to right, var(--ed-panel-2) 0 52px, var(--ed-work) 52px);`, { 'aria-hidden': 'true' });
    this.codeTextarea = elS('textarea', `${MONO} position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; padding: 14px 18px 80px 70px; border: 0; background: transparent; color: transparent; caret-color: var(--ed-accent); white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; overflow: hidden; resize: none; outline: none;`, { spellcheck: 'false', wrap: 'soft', 'data-focus-key': 'code-src' });
    this.codeTextarea.addEventListener('input', (e) => this.core.setCodeSrc(e.target.value));
    this.codeTextarea.addEventListener('keydown', (e) => this.onCodeEditorKeydown(e));
    // Caret tracking: repaints the active-line wash and (debounced) points the
    // live preview at the element under the caret, DevTools-style. Typing is
    // deliberately excluded from the inspect ping -- the preview iframe is
    // 350ms behind while typing, and scrolling it mid-thought is noise.
    const caretPing = () => {
      if (!this.core.state.codeOpen) return;
      this.refreshCodeCaret();
      clearTimeout(this._inspectTimer);
      this._inspectTimer = setTimeout(() => this.inspectFromCaret(), 160);
    };
    this.codeTextarea.addEventListener('click', caretPing);
    this.codeTextarea.addEventListener('keyup', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) caretPing();
    });
    inner.append(this.codePre, this.codeTextarea);
    root.appendChild(inner);
    return root;
  }

  /** Editing keys inside the source textarea. Inserts run through `codeInsertText` so the browser's native undo stack (Ctrl+Z) survives -- the old Tab handler reassigned `.value` and silently wiped it. */
  onCodeEditorKeydown(e) {
    const ta = e.target;
    if (e.key === 'Escape' && this._codeFind && this._codeFind.open) {
      // Escape means "close the find bar", not the whole modal -- stop it
      // before the window-level shortcut handler sees it.
      e.preventDefault();
      e.stopPropagation();
      this.closeCodeFind();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.isComposing) {
      // Auto-indent: a new line starts at the previous line's indentation.
      e.preventDefault();
      const at = ta.selectionStart;
      const lineStart = ta.value.lastIndexOf('\n', at - 1) + 1;
      const ind = (/^[ \t]*/.exec(ta.value.slice(lineStart, at)) || [''])[0];
      this.codeInsertText('\n' + ind);
      this.refreshCodeCaret();
      return;
    }
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const a = ta.selectionStart;
    const b = ta.selectionEnd;
    const val = ta.value;
    if (!e.shiftKey && !val.slice(a, b).includes('\n')) { this.codeInsertText('  '); return; }
    // Multi-line selection (or Shift+Tab): indent/outdent whole lines.
    const start = val.lastIndexOf('\n', a - 1) + 1;
    let end = val.indexOf('\n', b);
    if (end === -1) end = val.length;
    const block = val.slice(start, end);
    const next = e.shiftKey ? block.replace(/^ {1,2}/gm, '') : block.replace(/^/gm, '  ');
    if (next === block) return;
    try { ta.setSelectionRange(start, end); } catch { return; }
    this.codeInsertText(next);
    try { ta.setSelectionRange(start, start + next.length); } catch { /* ignore */ }
  }

  /**
   * Replaces the textarea selection with `text`, preferring `execCommand
   * ('insertText')` so the edit lands on the browser's native undo stack --
   * deprecated but universally supported for exactly this, and the only way
   * Ctrl+Z keeps working across Format / Replace / Tab. The manual splice
   * covers environments without it (jsdom); both paths end in `setCodeSrc`
   * (execCommand fires a real `input` event, the splice calls it directly).
   */
  codeInsertText(text) {
    const ta = this.codeTextarea;
    try { ta.focus(); } catch { /* ignore */ }
    const a = ta.selectionStart;
    const b = ta.selectionEnd;
    const expected = ta.value.slice(0, a) + text + ta.value.slice(b);
    try {
      const doc = this.ownerDocument;
      if (doc && doc.execCommand) (text === '' ? doc.execCommand('delete', false) : doc.execCommand('insertText', false, text));
    } catch { /* fall through to the splice */ }
    // Trust the result, not the return value: environments shim execCommand as
    // a truthy no-op (jsdom), and some browsers report success on edits they
    // dropped. When it really ran, its input event has already hit setCodeSrc.
    if (ta.value === expected) return;
    ta.value = expected;
    const at = a + text.length;
    try { ta.setSelectionRange(at, at); } catch { /* ignore */ }
    this.core.setCodeSrc(ta.value);
  }

  /** The iframe owns a separate document, so the Shadow DOM scrollbar rules
   * cannot reach its viewport. Mirror the editor scrollbar as preview chrome
   * only; the source string and the HTML applied/exported by the host remain
   * byte-for-byte untouched. */
  syncCodePreviewScrollbar() {
    const doc = this.codeFrame?.contentDocument;
    if (!doc?.head) return;
    const view = this.ownerDocument?.defaultView;
    const thumb = view?.getComputedStyle(this.mc).getPropertyValue('--ed-line-2').trim() || 'rgba(15,23,42,0.16)';
    let style = doc.head.querySelector('[data-mc-preview-scrollbar]');
    if (!style) {
      style = doc.createElement('style');
      style.setAttribute('data-mc-preview-scrollbar', '');
      doc.head.appendChild(style);
    }
    style.textContent = `html { scrollbar-width: thin !important; scrollbar-color: ${thumb} transparent !important; } *::-webkit-scrollbar { width: 8px !important; height: 8px !important; } *::-webkit-scrollbar-thumb { background: ${thumb} !important; border-radius: 999px !important; } *::-webkit-scrollbar-track { background: transparent !important; } *::-webkit-scrollbar-button { display: none !important; width: 0 !important; height: 0 !important; }`;
  }

  renderCodeModal() {
    const s = this.core.state;
    const t = this.core.t;
    this.codeModal.style.display = s.codeOpen ? 'grid' : 'none';
    if (!s.codeOpen) return;
    this.applyCodeWrap();
    this.refreshCodeSource();
    if (this._codeFrameSrc !== s.codeLive) {
      // Display-only: the preview pane draws logic tags as the canvas's
      // dashed bands; the source pane and everything exported keep the
      // literal {{#if}}/{{#each}} text.
      this.codeFrame.srcdoc = decorateLogicTags(s.codeLive);
      this._codeFrameSrc = s.codeLive;
    }
    this.syncCodePreviewScrollbar();
    this.codeWidthSeg.innerHTML = '';
    [{ label: t('device.desktop'), v: 'desktop', iconName: 'monitor' }, { label: t('device.mobile'), v: 'mobile', iconName: 'phone' }].forEach((w) => {
      const on = s.codeDevice === w.v;
      const btn = elS('button', `width: 32px; height: 26px; display: flex; align-items: center; justify-content: center; background: ${this.segBg(on)}; color: ${this.segFg(on)};`, { type: 'button', title: w.label, 'aria-pressed': String(on) });
      btn.appendChild(icon(w.iconName, 15));
      btn.addEventListener('click', () => this.core.setState({ codeDevice: w.v }));
      tip(btn, w.label, 'down');
      this.codeWidthSeg.appendChild(btn);
    });
    const phone = s.codeDevice === 'mobile';
    this.codeFrame.style.width = phone ? '390px' : '100%';
    this.codePreviewBody.classList.toggle('is-device', phone);
  }

  /** Repaint the syntax layer, gutter, find marks and metadata without
   * touching the canvas, inspector, iframe, or focused textarea node. */
  refreshCodeSource() {
    if (!this.core.state.codeOpen || !this.codeTextarea) return;
    const s = this.core.state;
    const t = this.core.t;
    this.codeStatusEl.textContent = s.codeDirty ? t('code.statusEdited') : t('code.statusSynced');
    if (this.codeTextarea.value !== s.codeSrc) this.codeTextarea.value = s.codeSrc;
    const lines = s.codeSrc.split('\n');
    // Find state: recomputed on every repaint so marks track live edits.
    const find = this._codeFind;
    let matches = [];
    if (find && find.open && find.q) {
      matches = findMatches(s.codeSrc, find.q);
      find.matches = matches;
      if (find.index >= matches.length) find.index = Math.max(0, matches.length - 1);
    } else if (find) {
      find.matches = [];
      find.index = 0;
    }
    if (this.codeFindCount) this.codeFindCount.textContent = matches.length ? `${find.index + 1}/${matches.length}` : '0/0';
    const wrap = this._codeWrap !== false;
    const rowCols = wrap ? '52px minmax(0,1fr)' : '52px max-content';
    const cellWrapCss = wrap ? 'white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word' : 'white-space:pre';
    const caret = Math.min(this.codeTextarea.selectionStart || 0, s.codeSrc.length);
    let pos = 0;
    let mi = 0;
    let caretLine = 0;
    this.codePre.innerHTML = lines.map((line, index) => {
      const lineEnd = pos + line.length;
      const isCaret = caret >= pos && caret <= lineEnd;
      if (isCaret) caretLine = index;
      const ranges = [];
      while (mi < matches.length && matches[mi].start <= lineEnd) {
        const m = matches[mi];
        if (m.end > pos) ranges.push({ start: Math.max(0, m.start - pos), end: Math.min(line.length, m.end - pos), cur: mi === find.index });
        mi++;
      }
      const html = (ranges.length ? markRanges(hl(line), ranges) : hl(line)) || '&#8203;';
      const numCss = 'padding-right:10px;text-align:right;user-select:none;border-right:1px solid var(--ed-line);' + (isCaret ? 'color:var(--ed-accent);font-weight:700' : 'color:var(--ed-faint)');
      const rowCss = `display:grid;grid-template-columns:${rowCols};min-height:20px;${isCaret ? 'background:var(--ed-soft);' : ''}`;
      pos = lineEnd + 1;
      return `<span style="${rowCss}"><span style="${numCss}">${index + 1}</span><span style="min-width:0;padding:0 18px;${cellWrapCss}">${html}</span></span>`;
    }).join('');
    this._codeCaretLine = caretLine;
    this.codeMetaEl.textContent = t('code.meta', { kb: (s.codeSrc.length / 1024).toFixed(1), lines: lines.length });
  }

  /** Cheap caret-only follow-up: repaints the rows only when the caret changed line, so plain clicks and arrow keys don't pay the full rebuild twice. */
  refreshCodeCaret() {
    if (!this.core.state.codeOpen || !this.codeTextarea) return;
    const caret = this.codeTextarea.selectionStart || 0;
    const line = this.core.state.codeSrc.slice(0, caret).split('\n').length - 1;
    if (line !== this._codeCaretLine) this.refreshCodeSource();
  }

  /** 0-based line index of a character offset into the source pane. */
  codeLineOf(offset) {
    return this.core.state.codeSrc.slice(0, Math.max(0, offset)).split('\n').length - 1;
  }

  /** Scrolls the numbered row for `line` into view; `flash` outlines it for a beat (how "here it is" reads after a preview click or Go-to-line). */
  scrollCodeLineIntoView(line, flash) {
    const row = this.codePre && this.codePre.children[line];
    if (!row) return;
    if (typeof row.scrollIntoView === 'function') { try { row.scrollIntoView({ block: 'center' }); } catch { /* ignore */ } }
    if (!flash) return;
    row.style.outline = '1.5px solid var(--ed-accent)';
    row.style.outlineOffset = '-1px';
    setTimeout(() => { row.style.outline = ''; row.style.outlineOffset = ''; }, 900);
  }

  // ---- code view: wrap + format ------------------------------------------

  /** Applies the current wrap mode to both layers. Wrap off swaps the pane to one-source-line-per-row with a shared horizontal scroll: the inner sizer grows to the widest highlighted row and the transparent textarea (absolutely positioned over it) inherits that width, so caret and colors stay aligned. */
  applyCodeWrap() {
    const ta = this.codeTextarea;
    if (!ta) return;
    const on = this._codeWrap !== false;
    ta.setAttribute('wrap', on ? 'soft' : 'off');
    ta.style.whiteSpace = on ? 'pre-wrap' : 'pre';
    ta.style.overflowWrap = on ? 'anywhere' : 'normal';
    ta.style.wordBreak = on ? 'break-word' : 'normal';
    if (this.codeScroller) this.codeScroller.style.overflowX = on ? 'hidden' : 'auto';
    if (this.codeInnerEl) {
      this.codeInnerEl.style.width = on ? '100%' : 'max-content';
      this.codeInnerEl.style.minWidth = on ? '0' : '100%';
    }
    if (this.codeWrapBtn) {
      this.codeWrapBtn.setAttribute('aria-pressed', String(on));
      this.codeWrapBtn.style.color = on ? 'var(--ed-accent)' : 'var(--ed-muted)';
      this.codeWrapBtn.style.borderColor = on ? 'var(--ed-accent)' : 'var(--ed-line)';
    }
  }

  toggleCodeWrap() {
    this._codeWrap = this._codeWrap === false;
    try { localStorage.setItem('mailcraft.codewrap', this._codeWrap ? 'on' : 'off'); } catch { /* ignore */ }
    this.applyCodeWrap();
    this.refreshCodeSource();
  }

  /** Pretty-prints the source pane in place (core/code-tools.js `formatHtml` -- whitespace between tags only, the rendered email is unchanged). One undo step; nothing reaches the canvas until Apply. */
  formatCodeSource() {
    const src = this.core.state.codeSrc;
    let next = src;
    try { next = formatHtml(src); } catch { next = src; }
    if (next === src) return;
    const ta = this.codeTextarea;
    try { ta.focus(); ta.setSelectionRange(0, ta.value.length); } catch { /* ignore */ }
    this.codeInsertText(next);
    try { ta.setSelectionRange(0, 0); } catch { /* ignore */ }
    if (this.codeScroller) this.codeScroller.scrollTop = 0;
    this.refreshCodeSource();
  }

  // ---- code view: find / replace / go-to-line ------------------------------

  buildCodeFindBar() {
    const t = this.core.t;
    const bar = elS('div', 'position: absolute; top: 8px; right: 16px; z-index: 6; display: none; flex-direction: column; gap: 6px; padding: 8px; background: var(--ed-panel); border: 1px solid var(--ed-line-2); border-radius: 10px; box-shadow: var(--ed-shadow-lg);', { class: 'mc-code-findbar', dir: 'ltr' });
    const INPUT = 'box-sizing: border-box; background: var(--ed-panel-2); border: 1px solid var(--ed-line); color: var(--ed-text); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; padding: 5px 8px; border-radius: 6px; outline: none;';
    const iconBtn = (name, key, onClick) => {
      const b = elS('button', 'border: 1px solid var(--ed-line); background: transparent; color: var(--ed-muted); cursor: pointer; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 6px; flex: none; transition: border-color 0.16s;', { type: 'button', title: t(key), 'data-i18n-title': key, 'aria-label': t(key) });
      b.appendChild(icon(name, 12));
      b.addEventListener('mouseenter', () => { b.style.borderColor = 'var(--ed-accent)'; });
      b.addEventListener('mouseleave', () => { b.style.borderColor = 'var(--ed-line)'; });
      b.addEventListener('click', onClick);
      return b;
    };
    const textBtn = (key, onClick) => {
      const b = elS('button', 'border: 1px solid var(--ed-line); background: transparent; color: var(--ed-text); cursor: pointer; height: 24px; padding: 0 8px; display: flex; align-items: center; border-radius: 6px; font-family: var(--ed-font); font-size: 10.5px; font-weight: 600; flex: none; transition: border-color 0.16s;', { type: 'button' });
      b.appendChild(elS('span', '', { text: t(key), 'data-i18n': key }));
      b.addEventListener('mouseenter', () => { b.style.borderColor = 'var(--ed-accent)'; });
      b.addEventListener('mouseleave', () => { b.style.borderColor = 'var(--ed-line)'; });
      b.addEventListener('click', onClick);
      return b;
    };
    const row1 = elS('div', 'display: flex; align-items: center; gap: 6px;');
    this.codeFindInput = elS('input', INPUT + 'width: 168px;', { placeholder: t('code.find'), 'data-i18n-placeholder': 'code.find', 'data-focus-key': 'code-find' });
    this.codeFindInput.addEventListener('input', (e) => {
      this._codeFind.q = e.target.value;
      this._codeFind.index = 0;
      this.refreshCodeSource();
    });
    this.codeFindInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.codeFindStep(e.shiftKey ? -1 : 1); } });
    this.codeFindCount = elS('span', 'font-family: ui-monospace, monospace; font-size: 10.5px; color: var(--ed-muted); min-width: 42px; text-align: center; flex: none;', { text: '0/0' });
    row1.append(this.codeFindInput, this.codeFindCount, iconBtn('up', 'code.prevMatch', () => this.codeFindStep(-1)), iconBtn('down', 'code.nextMatch', () => this.codeFindStep(1)), iconBtn('x', 'action.close', () => this.closeCodeFind()));
    const row2 = elS('div', 'display: flex; align-items: center; gap: 6px;');
    this.codeReplaceInput = elS('input', INPUT + 'width: 130px;', { placeholder: t('code.replace'), 'data-i18n-placeholder': 'code.replace', 'data-focus-key': 'code-replace' });
    this.codeReplaceInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.codeReplaceCurrent(); } });
    this.codeLineInput = elS('input', INPUT + 'width: 52px;', { placeholder: ':42', title: t('code.goToLine'), 'data-i18n-title': 'code.goToLine', 'aria-label': t('code.goToLine'), 'data-focus-key': 'code-goline' });
    this.codeLineInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.codeGoToLine(e.target.value); } });
    row2.append(this.codeReplaceInput, textBtn('code.replace', () => this.codeReplaceCurrent()), textBtn('code.replaceAll', () => this.codeReplaceAll()), this.codeLineInput);
    bar.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      this.closeCodeFind();
    });
    bar.append(row1, row2);
    this.codeFindBar = bar;
    return bar;
  }

  openCodeFind(focusLine) {
    const f = this._codeFind;
    f.open = true;
    this.codeFindBar.style.display = 'flex';
    const ta = this.codeTextarea;
    const sel = ta.value.slice(ta.selectionStart || 0, ta.selectionEnd || 0);
    if (sel && !sel.includes('\n')) {
      this.codeFindInput.value = sel;
      f.q = sel;
      f.index = 0;
    }
    this.refreshCodeSource();
    const target = focusLine ? this.codeLineInput : this.codeFindInput;
    try { target.focus(); target.select(); } catch { /* ignore */ }
  }

  closeCodeFind() {
    this._codeFind.open = false;
    this.codeFindBar.style.display = 'none';
    this.refreshCodeSource();
    try { this.codeTextarea.focus(); } catch { /* ignore */ }
  }

  codeFindStep(dir) {
    const f = this._codeFind;
    if (!f.matches.length) return;
    f.index = (f.index + dir + f.matches.length) % f.matches.length;
    const m = f.matches[f.index];
    // Selection set silently (focus stays in the find bar); the pane shows the
    // current match through its mark, and Escape lands the caret on it.
    try { this.codeTextarea.setSelectionRange(m.start, m.end); } catch { /* ignore */ }
    this.refreshCodeSource();
    this.scrollCodeLineIntoView(this.codeLineOf(m.start));
  }

  codeReplaceCurrent() {
    const f = this._codeFind;
    if (!f.matches.length) return;
    const m = f.matches[f.index];
    const ta = this.codeTextarea;
    try { ta.focus(); ta.setSelectionRange(m.start, m.end); } catch { return; }
    this.codeInsertText(this.codeReplaceInput.value);
    // Matches recompute on the repaint; the unchanged index now points at what
    // was the following occurrence.
    this.refreshCodeSource();
    this.scrollCodeLineIntoView(this.codeLineOf(m.start));
    try { this.codeReplaceInput.focus(); } catch { /* ignore */ }
  }

  codeReplaceAll() {
    const f = this._codeFind;
    if (!f.q || !f.matches.length) return;
    const src = this.core.state.codeSrc;
    const rep = this.codeReplaceInput.value;
    let out = '';
    let last = 0;
    for (const m of f.matches) { out += src.slice(last, m.start) + rep; last = m.end; }
    out += src.slice(last);
    const ta = this.codeTextarea;
    try { ta.focus(); ta.setSelectionRange(0, ta.value.length); } catch { return; }
    this.codeInsertText(out);
    try { ta.setSelectionRange(0, 0); } catch { /* ignore */ }
    this.refreshCodeSource();
    try { this.codeFindInput.focus(); } catch { /* ignore */ }
  }

  codeGoToLine(value) {
    const num = parseInt(String(value).replace(/[^0-9]/g, ''), 10);
    if (!num) return;
    const lines = this.core.state.codeSrc.split('\n');
    const line = Math.min(Math.max(1, num), lines.length) - 1;
    let off = 0;
    for (let i = 0; i < line; i++) off += lines[i].length + 1;
    try { this.codeTextarea.focus(); this.codeTextarea.setSelectionRange(off, off); } catch { /* ignore */ }
    this.refreshCodeSource();
    this.scrollCodeLineIntoView(line, true);
  }

  // ---- code view: inspect (code <-> preview) -------------------------------

  /** Tag scan of the source pane, cached per source string -- caret pings and preview clicks both read it. */
  codeScan() {
    const src = this.core.state.codeSrc;
    if (this._codeScanSrc !== src) {
      this._codeScanSrc = src;
      this._codeScanned = scanElements(src);
    }
    return this._codeScanned;
  }

  /** Same-tag elements of the preview document in document order, minus the decoration nodes `decorateLogicTags` adds (chips/band rows exist only in the preview, never in the source being mapped). */
  codePreviewEls(doc, tag) {
    const deco = (el) => (el.closest && el.closest('[data-mc-deco]'))
      || (el.firstElementChild && el.firstElementChild.hasAttribute && el.firstElementChild.hasAttribute('data-mc-deco'));
    return Array.from(doc.getElementsByTagName(tag)).filter((el) => !deco(el));
  }

  /**
   * Caret -> preview half of the inspect link. Both documents render the same
   * string, so "the nth <td>" identifies the same element on both sides --
   * per-tag counting on purpose: the parser's inserted <tbody>s (and the
   * preview-only decoration, filtered above) would shift any global index.
   * When the counts for a tag disagree (mid-typing, malformed markup), the
   * mapping walks up to the nearest ancestor whose counts still line up
   * rather than guessing.
   */
  inspectFromCaret() {
    const s = this.core.state;
    if (!s.codeOpen) return;
    const doc = this.codeFrame && this.codeFrame.contentDocument;
    if (!doc || !doc.body) return;
    const scan = this.codeScan();
    const caret = Math.min(this.codeTextarea.selectionStart || 0, Math.max(0, s.codeSrc.length - 1));
    let el = elementAtOffset(scan, caret);
    let node = null;
    while (el) {
      const list = this.codePreviewEls(doc, el.tag);
      if (list.length === (scan.byTag[el.tag] || []).length) { node = list[el.nth] || null; break; }
      el = el.parent >= 0 ? scan.els[el.parent] : null;
    }
    this.highlightPreviewNode(node);
  }

  highlightPreviewNode(node) {
    const doc = this.codeFrame && this.codeFrame.contentDocument;
    if (!doc) return;
    if (this._previewHit && this._previewHit !== node) {
      try { this._previewHit.removeAttribute('data-mc-hit'); } catch { /* ignore */ }
    }
    this._previewHit = null;
    if (!node || node === doc.body || node === doc.documentElement) return;
    this._previewHit = node;
    node.setAttribute('data-mc-hit', '');
    this.ensureInspectStyle(doc);
    if (typeof node.scrollIntoView === 'function') {
      try { node.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { try { node.scrollIntoView(); } catch { /* ignore */ } }
    }
  }

  /** Preview-only outline style, injected the same way as the preview scrollbar chrome -- the source string and everything exported stay untouched. */
  ensureInspectStyle(doc) {
    if (!doc.head) return;
    const view = this.ownerDocument && this.ownerDocument.defaultView;
    const accent = (view && view.getComputedStyle(this.mc).getPropertyValue('--ed-accent').trim()) || '#2563eb';
    let style = doc.head.querySelector('[data-mc-inspect-style]');
    if (!style) {
      style = doc.createElement('style');
      style.setAttribute('data-mc-inspect-style', '');
      doc.head.appendChild(style);
    }
    style.textContent = `[data-mc-hit] { outline: 2px solid ${accent} !important; outline-offset: -1px !important; }`;
  }

  /** Attach the preview -> code click handler to the iframe's current document (each srcdoc load mints a new one). Capture phase so an <a> highlights its source instead of navigating the preview away. */
  wireCodePreviewInspect() {
    const doc = this.codeFrame && this.codeFrame.contentDocument;
    if (!doc || doc === this._inspectWiredDoc) return;
    this._inspectWiredDoc = doc;
    this._previewHit = null;
    doc.addEventListener('click', (e) => {
      if (!this.core.state.codeOpen) return;
      e.preventDefault();
      this.revealSourceFromPreview(e.target);
    }, true);
  }

  /** Preview -> caret half of the inspect link: selects the clicked element's open tag in the source pane and scrolls its line into view. */
  revealSourceFromPreview(target) {
    const doc = this.codeFrame && this.codeFrame.contentDocument;
    if (!doc) return;
    const scan = this.codeScan();
    let node = target && target.nodeType === 1 ? target : target && target.parentElement;
    let found = null;
    let hit = null;
    while (node && node !== doc.documentElement) {
      if (node.closest && node.closest('[data-mc-deco]')) { node = node.parentElement; continue; }
      const tag = node.tagName.toLowerCase();
      const list = this.codePreviewEls(doc, tag);
      const nth = list.indexOf(node);
      if (nth !== -1 && (scan.byTag[tag] || []).length === list.length) {
        found = scan.byTag[tag][nth];
        hit = node;
        break;
      }
      node = node.parentElement;
    }
    if (!found) return;
    try {
      this.codeTextarea.focus();
      this.codeTextarea.setSelectionRange(found.openStart, found.openEnd);
    } catch { /* ignore */ }
    this.refreshCodeSource();
    this.scrollCodeLineIntoView(this.codeLineOf(found.openStart), true);
    this.highlightPreviewNode(hit);
  }

  // ---- modals: AI copy --------------------------------------------------

  buildAiModal() {
    const t = this.core.t;
    const overlay = elS('div', 'position: absolute; inset: 0; background: rgba(10,12,14,0.6); z-index: 50; display: flex; align-items: flex-start; justify-content: center; padding: 34px; overflow-y: auto; animation: mcFade 0.16s ease; display: none;', { class: 'mc-modal-backdrop' });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.core.setState({ libraryOpen: false, exportOpen: false, aiOpen: false, codeOpen: false, assetTarget: null, libHot: false }); });
    const modal = elS('div', 'width: 100%; max-width: 660px; background: var(--ed-panel); border: 1px solid var(--ed-line-2); border-radius: var(--ed-radius); overflow: hidden; box-shadow: var(--ed-shadow-lg); animation: mcIn 0.2s cubic-bezier(0.22,0.61,0.36,1);', { class: 'mc-modal' });
    modal.addEventListener('click', (e) => e.stopPropagation());
    overlay.appendChild(modal);

    const head = elS('div', 'display: flex; align-items: center; padding: 14px 20px; border-bottom: 1px solid var(--ed-line);');
    const headText = elS('div', 'flex: 1;');
    headText.append(
      elS('div', 'font-family: var(--ed-font); font-size: 10px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: var(--ed-muted);', { text: t('modal.aiDraft'), 'data-i18n': 'modal.aiDraft' }),
      elS('div', 'font-family: var(--ed-font); font-weight: 600; font-size: 16px; line-height: 1.25;', { text: t('modal.aiDraftTitle'), 'data-i18n': 'modal.aiDraftTitle' }),
    );
    const closeBtn = elS('button', 'border: 1px solid var(--ed-line); background: transparent; color: var(--ed-text); cursor: pointer; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; transition: border-color 0.16s, background 0.16s;', { type: 'button', title: t('action.close'), class: 'mc-icon-button' });
    closeBtn.appendChild(icon('x', 14));
    closeBtn.addEventListener('mouseenter', () => { closeBtn.style.borderColor = 'var(--ed-accent)'; });
    closeBtn.addEventListener('mouseleave', () => { closeBtn.style.borderColor = 'var(--ed-line)'; });
    closeBtn.addEventListener('click', () => this.core.setState({ libraryOpen: false, exportOpen: false, aiOpen: false, codeOpen: false, assetTarget: null, libHot: false }));
    tip(closeBtn, t('action.close'), 'down', 'end');
    head.append(headText, closeBtn);
    modal.appendChild(head);

    const body = elS('div', 'padding: 20px; display: grid; gap: 14px;');
    body.appendChild(elS('p', 'margin: 0; padding: 10px 12px; border: 1px solid var(--ed-line); border-radius: 8px; background: var(--ed-panel-2); color: var(--ed-muted); font-size: 12px; line-height: 1.5;', { text: t('ai.disclosure'), 'data-i18n': 'ai.disclosure' }));
    const row = elS('div', 'display: grid; grid-template-columns: 1fr 1fr; gap: 14px;');

    const goalWrap = elS('div');
    goalWrap.appendChild(elS('label', 'display: block; font-size: 11.5px; color: var(--ed-muted); margin-bottom: 4px;', { text: t('ai.goal'), 'data-i18n': 'ai.goal' }));
    this.aiGoalSelect = elS('select', 'width: 100%; box-sizing: border-box; background: var(--ed-panel-2); border: 1px solid var(--ed-line); color: var(--ed-text); font: inherit; font-size: 13px; padding: 8px;');
    this.aiGoalSelect.addEventListener('change', (e) => this.core.setState({ aiGoal: e.target.value }));
    // Filled once here rather than on every render: the lists are static, and
    // sixteen goals under two <optgroup> headings stay scannable where one flat
    // run of sixteen would not.
    AI_GOALS.forEach((g) => {
      const grp = document.createElement('optgroup');
      grp.label = g.group;
      g.items.forEach((name) => { const o = document.createElement('option'); o.value = name; o.textContent = name; grp.appendChild(o); });
      this.aiGoalSelect.appendChild(grp);
    });
    goalWrap.appendChild(this.aiGoalSelect);

    const toneWrap = elS('div');
    toneWrap.appendChild(elS('label', 'display: block; font-size: 11.5px; color: var(--ed-muted); margin-bottom: 4px;', { text: t('ai.tone'), 'data-i18n': 'ai.tone' }));
    this.aiToneSelect = elS('select', 'width: 100%; box-sizing: border-box; background: var(--ed-panel-2); border: 1px solid var(--ed-line); color: var(--ed-text); font: inherit; font-size: 13px; padding: 8px;');
    this.aiToneSelect.addEventListener('change', (e) => this.core.setState({ aiTone: e.target.value }));
    AI_TONES.forEach((tone) => { const o = document.createElement('option'); o.value = tone; o.textContent = tone; this.aiToneSelect.appendChild(o); });
    toneWrap.appendChild(this.aiToneSelect);
    row.append(goalWrap, toneWrap);
    body.appendChild(row);

    const briefWrap = elS('div');
    briefWrap.appendChild(elS('label', 'display: block; font-size: 11.5px; color: var(--ed-muted); margin-bottom: 4px;', { text: t('ai.briefLabel'), 'data-i18n': 'ai.briefLabel' }));
    this.aiBriefInput = elS('textarea', 'width: 100%; min-height: 78px; box-sizing: border-box; background: var(--ed-panel-2); border: 1px solid var(--ed-line); color: var(--ed-text); font: inherit; font-size: 13px; padding: 9px; resize: vertical;', { placeholder: t('ai.briefPlaceholder'), 'data-i18n-placeholder': 'ai.briefPlaceholder', 'data-focus-key': 'ai-brief', dir: 'auto' });
    this.aiBriefInput.addEventListener('focus', () => { this.aiBriefInput.style.borderColor = 'var(--ed-accent)'; this.aiBriefInput.style.outline = 'none'; });
    // Debounced with a blur flush: runAi reads state.aiBrief, and clicking
    // Generate blurs this field first -- the flush lands the last keystrokes
    // before the read.
    const briefCommit = typeCommit((v) => this.core.setState({ aiBrief: v }));
    this.aiBriefInput.addEventListener('blur', () => { this.aiBriefInput.style.borderColor = 'var(--ed-line)'; briefCommit.flush(); });
    this.aiBriefInput.addEventListener('input', (e) => briefCommit.call(e.target.value));
    briefWrap.appendChild(this.aiBriefInput);
    body.appendChild(briefWrap);

    this.aiRunBtn = elS('button', 'border: 0; background: var(--ed-accent); color: var(--ed-accent-ink); cursor: pointer; min-height: 36px; padding: 9px 12px; display: flex; align-items: center; justify-content: center; gap: 8px; font-family: var(--ed-font); font-weight: 600; font-size: 12px; transition: filter 0.16s;', { type: 'button', class: 'mc-icon-label' });
    this.aiRunBtn.iconNode = icon('spark', 14);
    this.aiRunBtn.labelNode = elS('span');
    this.aiRunBtn.append(this.aiRunBtn.iconNode, this.aiRunBtn.labelNode);
    this.aiRunBtn.addEventListener('mouseenter', () => { this.aiRunBtn.style.filter = 'brightness(1.1)'; });
    this.aiRunBtn.addEventListener('mouseleave', () => { this.aiRunBtn.style.filter = ''; });
    this.aiRunBtn.addEventListener('click', () => this.core.runAi());
    body.appendChild(this.aiRunBtn);

    this.aiResultsEl = elS('div');
    body.appendChild(this.aiResultsEl);
    modal.appendChild(body);
    return overlay;
  }

  renderAiModal() {
    const s = this.core.state;
    const t = this.core.t;
    this.aiModal.style.display = s.aiOpen ? 'flex' : 'none';
    if (!s.aiOpen) return;
    // Options are built once in buildAiModal; render only reflects state.
    this.aiGoalSelect.value = s.aiGoal;
    this.aiToneSelect.value = s.aiTone;
    if (this.aiBriefInput.value !== s.aiBrief) this.aiBriefInput.value = s.aiBrief;
    this.aiRunBtn.disabled = s.aiBusy;
    this.aiRunBtn.labelNode.textContent = s.aiBusy ? t('ai.writing') : t('ai.generate');

    this.aiResultsEl.innerHTML = '';
    s.aiResults.forEach((r) => {
      const card = elS('div', 'position: relative; border: 1px solid var(--ed-line); border-radius: var(--ed-radius-sm); padding: 15px;');
      card.appendChild(elS('div', 'font-family: var(--ed-font); font-size: 10px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: var(--ed-accent); margin-bottom: 7px;', { text: r.kind }));
      card.appendChild(elS('div', 'font-size: 14px; line-height: 1.55; white-space: pre-wrap;', { text: r.text, dir: 'auto' }));
      const useBtn = elS('button', 'margin-top: 12px; border: 1px solid var(--ed-line); background: transparent; color: var(--ed-text); cursor: pointer; padding: 6px 11px; font-family: ui-monospace, monospace; font-size: 9.5px; letter-spacing: 0.12em; text-transform: uppercase; transition: background 0.16s, color 0.16s, border-color 0.16s;', { type: 'button', text: r.action });
      useBtn.addEventListener('mouseenter', () => { useBtn.style.background = 'var(--ed-accent)'; useBtn.style.color = 'var(--ed-accent-ink)'; useBtn.style.borderColor = 'var(--ed-accent)'; });
      useBtn.addEventListener('mouseleave', () => { useBtn.style.background = 'transparent'; useBtn.style.color = 'var(--ed-text)'; useBtn.style.borderColor = 'var(--ed-line)'; });
      useBtn.addEventListener('click', r.onUse);
      card.appendChild(useBtn);
      this.aiResultsEl.appendChild(card);
    });
  }

  // ---- modals: preview ----------------------------------------------------

  buildPreviewModal() {
    const t = this.core.t;
    const overlay = elS('div', '', { class: 'mc-fullscreen-panel mc-preview-panel' });
    overlay.style.cssText = 'position: absolute; inset: 0; z-index: 60; background: var(--ed-work); display: grid; grid-template-rows: 58px minmax(0, 1fr); animation: mcFade 0.16s ease; display: none;';
    const head = elS('div', 'display: flex; align-items: center; gap: 12px; padding: 0 20px; border-bottom: 1px solid var(--ed-line); background: var(--ed-panel);', { class: 'mc-preview-toolbar' });
    const headText = elS('div', 'flex: 1; min-width: 0;');
    this.previewKickerEl = elS('div', 'font-family: var(--ed-font); font-size: 10px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: var(--ed-muted);', { class: 'mc-preview-kicker' });
    headText.append(this.previewKickerEl);
    this.previewDeviceSeg = elS('div', '', { class: 'mc-segment' });
    const closeBtn = elS('button', 'border: 1px solid var(--ed-line); background: transparent; color: var(--ed-text); cursor: pointer; height: 30px; padding: 0 13px; display: flex; align-items: center; gap: 6px; font-family: var(--ed-font); font-size: 11px; font-weight: 600; transition: border-color 0.16s, background 0.16s;', { type: 'button' });
    closeBtn.appendChild(icon('x', 14));
    closeBtn.appendChild(elS('span', '', { text: t('action.close'), 'data-i18n': 'action.close' }));
    closeBtn.addEventListener('mouseenter', () => { closeBtn.style.borderColor = 'var(--ed-accent)'; closeBtn.style.background = 'var(--ed-soft)'; });
    closeBtn.addEventListener('mouseleave', () => { closeBtn.style.borderColor = 'var(--ed-line)'; closeBtn.style.background = 'transparent'; });
    closeBtn.addEventListener('click', () => this.core.setState({ previewOpen: false }));
    head.append(headText, this.previewDeviceSeg, closeBtn);
    overlay.appendChild(head);
    // This body *is* the sent email's page: the theme's page background is
    // applied on each render (renderPreviewModal), and the stylesheet gives
    // it container padding painted in that background -- breathing room the
    // way a mail client's viewport provides it, with the sheet itself, and
    // everything exportHtml() renders, untouched.
    const body = elS('div', 'overflow-y: auto;', { class: 'mc-preview-body' });
    // Kept on the instance: renderPreviewModal repaints it from the document's
    // page background on every render, and it runs long after this builder's
    // local has gone out of scope.
    this.previewBody = body;
    this.previewSlot = elS('div', '', { class: 'mc-sheet-wrap' });
    this.previewSlot.style.cssText = 'display: flex; justify-content: center;';
    body.appendChild(this.previewSlot);
    overlay.appendChild(body);
    return overlay;
  }

  renderPreviewModal() {
    const s = this.core.state;
    const t = this.core.t;
    this.previewModal.style.display = s.previewOpen ? 'grid' : 'none';
    if (!s.previewOpen) { this._previewDoc = null; return; }
    this.previewKickerEl.textContent = s.device === 'mobile' ? t('preview.kickerMobile') : t('preview.kickerDesktop', { width: s.doc.theme.width });
    this.previewDeviceSeg.innerHTML = '';
    [
      { label: t('device.desktop'), v: 'desktop', iconName: 'monitor' }, { label: t('device.mobile'), v: 'mobile', iconName: 'phone' },
    ].forEach((d) => {
      const on = s.device === d.v;
      const btn = elS('button', `width: 32px; height: 26px; display: flex; align-items: center; justify-content: center; background: ${this.segBg(on)}; color: ${this.segFg(on)};`, { type: 'button', title: d.label, 'aria-pressed': String(on) });
      btn.appendChild(icon(d.iconName, 15));
      btn.addEventListener('click', () => this.core.setState({ device: d.v }));
      tip(btn, d.label, 'down');
      this.previewDeviceSeg.appendChild(btn);
    });
    // The preview body doubles as the sent page: the theme's page background
    // paints it, exactly as the exported <body style="background:..."> does.
    // Falls back to the empty string -- and so to the stylesheet's dotted
    // grid -- for a transparent page, which is exactly what a client with no
    // page colour of its own shows behind the email.
    const pageBg = s.doc.theme.bg || '';
    this.previewBody.style.background = /^(transparent|none)$/i.test(pageBg.trim()) ? '' : pageBg;
    // Rebuild the sheet only when what it renders from actually changed.
    // renderPreviewModal runs on *every* render pass, and rebuilding the
    // whole email document each time made the open preview visibly rough:
    // every unrelated setState re-created every node (images re-decoded and
    // flashed, the scroll anchor jumped). The three inputs are cheap
    // identity checks -- commit/undo/redo always replace `doc` with a fresh
    // parse, refreshTranslator always replaces `t` -- so a stale hit is
    // impossible.
    if (s.doc !== this._previewDoc || s.device !== this._previewDevice || t !== this._previewT) {
      this._previewDoc = s.doc;
      this._previewDevice = s.device;
      this._previewT = t;
      this.previewSlot.replaceChildren(renderDoc(this.core, false));
    }
  }
}

/** Ported from `blockTiles` inside `renderVals()` -- `icon` is a factory (not a built node) since a DOM node can only ever be attached in one place. */
function paletteTiles(core) {
  const rowCount = () => core.state.doc.rows.length;
  return PALETTE.map((e) => {
    if (e.g) {
      const gr = GROUPS[e.g];
      return {
        label: gr.label, icon: () => icon(gr.icon, 20),
        hint: gr.label + ' — drops a row of ordinary blocks you can edit and rearrange one by one',
        onDragStart: core.startDrag({ kind: 'group', id: e.g }),
        onAdd: () => core.insertGroup(e.g, null, 0, rowCount()),
      };
    }
    const b = DEF(e.t); if (!b) return null;
    return {
      label: b.label, icon: () => icon(b.type, 20), hint: b.hint + ' — drag onto the canvas, or double-click to append',
      onDragStart: core.startDrag({ kind: 'block', type: b.type }),
      onAdd: () => core.insertBlock(b.type, null, 0, rowCount()),
    };
  }).filter(Boolean);
}

// Guarded on both sides. `customElements` is absent under SSR (Next.js, Nuxt,
// Angular Universal) and in any Node-based test runner, where importing the
// package must not throw; and `define` throws NotSupportedError if the module
// is evaluated twice -- HMR, or a bundled and an ESM copy loaded side by side.
if (typeof customElements !== 'undefined' && !customElements.get('mailcraft-editor')) {
  customElements.define('mailcraft-editor', MailCraftEditor);
}
