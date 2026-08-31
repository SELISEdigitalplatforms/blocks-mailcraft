import { DEF } from '../core/blocks.js';
import { boxStyle, rowBg, rowPad, colsWrap, colStyle } from '../core/layout-style.js';
import { scopeCss } from '../core/sanitize.js';
import { cellsOf } from '../core/parse.js';
import { icon } from '../core/icons.js';
import { blockBody } from './block-body.js';
import { renderRte } from './rte.js';

function el(tag, style, attrs) {
  const node = document.createElement(tag);
  if (style) Object.assign(node.style, style);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else if (v !== undefined) node.setAttribute(k, v);
  }
  return node;
}

/**
 * Ported from `dropLine(active, key)`, but decoupled from React/state: the
 * original re-rendered the whole tree on every `dragover` (cheap for React,
 * since its reconciler patches only the one changed node); this renderer has
 * no diffing, so doing the same would rebuild the entire canvas on every
 * pixel of mouse movement while dragging -- exactly what made drag-and-drop
 * (and hover, below) feel un-smooth. Instead, drop lines are built once per
 * render and toggled directly via `showLine`/`hideActive`, with no state
 * change and no re-render involved.
 */
function dropLine() {
  return el('div', { height: '0', background: 'var(--ed-accent-sheet)', margin: '0', transition: 'height 0.1s', boxShadow: 'none' });
}

function showLine(tracker, line) {
  if (tracker.active && tracker.active !== line) hideLine(tracker.active);
  line.style.height = '3px'; line.style.margin = '3px 0'; line.style.boxShadow = '0 0 0 1px var(--ed-accent-sheet)';
  tracker.active = line;
}

function hideLine(line) {
  line.style.height = '0'; line.style.margin = '0'; line.style.boxShadow = 'none';
}

function hideActive(tracker) {
  if (tracker.active) { hideLine(tracker.active); tracker.active = null; }
}

/** Ported from `toolbar(id, kind, code)` -- the small floating control shown on the selected row/block. */
function toolbar(core, id, kind, code) {
  const btn = (name, title, fn, danger) => {
    const node = el('button', { position: 'relative', border: '0', background: 'transparent', color: danger ? '#ffdad8' : '#fff', cursor: 'pointer', width: '23px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center' }, { type: 'button', title, 'aria-label': title, 'data-tip': '1' });
    node.appendChild(icon(name, 13));
    node.appendChild(el('span', {}, { class: 'mc-tooltip mc-tooltip-up', text: title }));
    node.addEventListener('mousedown', (e) => e.stopPropagation());
    node.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    return node;
  };
  // --ed-accent-sheet, not --ed-accent, on purpose: this pill sits on the
  // canvas/email sheet, which stays the document's own light page regardless
  // of editor chrome dark mode. The sheet family is the brand accent fitted
  // against white (core/accent.js), so it keeps its contrast in both chrome
  // themes -- while still following a host's `accent`.
  const root = el('div', { position: 'absolute', top: '-12px', right: '6px', display: 'flex', alignItems: 'center', gap: '1px', background: kind === 'row' ? '#172033' : 'var(--ed-accent-sheet)', borderRadius: '6px', padding: '2px 3px', zIndex: '6', boxShadow: '0 3px 10px rgba(15,23,42,0.28)' });
  root.appendChild(el('span', { fontFamily: 'ui-monospace,monospace', fontSize: '8.5px', letterSpacing: '0.14em', color: kind === 'row' ? '#fff' : 'var(--ed-accent-sheet-ink)', opacity: '0.7', padding: '0 5px' }, { text: code }));
  root.appendChild(btn('up', 'Move up', () => core.nudge(id, -1)));
  root.appendChild(btn('down', 'Move down', () => core.nudge(id, 1)));
  root.appendChild(btn('copy', 'Duplicate', () => { core.setState({ sel: { type: kind, id } }, () => core.dupSel()); }));
  root.appendChild(btn('trash', 'Delete', () => { core.setState({ sel: { type: kind, id } }, () => core.delSel()); }, true));
  return root;
}

/**
 * Selected-row controls: square accent buttons pinned inside the row's
 * top-right corner (delete + duplicate; reordering is the left drag badge).
 * On --ed-accent-sheet like `toolbar` above and for the same reason: the
 * email sheet stays a light page in both chrome themes, and a dark-chrome
 * `--ed-accent` -- light enough to read on the dark panels -- would wash out
 * against it.
 */
function rowActions(core, id) {
  const btn = (name, title, fn) => {
    const node = el('button', { position: 'relative', border: '0', background: 'var(--ed-accent-sheet)', color: 'var(--ed-accent-sheet-ink)', cursor: 'pointer', width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', boxShadow: '0 2px 6px rgba(15,23,42,0.3)' }, { type: 'button', title, 'aria-label': title, 'data-tip': '1' });
    node.appendChild(icon(name, 14));
    node.appendChild(el('span', {}, { class: 'mc-tooltip mc-tooltip-up', text: title }));
    node.addEventListener('mousedown', (e) => e.stopPropagation());
    node.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    return node;
  };
  const root = el('div', { position: 'absolute', top: '6px', right: '6px', display: 'flex', gap: '4px', zIndex: '6' });
  root.appendChild(btn('trash', 'Delete', () => { core.setState({ sel: { type: 'row', id } }, () => core.delSel()); }));
  root.appendChild(btn('copy', 'Duplicate', () => { core.setState({ sel: { type: 'row', id } }, () => core.dupSel()); }));
  return root;
}

function blockCtx(core, editingBlockId) {
  return {
    editingId: editingBlockId,
    now: core.state.now,
    scopeCss,
    iconProvider: core.iconProvider,
    rteActiveRef: { get current() { return core.rteActive; } },
    // Also sets `sel` (not just `editing`): a real click both focuses the
    // contenteditable and fires a `click` on the wrapping block that would
    // normally call `core.select`. But focus's own setState already forces a
    // full canvas re-render (see focus-preserve.js), which replaces every
    // block's DOM node -- including the one mousedown/mouseup/click are
    // mid-gesture on -- so the browser drops that click (its target vanished
    // between mousedown and mouseup) and `core.select` never runs. Setting
    // `sel` here directly is what used to happen implicitly once the click
    // landed; without it, the block never shows selected (no border, no
    // duplicate/delete/move corner toolbar) even though the RTE toolbar,
    // which only depends on `editing`, still appears.
    // Guarded to a no-op once state already matches: restoring focus after a
    // rebuild (focus-preserve.js) calls `.focus()` on the freshly-created
    // node, which fires this same `focus` listener again. Without the guard
    // that re-fires `setState` -> re-render -> `.focus()` -> `setState` -> ...
    // forever (an infinite, stack-overflowing loop).
    onFocus: (block, node, key, isPlainText) => {
      core.editEl = node;
      core.editKey = key;
      core.editPlain = !!isPlainText;
      if (core.state.editing === block.id && core.state.sel && core.state.sel.type === 'block' && core.state.sel.id === block.id) return;
      // Snapshotted only on a genuine new focus (not the guarded no-op above,
      // which also covers every re-render-triggered refocus while typing --
      // see `syncLiveEdit`, mailcraft-editor.js). That sync keeps
      // `block.props[key]` continuously equal to the live DOM so re-renders
      // stop reverting what's mid-typing, which means by the time a real
      // blur fires, `value !== block.props[key]` is always false and the
      // edit would never commit (no undo entry, no autosave). Comparing
      // against the true pre-edit value captured here instead of the
      // continuously-synced prop is what makes onBlur's change check correct.
      core.editOriginal = block.props[key];
      core.setState({ editing: block.id, sel: { type: 'block', id: block.id }, tab: 'design' });
    },
    onBlur: (block, key, value) => {
      // A render tears down and rebuilds the whole canvas subtree (no diffing --
      // see the `dropLine` comment above); removing the still-focused node as
      // part of that forces a synchronous, spurious `blur` before the rebuilt
      // replacement can be focused. Committing on that blur (and worse, its
      // `editing: null` racing the render that's still in progress) is what
      // produced the onFocus <-> render infinite loop above -- `core.rendering`
      // (set for the render()'s duration, see mailcraft-editor.js) tells a real
      // blur apart from that artifact.
      if (core.rendering) return;
      if (core.rteActive) return;
      if (value !== core.editOriginal) core.setProp(block.id, key, value);
      if (core.state.editing === block.id) core.setState({ editing: null, linkDraft: null });
    },
    onPaste: (e, plainOnly) => core.pasteClean(plainOnly)(e),
    // Guarded to a no-op when already selected -- the selection re-render
    // refocuses the cell (focus-preserve), which fires `focus` again.
    selectBlock: (block) => {
      if (core.state.sel && core.state.sel.type === 'block' && core.state.sel.id === block.id) return;
      core.select('block', block.id);
    },
    onTableCellBlur: (block, ri, ci, val) => {
      const next = cellsOf(core.find(core.state.doc, block.id).block.props);
      if (next[ri] && next[ri][ci] !== val) { next[ri][ci] = val; core.setProp(block.id, 'data', next.map((r) => r.join('|')).join('\n')); }
    },
    renderRte: (block) => renderRte(core, block),
  };
}

/** Ported from `renderDoc(live)`. `live=true` is the editable canvas, `live=false` is the static preview/export tree. */
export function renderDoc(core, live) {
  const d = core.state.doc; const theme = d.theme;
  const width = core.state.device === 'mobile' ? 375 : theme.width;
  const sel = core.state.sel;
  const ctx = blockCtx(core, core.state.editing);
  // Lives only for this render's drag gesture(s) -- no core state, no re-render.
  const rowDropTracker = { active: null };

  // `dir="ltr"` pins the sheet to the document's own direction. The editor
  // chrome mirrors under an RTL locale (`dir=rtl` on `#mc`), but the email
  // being built is a separate document: exportHtml emits no `dir`, so mail
  // clients render it LTR -- letting the chrome's direction cascade in here
  // flipped bidi punctuation and default alignment on the canvas and made it
  // disagree with the exported result.
  const radius = Number(theme.radius) || 0;
  const borderW = Number(theme.borderW) || 0;
  const root = el('div', {
    width: width + 'px', maxWidth: '100%', background: theme.contentBg || 'transparent', color: theme.text, fontFamily: theme.font,
    // Only when the document actually asks for a shape: an unconditional
    // `0px` would override the editor chrome's own soft corner on the sheet
    // (style.js) and square off every template that never touched the field.
    borderRadius: radius ? radius + 'px' : '',
    // Same contract for the full content-area border: set only when asked,
    // so the chrome's own subtle frame keeps marking the sheet otherwise.
    border: borderW ? borderW + 'px ' + (theme.borderStyle || 'solid') + ' ' + (theme.borderColor || '#e2e2e5') : '',
    // And for the canvas-wide drop shadow -- unset keeps the chrome's own.
    boxShadow: theme.shadow || '',
    // Clipping the rows to that corner is right for the sent email (export
    // emits `overflow:hidden` alongside the radius) and for the static
    // preview, but not for the editable canvas: the sheet is also what the
    // row grip straddles and what the floating RTE toolbar overhangs
    // (top:-82px on the first block), and hiding the overflow cuts both off.
    overflow: !live && radius ? 'hidden' : '',
    transition: 'width 0.28s cubic-bezier(0.22,0.61,0.36,1), background 0.2s, border-radius 0.2s',
  }, { 'data-mc-sheet': '1', dir: 'ltr' });

  /*
   * The page: the full-width section the email sits on, painted from the
   * document's own `bg`/`padY`/`padX` rather than left to the workspace
   * chrome. It is the band a mail client shows around the content column --
   * the one part of the template that used to exist only in the exported
   * HTML, so changing its colour did nothing visible in the editor and its
   * size could not be changed at all. With the padding at its 0 default the
   * page hugs the sheet exactly and nothing about the canvas changes.
   */
  const padY = Number(theme.padY) || 0;
  const padX = Number(theme.padX) || 0;
  const page = el('div', {
    background: theme.bg || 'transparent',
    padding: padY + 'px ' + padX + 'px',
    boxSizing: 'border-box', maxWidth: '100%', display: 'flex', justifyContent: 'center',
    transition: 'background 0.2s, padding 0.22s cubic-bezier(0.22,0.61,0.36,1)',
    // `is-padded` is what moves the editor's frame outward (style.js): with
    // no padding the page hugs the sheet exactly, so the sheet keeps the
    // frame and an untouched canvas looks exactly as it always did.
  }, { 'data-mc-page': '1', class: 'mc-page' + (padY || padX ? ' is-padded' : ''), dir: 'ltr' });

  const rowLines = [];
  if (live) {
    // On the page, not the sheet: a drag held over the page padding is still
    // aimed at the template, and these fire for the sheet's own events too
    // (they bubble). Column drops stop propagation before they get here, as
    // they did when these listeners sat on the sheet.
    page.addEventListener('dragover', (e) => {
      const dr = core.drag; if (!dr) return;
      e.preventDefault();
      const index = core.indexFromPoint(root, e.clientY);
      showLine(rowDropTracker, rowLines[index]);
    });
    page.addEventListener('dragleave', (e) => { if (e.target === root || e.target === page) hideActive(rowDropTracker); });
    // Measured against `root`, exactly as the line above it was: the slots are
    // the sheet's children, not the page's, and deriving the index a second
    // time from the event's own target is what used to send every dropped
    // section to index 0 while the line sat where the pointer actually was.
    page.addEventListener('drop', (e) => { hideActive(rowDropTracker); core.canvasDrop(e, core.indexFromPoint(root, e.clientY)); });
  }

  d.rows.forEach((r, ri) => {
    if (live) { const line = dropLine(); rowLines.push(line); root.appendChild(line); }
    const isSel = live && sel && sel.id === r.id;

    const rowEl = el('div', Object.assign({ position: 'relative', padding: rowPad(r.props) }, rowBg(r.props)), { 'data-mc-slot': '1', class: live ? `mc-row-el${isSel ? ' is-selected' : ''}` : undefined });
    if (live) {
      rowEl.addEventListener('click', (e) => { e.stopPropagation(); core.select('row', r.id); });
    }
    if (isSel) rowEl.appendChild(rowActions(core, r.id));
    if (live) {
      // The grab target is the row's whole left edge, not just the visible
      // badge. Two reasons, both about `:hover`: the strip overlaps the row's
      // own left edge (it straddles the border so the round badge can sit
      // centered on it), because a gap there would be dead space between the
      // row's hover box and the grip's -- crossing it drops `:hover` on
      // `.mc-row-el` and hides the grip (display:none, see style.js) right as
      // the cursor arrives. And it spans the row's full height, because a
      // short handle pinned to the top has the same failure one axis over: on
      // a tall row, moving left from anywhere below the handle exits the row
      // before reaching it, so the grip blinks out and the section simply
      // cannot be picked up. The badge stays small; only the hit area grew.
      const grip = el('div', { position: 'absolute', left: '-14px', top: '0', bottom: '0', width: '28px', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'grab', zIndex: '6' }, { draggable: 'true', title: 'Drag to reorder section', 'aria-label': 'Drag to reorder section', class: 'mc-row-grip' });
      const gripHandle = el('div', { display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', width: '28px', height: '28px', borderRadius: '50%' }, { class: 'mc-row-grip-handle' });
      gripHandle.appendChild(icon('move', 15));
      grip.appendChild(gripHandle);
      grip.addEventListener('dragstart', core.startDrag({ kind: 'move-row', id: r.id }));
      grip.addEventListener('dragend', () => { core.drag = null; hideActive(rowDropTracker); });
      grip.addEventListener('click', (e) => { e.stopPropagation(); core.select('row', r.id); });
      rowEl.appendChild(grip);
    }

    /*
     * The mobile preview lays out exactly the way the sent email does. The
     * device switch used to do nothing but narrow the sheet to 375px, so a
     * 4-column row previewed as four 60px slivers -- a layout no recipient
     * would ever see, since the exported stylesheet collapses that row below
     * the content width. Previewing the wide layout at a narrow width was
     * showing a page that does not exist.
     *
     * The three modes mirror `mobilePlan` in core/export.js: one-up stack,
     * two-up grid, or the desktop layout kept as-is. Reverse flips the order,
     * which is why this uses flex here too -- the same mechanism the media
     * query uses, so the preview cannot drift from the output.
     */
    const mobile = core.state.device === 'mobile' && r.cols.length > 1;
    const mMode = r.props.mobileCols === undefined ? 1 : r.props.mobileCols;
    const stacked = mobile && mMode !== 'keep';
    const twoUp = stacked && String(mMode) === '2';
    const reversed = stacked && r.props.mobileOrder === 'reverse';
    const colsEl = el('div', stacked
      ? (twoUp || reversed
        ? {
          display: 'flex',
          flexWrap: twoUp && reversed ? 'wrap-reverse' : 'wrap',
          flexDirection: twoUp ? (reversed ? 'row-reverse' : 'row') : (reversed ? 'column-reverse' : 'column'),
        }
        : { display: 'block' })
      : colsWrap(r.props));
    r.cols.forEach((c, ci) => {
      const colLines = [];
      const items = [];
      c.blocks.forEach((b, bi) => {
        /*
         * Device visibility. In the static preview -- the honest picture of
         * what is sent -- a block the current device would not receive is not
         * drawn at all, matching the exported `.mc-only-d` / `.mc-only-m`
         * rules. On the editable canvas it is drawn faded instead: hiding it
         * outright would leave the user with a block they cannot select,
         * move or set back to "all devices".
         */
        const hiddenHere = b.props.vis === (core.state.device === 'mobile' ? 'desktop' : 'mobile');
        if (!live && hiddenHere) return;
        if (live) { const line = dropLine(); colLines.push(line); items.push(line); }
        const bSel = live && sel && sel.id === b.id;
        const bWrap = el('div', Object.assign({ position: 'relative', opacity: hiddenHere ? '0.4' : '' }, boxStyle(b.props)), { 'data-mc-slot': '1', draggable: live ? 'true' : undefined, class: live ? `mc-block-el${bSel ? ' is-selected' : ''}` : undefined });
        if (live) {
          bWrap.addEventListener('dragstart', core.startDrag({ kind: 'move-block', id: b.id }));
          bWrap.addEventListener('dragend', () => { core.drag = null; hideActive(rowDropTracker); hideActive(colTracker); });
          bWrap.addEventListener('click', (e) => { e.stopPropagation(); core.select('block', b.id); });
          // WebKit gives a `draggable="true"` ancestor priority over the
          // selection machinery: a mousedown anywhere inside this wrapper is
          // taken as the start of an element drag, so in Safari a double-click
          // on block text never selects the word and pressing and sweeping
          // across it never extends a selection. (Chromium and Gecko both
          // special-case contenteditable descendants; WebKit does not.)
          // Dropping the attribute for the length of a gesture that begins
          // inside editable text hands those mousedowns back to the caret;
          // restoring it on mouseup keeps drag-to-reorder working from every
          // other part of the block -- including its padding, which is what a
          // block is normally picked up by.
          bWrap.addEventListener('mousedown', (e) => {
            const target = e.target;
            if (!target || target.nodeType !== 1 || !target.closest('[contenteditable="true"]')) return;
            bWrap.draggable = false;
            const view = bWrap.ownerDocument.defaultView;
            if (view) view.addEventListener('mouseup', () => { bWrap.draggable = true; }, { once: true });
          });
        }
        // Not while this block is being inline-edited: the pill sits at the
        // block's top-right, flush against the floating RTE toolbar's bottom
        // edge -- visually colliding with it, and putting its Delete button a
        // few pixels from the RTE's own controls. The RTE stands in for it for
        // the duration of the edit; it comes back on blur (still selected).
        if (bSel && ctx.editingId !== b.id) bWrap.appendChild(toolbar(core, b.id, 'block', DEF(b.type).code));
        bWrap.appendChild(blockBody(b, theme, live, ctx));
        items.push(bWrap);
      });
      let colTracker;
      if (live) {
        const endLine = dropLine(); colLines.push(endLine); items.push(endLine);
        colTracker = { active: null };
      }
      if (live && !c.blocks.length) {
        items.push(el('div', { border: '1px dashed var(--ed-accent-sheet-line)', borderRadius: 'var(--ed-radius-sm)', color: 'var(--ed-faint)', fontFamily: 'ui-monospace,monospace', fontSize: '9.5px', letterSpacing: '0.14em', textTransform: 'uppercase', padding: '24px 8px', textAlign: 'center' }, { text: 'drop block' }));
      }
      // Stacked, a column is simply a full-width block -- the flex sizing and
      // the horizontal gutter both belong to the side-by-side layout only.
      // Two-up takes half, box-sized so its own padding cannot push it over
      // the line and wrap every cell onto a row of its own.
      const colEl = el('div', stacked
        ? (twoUp ? { flex: '0 0 50%', maxWidth: '50%', boxSizing: 'border-box' } : { width: '100%' })
        : colStyle(r.props, c));
      // Column-level styling lives on an inner wrapper, not on colEl itself:
      // colEl's padding is the inter-column gutter (colStyle), and a painted
      // background must stop at the column's visual edge, not bleed across
      // the gutter. `host` is also what the drag listeners and
      // `indexFromPoint` must use -- the block slots are its children.
      const styled = c.bg || c.border || c.radius || c.padY || c.padX;
      const host = styled
        ? el('div', { background: c.bg || 'transparent', border: c.border ? c.border + 'px ' + (c.borderStyle || 'solid') + ' ' + (c.lineColor || '#e2e2e5') : '0', borderRadius: (c.radius || 0) + 'px', padding: (c.padY || 0) + 'px ' + (c.padX || 0) + 'px', height: '100%', boxSizing: 'border-box' })
        : colEl;
      if (live) {
        host.addEventListener('dragover', (e) => {
          const dr = core.drag; if (!dr) return;
          e.preventDefault(); e.stopPropagation();
          if (dr.kind === 'row' || dr.kind === 'move-row') return;
          const index = core.indexFromPoint(host, e.clientY);
          showLine(colTracker, colLines[index]);
        });
        host.addEventListener('dragleave', (e) => { if (e.target === host) hideActive(colTracker); });
        host.addEventListener('drop', (e) => {
          e.stopPropagation();
          hideActive(colTracker);
          core.colDrop(r.id, ci)(e);
        });
      }
      items.forEach((it) => host.appendChild(it));
      if (host !== colEl) colEl.appendChild(host);
      colsEl.appendChild(colEl);
    });
    rowEl.appendChild(colsEl);
    root.appendChild(rowEl);
  });

  if (live) { const line = dropLine(); rowLines.push(line); root.appendChild(line); }
  if (live && !d.rows.length) {
    root.appendChild(el('div', { border: '1px dashed var(--ed-accent-sheet-line)', padding: '90px 20px', textAlign: 'center', fontFamily: 'ui-monospace,monospace', fontSize: '10.5px', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ed-faint)' }, { text: 'drag a row or block here' }));
  }

  page.appendChild(root);
  return page;
}
