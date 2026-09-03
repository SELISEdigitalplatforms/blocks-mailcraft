import { uid } from './ids.js';
import { mk, blk, mkRow, GROUPS, LAYOUTS, migrateDoc, normalizeDoc, blankDoc } from './blocks.js';
import { binder, decorate, group } from './binder.js';
import { ALL_FOLDER_ID, normalizeAsset, resolveLimits, providerProblems } from './storage.js';
import { validateFiles, limitsProblem } from './storage-limits.js';
import { migrateTokens, cleanHtml, escHtml, linkHref, scaleInlineSizes, stripInlineStyle } from './sanitize.js';
import { buildHtml as buildHtmlFn } from './export.js';
import { htmlToDoc } from './import-html.js';
import { boxCss } from './layout-style.js';
import { vars as varsFn, TOKEN, INSERT_KEYS } from './variables.js';
import { createTranslator } from './i18n/index.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const STORAGE_KEY = 'mailcraft.v3';
const TAB_KEY_PREFIX = STORAGE_KEY + '.tab.';
const TAB_ID_KEY = 'mailcraft.tab';
/** How long another tab's draft slot survives without a save before `sweepDrafts` reclaims it. */
const DRAFT_TTL = 7 * 24 * 60 * 60 * 1000;
/**
 * How many uploads run at once. Not unbounded: a presign plus a PUT per file,
 * fanned out across a twenty-file drop, is the kind of burst a gateway
 * rate-limits. Not one at a time either -- that made a large drop as slow as
 * the sum of its round trips.
 */
const UPLOAD_CONCURRENCY = 3;
/**
 * Older builds seeded the library with six invented files (a logo, product
 * shots, textures) drawn as hatched placeholder SVGs, and autosaved them into
 * the draft alongside the document. Dropping the seed from the package is not
 * enough on its own: every browser that ever opened one of those builds still
 * has the tiles in localStorage and would keep showing them. This matches the
 * exact placeholder signature -- an inline `<pattern id="s">`, which nothing
 * a user uploads can be -- so a restored draft loses them once and keeps
 * everything else.
 */
const RETIRED_SEED = /^data:image\/svg\+xml;utf8,.*%3Cpattern%20id%3D%22s%22/;
const withoutRetiredSeeds = (assets) => (Array.isArray(assets) ? assets.filter((a) => !RETIRED_SEED.test(String((a && a.url) || ''))) : []);
/**
 * The one span Text size moves in, per block type -- shared by the inspector
 * range and the RTE's ± buttons. They used to disagree: the panel allowed
 * 8–96 (text) and 12–120 (heading) while `size()` clamped to a private
 * 10–64, so a single "Larger text" click on a 96px block *shrank* it to 64.
 */
const SIZE_SPAN = { text: [8, 96], heading: [12, 120] };
/** The blocks whose content is rich HTML in props, and the prop it lives in. Only these need the descendant rewrites below. */
const RICH_HTML_PROP = { text: 'html', list: 'items' };
/** Inspector key -> the inline CSS property whose descendant copies mask it (see `stripInlineStyle`). */
const RICH_OWNED_STYLE = { color: 'color', lh: 'line-height', weight: 'font-weight', align: 'text-align' };

/**
 * Keeps a rich block's descendants in agreement with the block-level control
 * being moved. Imported HTML deliberately keeps per-element inline typography
 * (sanitize.js `cleanImportHtml`), and a descendant's own declaration beats
 * inheritance from the wrapper -- so without this, Text size / color / Line
 * spacing / weight / Align silently did nothing on any imported (or
 * AI-drafted) block. Size *scales* descendants so a 15/26/15px hierarchy
 * survives as 45/78/45 instead of flattening; the others strip the descendant
 * property, exactly the semantics the Font control already shipped with.
 * Runs inside the same `commit` as the prop write: one undo step, and a
 * document nobody touches is never rewritten.
 */
function syncRichContent(block, key, val) {
  const prop = RICH_HTML_PROP[block.type];
  if (!prop) return false;
  // list items are one fragment per line; the rewrite must not run across the joins.
  const perLine = (src, fn) => (prop === 'items' ? String(src).split('\n').map(fn).join('\n') : fn(String(src)));
  const src = block.props[prop];
  if (src == null || src === '') return false;
  let out = src;
  if (key === 'size') {
    const cur = Number(block.props.size);
    const next = Number(val);
    // An unknown base (imports that carried no readable size) can't be scaled
    // against -- the first explicit size just establishes the base.
    if (cur > 0 && next > 0 && next !== cur) out = perLine(src, (s) => scaleInlineSizes(s, next / cur));
  } else if (RICH_OWNED_STYLE[key]) {
    out = perLine(src, (s) => stripInlineStyle(s, RICH_OWNED_STYLE[key]));
  }
  if (out === src) return false;
  block.props[prop] = out;
  return true;
}

const BORDER_STYLES = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
  { value: 'double', label: 'Double' },
];

/** Character offset of (node, offset) counting only text within `root` -- mirrors `textOffset` in render/focus-preserve.js (kept local: core/ doesn't otherwise depend on render/). */
function charOffset(root, node, offset) {
  if (node.nodeType !== Node.TEXT_NODE) {
    let n = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let cur; const target = node.childNodes[offset];
    if (!target) { while (walker.nextNode()) n += walker.currentNode.nodeValue.length; return n; }
    while ((cur = walker.nextNode())) { if (cur === target || target.contains(cur)) return n; n += cur.nodeValue.length; }
    return n;
  }
  let n = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let cur;
  while ((cur = walker.nextNode())) {
    if (cur === node) return n + offset;
    n += cur.nodeValue.length;
  }
  return n;
}

/**
 * Ported from the original prototype's `class Component extends DCLogic` --
 * same state shape, same method names and logic, with `this.setState(patch, cb)`
 * replaced by direct mutation + `emit()` (there is no React underneath this
 * package). Rendering lives entirely in render/ -- this class only ever
 * touches `this.state`, never the DOM.
 */
/**
 * HTML -> { rows, theme } with a never-drop-content fallback: anything the
 * importer cannot classify into rows survives as a single raw-html row rather
 * than vanishing. Shared by `importHtml` (Code modal / host API) and
 * html-sourced templates so both paths degrade identically.
 */
function parseHtmlSource(src) {
  const parsed = htmlToDoc(src);
  let rows = parsed.rows;
  if (!rows.length) {
    const row = mkRow([100], [mk('html')]);
    row.props.py = 0; row.props.px = 0;
    let body = src;
    try { body = new DOMParser().parseFromString(String(src || ''), 'text/html').body.innerHTML || src; } catch { /* keep raw src */ }
    row.cols[0].blocks[0].props.code = String(body || '').trim();
    rows = [row];
  }
  return { rows, theme: parsed.theme || {} };
}

/** Full document from an HTML string: imported rows plus whatever theme keys the source declared, over blank-doc defaults for the rest. */
function docFromHtml(src) {
  const doc = blankDoc();
  const { rows, theme } = parseHtmlSource(src);
  doc.rows = rows;
  Object.assign(doc.theme, theme);
  return doc;
}

/**
 * AI draft goals and tones.
 *
 * These are prompt text, not UI chrome: `runAi` splices the selected strings
 * straight into the sentence it sends the provider, so they stay English here
 * and are deliberately NOT routed through `t()` -- a translated goal would
 * change what the model is asked for, not just what the operator reads. The
 * goal list tracks the email jobs the shipped example templates already cover
 * (welcome, receipt, cart, restock, referral, review, newsletter, ...) so the
 * dropdown offers work an operator recognises rather than five generic verbs.
 *
 * Goals carry a `group` for the `<optgroup>` label; the first entry is the
 * default in `state.aiGoal`.
 */
export const AI_GOALS = [
  { group: 'Draft a new email', items: [
    'Full email draft',
    'Welcome or onboarding',
    'Product announcement',
    'Promotion or sale',
    'Event or webinar invite',
    'Newsletter intro',
    'Abandoned cart reminder',
    'Back in stock alert',
    'Re-engagement nudge',
    'Referral or reward invite',
    'Feedback or review request',
    'Thank you or post-purchase',
    'Transactional notice',
  ] },
  { group: 'Rework existing copy', items: [
    'Headline options',
    'Shorten existing copy',
    'Rewrite for clarity',
  ] },
];

/** Flat list -- tone has no natural grouping, and twelve entries still scan in one pass. */
export const AI_TONES = [
  'Confident, plain',
  'Warm and personal',
  'Friendly and casual',
  'Direct and minimal',
  'Playful',
  'Enthusiastic and bold',
  'Urgent and time-sensitive',
  'Premium and understated',
  'Reassuring and calm',
  'Apologetic and accountable',
  'Formal',
  'Technical and precise',
];

/** Every goal string, flattened -- the order the `<select>` presents them in. */
export const AI_GOAL_VALUES = AI_GOALS.flatMap((g) => g.items);

export class EditorCore {
  constructor({ variables, aiProvider, iconProvider, messages, storageProvider, storageLimits } = {}) {
    this.variablesRaw = variables ?? null;
    this.aiProvider = aiProvider ?? null;
    this.iconProvider = iconProvider ?? null;
    this.storageProvider = storageProvider ?? null;
    this.storageLimits = storageLimits ?? null;
    this.messages = messages ?? null;
    this.t = createTranslator(this.messages);
    this.listeners = new Set();
    this.drag = null;
    this.editEl = null;
    this.savedRange = null;
    this.rteActive = false;
    this.fileEl = null;
    // `mount()` restores the persisted draft, but `connectedCallback` runs it
    // *after* the host may already have pushed a document in -- the
    // `createElement()` -> `loadTemplate()` -> `append()` pattern the element's
    // constructor comment advertises. Without these two flags that restore
    // silently threw the host's template away and showed the previous draft
    // instead, and re-connecting the element (a framework remount, or a move in
    // the DOM) did the same to a document already on screen.
    this.docSetByHost = false;
    this.mounted = false;

    this.state = {
      doc: blankDoc(),
      // Empty, not a sample name: this ends up in the exported <title> and the
      // download filename, so a placeholder here ships in a host's real email.
      sel: null, hover: null, tab: 'design', chrome: 'light', device: 'desktop', mode: 'rows', zoom: 1, advancedOpen: false,
      assets: [], assetFolder: ALL_FOLDER_ID, assetQuery: '', libraryOpen: false, assetTarget: null,
      folders: null, assetCursor: null, assetsLoading: false, assetsError: null, assetsLoaded: false, uploading: 0,
      exportOpen: false, exportCode: '', copied: false, aiOpen: false, aiGoal: AI_GOAL_VALUES[0], aiTone: AI_TONES[0],
      aiBrief: '', aiBusy: false, aiResults: [], previewOpen: false, toast: null, drop: null, rowDrop: null,
      editing: null, linkDraft: null, codeOpen: false, codeSrc: '', codeLive: '', codeDirty: false, codeDevice: 'desktop',
      history: [], future: [], now: Date.now(), savedStatus: 'idle', savedAt: null, libHot: false,
    };
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  /**
   * `window.getSelection()`/`document.getSelection()` reports `anchorNode`
   * as `<body>` (not the real, deep node) once the actual selection lives
   * inside an open shadow root -- which it always does here, since the
   * editor is a shadow-DOM web component. `ShadowRoot.getSelection()`
   * (Chromium-only; no standard equivalent yet) reports the real node/offset
   * and is what every selection-reading method below needs, or they silently
   * read garbage instead of erroring. `this.exportRoot` is the element's
   * shadow root (set by `mount()`); the `window.getSelection()` fallback
   * only matters for a browser without `ShadowRoot.getSelection`.
   */
  getSelection() {
    return this.exportRoot && typeof this.exportRoot.getSelection === 'function' ? this.exportRoot.getSelection() : window.getSelection();
  }

  /**
   * Batched like React's `setState`, via a microtask instead of a reconciler:
   * `render()` tears down and rebuilds the whole canvas (no diffing), which
   * removes whatever DOM node currently has focus. A *synchronous* render
   * mid-gesture -- e.g. from `onBlur`'s own `setState` while the browser is
   * still in the middle of moving focus from one block to another on a
   * single click -- yanks out the node the browser is about to focus next,
   * so that native focus-transition silently fails: the click's `blur`
   * fires, but its `focus` on the new block never does. Deferring the
   * render to a microtask lets a whole synchronous gesture (blur -> focus,
   * or several `setState` calls in a row) finish first -- exactly what
   * React's batching gives you for free -- and coalesces it into one render
   * reflecting the final state, instead of one destructive render per call.
   */
  emit() {
    if (this._emitScheduled) return;
    this._emitScheduled = true;
    const schedule = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (fn) => setTimeout(fn, 16);
    this._emitHandle = schedule(() => {
      this._emitScheduled = false;
      this._emitHandle = null;
      for (const fn of this.listeners) fn();
    });
  }

  /** `this.setState(patch, cb)` from the original, minus React. */
  setState(patch, cb) {
    Object.assign(this.state, typeof patch === 'function' ? patch(this.state) : patch);
    this.emit();
    if (cb) cb();
  }

  // ---- lifecycle ---------------------------------------------------------

  /** `componentDidMount`. `exportRoot` is the DOM root `buildHtml()`'s DOM-read-back (`grab`) searches -- the element's shadow root. */
  mount(exportRoot) {
    this.exportRoot = exportRoot;
    // Per-tab persistence: every tab autosaving to one shared key made
    // concurrent tabs clobber (and, briefly, mirror) each other -- loading a
    // template in one tab replaced the document in all of them. Each tab
    // instead owns a private draft slot named by an id kept in sessionStorage
    // (survives a reload of *this* tab, never shared with other tabs), so
    // every tab is an independent document. The shared STORAGE_KEY lives on
    // as the "most recent work" seed: still written by every persist, and a
    // brand-new tab (no draft of its own yet) starts from it -- the same
    // reopen-where-I-left-off behavior as before.
    try {
      let tabId = sessionStorage.getItem(TAB_ID_KEY);
      if (!tabId) { tabId = uid(); sessionStorage.setItem(TAB_ID_KEY, tabId); }
      this.tabKey = TAB_KEY_PREFIX + tabId;
    } catch { this.tabKey = null; }
    const firstMount = !this.mounted;
    this.mounted = true;
    // First mount only, and never over a document the host already supplied.
    try {
      const raw = firstMount && !this.docSetByHost
        && ((this.tabKey && localStorage.getItem(this.tabKey)) || localStorage.getItem(STORAGE_KEY));
      if (raw) {
        const s = JSON.parse(migrateTokens(raw));
        // A draft blob is as untrusted as any other input -- it may have been
        // written by an older build, or edited by hand in devtools.
        if (s && s.doc) s.doc = normalizeDoc(s.doc);
        // `device` was never actually written by `persist()` below, but a
        // stale/foreign blob could still carry the retired 'dark' inbox-preview
        // value -- normalize anything that isn't 'mobile' to 'desktop' rather
        // than trust it verbatim.
        if (s && s.doc) this.setState({ doc: s.doc, assets: withoutRetiredSeeds(s.assets), chrome: s.chrome || 'light', device: s.device === 'mobile' ? 'mobile' : 'desktop' });
      }
    } catch { /* ignore */ }
    this.sweepDrafts();
    this.tick = setInterval(() => {
      if (!this.hasCountdown()) return;
      // Surgical: with a countdown block in the document this ticked a full
      // re-render every second -- open dropdowns died within a second and the
      // editor never idled. The element repaints just the countdown digits.
      this.state.now = Date.now();
      if (this.onTick) this.onTick(); else this.setState({ now: this.state.now });
    }, 1000);
  }

  /**
   * Reclaims other tabs' draft slots that haven't been saved to in DRAFT_TTL.
   * Without this, every browser tab ever opened would leave a full document
   * blob in localStorage forever and eventually hit the origin quota. This
   * tab's own slot and the shared STORAGE_KEY seed are never touched, and an
   * unreadable blob counts as stale.
   */
  sweepDrafts() {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(TAB_KEY_PREFIX) || k === this.tabKey) continue;
        let stale = true;
        try {
          const b = JSON.parse(localStorage.getItem(k));
          stale = !b || !b.t || Date.now() - b.t > DRAFT_TTL;
        } catch { /* unreadable -> stale */ }
        if (stale) localStorage.removeItem(k);
      }
    } catch { /* ignore */ }
  }

  /** Wires the window-level keydown shortcuts and the selectionchange listener the RTE toolbar needs to preserve the selection across a toolbar click. `isTyping(target)` and `shadowActiveElement()` are supplied by the element since only it knows its shadow root. */
  mountKeyboard(isTyping) {
    this.onKey = (e) => {
      // Shadow DOM retargets events for listeners outside the root: on this
      // window-level listener, `e.target` is always the <mailcraft-editor>
      // host, never the inner input -- which made `isTyping` always false, so
      // Backspace while editing an inspector field deleted the selected
      // block. `composedPath()[0]` is the true, pre-retargeting target.
      const target = e.composedPath ? e.composedPath()[0] : e.target;
      const typing = isTyping(target);
      if (e.key === 'Escape') {
        // Escape inside a field means "leave the field", not "drop the
        // selection and close every modal" -- blur it; a second Escape then
        // does the usual deselect/close.
        if (typing && target && typeof target.blur === 'function') { target.blur(); return; }
        this.setState({ sel: null, libraryOpen: false, exportOpen: false, aiOpen: false, codeOpen: false, previewOpen: false });
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        // Inside a real form field the browser's own field undo is what the
        // user means; hijacking it for document undo while mid-edit was part
        // of the "inputs behave weird" report. Contenteditable blocks keep
        // document undo -- their edits only commit on blur.
        if (typing && !(target && target.isContentEditable)) return;
        e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') { e.preventDefault(); this.openExport(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && this.state.editing) { e.preventDefault(); this.openLink(); return; }
      if (typing) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); this.dupSel(); return; }
      if ((e.key === 'Backspace' || e.key === 'Delete') && this.state.sel) { e.preventDefault(); this.delSel(); }
    };
    window.addEventListener('keydown', this.onKey);
    /**
     * Restoring the caret after a render (focus-preserve.js) sets a Range,
     * which fires `selectionchange` exactly like a real user selection would
     * -- so without checking whether the caret *actually* moved, this handler
     * would request another toolbar refresh in reaction to its own restoration,
     * restore (and fire `selectionchange`) again, forever. Comparing the
     * resolved character offsets (stable across a rebuild, unlike DOM node
     * identity) instead of reacting to every notification is what makes this
     * immune to that -- and to needing to know or guess the exact timing of
     * how many `selectionchange` events a browser coalesces per mutation.
     */
    this._lastSelBlock = null; this._lastSelStart = null; this._lastSelEnd = null;
    this.onSelect = () => {
      if (!this.state.editing) return;
      const sel = this.getSelection();
      if (!(sel && sel.rangeCount && this.editEl && this.editEl.contains(sel.anchorNode))) return;
      const range = sel.getRangeAt(0);
      const start = charOffset(this.editEl, range.startContainer, range.startOffset);
      const end = charOffset(this.editEl, range.endContainer, range.endOffset);
      if (this._lastSelBlock === this.state.editing && this._lastSelStart === start && this._lastSelEnd === end) return;
      this._lastSelBlock = this.state.editing; this._lastSelStart = start; this._lastSelEnd = end;
      this.savedRange = range.cloneRange();
      // Formatting-state changes only affect the small floating RTE toolbar.
      // Rebuilding the entire editor here made every caret movement tear down
      // the canvas, inspector and modal DOM, which was the largest source of
      // typing/selection jitter. The element supplies a surgical toolbar
      // refresh callback instead.
      if (this.onFormatChange) this.onFormatChange();
    };
    document.addEventListener('selectionchange', this.onSelect);
    /**
     * Click-outside fallback for closing the RTE toolbar. The blur path
     * (`blockCtx.onBlur`, canvas.js) only runs if the edited block still holds
     * focus at the moment of the outside press -- but several toolbar controls
     * legitimately move focus to themselves (the Text style / Merge Tags
     * selects, the color inputs, the link popover's href field). Dismiss one
     * of those without committing and no block blur can ever fire again, so
     * `state.editing` -- and the toolbar -- stayed open no matter where the
     * user clicked. A completed click whose composed path contains neither the
     * edited block nor the toolbar closes the edit explicitly.
     *
     * `click`, deliberately not `pointerdown`: by click time the press's
     * native blur/focus transition has fully settled, so this never rebuilds
     * the canvas mid-gesture (the dropped-click problem documented in
     * `blockCtx.onFocus`, canvas.js) and never races focus-preserve into
     * refocusing -- and thereby reopening -- the block it just closed. It also
     * ignores scrollbar drags, which emit no click.
     */
    this.onOutsideClick = (e) => {
      if (!this.state.editing || this.rendering) return;
      // A drag-selection that starts inside the block but ends outside it
      // fires its click on a common ancestor -- but the block keeps focus
      // through such a drag, while a genuine outside press blurs it first
      // (and the blur pipeline has then already handled the close).
      const active = this.exportRoot && this.exportRoot.activeElement;
      if (active && active === this.editEl) return;
      const path = e.composedPath ? e.composedPath() : [];
      for (const n of path) {
        if (!n || n.nodeType !== 1) continue;
        if (n.getAttribute && n.getAttribute('data-mc-content') === this.state.editing) return;
        if (n.hasAttribute && n.hasAttribute('data-rte-root')) return;
      }
      this.closeEditing();
    };
    if (this.exportRoot) this.exportRoot.addEventListener('click', this.onOutsideClick);
  }

  unmountKeyboard() {
    window.removeEventListener('keydown', this.onKey);
    document.removeEventListener('selectionchange', this.onSelect);
    if (this.exportRoot && this.onOutsideClick) this.exportRoot.removeEventListener('click', this.onOutsideClick);
    this.onOutsideClick = null;
  }

  unmount() {
    clearTimeout(this._searchTimer);
    clearTimeout(this._limitsWarnTimer);
    this.abortAssets('list');
    this.abortAssets('upload');
    clearInterval(this.tick);
    clearTimeout(this.tt);
    clearTimeout(this.codeTimer);
    clearTimeout(this._persistTimer);
    if (this._emitHandle != null) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this._emitHandle);
      else clearTimeout(this._emitHandle);
    }
    this._emitHandle = null;
    this._emitScheduled = false;
    this.unmountKeyboard();
  }

  // ---- rich text editing ----------------------------------------------

  /**
   * Explicitly ends the active rich-text edit: commits the live content the
   * way `blockCtx.onBlur` (canvas.js) would, then clears `editing`/`linkDraft`.
   * Used by the click-outside fallback (`mountKeyboard`), which fires exactly
   * when the block no longer holds focus, so no blur will ever arrive to do
   * this. Any blur this close itself provokes is deliberately swallowed via
   * `rteActive`: the commit below is the single commit path -- letting onBlur
   * also run would compare against the same `editOriginal` and push a second
   * undo entry for the same change.
   */
  closeEditing() {
    const id = this.state.editing;
    if (!id) return;
    const elNode = this.editEl;
    const val = elNode && elNode.isConnected && this.editKey
      ? (this.editPlain ? elNode.textContent : elNode.innerHTML)
      : null;
    this.rteActive = true;
    if (elNode && this.exportRoot && this.exportRoot.activeElement === elNode) elNode.blur();
    this.rteActive = false;
    if (val !== null && val !== this.editOriginal) this.setProp(id, this.editKey, val);
    if (this.state.editing === id) this.setState({ editing: null, linkDraft: null });
  }

  exec(cmd, arg) {
    this.rteActive = true;
    try {
      if (this.editEl) {
        // `preventScroll`: `editEl` is already the block being actively
        // edited (on-screen, wherever the user has scrolled to) -- this just
        // restores focus after a toolbar-button click stole it, not a fresh
        // navigation, so it shouldn't yank a long template's scroll position.
        this.editEl.focus({ preventScroll: true });
        const sel = this.getSelection();
        // Only fall back to the cached `savedRange` when the live selection
        // isn't currently inside the block being edited (e.g. it was lost
        // while a dropdown or the link popover had focus) -- toolbar buttons
        // preventDefault their mousedown specifically so the real selection
        // survives the click, and unconditionally overwriting it here with
        // `savedRange` fought that: a render tearing down and rebuilding the
        // edited block's DOM (no diffing -- see `dropLine`, render/canvas.js)
        // collapses the live selection as a side effect and can still leave
        // `savedRange` reflecting that instead of the real, current one.
        const liveSelectionValid = sel && sel.rangeCount && this.editEl.contains(sel.anchorNode) && this.editEl.contains(sel.focusNode);
        if (!liveSelectionValid && this.savedRange && sel) { sel.removeAllRanges(); sel.addRange(this.savedRange); }
      }
      document.execCommand(cmd, false, arg);
      const sel2 = this.getSelection();
      if (sel2 && sel2.rangeCount && this.editEl && this.editEl.contains(sel2.anchorNode)) this.savedRange = sel2.getRangeAt(0).cloneRange();
    } catch { /* ignore */ }
    setTimeout(() => { this.rteActive = false; }, 0);
  }

  pasteClean(plainOnly) {
    return (e) => {
      const dt = e.clipboardData; if (!dt) return;
      e.preventDefault();
      const html = dt.getData('text/html');
      const text = dt.getData('text/plain') || '';
      const out = (!plainOnly && html) ? cleanHtml(html) : escHtml(text).replace(/\r?\n/g, '<br />');
      this.exec('insertHTML', out);
    };
  }

  syncEdit(b) {
    const elNode = this.editEl; if (!elNode) return;
    const key = b.type === 'heading' ? 'text' : (b.type === 'html' ? 'code' : 'html');
    const val = b.type === 'heading' ? elNode.textContent : elNode.innerHTML;
    if (b.props[key] !== val) this.setProp(b.id, key, val);
  }

  anchorAt() {
    const sel = this.getSelection();
    const node = sel && sel.anchorNode ? (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement) : null;
    return node && node.closest ? node.closest('a') : null;
  }

  currentTag() {
    const sel = this.getSelection();
    const node = sel && sel.anchorNode ? (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement) : null;
    const elNode = node && node.closest ? node.closest('h1,h2,h3,h4,h5,h6,blockquote,p') : null;
    return elNode ? elNode.tagName.toLowerCase() : '';
  }

  /**
   * Everything the RTE toolbar displays about the current selection, as one
   * comparable string. `selectionchange` fires for every pixel of a drag
   * selection; rebuilding the ~25-control toolbar each time made selecting
   * text visibly stutter. Comparing this fingerprint lets the refresh skip
   * every tick where nothing the toolbar shows has actually changed --
   * dragging through uniformly-formatted text rebuilds nothing at all.
   */
  formatFingerprint(b) {
    let s = b.id + '|' + this.currentTag() + '|' + this.selSize(b) + '|' + (this.state.linkDraft ? 1 : 0) + '|';
    for (const cmd of ['bold', 'italic', 'underline', 'strikeThrough', 'superscript', 'subscript', 'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull', 'insertUnorderedList', 'insertOrderedList']) {
      let on = false;
      try { on = document.queryCommandState(cmd); } catch { /* ignore */ }
      s += on ? '1' : '0';
    }
    return s;
  }

  openLink = () => {
    const a = this.anchorAt();
    this.rteActive = true;
    this.setState({ linkDraft: { href: a ? (a.getAttribute('href') || '') : 'https://', blank: a ? a.target === '_blank' : true, editing: !!a } });
  };

  applyLink = (b) => {
    const d = this.state.linkDraft; if (!d) return;
    // Normalized here rather than at render: inline links live inside the
    // block's own HTML, which nothing re-templates, so a bare `selise.ch`
    // typed in this dialog would be stored -- and shipped -- as a relative
    // URL that resolves against the mail client instead of the site.
    const href = linkHref(d.href);
    this.exec('createLink', href);
    const elNode = this.editEl;
    if (elNode) {
      elNode.querySelectorAll('a').forEach((a) => {
        if (a.getAttribute('href') !== href) return;
        if (d.blank) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); }
        else { a.removeAttribute('target'); a.removeAttribute('rel'); }
      });
    }
    this.syncEdit(b);
    this.setState({ linkDraft: null });
  };

  removeLink = (b) => {
    this.exec('unlink');
    this.syncEdit(b);
    this.setState({ linkDraft: null });
  };

  size(b, delta) {
    // A non-collapsed selection inside a rich text block means the user is
    // sizing a *run*, not the block -- every neighbouring control (bold,
    // color, highlight) is selection-scoped, so a ± that rewrote the whole
    // block's prop here read as broken. Only `text` can keep the resulting
    // spans: a heading folds back through `textContent` (syncEdit), which
    // would silently drop them, so it stays block-level.
    if (b.type === 'text' && this.sizeSelection(b, delta)) return;
    // Uncommitted inline formatting is folded into props by `setProp` below
    // (`onFoldLiveEdit`), not here. This used to do its own fold, as a second
    // commit: that read `editEl.innerHTML` unconditionally, so a second click
    // landing in the same frame as the first -- before the rebuild had put the
    // rescaled html into the DOM -- wrote the pre-scale markup straight back
    // over it, and two quick clicks on a mixed-size block moved nothing. It
    // also cost an extra undo step per click.
    // Read the size off the live document, not off the `b` the toolbar closed
    // over when it was built: two clicks landing before the next rebuild both
    // saw the same stale base, so the second one re-applied the first one's
    // value and the pair counted as a single step.
    const live = this.find(this.state.doc, b.id).block || b;
    const cur = Number(live.props.size) || 16;
    const [lo, hi] = SIZE_SPAN[b.type] || [10, 64];
    this.setProp(b.id, 'size', Math.max(lo, Math.min(hi, cur + delta)));
  }

  /** Nearest inline px font-size walking up from `node` to the edited block's wrapper -- null when no run declares one (the block prop then owns the size). */
  inlineSizeAt(node) {
    let n = node && node.nodeType === 1 ? node : (node ? node.parentElement : null);
    while (n && n !== this.editEl) {
      const m = /^([\d.]+)px$/.exec((n.style && n.style.fontSize) || '');
      if (m) return parseFloat(m[1]);
      n = n.parentElement;
    }
    return null;
  }

  /** What the ± readout should show: the inline size at the selection when the caret sits inside a sized run, else the block's own size. Also part of `formatFingerprint`, so moving the caret across differently-sized runs refreshes the toolbar. */
  selSize(b) {
    const live = this.find(this.state.doc, b.id).block || b;
    const base = Number(live.props.size) || 16;
    if (b.type !== 'text' || this.state.editing !== b.id || !this.editEl) return base;
    const sel = this.getSelection();
    const node = sel && sel.rangeCount && this.editEl.contains(sel.anchorNode)
      ? sel.anchorNode
      : (this.savedRange && this.editEl.contains(this.savedRange.startContainer) ? this.savedRange.startContainer : null);
    const inline = node ? this.inlineSizeAt(node) : null;
    return inline == null ? base : Math.round(inline);
  }

  /**
   * Sizes just the selected run(s) of text by wrapping each selected text node
   * in a `font-size` span (or restepping the span a previous click made --
   * repeated ± must not nest one span per click). Wrapping happens at the text
   * node, the innermost level, so the new size always outranks any inline size
   * an imported ancestor carries. The change lives in the contenteditable like
   * bold/italic do and folds into props through the same blur/commit path.
   *
   * Returns false when the click is not selection-scoped -- no live edit, a
   * bare caret, or a selection covering the whole block. The last keeps
   * select-all + ± behaving as the block-level master scale it always was
   * (`syncRichContent` then *scales* mixed sizes instead of flattening them,
   * and the saved `size` prop stays truthful).
   */
  sizeSelection(b, delta) {
    const root = this.editEl;
    if (!root || !root.isConnected || this.state.editing !== b.id) return false;
    const sel = this.getSelection();
    // Same fallback discipline as `exec`: the live selection wins when it is
    // inside the edited block; `savedRange` covers focus stolen by a control.
    let src = sel && sel.rangeCount && root.contains(sel.anchorNode) && root.contains(sel.focusNode) ? sel.getRangeAt(0) : null;
    if (!src && this.savedRange && root.contains(this.savedRange.startContainer) && root.contains(this.savedRange.endContainer)) src = this.savedRange;
    if (!src || src.collapsed) return false;
    const range = src.cloneRange();
    const total = root.textContent.length;
    if (charOffset(root, range.startContainer, range.startOffset) === 0
      && charOffset(root, range.endContainer, range.endOffset) === total) return false;

    const [lo, hi] = SIZE_SPAN.text;
    const live = this.find(this.state.doc, b.id).block || b;
    const cur = this.inlineSizeAt(range.startContainer) || Number(live.props.size) || 16;
    const next = Math.max(lo, Math.min(hi, Math.round(cur) + delta));

    // Split the boundary text nodes so every text node intersecting the range
    // is *fully* inside it; order matters when both ends share one node.
    const endC = range.endContainer;
    if (endC.nodeType === 3 && range.endOffset < endC.nodeValue.length) endC.splitText(range.endOffset);
    const startC = range.startContainer;
    if (startC.nodeType === 3 && range.startOffset > 0) {
      const tail = startC.splitText(range.startOffset);
      range.setStart(tail, 0);
      if (endC === startC) range.setEnd(tail, tail.nodeValue.length);
    }
    const s = charOffset(root, range.startContainer, range.startOffset);
    const e = charOffset(root, range.endContainer, range.endOffset);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const hits = [];
    let pos = 0; let tn;
    while ((tn = walker.nextNode())) {
      const len = tn.nodeValue.length;
      if (len && pos >= s && pos + len <= e) hits.push(tn);
      pos += len;
      if (pos >= e) break;
    }
    // Something non-text was selected (an image, say): still handled -- the
    // click must not fall through and resize the whole block.
    if (!hits.length) return true;
    const wraps = hits.map((node) => {
      const parent = node.parentElement;
      if (parent && parent !== root && parent.tagName === 'SPAN' && parent.childNodes.length === 1) {
        parent.style.fontSize = next + 'px';
        return parent;
      }
      const span = document.createElement('span');
      span.style.fontSize = next + 'px';
      node.replaceWith(span);
      span.appendChild(node);
      return span;
    });
    // Reselect the runs so the next ± click steps from here, and cache the
    // range the way `exec` does for controls that steal focus. Boundaries go
    // *inside* the first/last wrap (each holds exactly one text node), so the
    // selection anchor sits under the new span and `selSize` reads it for the
    // toolbar readout.
    const first = wraps[0].firstChild;
    const last = wraps[wraps.length - 1].lastChild;
    const r2 = document.createRange();
    r2.setStart(first, 0);
    r2.setEnd(last, last.nodeValue.length);
    if (sel) { sel.removeAllRanges(); sel.addRange(r2); }
    this.savedRange = r2.cloneRange();
    return true;
  }

  hasCountdown() { return this.state.doc.rows.some((r) => r.cols.some((c) => c.blocks.some((b) => b.type === 'countdown'))); }

  persist(doc, assets, chrome) {
    try {
      const blob = JSON.stringify({
        doc: doc || this.state.doc,
        // With a provider the library belongs to the backend, not to this
        // draft: the files are already durable there, and writing them here
        // only risks reviving tiles for files since deleted. Without one it
        // is base64 in localStorage, which is what fills the origin quota.
        assets: this.storageProvider ? [] : (assets || this.state.assets), chrome: chrome || this.state.chrome,
        // `t` is what sweepDrafts ages slots by; mount's reader ignores it.
        t: Date.now(),
      });
      // The tab's own slot is this tab's document; the shared key is only the
      // seed a future fresh tab starts from (most recent work wins there).
      if (this.tabKey) localStorage.setItem(this.tabKey, blob);
      localStorage.setItem(STORAGE_KEY, blob);
      // Direct mutation + surgical label refresh, NOT setState: autosave runs
      // 400ms after every commit, so a setState here re-rendered the entire
      // editor just to change the header's "Saved" label -- which, half a
      // second after any edit, silently destroyed whatever the user had since
      // opened (a native <select>'s option list, most visibly) and doubled
      // the render cost of every single interaction.
      this.state.savedStatus = 'saved';
      this.state.savedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (this.onSavedChange) this.onSavedChange();
    } catch {
      this.state.savedStatus = 'error';
      if (this.onSavedChange) this.onSavedChange();
    }
  }

  commit(fn) {
    const prev = JSON.stringify(this.state.doc);
    const doc = JSON.parse(prev);
    fn(doc);
    this.setState({ doc, history: this.state.history.slice(-40).concat(prev), future: [] });
    // A drag on any continuous control (a range slider especially) fires
    // `commit` dozens of times a second. `persist` does a full JSON.stringify
    // of the doc plus a *synchronous* localStorage.setItem -- both real costs
    // -- and was running on every single one of those commits, right in the
    // middle of the drag. That's enough main-thread work per tick to visibly
    // stutter the slider. Debouncing to fire once after things settle keeps
    // autosave working (nothing is lost -- the last doc always wins) without
    // paying that cost on every intermediate value.
    clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => this.persist(doc), 400);
  }

  /**
   * Both directions of history have the same two obligations when a block is
   * being edited, because the live contenteditable is a second copy of that
   * block's content: fold it into props *before* the current state is pushed
   * onto the opposite stack (or the step back carries markup a few keystrokes
   * behind what was on screen), and mark it stale afterwards (or the render
   * that follows syncs the pre-undo DOM straight back over the restored doc --
   * which is what made undo look like it skipped the focused block).
   */
  undo() {
    const hist = this.state.history.slice(); const prev = hist.pop(); if (!prev) return;
    if (this.state.editing && this.onFoldLiveEdit) this.onFoldLiveEdit();
    const doc = JSON.parse(prev);
    if (this.state.editing) this.editStale = this.state.editing;
    this.setState({ doc, history: hist, future: this.state.future.concat(JSON.stringify(this.state.doc)), sel: null }, () => this.persist(doc));
  }

  redo() {
    const fut = this.state.future.slice(); const next = fut.pop(); if (!next) return;
    if (this.state.editing && this.onFoldLiveEdit) this.onFoldLiveEdit();
    const doc = JSON.parse(next);
    if (this.state.editing) this.editStale = this.state.editing;
    this.setState({ doc, future: fut, history: this.state.history.concat(JSON.stringify(this.state.doc)), sel: null }, () => this.persist(doc));
  }

  flash(msg) {
    // Direct mutation + surgical refresh (same reason as persist above): the
    // toast's auto-dismissal 1.9s later was a spontaneous full re-render --
    // it destroyed any dropdown the user had opened since, to hide a label.
    this.state.toast = msg;
    if (this.onToast) this.onToast(); else this.setState({ toast: msg });
    clearTimeout(this.tt);
    this.tt = setTimeout(() => {
      this.state.toast = null;
      if (this.onToast) this.onToast(); else this.setState({ toast: null });
    }, 1900);
  }
  select(type, id) { this.setState({ sel: { type, id }, tab: 'design' }); }

  find(doc, id) {
    for (const r of doc.rows) {
      if (r.id === id) return { row: r };
      for (let ci = 0; ci < r.cols.length; ci++) {
        const bi = r.cols[ci].blocks.findIndex((b) => b.id === id);
        if (bi > -1) return { row: r, col: r.cols[ci], ci, bi, block: r.cols[ci].blocks[bi] };
      }
    }
    return {};
  }

  selObj() { return this.state.sel ? this.find(this.state.doc, this.state.sel.id) : {}; }

  setProp(id, key, val) {
    // The rewrite below works from the block's *committed* html, so anything
    // still living only in the focused contenteditable is folded into props
    // first -- otherwise it would both rewrite stale content and lose the
    // uncommitted edit the moment the rebuilt node reads props back.
    if (this.state.editing === id && this.onFoldLiveEdit) this.onFoldLiveEdit();
    let rewrote = false;
    this.commit((doc) => {
      const f = this.find(doc, id);
      const target = f.block ? f.block.props : (f.row ? f.row.props : null);
      if (!target) return;
      // Before the write: the size rewrite needs the outgoing value as its base.
      if (f.block) rewrote = syncRichContent(f.block, key, val);
      target[key] = val;
    });
    // props are now *ahead* of the live contenteditable, which still holds the
    // pre-rewrite html. Flagged so the render that follows syncs nothing back
    // over them (`syncLiveEdit`, mailcraft-editor.js): without this, every
    // Text size / color / spacing change made while the block was focused --
    // i.e. every change made from the RTE's own +/- pair -- was silently
    // reverted one frame later, so a mixed-size block ended up with a climbing
    // `size` prop and untouched inline sizes.
    if (rewrote) this.editStale = id;
  }

  setTheme(key, val) { this.commit((doc) => { doc.theme[key] = val; }); }

  /** Column-level styling (`bg`, `radius`, `padY`, `padX` on a col object -- all optional, absent means unstyled). What lets one section hold differently-colored card columns, which row-level props can't express. */
  setColProp(rowId, ci, key, val) {
    this.commit((doc) => {
      const row = this.find(doc, rowId).row;
      if (row && row.cols[ci]) row.cols[ci][key] = val;
    });
  }

  /**
   * Sections store padding as a linked pair (`py` top+bottom, `px`
   * left+right). Splitting copies the pair onto the four side props so
   * nothing moves visually at the moment of the toggle; re-linking folds the
   * sides back to their averages and deletes the overrides -- rendering
   * falls back to the pair wherever a side prop is absent (layout-style.js
   * `rowPad`), which is also what keeps pre-split documents rendering
   * unchanged.
   */
  togglePadSplit(id) {
    this.commit((doc) => {
      const f = this.find(doc, id);
      const row = f.row; if (!row) return;
      const p = row.props;
      const on = !p.padSplit;
      if (on) {
        if (p.pt === undefined) { p.pt = p.py; p.pb = p.py; p.pl = p.px; p.pr = p.px; }
      } else {
        p.py = Math.round(((p.pt ?? p.py) + (p.pb ?? p.py)) / 2);
        p.px = Math.round(((p.pl ?? p.px) + (p.pr ?? p.px)) / 2);
        delete p.pt; delete p.pb; delete p.pl; delete p.pr;
      }
      p.padSplit = on;
    });
  }

  // ---- tree mutations -----------------------------------------------------

  insertBlock(type, rowId, ci, index) {
    const block = mk(type);
    // Dynamic-content markers come in pairs: dropping the tile inserts the
    // start and its matching end together, and the user drags content between
    // them. From then on each half is an ordinary block -- moved, duplicated
    // or deleted on its own (export balances whatever arrangement results).
    const pair = type === 'condition' || type === 'loop' ? [block, blk(type, { expr: '', end: true })] : [block];
    this.commit((doc) => {
      if (this.state.mode === 'stack' || !rowId) {
        // Markers dropped at row level get a row *each*, so whole sections
        // can be dragged between them; one shared row would trap the pair
        // inside a single column.
        const at = typeof index === 'number' ? index : doc.rows.length;
        pair.slice().reverse().forEach((b) => {
          const row = mkRow([100], [b]);
          // Marker rows are editor scaffolding (export drops their <tr>
          // entirely) -- a slim band, not a full padded section.
          if (pair.length > 1) { row.props.py = 4; }
          doc.rows.splice(at, 0, row);
        });
      } else {
        const f = this.find(doc, rowId);
        const col = f.row.cols[ci] || f.row.cols[0];
        const at = typeof index === 'number' ? index : col.blocks.length;
        col.blocks.splice(at, 0, ...pair);
      }
    });
    this.setState({ sel: { type: 'block', id: block.id }, tab: 'design', drop: null, rowDrop: null });
  }

  insertGroup(id, rowId, ci, index) {
    const gr = GROUPS[id]; if (!gr) return;
    const rows = gr.build();
    if (rowId) {
      const blocks = rows.reduce((acc, r) => acc.concat(r.cols.reduce((a, c) => a.concat(c.blocks), [])), []);
      this.commit((doc) => {
        const f = this.find(doc, rowId);
        const col = f.row.cols[ci] || f.row.cols[0];
        col.blocks.splice(typeof index === 'number' ? index : col.blocks.length, 0, ...blocks);
      });
      this.setState({ sel: blocks[0] ? { type: 'block', id: blocks[0].id } : null, tab: 'design', drop: null, rowDrop: null });
      return;
    }
    this.commit((doc) => { doc.rows.splice(typeof index === 'number' ? index : doc.rows.length, 0, ...rows); });
    this.setState({ sel: { type: 'row', id: rows[0].id }, tab: 'design', drop: null, rowDrop: null });
  }

  insertRow(spans, index, withHtml) {
    const row = withHtml ? mkRow([100], [mk('html')]) : mkRow(spans);
    if (withHtml) { row.props.py = 0; row.props.px = 0; }
    this.commit((doc) => { doc.rows.splice(typeof index === 'number' ? index : doc.rows.length, 0, row); });
    this.setState({ sel: { type: withHtml ? 'block' : 'row', id: withHtml ? row.cols[0].blocks[0].id : row.id }, tab: 'design', drop: null, rowDrop: null });
  }

  moveBlock(blockId, rowId, ci, index) {
    this.commit((doc) => {
      const from = this.find(doc, blockId); if (!from.block) return;
      const [b] = from.col.blocks.splice(from.bi, 1);
      const to = this.find(doc, rowId);
      if (!to.row) { doc.rows.push(mkRow([100], [b])); return; }
      const col = to.row.cols[ci] || to.row.cols[0];
      let at = typeof index === 'number' ? index : col.blocks.length;
      if (col === from.col && from.bi < at) at--;
      col.blocks.splice(at, 0, b);
    });
    this.setState({ drop: null, rowDrop: null });
  }

  moveRow(rowId, index) {
    this.commit((doc) => {
      const i = doc.rows.findIndex((r) => r.id === rowId); if (i < 0) return;
      const [r] = doc.rows.splice(i, 1);
      let at = index; if (i < at) at--;
      doc.rows.splice(Math.max(0, Math.min(at, doc.rows.length)), 0, r);
    });
    this.setState({ drop: null, rowDrop: null });
  }

  moveBlockToNewRow(blockId, index) {
    this.commit((doc) => {
      const f = this.find(doc, blockId); if (!f.block) return;
      const [b] = f.col.blocks.splice(f.bi, 1);
      doc.rows.splice(index, 0, mkRow([100], [b]));
    });
    this.setState({ drop: null, rowDrop: null });
  }

  dupSel() {
    const sel = this.state.sel; if (!sel) return;
    this.commit((doc) => {
      const f = this.find(doc, sel.id);
      if (f.block) { const c = clone(f.block); c.id = uid(); f.col.blocks.splice(f.bi + 1, 0, c); }
      else if (f.row) {
        const c = clone(f.row); c.id = uid();
        c.cols.forEach((col) => { col.id = uid(); col.blocks.forEach((b) => { b.id = uid(); }); });
        doc.rows.splice(doc.rows.indexOf(f.row) + 1, 0, c);
      }
    });
    this.flash(this.t('toast.duplicated'));
  }

  delSel() {
    const sel = this.state.sel; if (!sel) return;
    this.commit((doc) => {
      const f = this.find(doc, sel.id);
      if (f.block) f.col.blocks.splice(f.bi, 1);
      else if (f.row) doc.rows.splice(doc.rows.indexOf(f.row), 1);
    });
    this.setState({ sel: null });
  }

  nudge(id, dir) {
    this.commit((doc) => {
      const f = this.find(doc, id);
      if (f.block) {
        const at = f.bi + dir; if (at < 0 || at >= f.col.blocks.length) return;
        const [b] = f.col.blocks.splice(f.bi, 1); f.col.blocks.splice(at, 0, b);
      } else if (f.row) {
        const i = doc.rows.indexOf(f.row); const at = i + dir;
        if (at < 0 || at >= doc.rows.length) return;
        const [r] = doc.rows.splice(i, 1); doc.rows.splice(at, 0, r);
      }
    });
  }

  // ---- drag & drop --------------------------------------------------------

  startDrag(payload) {
    return (e) => {
      this.drag = payload;
      try { e.dataTransfer.setData('text/plain', JSON.stringify(payload)); e.dataTransfer.effectAllowed = 'copyMove'; } catch { /* ignore */ }
    };
  }

  indexFromPoint(el, y) {
    if (!el || !el.children) return 0;
    const kids = Array.from(el.children).filter((c) => c.getAttribute && c.getAttribute('data-mc-slot') === '1');
    let idx = kids.length;
    for (let i = 0; i < kids.length; i++) {
      const r = kids[i].getBoundingClientRect();
      if (r.height === 0) continue;
      if (y < r.top + r.height / 2) { idx = i; break; }
    }
    return idx;
  }

  colDragOver(rowId, ci) {
    return (e) => {
      const d = this.drag; if (!d) return;
      e.preventDefault(); e.stopPropagation();
      if (d.kind === 'row' || d.kind === 'move-row') return;
      const index = this.indexFromPoint(e.currentTarget, e.clientY);
      const cur = this.state.drop;
      if (!cur || cur.rowId !== rowId || cur.ci !== ci || cur.index !== index) this.setState({ drop: { rowId, ci, index }, rowDrop: null });
    };
  }

  colDrop(rowId, ci) {
    return (e) => {
      const d = this.drag; if (!d) return;
      e.preventDefault(); e.stopPropagation();
      const index = this.indexFromPoint(e.currentTarget, e.clientY);
      if (d.kind === 'block') this.insertBlock(d.type, rowId, ci, index);
      else if (d.kind === 'move-block') this.moveBlock(d.id, rowId, ci, index);
      else if (d.kind === 'group') this.insertGroup(d.id, rowId, ci, index);
      else if (d.kind === 'asset') this.dropAsset(d.assetId, rowId, ci, index);
      this.drag = null;
    };
  }

  /**
   * The element whose children are the row slots, given whatever the drag
   * listener was attached to. The row slots are children of the sheet, but the
   * canvas's own listeners sit on the page wrapper around it, so that a drag
   * held over the page's padding still counts as aimed at the template
   * (canvas.js). Reading the page's children finds no slots at all, so an
   * index derived from it came back 0 and every section landed at the top no
   * matter where the drop line was shown. The canvas now passes its index
   * outright; this keeps the derived path right for any other host wiring.
   */
  rowSlotHost(target) {
    if (!target || !target.getAttribute) return target || null;
    if (target.getAttribute('data-mc-sheet') === '1') return target;
    return (target.querySelector && target.querySelector('[data-mc-sheet="1"]')) || target;
  }

  canvasDragOver = (e, index) => {
    const d = this.drag; if (!d) return;
    e.preventDefault();
    const at = typeof index === 'number' ? index : this.indexFromPoint(this.rowSlotHost(e.currentTarget), e.clientY);
    if (this.state.rowDrop !== at) this.setState({ rowDrop: at, drop: null });
  };

  /**
   * `index` is the slot the caller already highlighted. The canvas passes it
   * so the drop lands where the line was drawn -- one measurement, not two of
   * them racing. Omitted (a host wiring these onto its own element), the
   * index is derived here instead.
   */
  canvasDrop = (e, index) => {
    const d = this.drag; if (!d) return;
    e.preventDefault();
    index = typeof index === 'number' ? index : this.indexFromPoint(this.rowSlotHost(e.currentTarget), e.clientY);
    if (d.kind === 'row') this.insertRow(d.spans, index, d.html);
    else if (d.kind === 'move-row') this.moveRow(d.id, index);
    else if (d.kind === 'block') this.insertBlock(d.type, null, 0, index);
    else if (d.kind === 'move-block') this.moveBlockToNewRow(d.id, index);
    else if (d.kind === 'group') this.insertGroup(d.id, null, 0, index);
    else if (d.kind === 'asset') this.dropAsset(d.assetId, null, 0, index);
    this.drag = null;
  };

  dropAsset(assetId, rowId, ci, index) {
    const a = this.state.assets.find((x) => x.id === assetId); if (!a) return;
    const block = mk('image');
    block.props.src = a.url; block.props.alt = a.name.replace(/\.[a-z]+$/i, '').replace(/[-_]/g, ' ');
    this.commit((doc) => {
      if (!rowId || this.state.mode === 'stack') doc.rows.splice(typeof index === 'number' ? index : doc.rows.length, 0, mkRow([100], [block]));
      else {
        const f = this.find(doc, rowId); const col = f.row.cols[ci] || f.row.cols[0];
        col.blocks.splice(typeof index === 'number' ? index : col.blocks.length, 0, block);
      }
    });
    this.setState({ sel: { type: 'block', id: block.id }, tab: 'design', drop: null, rowDrop: null });
  }

  // ---- assets --------------------------------------------------------------

  /**
   * Host-supplied storage. Assigning one takes the library over completely:
   * folders and pages come from the backend, and every upload and delete
   * round-trips through the provider. Assigning `null` drops back to the
   * local-only library -- empty until something is dropped into it, and gone
   * again when the draft is cleared.
   */
  setStorageProvider(provider) {
    const problems = provider ? providerProblems(provider) : [];
    if (problems.length) { console.warn('[mailcraft] ' + problems.join('; ')); return; }
    this.storageProvider = provider || null;
    this.abortAssets('list');
    this.abortAssets('upload');
    if (!provider) {
      this.setState({ assets: [], folders: null, assetFolder: ALL_FOLDER_ID, assetCursor: null, assetsError: null, assetsLoaded: false });
      return;
    }
    this.setState({ assets: [], folders: null, assetFolder: ALL_FOLDER_ID, assetCursor: null, assetsError: null, assetsLoaded: false });
    // Surface a missing upload policy while the integrator is looking at the
    // console, not later when a user drops a file and gets a refusal. Deferred
    // a turn because `storageProvider` and `storageLimits` are normally set on
    // consecutive lines, in either order.
    clearTimeout(this._limitsWarnTimer);
    this._limitsWarnTimer = setTimeout(() => {
      if (this.storageProvider && limitsProblem(this.limits())) {
        console.warn('[mailcraft] storageProvider is set but storageLimits is not -- every upload will be refused. See core/storage-limits.js.');
      }
    }, 0);
    this.refreshAssets();
  }

  /**
   * Applies a host-supplied template as an undoable edit. Template galleries
   * are host UI, not editor UI -- there is no tab and no catalogue in the
   * package -- so this method is the whole seam. Accepts `doc` (a document
   * object), `build()` (one made per use), or raw `html` (run through the
   * importer). The other direction is `getContent()`, which is how a host
   * captures the current document to store as a template of its own.
   */
  loadTemplate(tpl) {
    if (!tpl) return;
    const built = typeof tpl.build === 'function' ? tpl.build()
      : tpl.doc ? tpl.doc
      : (typeof tpl.html === 'string' && tpl.html.trim()) ? docFromHtml(tpl.html)
      : null;
    if (!built) return;
    const doc = normalizeDoc(JSON.parse(JSON.stringify(built)));
    if (!doc) return;
    this.docSetByHost = true;
    this.setState({
      doc,
      sel: null,
      history: this.state.history.concat(JSON.stringify(this.state.doc)),
      future: [],
    }, () => this.persist(doc));
    this.flash(this.t('toast.templateLoaded', { name: tpl.name || '' }));
  }

  setStorageLimits(limits) { this.storageLimits = limits || null; this.emit(); }

  /**
   * Listings and uploads get separate abort scopes on purpose. Changing folder
   * should cancel the listing it supersedes, but must not kill uploads already
   * in flight -- a user who drops files and then browses elsewhere still wants
   * those files. Both are cancelled when the provider changes or the editor
   * unmounts.
   *
   * A provider that ignores `signal` simply runs to completion; `refreshAssets`
   * still discards the superseded result by token, so cancellation is an
   * optimisation on top of correctness, not the thing that provides it.
   */
  abortAssets(scope) {
    const key = scope === 'upload' ? '_uploadAbort' : '_listAbort';
    if (this[key]) this[key].abort();
    this[key] = typeof AbortController === 'function' ? new AbortController() : null;
    return this[key] ? this[key].signal : undefined;
  }

  /** `editor.storageLimits` over `provider.limits`, per key. */
  limits() { return resolveLimits(this.storageLimits, this.storageProvider && this.storageProvider.limits); }

  /** Sidebar entries. Counts appear only where they are actually known -- a cursor-paged backend cannot say how many files a folder holds without walking all of it, and a wrong count is worse than none. */
  folderOptions() {
    const s = this.state;
    // Without a provider there is no folder tree to offer -- only whatever was
    // dropped into this session, whose count is known exactly.
    if (!this.storageProvider) return [{ id: ALL_FOLDER_ID, name: this.t('library.allFiles'), count: s.assets.length }];
    return [{ id: ALL_FOLDER_ID, name: this.t('library.allFiles'), count: null }]
      .concat((s.folders || []).map((f) => ({ id: f.id, name: f.name, count: null })));
  }

  /** With a provider, folder and search are the backend's job -- re-filtering the current page here would hide matches that live on the next one. */
  visibleAssets() {
    const s = this.state;
    if (this.storageProvider) return s.assets;
    const q = (s.assetQuery || '').trim().toLowerCase();
    return q ? s.assets.filter((a) => a.name.toLowerCase().includes(q)) : s.assets;
  }

  openLibrary(assetTarget) {
    this.setState({ libraryOpen: true, assetTarget: assetTarget || null });
    if (this.storageProvider && !this.state.assetsLoaded && !this.state.assetsLoading) this.refreshAssets();
  }

  setAssetFolder(id) {
    this.setState({ assetFolder: id });
    if (this.storageProvider) this.refreshAssets();
  }

  setAssetQuery(q) {
    this.setState({ assetQuery: q });
    if (!this.storageProvider) return;
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.refreshAssets(), 320);
  }

  /**
   * Loads a page from the provider; `append` continues from the cursor the last
   * page returned. Each run takes a token and drops its own result if another
   * run started meanwhile, so a slow query for a folder the user has already
   * navigated away from cannot overwrite the list they are now looking at.
   */
  async refreshAssets({ append = false } = {}) {
    const provider = this.storageProvider;
    if (!provider) return;
    const token = (this._assetToken = (this._assetToken || 0) + 1);
    const signal = this.abortAssets('list');
    this.setState({ assetsLoading: true, assetsError: null });
    try {
      if (!this.state.folders && provider.folders) {
        // A folder list is optional chrome; failing to get one must not take
        // the file list down with it.
        try {
          const folders = await provider.folders({ signal });
          if (token === this._assetToken) this.setState({ folders });
        } catch { /* ignore */ }
      }
      const page = await provider.list({
        folderId: this.folderId(),
        cursor: append ? this.state.assetCursor : null,
        query: (this.state.assetQuery || '').trim(),
        signal,
      });
      if (token !== this._assetToken) return;
      const items = ((page && page.items) || []).map((a) => normalizeAsset(a));
      this.setState({
        assets: append ? this.state.assets.concat(items) : items,
        assetCursor: (page && page.cursor) || null,
        assetsLoading: false,
        assetsLoaded: true,
      });
    } catch (e) {
      // An abort is this class superseding its own request -- not a failure to
      // report, and the run that replaced it owns the UI now.
      if (token !== this._assetToken || (e && e.name === 'AbortError')) return;
      this.setState({ assetsLoading: false, assetsError: (e && e.message) || String(e) });
    }
  }

  loadMoreAssets() { if (this.state.assetCursor && !this.state.assetsLoading) this.refreshAssets({ append: true }); }

  /** The selected folder as the provider sees it. The synthetic "all files" entry is not a real folder, and its id is already the empty string a provider reads as "no filter". */
  folderId() { return this.state.assetFolder || ALL_FOLDER_ID; }

  /**
   * Validate, then upload. Both halves are the host's policy: what may be
   * uploaded comes from `storageLimits`, where it goes comes from the provider.
   *
   * With neither configured this is the original prototype behaviour. With a
   * provider but no limits it refuses -- that combination is a misconfiguration
   * rather than a mode, and quietly accepting anything is the exact thing the
   * limits exist to prevent.
   */
  async addFiles(list) {
    const files = Array.from(list || []);
    if (!files.length) return;
    const provider = this.storageProvider;
    const limits = this.limits();

    if (!provider && !limits) { this.addFilesAsDataUrls(files); return; }

    const { accepted, rejected } = await validateFiles(files, limits);
    // The first reason shows immediately; the rest queue behind it, spaced a
    // little longer than a toast lives. A ten-file drop where nothing passes
    // would otherwise show only whichever rejection happened to land last.
    rejected.forEach((r, i) => {
      if (i === 0) this.flash(this.t(r.key, r.params));
      else setTimeout(() => this.flash(this.t(r.key, r.params)), i * 2100);
    });
    if (!accepted.length) return;
    if (!provider) { this.addFilesAsDataUrls(accepted.map((a) => a.file)); return; }

    const folderId = this.folderId();
    const signal = this.abortAssets('upload');
    // Results are written by index rather than pushed, so the library shows the
    // files in the order they were dropped however the pool happens to finish.
    const results = new Array(accepted.length);
    let next = 0;
    this.setState({ uploading: accepted.length });

    const worker = async () => {
      for (let i = next++; i < accepted.length; i = next++) {
        const item = accepted[i];
        try {
          const asset = await provider.upload(item.file, { folderId, width: item.w, height: item.ht, signal });
          results[i] = normalizeAsset(asset, item);
        } catch (e) {
          if (!(e && e.name === 'AbortError')) {
            this.flash(this.t('storage.errUploadFailed', { name: item.name, reason: (e && e.message) || '' }));
          }
        }
        this.setState({ uploading: Math.max(0, this.state.uploading - 1) });
      }
    };
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, accepted.length) }, worker));

    this.setState({ uploading: 0 });
    const added = results.filter(Boolean);
    if (added.length) this.finishUpload(added);
  }

  /**
   * The no-provider path, kept so the package still does something sensible
   * with nothing wired: files dropped in stay in this browser, in this draft.
   * Worth knowing before shipping on it -- Gmail and Outlook both strip
   * `data:` images, so this is a way to try the editor, not a way to send
   * mail. Wire a `storageProvider` before anything leaves the building.
   */
  addFilesAsDataUrls(list) {
    const files = Array.from(list || []).filter((f) => /^image\//.test(f.type));
    if (!files.length) return;
    let pending = files.length; const added = [];
    const done = () => { if (--pending === 0 && added.length) this.finishUpload(added); };
    files.forEach((f) => {
      const fr = new FileReader();
      fr.onload = () => {
        const img = new Image();
        img.onload = () => { added.push({ id: uid(), name: f.name, url: fr.result, folder: '', w: img.width, ht: img.height, size: f.size }); done(); };
        img.onerror = () => { added.push({ id: uid(), name: f.name, url: fr.result, folder: '', w: 0, ht: 0, size: f.size }); done(); };
        img.src = fr.result;
      };
      fr.onerror = done;
      fr.readAsDataURL(f);
    });
  }

  finishUpload(added) {
    const assets = added.concat(this.state.assets);
    // No folder switch either way: with a provider the file already sits in
    // whichever folder the user was looking at, and without one there is only
    // ever the single synthetic folder.
    this.setState({ assets, libHot: false }, () => { if (!this.storageProvider) this.persist(null, assets); });
    this.flash(added.length === 1 ? this.t('toast.fileUploadedOne') : this.t('toast.fileUploadedMany', { count: added.length }));
  }

  /** DEL on a library tile. Where the provider owns the file, a failed delete leaves the tile alone rather than showing a removal that did not happen. */
  async removeAsset(a) {
    const provider = this.storageProvider;
    if (provider && provider.remove) {
      try { await provider.remove(a); }
      catch (e) { this.flash(this.t('storage.errDeleteFailed', { name: a.name, reason: (e && e.message) || '' })); return; }
    }
    const assets = this.state.assets.filter((x) => x.id !== a.id);
    this.setState({ assets }, () => { if (!provider) this.persist(null, assets); });
    this.flash(this.t('toast.assetDeleted', { name: a.name }));
  }

  useAsset(a) {
    const t = this.state.assetTarget;
    if (t) {
      this.setProp(t.id || t, t.key || 'src', a.url);
      this.setState({ libraryOpen: false, assetTarget: null });
      this.flash(this.t('toast.imageReplaced'));
    } else {
      const block = mk('image');
      block.props.src = a.url; block.props.alt = a.name.replace(/\.[a-z]+$/i, '').replace(/[-_]/g, ' ');
      const sel = this.selObj();
      this.commit((doc) => {
        if (sel.row && this.state.mode === 'rows') this.find(doc, sel.row.id).row.cols[sel.ci || 0].blocks.push(block);
        else doc.rows.push(mkRow([100], [block]));
      });
      this.setState({ libraryOpen: false, sel: { type: 'block', id: block.id }, tab: 'design' });
      this.flash(this.t('toast.imageAdded'));
    }
  }

  // ---- export / code view --------------------------------------------------

  buildHtml(opts) { return buildHtmlFn(this.state, this.exportRoot, boxCss, opts); }

  openExport = () => {
    this.setState({ exportOpen: true, exportCode: this.buildHtml(), copied: false, libraryOpen: false, aiOpen: false, codeOpen: false });
  };

  copyExport = () => {
    if (navigator.clipboard) navigator.clipboard.writeText(this.state.exportCode).then(() => this.setState({ copied: true }), () => this.setState({ copied: true }));
    else this.setState({ copied: true });
    this.flash(this.t('toast.htmlCopied'));
  };

  /** Code view's source pane onto the clipboard, unsaved edits included: `codeSrc` is what the pane shows, which may be ahead of what Apply has pushed to the canvas. */
  copyCode = () => {
    if (navigator.clipboard) navigator.clipboard.writeText(this.state.codeSrc).catch(() => {});
    this.flash(this.t('toast.htmlCopied'));
  };

  downloadExport = () => {
    const blob = new Blob([this.state.exportCode], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'email.html';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  };

  openCode = () => {
    const src = this.buildHtml();
    this.setState({ codeOpen: true, codeSrc: src, codeLive: src, codeDirty: false, libraryOpen: false, exportOpen: false, aiOpen: false });
  };

  setCodeSrc = (value) => {
    // Source typing only changes the code editor surface. Updating the state
    // directly and asking that surface to repaint avoids rebuilding the full
    // canvas and inspector on every keystroke.
    this.state.codeSrc = value;
    this.state.codeDirty = true;
    if (this.onCodeSourceChange) this.onCodeSourceChange();
    clearTimeout(this.codeTimer);
    this.codeTimer = setTimeout(() => this.setState({ codeLive: this.state.codeSrc }), 350);
  };

  /** Shared HTML -> doc entry point for both the Code modal's "Apply" action and the host-facing `importHtml` API. Recognizable shapes (image/button/heading/text/divider/list/table, per `core/import-html.js`) become native blocks; anything structural that can't be classified falls back to one raw `html` block per row, and a totally unparseable/empty result falls back to a single row wrapping the whole body -- content is never dropped. Returns the number of rows produced. */
  importHtml(src) {
    const { rows, theme } = parseHtmlSource(src);
    this.docSetByHost = true;
    // The theme patch carries only keys the source actually declared (page
    // background, content width, font stack) -- merged, not replaced, so an
    // import that says nothing about e.g. link color leaves it alone.
    this.commit((doc) => { doc.rows = rows; Object.assign(doc.theme, theme); });
    return rows.length;
  }

  applyCode = () => {
    try {
      const n = this.importHtml(this.state.codeSrc);
      this.setState({ codeOpen: false, codeDirty: false, sel: null });
      this.flash(n === 1 ? this.t('toast.sourceAppliedOne') : this.t('toast.sourceAppliedMany', { rows: n }));
    } catch {
      this.flash(this.t('toast.parseError'));
    }
  };

  // ---- AI copy ---------------------------------------------------------

  runAi = async () => {
    const { aiGoal, aiTone, aiBrief } = this.state;
    this.setState({ aiBusy: true, aiResults: [] });
    const prompt = 'You write marketing email copy. Goal: ' + aiGoal + '. Tone: ' + aiTone + '. Brief: ' + aiBrief +
      '. Return ONLY JSON: {"headline":"...","body":"...","cta":"..."} — body max 55 words, plain sentences, no emoji, may use {{ first_name }}.';
    let out = null;
    try {
      if (this.aiProvider) {
        const raw = await this.aiProvider(prompt);
        const m = String(raw).match(/\{[\s\S]*\}/);
        if (m) out = JSON.parse(m[0]);
      }
    } catch { out = null; }
    if (!out) {
      const s = (aiBrief || 'the new drop').replace(/\.$/, '');
      out = {
        headline: s.split(/[,.]/)[0].slice(0, 58),
        body: 'Hi {{ first_name }} — ' + s + '. We kept it short: one link, one decision, no pressure.',
        cta: 'See it',
      };
    }
    const addText = (html, size, msg) => { const b = mk('text'); b.props.html = html; if (size) b.props.size = size; this.commit((doc) => { doc.rows.push(mkRow([100], [b])); }); this.setState({ aiOpen: false, sel: { type: 'block', id: b.id }, tab: 'design' }); this.flash(msg); };
    this.setState({
      aiBusy: false,
      aiResults: [
        { kind: this.t('ai.kindHeadline'), text: out.headline, action: this.t('ai.actionInsertHeading'), onUse: () => addText('<strong style="font-size:27px;line-height:1.15;display:block">' + out.headline + '</strong>', 16, this.t('toast.headingAdded')) },
        { kind: this.t('ai.kindBody'), text: out.body, action: this.t('ai.actionInsertText'), onUse: () => addText(out.body, 16, this.t('toast.textBlockAdded')) },
        { kind: this.t('ai.kindButton'), text: out.cta, action: this.t('ai.actionInsertButton'), onUse: () => { const b = mk('button'); b.props.label = out.cta; this.commit((doc) => { doc.rows.push(mkRow([100], [b])); }); this.setState({ aiOpen: false, sel: { type: 'block', id: b.id }, tab: 'design' }); this.flash(this.t('toast.buttonAdded')); } },
      ],
    });
  };

  // ---- variables -----------------------------------------------------------

  // ---- inspector field descriptors (ported from fields()/boxFields()/themeFields()) --

  boxFields() {
    const f = this.selObj();
    if (!f.block) return [];
    const b = f.block;
    const B = binder(() => this.find(this.state.doc, b.id).block.props, (k, v) => this.setProp(b.id, k, v), this);
    return decorate([
      B.head('Box & border'),
      B.color('Background color', 'bBg'),
      B.range('Border thickness', 'bBorder', 0, 20, 1, 'px'),
      ...(b.props.bBorder ? [
        B.sel('Border style', 'bStyle', BORDER_STYLES), B.color('Border color', 'bLine'),
        B.tog('Top border', 'bTop', true), B.tog('Right border', 'bRight', true),
        B.tog('Bottom border', 'bBottom', true), B.tog('Left border', 'bLeft', true),
      ] : []),
      B.range('Rounded corners', 'bRadius', 0, 100, 1, 'px'),
      B.range('Space inside', 'bPad', 0, 100, 2, 'px'),
    ]);
  }

  fields() {
    const sel = this.state.sel; if (!sel) return [];
    const f = this.selObj();
    const ALIGN = [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }];
    if (f.block) {
      const b = f.block;
      const B = binder(() => this.find(this.state.doc, b.id).block.props, (k, v) => this.setProp(b.id, k, v), this);
      // No leading "Block — X" head: the sticky panel header directly above
      // already reads "Block properties / X", so it only added a duplicate
      // line and a dead divider strip under the title.
      const base = [];
      const padF = [B.head('Spacing'), group(null, [B.range('Above & below', 'py', 0, 160, 2, 'px'), B.range('Left & right', 'px', 0, 120, 2, 'px')])];
      // Appended to every block type at once rather than repeated across
      // twenty switch arms. An absent `vis` means "all devices", so the
      // property only ever appears in a document that asked for it and no
      // migration is needed. Re-decorating an already-decorated list is safe:
      // `decorate` derives its flags from `kind`, which survives the pass.
      const visF = [B.head('Visibility'), B.seg('Show on', 'vis', [
        { value: 'all', label: 'All' },
        { value: 'desktop', label: 'Desktop' },
        { value: 'mobile', label: 'Mobile' },
      ])];
      const built = (() => {
      switch (b.type) {
        case 'text': return decorate(base.concat(
          /<a(?:\s|>)/i.test(String(b.props.html || ''))
            ? [{ kind: 'richLinks', label: 'Links', html: b.props.html || '', onChange: (v) => this.setProp(b.id, 'html', v) }]
            : [],
          [B.area('Text', 'html'), B.sel('Font', 'fontFamily', this.fontOptions(true, b.props.fontFamily)), B.range('Text size', 'size', ...SIZE_SPAN.text, 1, 'px'), B.range('Line spacing', 'lh', 0.8, 3, 0.05, ''), B.seg('Align', 'align', ALIGN), B.sel('Text weight', 'weight', [{ value: '400', label: 'Regular' }, { value: '500', label: 'Medium' }, { value: '700', label: 'Bold' }]), B.color('Text color', 'color')], padF));
        case 'image': return decorate(base.concat([B.btn('Choose from library', () => this.openLibrary({ id: b.id, key: 'src' })), B.text('Alt text', 'alt', 'Describe the image'), B.text('Link URL', 'href', 'https://'), B.range('Width', 'width', 5, 100, 1, '%'), B.seg('Align', 'align', ALIGN), B.range('Rounded corners', 'radius', 0, 200, 1, 'px')], padF));
        case 'button': return decorate(base.concat([B.text('Label', 'label'), B.text('Link URL', 'href', 'https://'), B.color('Button color', 'bg'), B.color('Text color', 'color'), B.sel('Font', 'fontFamily', this.fontOptions(true, b.props.fontFamily)), B.range('Text size', 'size', 8, 48, 1, 'px'), B.range('Rounded corners', 'radius', 0, 60, 1, 'px'), B.range('Outline thickness', 'borderW', 0, 6, 1, 'px')].concat(b.props.borderW ? [B.sel('Outline style', 'borderStyle', BORDER_STYLES), B.color('Outline color', 'borderColor')] : []).concat([B.range('Button height', 'py', 0, 60, 1, 'px'), B.range('Button width', 'px', 0, 120, 2, 'px'), B.seg('Align', 'align', ALIGN), B.tog('Full width', 'full')])));
        case 'divider': return decorate(base.concat([B.range('Thickness', 'thickness', 1, 20, 1, 'px'), B.sel('Line style', 'lineStyle', BORDER_STYLES), B.range('Width', 'width', 5, 100, 5, '%'), B.color('Color', 'color'), B.range('Space above & below', 'py', 0, 160, 2, 'px')]));
        case 'spacer': return decorate(base.concat([B.range('Height', 'height', 0, 400, 2, 'px')]));
        // Dynamic-content markers: the expression lives on the start marker;
        // an end marker has nothing to configure, so its panel just says what
        // it is. Authored, never evaluated -- export emits the literal
        // {{#if}}/{{#each}} tags at the markers' positions for the host's
        // templating engine to run at send time (see export.js).
        // The expression field suggests the host's merge variables (the same
        // list the Variables tab shows) but stays free text -- conditions and
        // loops routinely reference names that aren't inline tokens.
        case 'condition': return decorate(base.concat(b.props.end
          ? [B.head('End of condition — drag it to move the boundary')]
          : [B.text('Show only if', 'expr', 'e.g. is_premium', this.vars())]));
        case 'loop': return decorate(base.concat(b.props.end
          ? [B.head('End of loop — drag it to move the boundary')]
          : [B.text('Repeat for each', 'expr', 'e.g. order.items', this.vars())]));
        case 'social': return decorate(base.concat([
          // Custom kind (render/fields.js `renderSocialItems`): a per-network
          // card list with an add-dropdown, replacing the raw Name|URL
          // textarea. Same `items` string underneath.
          { kind: 'social', label: 'Networks', value: b.props.items || '', onChange: (v) => this.setProp(b.id, 'items', v) },
          B.seg('Icon palette', 'palette', [{ value: 'custom', label: 'Custom' }, { value: 'brand', label: 'Brand' }]),
          B.seg('Icon shape', 'shape', [{ value: 'outline', label: 'Outline' }, { value: 'bare', label: 'Bare' }, { value: 'circle', label: 'Circle' }, { value: 'square', label: 'Square' }]),
          B.tog('Show network names', 'showLabel'),
          B.sel('Font', 'fontFamily', this.fontOptions(true, b.props.fontFamily)),
          B.seg('Align', 'align', ALIGN), B.range('Icon size', 'size', 10, 64, 1, 'px'), B.range('Space between icons', 'gap', 0, 80, 2, 'px'), B.color('Icon color', 'color'),
        ]));
        case 'video': return decorate(base.concat([B.btn('Choose thumbnail', () => this.openLibrary({ id: b.id, key: 'src' })), B.text('Video URL', 'href', 'https://'), B.text('Caption', 'caption'), B.color('Badge color', 'badge')]));
        case 'html': return decorate(base.concat([B.area('Raw HTML', 'code')]));
        case 'countdown': return decorate(base.concat([B.text('Ends at (YYYY-MM-DDTHH:MM)', 'target'), B.text('Label', 'label'), B.sel('Font', 'fontFamily', this.fontOptions(true, b.props.fontFamily)), B.color('Color', 'color')]));
        case 'menu': return decorate(base.concat([B.area('Items — one per line as Label|URL', 'items'), B.seg('Align', 'align', ALIGN), B.sel('Font', 'fontFamily', this.fontOptions(true, b.props.fontFamily)), B.range('Text size', 'size', 8, 32, 1, 'px'), B.range('Space between items', 'gap', 0, 80, 2, 'px'), B.color('Text color', 'color')]));
        case 'heading': return decorate(base.concat([B.area('Text', 'text'), B.sel('Heading level', 'level', [{ value: 'h1', label: 'H1 — largest' }, { value: 'h2', label: 'H2' }, { value: 'h3', label: 'H3' }, { value: 'h4', label: 'H4 — smallest' }]), B.seg('Font style', 'font', [{ value: 'condensed', label: 'Condensed' }, { value: 'body', label: 'Body' }]), B.sel('Font', 'fontFamily', this.fontOptions(true, b.props.fontFamily)), B.range('Text size', 'size', ...SIZE_SPAN.heading, 1, 'px'), B.range('Line spacing', 'lh', 0.8, 2.2, 0.02, ''), B.seg('Align', 'align', ALIGN), B.sel('Text weight', 'weight', [{ value: '400', label: 'Regular' }, { value: '600', label: 'Semibold' }, { value: '700', label: 'Bold' }]), B.color('Text color', 'color')], padF));
        case 'list': return decorate(base.concat([B.area('Items — one per line', 'items'), B.tog('Numbered', 'ordered'), B.sel('Font', 'fontFamily', this.fontOptions(true, b.props.fontFamily)), B.range('Text size', 'size', 8, 48, 1, 'px'), B.range('Line spacing', 'lh', 0.8, 3, 0.05, ''), B.range('Space between items', 'gap', 0, 60, 1, 'px'), B.color('Text color', 'color')], padF));
        case 'table': return decorate(base.concat([
          // Custom kind (render/fields.js `renderTableGrid`): a real grid of
          // cell inputs with add/remove row+column controls, replacing the
          // raw pipe-separated textarea (and its separate add buttons). Same
          // `data` string underneath.
          { kind: 'tablegrid', label: 'Cells', value: b.props.data || '', header: !!b.props.header, onChange: (v) => this.setProp(b.id, 'data', v) },
          B.tog('Header row', 'header'), B.tog('Cell borders', 'borders'), ...(b.props.borders ? [B.range('Border thickness', 'borderWidth', 1, 10, 1, 'px'), B.sel('Border style', 'borderStyle', BORDER_STYLES)] : []), B.tog('Zebra stripes', 'striped'),
          B.sel('Font', 'fontFamily', this.fontOptions(true, b.props.fontFamily)),
          B.range('Space in cells', 'pad', 0, 50, 1, 'px'), B.range('Text size', 'size', 8, 32, 1, 'px'), B.range('Width', 'width', 10, 100, 5, '%'),
          B.color('Header color', 'headBg'), B.color('Line color', 'lineColor'), B.seg('Align', 'align', ALIGN),
        ]));
        case 'css': return decorate(base.concat([B.area('CSS', 'code'), B.text('Note to yourself', 'note')]));
        case 'box': return decorate(base.concat([B.area('Content (HTML allowed)', 'html'), B.color('Background color', 'bg'), B.btn('Choose background image', () => this.openLibrary({ id: b.id, key: 'bgImage' })), B.text('Background image URL', 'bgImage', 'https://'), B.range('Space inside', 'pad', 0, 160, 2, 'px'), B.range('Border thickness', 'border', 0, 20, 1, 'px')].concat(b.props.border ? [
          B.sel('Border style', 'borderStyle', BORDER_STYLES), B.color('Border color', 'lineColor'),
          B.tog('Top border', 'topBorder', true), B.tog('Right border', 'rightBorder', true),
          B.tog('Bottom border', 'bottomBorder', true), B.tog('Left border', 'leftBorder', true),
        ] : []).concat([B.range('Rounded corners', 'radius', 0, 200, 1, 'px'), B.range('Min height', 'minH', 0, 1200, 10, 'px'), B.range('Max width', 'maxW', 10, 100, 5, '%'), B.seg('Align', 'align', ALIGN), B.tog('Drop shadow', 'shadow')])));
        case 'svg': return decorate(base.concat([B.area('SVG markup', 'code'), B.seg('Align', 'align', ALIGN), B.range('Width', 'width', 5, 100, 5, '%'), B.range('Padding', 'py', 0, 120, 2, 'px')]));
        case 'codeblock': return decorate(base.concat([B.area('Code', 'code'), B.color('Background', 'bg'), B.color('Text color', 'color'), B.range('Size', 'size', 8, 32, 0.5, 'px'), B.range('Padding', 'pad', 0, 80, 2, 'px')]));
        default: return [];
      }
      })();
      // Logic markers are editor furniture with no rendered body, so there is
      // nothing for a device to show or hide.
      if (b.type === 'condition' || b.type === 'loop') return built;
      return decorate(built.concat(visF));
    }
    if (f.row) {
      const r = f.row;
      const p = r.props;
      const B = binder(() => this.find(this.state.doc, r.id).row.props, (k, v) => this.setProp(r.id, k, v), this);
      const curIdx = LAYOUTS.findIndex((l) => l.spans.length === r.cols.length && l.spans.join() === r.cols.map((c) => c.span).join());
      const adv = !!this.state.advancedOpen;
      const uiToggle = (label, on, onChange) => ({ kind: 'toggle', label, on: !!on, onChange });
      // Grouped and progressive rather than one flat wall of every control:
      // plain-language groups first; anything conditional (border sides,
      // image fit) appears only once it applies; the CSS-flavored layout
      // machinery (flex/grid, max-width, vertical align, raw image URL)
      // lives behind the "Advanced options" switch, an editor-UI flag
      // (this.state, never the doc) so it doesn't dirty or save with the
      // document.
      return decorate([
        // No leading "Section — N columns" head: the panel header already
        // says "Section properties / Section", and the Columns select right
        // here shows the layout.
        {
          kind: 'select', label: 'Columns', value: String(curIdx > -1 ? curIdx : 0),
          options: LAYOUTS.map((l, i) => ({ value: String(i), label: l.label })),
          onChange: (v) => {
            const spans = LAYOUTS[Number(v)].spans;
            this.commit((doc) => {
              const row = this.find(doc, r.id).row;
              const kept = row.cols.slice();
              // Spread keeps per-column styling (bg/radius/padY/padX) on
              // columns that survive the structure change.
              row.cols = spans.map((s, i) => Object.assign({}, kept[i] || {}, { id: (kept[i] && kept[i].id) || uid(), span: s, blocks: (kept[i] && kept[i].blocks) || [] }));
              const orphan = kept.slice(spans.length).reduce((a, c) => a.concat(c.blocks), []);
              if (orphan.length) row.cols[row.cols.length - 1].blocks = row.cols[row.cols.length - 1].blocks.concat(orphan);
            });
          },
        },
        ...(r.cols.length > 1 ? [
          B.range('Space between columns', 'gap', 0, 120, 2, 'px'),
          B.head('On mobile'),
          // Replaces the old "Stack columns on mobile" switch, which could
          // only say all-or-nothing. Saved documents are mapped onto these
          // values in migrateDoc, so an existing toggle keeps its meaning.
          B.seg('Columns', 'mobileCols', [
            { value: 1, label: 'One' },
            { value: 2, label: 'Two' },
            { value: 'keep', label: 'Keep' },
          ]),
          // Only offered where it changes something: reversing a row that
          // keeps its desktop layout would do nothing.
          ...(p.mobileCols !== 'keep' ? [B.seg('Order', 'mobileOrder', [
            { value: 'normal', label: 'Normal' },
            { value: 'reverse', label: 'Reverse' },
          ])] : []),
        ] : []),
        // Per-column styling, only for multi-column sections (a single
        // column's background is just the section background).
        ...(r.cols.length > 1 ? r.cols.reduce((acc, c, ci) => {
          const CB = binder(() => this.find(this.state.doc, r.id).row.cols[ci], (k, v) => this.setColProp(r.id, ci, k, v), this);
          return acc.concat([
            B.head('Column ' + (ci + 1)),
            CB.color('Background color', 'bg'),
            CB.range('Border thickness', 'border', 0, 20, 1, 'px'),
            ...(c.border ? [CB.sel('Border style', 'borderStyle', BORDER_STYLES), CB.color('Border color', 'lineColor')] : []),
            CB.range('Rounded corners', 'radius', 0, 100, 1, 'px'),
            group('Space inside', [CB.range('Top & bottom', 'padY', 0, 100, 2, 'px'), CB.range('Left & right', 'padX', 0, 100, 2, 'px')]),
          ]);
        }, []) : []),

        B.head('Background'),
        B.color('Background color', 'bg'),
        B.btn(p.bgImage ? 'Change background image' : 'Add background image', () => this.openLibrary({ id: r.id, key: 'bgImage' })),
        ...(p.bgImage ? [
          B.btn('Remove background image', () => this.setProp(r.id, 'bgImage', '')),
          B.sel('Image fit', 'bgSize', [{ value: 'cover', label: 'Fill the section' }, { value: 'contain', label: 'Fit inside' }, { value: 'auto', label: 'Actual size' }]),
          B.sel('Image position', 'bgPos', [{ value: 'center', label: 'Center' }, { value: 'top', label: 'Top' }, { value: 'bottom', label: 'Bottom' }, { value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]),
          B.range('Darken image', 'overlay', 0, 100, 1, '%'),
        ] : []),

        B.head('Border & corners'),
        B.range('Border thickness', 'border', 0, 20, 1, 'px'),
        B.sel('Border style', 'borderStyle', BORDER_STYLES),
        ...(p.border ? [
          B.color('Border color', 'lineColor'),
          B.tog('Top border', 'bTop', true),
          B.tog('Right border', 'bRight', true),
          B.tog('Bottom border', 'bBottom', true),
          B.tog('Left border', 'bLeft', true),
        ] : []),
        B.range('Rounded corners', 'radius', 0, 200, 1, 'px'),
        // Stored as the raw CSS string so an imported template's exact shadow
        // survives; the toggle writes/clears a standard soft card shadow.
        // (Note: many email clients ignore box-shadow -- it's progressive.)
        uiToggle('Drop shadow', !!p.shadow, () => this.setProp(r.id, 'shadow', p.shadow ? '' : '0 1px 2px rgba(15,23,42,0.06), 0 8px 24px rgba(15,23,42,0.10)')),

        B.head('Spacing'),
        // The group's "More options" switch is not a B.tog: the split/merge
        // needs to seed or fold the side props in the same commit -- see
        // togglePadSplit.
        group('Space inside', p.padSplit ? [
          B.range('Top', 'pt', 0, 200, 2, 'px'),
          B.range('Right', 'pr', 0, 160, 2, 'px'),
          B.range('Bottom', 'pb', 0, 200, 2, 'px'),
          B.range('Left', 'pl', 0, 160, 2, 'px'),
        ] : [
          B.range('Top & bottom', 'py', 0, 200, 2, 'px'),
          B.range('Left & right', 'px', 0, 160, 2, 'px'),
        ], { on: !!p.padSplit, onChange: () => this.togglePadSplit(r.id) }),
        group('Space outside', [
          B.range('Top', 'mt', 0, 160, 2, 'px'),
          B.range('Right', 'mr', 0, 160, 2, 'px'),
          B.range('Bottom', 'mb', 0, 160, 2, 'px'),
          B.range('Left', 'ml', 0, 160, 2, 'px'),
        ]),

        uiToggle('Advanced options', adv, () => this.setState({ advancedOpen: !this.state.advancedOpen })),
        ...(adv ? [
          B.head('Advanced'),
          B.seg('Layout engine', 'layout', [{ value: 'columns', label: 'Columns' }, { value: 'flex', label: 'Flex' }, { value: 'grid', label: 'Grid' }]),
          ...(p.layout === 'flex' ? [
            B.sel('Flex direction', 'flexDir', [{ value: 'row', label: 'Row' }, { value: 'row-reverse', label: 'Row reverse' }, { value: 'column', label: 'Column' }, { value: 'column-reverse', label: 'Column reverse' }]),
            B.sel('Justify content', 'justify', [{ value: 'flex-start', label: 'Start' }, { value: 'center', label: 'Center' }, { value: 'flex-end', label: 'End' }, { value: 'space-between', label: 'Space between' }, { value: 'space-around', label: 'Space around' }]),
            B.sel('Align items', 'alignItems', [{ value: 'stretch', label: 'Stretch' }, { value: 'flex-start', label: 'Start' }, { value: 'center', label: 'Center' }, { value: 'flex-end', label: 'End' }]),
            B.tog('Wrap flex items', 'wrap'),
          ] : []),
          ...(p.layout === 'grid' ? [B.range('Grid columns', 'gridCols', 1, 12, 1, '')] : []),
          B.text('Background image URL', 'bgImage', 'https://'),
          B.sel('Image repeat', 'bgRepeat', [{ value: 'no-repeat', label: 'No repeat' }, { value: 'repeat', label: 'Tile' }, { value: 'repeat-x', label: 'Tile across' }]),
          B.range('Max width', 'maxW', 10, 100, 5, '%'),
          B.seg('Vertical align', 'valign', [{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }]),
        ] : []),
      ]);
    }
    return [];
  }

  /**
   * Email-safe font stacks, shared by the theme's global select and every
   * block's own Font select. `inherit: true` prepends the blocks' default --
   * an empty value meaning "use the theme font" (renderers read
   * `p.fontFamily || theme.font`, so old documents need no migration).
   */
  fontOptions(inherit, current) {
    const stacks = [
      { value: '"Helvetica Neue", Helvetica, Arial, sans-serif', label: 'Helvetica Neue' },
      { value: 'Helvetica, Arial, sans-serif', label: 'Helvetica / Arial' },
      { value: '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif', label: 'System UI' },
      { value: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
      { value: 'Tahoma, Geneva, sans-serif', label: 'Tahoma' },
      { value: '"Trebuchet MS", Helvetica, sans-serif', label: 'Trebuchet MS' },
      { value: 'Georgia, "Times New Roman", serif', label: 'Georgia' },
      { value: '"Times New Roman", Times, serif', label: 'Times New Roman' },
      { value: '"Palatino Linotype", Palatino, Georgia, serif', label: 'Palatino' },
      { value: 'ui-monospace, "Courier New", monospace', label: 'Monospace' },
    ];
    const opts = inherit ? [{ value: '', label: 'Inherit — theme font' }].concat(stacks) : stacks;
    // An imported email brings its own stack, and it is almost never one of
    // the ten above. A <select> whose value matches no option shows nothing
    // selected -- the control read 'Inherit — theme font' (or the first
    // stack) about a block that was really set in Georgia, and the only way
    // to answer "what font is this?" was to overwrite it. Kept as an option
    // of its own, matched loosely because quoting and spacing differ
    // between what CSSOM hands back and what the list declares ('DM Sans'
    // vs "DM Sans").
    const key = (v) => String(v || '').replace(/["']/g, '').replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ').trim().toLowerCase();
    if (current && !opts.some((o) => key(o.value) === key(current))) {
      opts.push({ value: current, label: String(current).split(',')[0].replace(/["']/g, '').trim() + ' — from the email' });
    }
    return opts;
  }

  themeFields() {
    const B = binder(() => this.state.doc.theme, (k, v) => this.setTheme(k, v), this);
    return decorate([
      B.head('Canvas'),
      B.slider('Content area width', 'width', 280, 900, 5, 'px'),
      // The page section: everything outside the content column. Its colour
      // was always here, but with nothing painting it in the editor and no
      // way to size it, the band around a template could only be seen (and
      // never adjusted) in a sent message.
      B.color('Page background color', 'bg', { transparent: true, solid: '#eef2f7' }),
      group('Space around content', [
        B.range('Top & bottom', 'padY', 0, 120, 2, 'px'),
        B.range('Sides', 'padX', 0, 120, 2, 'px'),
      ]),
      B.head('Content area'),
      B.color('Content area background color', 'contentBg', { transparent: true, solid: '#ffffff' }),
      B.range('Corner radius', 'radius', 0, 48, 1, 'px'),
      B.range('Border thickness', 'borderW', 0, 12, 1, 'px'),
      B.sel('Drop shadow', 'shadow', [
        { value: '', label: 'None' },
        { value: '0 2px 8px rgba(23,32,51,0.08)', label: 'Soft' },
        { value: '0 8px 28px rgba(23,32,51,0.14)', label: 'Medium' },
        { value: '0 18px 48px rgba(23,32,51,0.22)', label: 'Deep' },
      ]),
    ].concat(this.state.doc.theme.borderW ? [
      B.sel('Border style', 'borderStyle', BORDER_STYLES),
      B.color('Border color', 'borderColor'),
    ] : []).concat([
      B.head('Type & color'),
      B.sel('Default font', 'font', this.fontOptions(false, this.state.doc.theme.font)),
      B.color('Text color', 'text'),
      B.color('Link color', 'link'),
    ]));
  }

  vars() { return varsFn(this.variablesRaw); }

  insertSnippet(code, label) {
    const sel = this.selObj();
    const key = sel.block ? INSERT_KEYS[sel.block.type] : null;
    if (key) {
      this.setProp(sel.block.id, key, (sel.block.props[key] || '') + (key === 'items' || key === 'data' ? '\n' : ' ') + code);
      this.flash(this.t('toast.snippetInserted', { name: label || this.t('toast.snippetDefaultLabel') }));
    } else {
      if (navigator.clipboard) navigator.clipboard.writeText(code);
      this.flash(this.t('toast.snippetCopied', { name: label || this.t('toast.snippetDefaultLabel') }));
    }
  }

  insertTag(token) { this.insertSnippet(TOKEN(token), TOKEN(token)); }

  // ---- host-facing API (setContent/getContent/etc. live on the element) ----

  /**
   * `setContent`. Normalized on the way in for the same reason the HTML path
   * is: a host's stored JSON may predate this build or have been assembled by
   * a backend that only wrote the fields it cared about. Sparse input used to
   * reach the renderer intact and fail later at export time.
   */
  loadDoc(input) {
    const doc = normalizeDoc(input);
    if (!doc) return;
    this.docSetByHost = true;
    this.setState({ doc, sel: null, history: this.state.history.concat(JSON.stringify(this.state.doc)), future: [] }, () => this.persist(doc));
  }
}
