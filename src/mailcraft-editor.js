import { EditorCore } from './core/editor-core.js';
import { GROUPS, LAYOUTS, DEF, PALETTE } from './core/blocks.js';
import { KB } from './core/assets.js';
import { acceptAttribute } from './core/storage-limits.js';
import { renderDoc } from './render/canvas.js';
import { renderRte } from './render/rte.js';
import { renderField, renderFieldCards, typeCommit } from './render/fields.js';
import { icon } from './core/icons.js';
import { TOKEN } from './core/variables.js';
import { hl, cssUrl } from './core/sanitize.js';
import { withFocusPreserved } from './render/focus-preserve.js';
import { captureTemplatePng } from './render/screenshot.js';
import { createStoryViewer } from './render/story.js';
import { STYLE } from './render/style.js';
import { createTranslator, isRtl } from './core/i18n/index.js';
import { LOCALE_TABLES } from './core/i18n/tables.js';

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
 * Attributes: `variables`, `campaign`, `locale` (picks the shipped UI language
 * and, via `dir` defaulting, RTL), `dir`, `theme` ("light"/"dark" -- host-owned),
 * `ui-font` (a CSS font-family value; use "inherit" for the host app's font),
 * chrome; while present the built-in toggle is hidden). Properties: `.variables`, `.campaign`,
 * `.aiProvider` (optional async fn, replaces the original's `window.claude.complete`),
 * `.iconProvider` (optional social-icon override), `.storageProvider` (host-supplied
 * file storage -- see `core/storage.js`), `.storageLimits` (host-set upload ceilings,
 * required whenever a provider is set), `.messages` (UI string overrides --
 * a host's own table, an imported locale from `core/i18n/`, or both merged via
 * `defineMessages`; see `core/i18n/index.js`).
 * Methods: `getContent()`, `setContent(doc)`, `importHtml(html)`, `exportHtml()`,
 * `loadTemplate(tpl)`, `screenshotPng()`
 * (full-template PNG as a Blob), `previewScreenshot()` (story-style viewer),
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
  static get observedAttributes() { return ['variables', 'campaign', 'locale', 'dir', 'theme', 'ui-font']; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    // Created here (not connectedCallback) so `.variables`/`.campaign`/`.getContent()`
    // work even before the element is inserted into the document -- a common pattern
    // (`document.createElement(...)`, configure, then append).
    this.core = new EditorCore({
      variables: this.hasAttribute('variables') ? this.getAttribute('variables') : undefined,
      campaign: this.hasAttribute('campaign') ? this.getAttribute('campaign') : undefined,
    });
  }

  connectedCallback() {
    this.buildShell();
    this.applyUiFont();
    this.applyDir();
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
    if (name === 'campaign') this.core.setState({ campaign: value });
    if (name === 'locale' || name === 'dir') this.applyDir();
    if (name === 'locale') this.refreshTranslator();
    if (name === 'theme') this.applyTheme();
    if (name === 'ui-font') this.applyUiFont();
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
   * (core/i18n/tables.js) and overlays any host-set `.messages` on top --
   * attribute picks the language, `.messages` stays the documented way to
   * override individual strings. With no locale attribute this degrades to
   * the old behavior: `.messages` alone over built-in English.
   */
  refreshTranslator() {
    const table = LOCALE_TABLES[this.getAttribute('locale')] || null;
    const overrides = this.core.messages;
    this.core.t = createTranslator(table ? Object.assign({}, table, overrides || {}) : overrides);
    this.story?.retranslate();
    this.core.emit();
  }

  /** `dir` wins when the host sets it explicitly; otherwise it defaults from `isRtl(locale)` so `locale="ar"` gets RTL for free. Applied directly to `#mc` (not full state, since it never affects rendered content, only the CSS `dir`). */
  applyDir() {
    if (!this.mc) return;
    const explicit = this.getAttribute('dir');
    this.mc.setAttribute('dir', explicit || (isRtl(this.getAttribute('locale')) ? 'rtl' : 'ltr'));
  }

  // ---- public API ----------------------------------------------------

  getContent() { return JSON.parse(JSON.stringify(this.core.state.doc)); }
  setContent(doc) { this.core.loadDoc(doc); }
  /** Parses arbitrary HTML (a full email, a fragment, MailCraft's own exported output) into native blocks wherever the shape is recognizable, replacing the current document. See `core/import-html.js` for the per-shape rules. */
  importHtml(html) { return this.core.importHtml(html); }
  get campaign() { return this.core.state.campaign; }
  set campaign(value) { this.core.setState({ campaign: value }); }
  get variables() { return this.core.vars(); }
  set variables(value) { this.core.variablesRaw = value; this.core.emit(); }

  get uiFont() { return this.getAttribute('ui-font') || ''; }
  set uiFont(value) {
    if (value == null || String(value).trim() === '') this.removeAttribute('ui-font');
    else this.setAttribute('ui-font', String(value));
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
   * README.md for a worked example. Setting one replaces the seeded demo
   * library with the backend's own: folders, paging,
   * upload and delete all go through it, and nothing is written to
   * localStorage. Set `null` to go back to the built-in behaviour.
   */
  get storageProvider() { return this.core.storageProvider; }
  set storageProvider(provider) { this.core.setStorageProvider(provider); }

  /**
   * What may be uploaded: `{ accept, maxBytes, maxWidth, maxHeight, maxFilesPerDrop, allowSvg }`.
   * Required alongside a provider and deliberately undefaulted -- the ceilings
   * that suit an email template depend on the sending platform, the audience's
   * mail clients and the host's own rules, none of which this package can know.
   * See `core/storage-limits.js`.
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

  exportHtml() {
    const html = this.core.buildHtml();
    this.dispatchEvent(new CustomEvent('export', { detail: html }));
    return html;
  }

  /** Full-template screenshot as a PNG Blob (2x resolution, desktop width, independent of the current device/zoom view). See render/screenshot.js for the technique and its limits. */
  screenshotPng() { return captureTemplatePng(this.core, this.mc); }

  /** Opens the story-style viewer over the editor and captures into it -- what the Screenshot button does. Nothing touches the filesystem until the user picks Download inside it. */
  previewScreenshot() { this.story.open(); }

  /** `screenshotPng()` plus the same save-a-file flow as the HTML export download, with success/failure toasts. Pass an already-captured blob (the story viewer does) to save that one instead of rendering a second time. */
  async downloadScreenshot(blob) {
    const t = this.core.t;
    try {
      const png = blob || await this.screenshotPng();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(png);
      a.download = (this.core.state.campaign || 'email').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.png';
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
      const png = blob || await this.screenshotPng();
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

    this.mc = elS('div', 'height: 100%; padding: 16px; box-sizing: border-box; background: radial-gradient(circle at 8% 0%, var(--ed-soft), transparent 28%), var(--ed-bg); color: var(--ed-text); font-family: var(--ed-font); font-size: 14px; overflow-x: auto; overflow-y: hidden;', { id: 'mc' });
    root.appendChild(this.mc);

    const outer = elS('div', 'position: relative; height: 100%; min-width: 1180px;');
    this.mc.appendChild(outer);

    this.frame = elS('div', 'position: relative; height: 100%; border: 1px solid var(--ed-line-2); border-radius: var(--ed-radius); background: var(--ed-panel); display: grid; grid-template-rows: 54px 1fr; overflow: hidden; box-shadow: var(--ed-shadow-sm), var(--ed-shadow-md);', { class: 'mc-shell' });
    outer.appendChild(this.frame);

    this.frame.appendChild(this.buildHeader());

    this.body = elS('div', 'display: grid; grid-template-columns: 1fr 340px; min-height: 0;', { class: 'mc-layout' });
    this.frame.appendChild(this.body);
    this.body.appendChild(this.buildMain());
    this.body.appendChild(this.buildAside());

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

  buildHeader() {
    const t = this.core.t;
    const header = elS('header', "display: flex; align-items: center; gap: 14px; padding: 0 16px; border-bottom: 1px solid var(--ed-line); background: linear-gradient(to bottom, var(--ed-panel), var(--ed-panel-2)); position: relative; z-index: 30;", { class: 'mc-header' });

    const brandMark = elS('span', '', { class: 'mc-brand-mark' });
    const markSvg = icon('mailSpark', 20);
    markSvg.setAttribute('stroke-width', '1.8');
    brandMark.appendChild(markSvg);
    const brand = elS('div', 'display: flex; align-items: center; gap: 9px;');
    brand.append(
      brandMark,
      elS('span', 'font-family: var(--ed-font); font-weight: 600; font-size: 15px; letter-spacing: -0.01em; line-height: 1;', { text: 'MailCraft', class: 'mc-brand-name' }),
    );
    header.append(brand, elS('div', 'width: 1px; height: 22px; background: var(--ed-line);'));

    this.savedLabel = elS('span', 'display: flex; align-items: center; gap: 6px; font-family: ui-monospace, monospace; font-size: 9.5px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ed-faint); white-space: nowrap;');
    // No infinite pulse: a forever-running animation keeps the compositor
    // producing frames while the editor is idle -- constant CPU on low-end
    // hardware for a decorative effect. A solid dot still reads "autosave on".
    this.savedDot = elS('span', 'width: 5px; height: 5px; border-radius: 50%; background: var(--ed-accent);');
    this.savedLabel.appendChild(this.savedDot);
    this.savedLabel.appendChild(document.createTextNode(''));
    header.appendChild(this.savedLabel);

    header.appendChild(elS('div', 'flex: 1;'));

    this.deviceSeg = elS('div', '', { class: 'mc-segment mc-device-segment' });
    header.appendChild(this.deviceSeg);

    const iconButtons = elS('div', 'display: flex; align-items: center; gap: 3px;');
    this.undoBtn = this.iconBtn('undo', t('action.undoHint'), () => this.core.undo(), 'action.undoHint');
    this.redoBtn = this.iconBtn('redo', t('action.redoHint'), () => this.core.redo(), 'action.redoHint');
    this.chromeBtn = this.labelIconBtn('moon', t('action.chromeToDark'), t('action.chromeHint'), () => {
      const chrome = this.core.state.chrome === 'light' ? 'dark' : 'light';
      this.core.setState({ chrome }, () => this.core.persist(null, null, null, chrome));
    }, 'action.chromeHint');
    this.chromeBtn.i18nTipKey = this.core.state.chrome === 'light' ? 'action.chromeHintToDark' : 'action.chromeHintToLight';
    this.chromeBtn.tipNode.textContent = t(this.chromeBtn.i18nTipKey);
    this.aiBtn = this.labelIconBtn('spark', t('action.aiDraft'), t('action.aiDraftHint'), () => this.core.setState({ aiOpen: true }), 'action.aiDraftHint', 'action.aiDraft');
    this.codeBtn = this.labelIconBtn('code', t('action.code'), t('action.codeHint'), () => this.core.openCode(), 'action.codeHint', 'action.code');
    this.previewBtn = this.labelIconBtn('eye', t('action.preview'), t('action.previewHint') || '', () => this.core.setState({ previewOpen: true }), 'action.previewHint', 'action.preview');
    this.exportBtn = this.labelIconBtn('download', t('action.export'), t('action.exportHint'), () => this.core.openExport(), 'action.exportHint', 'action.export');

    iconButtons.append(this.undoBtn, this.redoBtn, this.chromeBtn, this.aiBtn, this.codeBtn, this.previewBtn, this.exportBtn);
    header.appendChild(iconButtons);
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

  /** Repaint just the countdown digits on the canvas -- driven by the core's
   * 1s tick (core.onTick), which used to re-render the whole editor. */
  refreshCountdowns() {
    const now = this.core.state.now;
    this.canvasSlot.querySelectorAll('[data-mc-countdown]').forEach((wrap) => {
      const ms = Math.max(0, new Date(wrap.getAttribute('data-mc-countdown')).getTime() - now);
      const vals = { days: Math.floor(ms / 86400000), hrs: Math.floor(ms / 3600000) % 24, min: Math.floor(ms / 60000) % 60, sec: Math.floor(ms / 1000) % 60 };
      wrap.querySelectorAll('[data-mc-count]').forEach((n) => {
        n.textContent = String(vals[n.getAttribute('data-mc-count')] ?? 0).padStart(2, '0');
      });
    });
  }

  /** The header's "Saved HH:MM" label -- autosave updates it through
   * core.onSavedChange, surgically: it is the only thing autosave changes
   * on screen, and a full render for it destroyed open dropdowns. */
  refreshSavedLabel() {
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

  // ---- main (canvas) ------------------------------------------------------

  buildMain() {
    const main = elS('main', '', { class: 'mc-workspace' });
    this.mainEl = main;
    main.style.cssText = 'position: relative; overflow-y: auto; min-height: 0;';
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
    const aside = elS('aside', 'border-left: 1px solid var(--ed-line); background: var(--ed-panel); display: grid; grid-template-rows: auto 1fr; min-height: 0;', { class: 'mc-inspector' });
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
    if (!c.state.editing || !c.editEl || !c.editEl.isConnected || !c.editKey) return;
    const found = c.find(c.state.doc, c.state.editing);
    if (!found.block) return;
    const val = c.editPlain ? c.editEl.textContent : c.editEl.innerHTML;
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
    this.refreshSavedLabel();

    this.undoBtn.disabled = !s.history.length;
    this.redoBtn.disabled = !s.future.length;
    // A host-supplied `theme` attribute owns light/dark (see applyTheme) --
    // hide the built-in toggle rather than let it fight the host's control.
    this.chromeBtn.style.display = this.hasAttribute('theme') ? 'none' : 'flex';
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
    this.renderPreviewModal(false);

    this.refreshToast();
  }

  segBg(on) { return on ? 'var(--ed-accent)' : 'transparent'; }
  segFg(on) { return on ? 'var(--ed-accent-ink)' : 'var(--ed-muted)'; }

  renderDeviceSeg() {
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
          line.append(chip, elS('span', 'font-family: var(--ed-font); font-size: 12px; font-weight: 500; color: var(--ed-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;', { text: text || typeName, class: 'mc-tree-title' }));
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
    const search = elS('input', 'width: 100%; box-sizing: border-box; background: var(--ed-panel-2); border: 1px solid var(--ed-line); border-radius: 8px; color: var(--ed-text); font: inherit; font-size: 12.5px; padding: 7px 9px; margin-bottom: 8px;', { placeholder: t('vars.filterPlaceholder'), 'data-focus-key': 'var-query' });
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
        elS('span', 'display: block; font-family: ui-monospace, monospace; font-size: 10px; color: var(--ed-accent); margin-top: 2px;', { text: TOKEN(v) }),
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
    this.assetSearch = elS('input', 'width: 210px; box-sizing: border-box; background: var(--ed-panel-2); border: 1px solid var(--ed-line); color: var(--ed-text); font: inherit; font-size: 13px; padding: 7px 9px;', { placeholder: t('library.searchPlaceholder'), 'data-i18n-placeholder': 'library.searchPlaceholder', 'data-focus-key': 'asset-query' });
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

    this.exportTextarea = elS('textarea', 'width: 100%; height: 100%; box-sizing: border-box; border: 0; background: var(--ed-work); color: var(--ed-text); font-family: ui-monospace, monospace; font-size: 11.5px; line-height: 1.55; padding: 18px 20px; resize: none;', { readonly: 'true' });
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
    const reloadBtn = elS('button', 'border: 1px solid var(--ed-line); background: transparent; color: var(--ed-text); cursor: pointer; height: 30px; padding: 0 11px; display: flex; align-items: center; gap: 6px; font-family: var(--ed-font); font-size: 11px; font-weight: 600; transition: border-color 0.16s, background 0.16s;', { type: 'button', title: t('action.reloadHint'), 'data-i18n-title': 'action.reloadHint' });
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
    head.append(headIcon, headText, this.codeWidthSeg, reloadBtn, applyBtn, closeBtn);
    overlay.appendChild(head);

    const cols = elS('div', 'display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 12px; min-height: 0; background: var(--ed-work);', { class: 'mc-code-split' });
    const left = elS('div', 'display: grid; grid-template-rows: auto 1fr; min-height: 0; border: 1px solid var(--ed-line); border-radius: 12px; overflow: hidden; background: var(--ed-panel);', { class: 'mc-code-source' });
    const leftHead = elS('div', 'padding: 7px 16px; border-bottom: 1px solid var(--ed-line); font-family: var(--ed-font); font-size: 10px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: var(--ed-muted); display: flex; justify-content: space-between;', { class: 'mc-pane-label' });
    this.codeMetaEl = elS('span');
    leftHead.append(elS('span', '', { text: t('code.source'), 'data-i18n': 'code.source' }), this.codeMetaEl);
    left.appendChild(leftHead);
    const editorWrap = elS('div', 'position: relative; min-height: 0;');
    editorWrap.appendChild(this.buildCodeEditor());
    left.appendChild(editorWrap);
    cols.appendChild(left);

    const right = elS('div', 'display: grid; grid-template-rows: auto 1fr; min-height: 0; border: 1px solid var(--ed-line); border-radius: 12px; overflow: hidden; background: var(--ed-panel);', { class: 'mc-code-preview' });
    right.appendChild(elS('div', 'padding: 7px 16px; border-bottom: 1px solid var(--ed-line); background: var(--ed-panel); font-family: var(--ed-font); font-size: 10px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: var(--ed-muted);', { text: t('code.livePreview'), 'data-i18n': 'code.livePreview', class: 'mc-pane-label' }));
    const previewWrap = elS('div', 'overflow: auto; padding: 20px; display: flex; justify-content: center; background: var(--ed-work);', { class: 'mc-code-preview-body' });
    this.codeFrame = elS('iframe', "width: 100%; height: 100%; min-height: 420px; border: 1px solid var(--ed-line-2); border-radius: 6px; background: #ffffff; box-shadow: 0 6px 18px rgba(15,23,42,0.10); transition: width 0.24s cubic-bezier(0.22,0.61,0.36,1);", { title: t('code.liveHtmlPreviewTitle'), 'data-i18n-title': 'code.liveHtmlPreviewTitle', class: 'mc-code-frame' });
    previewWrap.appendChild(this.codeFrame);
    right.appendChild(previewWrap);
    cols.appendChild(right);
    overlay.appendChild(cols);

    overlay.appendChild(elS('div', 'padding: 8px 18px; border-top: 1px solid var(--ed-line); font-family: ui-monospace, monospace; font-size: 9.5px; letter-spacing: 0.06em; color: var(--ed-faint);', { text: t('code.applyNote'), 'data-i18n': 'code.applyNote', class: 'mc-code-footer' }));
    return overlay;
  }

  /** Ported from `codeEditorEl()`: a sticky line-number gutter + a syntax-highlighted `<pre>` sitting behind a transparent-text/visible-caret `<textarea>` -- the classic fake-highlighting-textarea trick. The gutter and `<pre>` are rebuilt on every keystroke (cheap, not focusable); the textarea itself is created once here and only ever has its `.value` patched, so it never loses focus or caret position. */
  buildCodeEditor() {
    const MONO = 'font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 20px; tab-size: 2;';
    const root = elS('div', 'position: absolute; inset: 0; overflow: auto; background: var(--ed-work);');
    const inner = elS('div', 'display: flex; align-items: stretch; min-height: 100%; width: max-content; min-width: 100%;');
    this.codeGutter = elS('div', `${MONO} position: sticky; left: 0; z-index: 2; flex: none; width: 52px; padding: 14px 10px 80px; text-align: right; color: var(--ed-faint); background: var(--ed-panel-2); border-right: 1px solid var(--ed-line); user-select: none;`);
    const contentWrap = elS('div', 'position: relative; flex: 1 0 auto;');
    this.codePre = elS('pre', `${MONO} margin: 0; padding: 14px 18px 80px; white-space: pre; color: var(--ed-text); pointer-events: none; min-height: 100%;`, { 'aria-hidden': 'true' });
    this.codeTextarea = elS('textarea', `${MONO} position: absolute; top: 0; left: 0; width: 100%; height: 100%; margin: 0; padding: 14px 18px 80px; border: 0; background: transparent; color: transparent; caret-color: var(--ed-accent); white-space: pre; overflow: hidden; resize: none; outline: none;`, { spellcheck: 'false', wrap: 'off', 'data-focus-key': 'code-src' });
    this.codeTextarea.addEventListener('input', (e) => this.core.setCodeSrc(e.target.value));
    this.codeTextarea.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      const ta = e.target; const a = ta.selectionStart; const b = ta.selectionEnd;
      const next = ta.value.slice(0, a) + '  ' + ta.value.slice(b);
      this.core.setCodeSrc(next);
      ta.value = next;
      ta.selectionStart = ta.selectionEnd = a + 2;
    });
    contentWrap.append(this.codePre, this.codeTextarea);
    inner.append(this.codeGutter, contentWrap);
    root.appendChild(inner);
    return root;
  }

  renderCodeModal() {
    const s = this.core.state;
    const t = this.core.t;
    this.codeModal.style.display = s.codeOpen ? 'grid' : 'none';
    if (!s.codeOpen) return;
    this.refreshCodeSource();
    if (this._codeFrameSrc !== s.codeLive) {
      this.codeFrame.srcdoc = s.codeLive;
      this._codeFrameSrc = s.codeLive;
    }
    this.codeWidthSeg.innerHTML = '';
    [{ label: t('device.desktop'), v: 'desktop', iconName: 'monitor' }, { label: t('device.mobile'), v: 'mobile', iconName: 'phone' }].forEach((w) => {
      const on = s.codeDevice === w.v;
      const btn = elS('button', `width: 32px; height: 26px; display: flex; align-items: center; justify-content: center; background: ${this.segBg(on)}; color: ${this.segFg(on)};`, { type: 'button', title: w.label, 'aria-pressed': String(on) });
      btn.appendChild(icon(w.iconName, 15));
      btn.addEventListener('click', () => this.core.setState({ codeDevice: w.v }));
      tip(btn, w.label, 'down');
      this.codeWidthSeg.appendChild(btn);
    });
    this.codeFrame.style.width = s.codeDevice === 'mobile' ? '390px' : '100%';
  }

  /** Repaint the syntax layer, gutter and metadata without touching the
   * canvas, inspector, iframe, or focused textarea node. */
  refreshCodeSource() {
    if (!this.core.state.codeOpen || !this.codeTextarea) return;
    const s = this.core.state;
    const t = this.core.t;
    this.codeStatusEl.textContent = s.codeDirty ? t('code.statusEdited') : t('code.statusSynced');
    if (this.codeTextarea.value !== s.codeSrc) this.codeTextarea.value = s.codeSrc;
    this.codePre.innerHTML = hl(s.codeSrc) + '\n';
    const lineCount = s.codeSrc.split('\n').length;
    if (this.codeGutter.childElementCount !== lineCount) {
      this.codeGutter.innerHTML = '';
      for (let i = 1; i <= lineCount; i++) this.codeGutter.appendChild(elS('div', '', { text: String(i) }));
    }
    this.codeMetaEl.textContent = t('code.meta', { kb: (s.codeSrc.length / 1024).toFixed(1), lines: lineCount });
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
    goalWrap.appendChild(this.aiGoalSelect);

    const toneWrap = elS('div');
    toneWrap.appendChild(elS('label', 'display: block; font-size: 11.5px; color: var(--ed-muted); margin-bottom: 4px;', { text: t('ai.tone'), 'data-i18n': 'ai.tone' }));
    this.aiToneSelect = elS('select', 'width: 100%; box-sizing: border-box; background: var(--ed-panel-2); border: 1px solid var(--ed-line); color: var(--ed-text); font: inherit; font-size: 13px; padding: 8px;');
    this.aiToneSelect.addEventListener('change', (e) => this.core.setState({ aiTone: e.target.value }));
    toneWrap.appendChild(this.aiToneSelect);
    row.append(goalWrap, toneWrap);
    body.appendChild(row);

    const briefWrap = elS('div');
    briefWrap.appendChild(elS('label', 'display: block; font-size: 11.5px; color: var(--ed-muted); margin-bottom: 4px;', { text: t('ai.briefLabel'), 'data-i18n': 'ai.briefLabel' }));
    this.aiBriefInput = elS('textarea', 'width: 100%; min-height: 78px; box-sizing: border-box; background: var(--ed-panel-2); border: 1px solid var(--ed-line); color: var(--ed-text); font: inherit; font-size: 13px; padding: 9px; resize: vertical;', { placeholder: t('ai.briefPlaceholder'), 'data-i18n-placeholder': 'ai.briefPlaceholder', 'data-focus-key': 'ai-brief' });
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
    const goals = ['Full email draft', 'Headline options', 'Shorten existing copy', 'Product announcement', 'Re-engagement nudge'];
    const tones = ['Confident, plain', 'Warm and personal', 'Technical and precise', 'Playful', 'Formal'];
    if (this.aiGoalSelect.childElementCount !== goals.length) {
      this.aiGoalSelect.innerHTML = '';
      goals.forEach((g) => { const o = document.createElement('option'); o.value = g; o.textContent = g; this.aiGoalSelect.appendChild(o); });
    }
    this.aiGoalSelect.value = s.aiGoal;
    if (this.aiToneSelect.childElementCount !== tones.length) {
      this.aiToneSelect.innerHTML = '';
      tones.forEach((tone) => { const o = document.createElement('option'); o.value = tone; o.textContent = tone; this.aiToneSelect.appendChild(o); });
    }
    this.aiToneSelect.value = s.aiTone;
    if (this.aiBriefInput.value !== s.aiBrief) this.aiBriefInput.value = s.aiBrief;
    this.aiRunBtn.disabled = s.aiBusy;
    this.aiRunBtn.labelNode.textContent = s.aiBusy ? t('ai.writing') : t('ai.generate');

    this.aiResultsEl.innerHTML = '';
    s.aiResults.forEach((r) => {
      const card = elS('div', 'position: relative; border: 1px solid var(--ed-line); border-radius: var(--ed-radius-sm); padding: 15px;');
      card.appendChild(elS('div', 'font-family: var(--ed-font); font-size: 10px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: var(--ed-accent); margin-bottom: 7px;', { text: r.kind }));
      card.appendChild(elS('div', 'font-size: 14px; line-height: 1.55; white-space: pre-wrap;', { text: r.text }));
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
    overlay.style.cssText = 'position: absolute; inset: 0; z-index: 60; display: grid; grid-template-rows: 58px minmax(0, 1fr); animation: mcFade 0.16s ease; display: none;';
    const head = elS('div', 'display: flex; align-items: center; gap: 12px; padding: 0 20px; border-bottom: 1px solid var(--ed-line); background: var(--ed-panel);', { class: 'mc-preview-toolbar' });
    const headText = elS('div', 'flex: 1; min-width: 0;');
    this.previewKickerEl = elS('div', 'font-family: var(--ed-font); font-size: 10px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: var(--ed-muted);', { class: 'mc-preview-kicker' });
    this.previewCampaignEl = elS('div', 'font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;', { class: 'mc-preview-title' });
    headText.append(this.previewKickerEl, this.previewCampaignEl);
    this.previewDeviceSeg = elS('div', '', { class: 'mc-segment' });
    const closeBtn = elS('button', 'border: 1px solid var(--ed-line); background: transparent; color: var(--ed-text); cursor: pointer; height: 30px; padding: 0 13px; display: flex; align-items: center; gap: 6px; font-family: var(--ed-font); font-size: 11px; font-weight: 600; transition: border-color 0.16s, background 0.16s;', { type: 'button' });
    closeBtn.appendChild(icon('x', 14));
    closeBtn.appendChild(elS('span', '', { text: t('action.close'), 'data-i18n': 'action.close' }));
    closeBtn.addEventListener('mouseenter', () => { closeBtn.style.borderColor = 'var(--ed-accent)'; closeBtn.style.background = 'var(--ed-soft)'; });
    closeBtn.addEventListener('mouseleave', () => { closeBtn.style.borderColor = 'var(--ed-line)'; closeBtn.style.background = 'transparent'; });
    closeBtn.addEventListener('click', () => this.core.setState({ previewOpen: false }));
    head.append(headText, this.previewDeviceSeg, closeBtn);
    overlay.appendChild(head);
    const body = elS('div', 'overflow-y: auto; padding: 32px 24px;', { class: 'mc-preview-body' });
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
    if (!s.previewOpen) return;
    this.previewKickerEl.textContent = s.device === 'mobile' ? t('preview.kickerMobile') : t('preview.kickerDesktop', { width: s.doc.theme.width });
    this.previewCampaignEl.textContent = s.campaign;
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
    this.previewSlot.innerHTML = '';
    this.previewSlot.appendChild(renderDoc(this.core, false));
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
