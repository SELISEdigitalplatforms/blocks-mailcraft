import { icon } from '../core/icons.js';
import { TOKEN } from '../core/variables.js';
import { typeCommit } from './fields.js';

function el(tag, style, attrs) {
  const node = document.createElement(tag);
  if (style) Object.assign(node.style, style);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else if (v !== undefined) node.setAttribute(k, v);
  }
  return node;
}

function st(cmd) { try { return document.queryCommandState(cmd); } catch { return false; } }

/** Local equivalent of `mailcraft-editor.js`'s `tip()` -- this module doesn't import `elS`, so it builds the same `.mc-tooltip` markup directly. Every RTE control renders its tooltip above itself (`dir: 'up'`), since the toolbar already floats above the block it's editing. */
function tipRte(node, label) {
  node.style.position = 'relative';
  if (!node.hasAttribute('aria-label')) node.setAttribute('aria-label', label);
  node.appendChild(el('span', {}, { class: 'mc-rte-tooltip', text: label }));
  return node;
}

/** Humanizes a variable name for display (`first_name` -> `First name`) while the inserted/appended value always stays the exact `{{ token }}` -- display and data are kept deliberately separate. */
function humanize(v) {
  const s = String(v || '').replace(/[_.]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Ported from the original `rte(b)` -- the floating formatting toolbar shown above a focused rich-text block. */
export function renderRte(core, b) {
  const t = core.t;
  const btn = (name, title, fn, active) => {
    const node = el('button', {
      border: '0', borderRadius: '7px', background: active ? 'var(--ed-accent)' : 'transparent', color: active ? 'var(--ed-accent-ink)' : 'var(--rte-muted)',
      cursor: 'pointer', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none',
    }, { type: 'button', title, 'data-rte-control': '1', 'data-active': active ? 'true' : 'false' });
    node.appendChild(icon(name, 14));
    node.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    node.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation(); fn();
      if (core.onFormatChange) core.onFormatChange();
    });
    tipRte(node, title);
    return node;
  };
  const sep = () => el('span', { width: '1px', height: '18px', background: 'var(--rte-border)', margin: '0 4px', flex: 'none' });
  /** A native `<input type="color">` behind an icon + a thin current-color swatch bar -- `mousedown`'s `preventDefault` keeps the live text selection from collapsing before the picker opens, the same guard every other control here uses; `core.exec()`'s `savedRange` fallback (editor-core.js) covers the rest, since opening the OS color panel unavoidably moves focus away from the block regardless. */
  const colorPicker = (iconName, cmd, initial, title) => {
    const label = el('label', {
      position: 'relative', width: '30px', height: '28px', borderRadius: '7px', background: 'var(--rte-input)',
      boxShadow: 'inset 0 0 0 1px var(--rte-border)', color: 'var(--rte-text)', cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', overflow: 'hidden',
    }, { 'data-rte-picker': '1', title });
    label.appendChild(icon(iconName, 14));
    const swatch = el('span', { position: 'absolute', left: '6px', right: '6px', bottom: '4px', height: '3px', borderRadius: '99px', background: initial, pointerEvents: 'none' });
    label.appendChild(swatch);
    const input = el('input', { position: 'absolute', inset: '0', width: '100%', height: '100%', opacity: '0', margin: '0', cursor: 'pointer' }, { type: 'color', value: initial.startsWith('#') ? initial : '#1d1f20' });
    input.addEventListener('mousedown', (e) => e.stopPropagation());
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('input', (e) => { swatch.style.background = e.target.value; core.exec(cmd, e.target.value); });
    label.appendChild(input);
    tipRte(label, title);
    return label;
  };
  const rowStyle = { display: 'flex', alignItems: 'center', gap: '2px', whiteSpace: 'nowrap' };
  const selectStyle = {
    background: 'var(--rte-input)', color: 'var(--rte-text)', border: '1px solid var(--rte-border)', borderRadius: '7px',
    fontFamily: 'var(--ed-font)', fontSize: '10.5px', fontWeight: '500', letterSpacing: '0', padding: '5px 24px 5px 27px', height: '28px', cursor: 'pointer', maxWidth: '150px', appearance: 'none', WebkitAppearance: 'none', outline: 'none',
  };
  const selectControl = (label, value, width, iconName, options, onChange) => {
    const wrap = el('label', { position: 'relative', display: 'inline-flex', alignItems: 'center', color: 'var(--rte-muted)' }, { 'data-rte-select': '1', 'aria-label': label });
    const lead = el('span', { position: 'absolute', left: '8px', zIndex: '2', pointerEvents: 'none', display: 'flex' });
    lead.appendChild(icon(iconName, 13));
    const select = el('select', Object.assign({}, selectStyle, { width }), { title: label });
    options.forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; select.appendChild(o); });
    select.value = value;
    select.addEventListener('mousedown', (e) => e.stopPropagation());
    select.addEventListener('change', onChange);
    const tail = el('span', { position: 'absolute', right: '7px', pointerEvents: 'none', display: 'flex' });
    tail.appendChild(icon('chevronDown', 12));
    wrap.append(lead, select, tail);
    return wrap;
  };

  const vars = core.vars();
  const root = el('div', {
    position: 'absolute', top: '-82px', left: '0', zIndex: '30', display: 'grid', gap: '5px',
    background: 'var(--rte-bg)', border: '1px solid var(--rte-border)', borderRadius: '8px', padding: '7px 8px', boxShadow: 'var(--rte-shadow)',
  }, { class: 'mc-rte', 'data-mc-rte': '1', 'data-rte-root': '1' });
  // `rteActive` guards `blockCtx.onBlur` (canvas.js): the blur the edited
  // block fires when a toolbar control takes focus (a select opening, a color
  // input, the link field) must not end the edit. It used to be a one-way
  // latch here -- only `core.exec()` ever reset it -- so any toolbar
  // interaction that never reached exec (a dismissed dropdown, a cancelled
  // color dialog, a click on the toolbar's padding) left it stuck true, and
  // every later genuine blur was swallowed: the toolbar could no longer be
  // closed by clicking outside. The swallow is only needed for the blur fired
  // during this press's own mousedown, so release on the gesture's pointerup
  // (blur always precedes it); controls that need the guard past the gesture
  // re-arm it themselves (`exec`, `openLink`).
  root.addEventListener('pointerdown', () => {
    core.rteActive = true;
    const release = () => {
      core.rteActive = false;
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', release, true);
    };
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
  }, true);
  root.addEventListener('mousedown', (e) => e.stopPropagation());
  root.addEventListener('click', (e) => e.stopPropagation());

  const r1 = el('div', rowStyle);
  const fmt = selectControl(t('rte.textStyle'), core.currentTag(), '118px', 'typeColor',
    [['', t('rte.textStyle')], ['p', 'Paragraph'], ['h1', 'Heading 1'], ['h2', 'Heading 2'], ['h3', 'Heading 3'], ['h4', 'Heading 4'], ['h5', 'Heading 5'], ['h6', 'Small heading'], ['blockquote', 'Block quote']], (e) => {
    if (e.target.value) {
      core.exec('formatBlock', e.target.value);
      if (core.onFormatChange) core.onFormatChange();
    }
  });
  r1.append(
    fmt, sep(),
    btn('bold', 'Bold', () => core.exec('bold'), st('bold')),
    btn('italic', 'Italic', () => core.exec('italic'), st('italic')),
    btn('underline', 'Underline', () => core.exec('underline'), st('underline')),
    btn('strike', 'Strikethrough', () => core.exec('strikeThrough'), st('strikeThrough')),
    btn('inlineCode', 'Inline code', () => core.exec('insertHTML', '<code style="font-family:ui-monospace,monospace;font-size:0.92em;background:var(--ed-soft);padding:1px 4px">' + (core.getSelection().toString() || 'code') + '</code>')),
    btn('superscript', 'Superscript', () => core.exec('superscript'), st('superscript')),
    btn('subscript', 'Subscript', () => core.exec('subscript'), st('subscript')),
  );
  // Only where a size is actually rendered: `box` hardcodes 15px and `html`
  // sets no font-size at all, so on those two the ± pair moved nothing while
  // still persisting a junk `size` prop into the saved document, with the
  // readout counting up beside it.
  if (b.type === 'text' || b.type === 'heading') r1.append(
    sep(),
    btn('minus', 'Smaller text', () => core.size(b, -1)),
    // `selSize`, not `props.size`: with the caret inside a run the ± pair
    // sized on its own (core `sizeSelection`), the readout shows that run's
    // size -- the block prop no longer tells the whole story.
    el('span', { fontFamily: 'var(--ed-font)', fontSize: '9.5px', color: 'var(--rte-muted)', minWidth: '32px', textAlign: 'center' }, { text: core.selSize(b) + 'px' }),
    btn('plus', 'Larger text', () => core.size(b, 1)),
  );

  const r2 = el('div', rowStyle);
  r2.append(
    btn('alignLeft', 'Align left', () => core.exec('justifyLeft'), st('justifyLeft')),
    btn('alignCenter', 'Align center', () => core.exec('justifyCenter'), st('justifyCenter')),
    btn('alignRight', 'Align right', () => core.exec('justifyRight'), st('justifyRight')),
    btn('alignJustify', 'Justify', () => core.exec('justifyFull'), st('justifyFull')),
    sep(),
    btn('list', 'Bullet list', () => core.exec('insertUnorderedList'), st('insertUnorderedList')),
    btn('listOrdered', 'Numbered list', () => core.exec('insertOrderedList'), st('insertOrderedList')),
    btn('outdent', 'Outdent', () => core.exec('outdent')),
    btn('indent', 'Indent', () => core.exec('indent')),
    sep(),
    btn('link', 'Link — ⌘K', () => core.openLink(), !!core.state.linkDraft),
    btn('unlink', 'Remove link', () => core.removeLink(b)),
    btn('formatClear', t('rte.clearFormatting'), () => core.exec('removeFormat')),
    sep(),
    colorPicker('typeColor', 'foreColor', '#172033', t('rte.textColor')),
    colorPicker('highlighter', 'hiliteColor', '#fef08a', t('rte.highlightColor')),
    btn('eraser', t('rte.removeHighlight'), () => core.exec('hiliteColor', 'transparent')),
    sep(),
  );
  const varOptions = [['', vars.length ? t('rte.mergeTags') : t('rte.noMergeTags')]].concat(vars.map((v) => [TOKEN(v), humanize(v)]));
  r2.appendChild(selectControl(t('rte.mergeTags'), '', '132px', 'data', varOptions, (e) => {
    if (e.target.value) { core.exec('insertText', e.target.value); e.target.value = ''; }
  }));

  root.appendChild(r1);
  root.appendChild(r2);
  if (core.state.linkDraft) root.appendChild(linkPopover(core, b, vars));
  // The toolbar hangs a fixed 82px above the block, so on a block near the top
  // of the email it reaches past the top of the scrolling workspace -- which
  // clips it there, hiding the toolbar's first row under the header. When
  // there is no headroom, flip it to hang below the block instead.
  //
  // Placement needs layout, which doesn't exist until the node is mounted --
  // but deciding in a frame callback alone made the toolbar visibly jump from
  // its clipped spot to the flipped one, on first open and again on every
  // rebuild while editing (each replaceWith reset it above, then hopped).
  // So the last decision is cached per block and applied synchronously on
  // rebuilds, and only the first build for a block spends one frame hidden
  // while it measures -- the toolbar then appears already in place.
  const BELOW = 'calc(100% + 10px)';
  const cached = core._rteFlip && core._rteFlip.id === b.id ? core._rteFlip.flip : null;
  if (cached === true) root.style.top = BELOW;
  else if (cached === null) root.style.visibility = 'hidden';
  requestAnimationFrame(() => {
    if (!root.isConnected) return;
    const scroller = core.exportRoot && core.exportRoot.querySelector('.mc-workspace');
    if (scroller && root.parentElement) {
      // Judged from the block's own position, not the toolbar's current one,
      // so an already-flipped toolbar can flip back once headroom returns.
      const wouldBeTop = root.parentElement.getBoundingClientRect().top - 82;
      const flip = wouldBeTop < scroller.getBoundingClientRect().top + 4;
      core._rteFlip = { id: b.id, flip };
      root.style.top = flip ? BELOW : '-82px';
    }
    root.style.visibility = '';
  });
  return root;
}

/** Ported from the original `linkPopover(b, vars)`. */
function linkPopover(core, b, vars) {
  const t = core.t;
  const d = core.state.linkDraft;
  const set = (patch) => core.setState({ linkDraft: Object.assign({}, core.state.linkDraft, patch) });
  const inputStyle = {
    flex: '1', minWidth: '0', background: 'var(--rte-input)', color: 'var(--rte-text)', border: '1px solid var(--rte-border)', borderRadius: '5px',
    font: 'inherit', fontFamily: 'ui-monospace, monospace', fontSize: '11px', padding: '5px 7px',
  };
  const act = (label, primary, onClick) => {
    const node = el('button', {
      border: primary ? '0' : '1px solid var(--rte-border)', borderRadius: '5px', background: primary ? 'var(--ed-accent)' : 'transparent',
      color: primary ? 'var(--ed-accent-ink)' : 'var(--rte-text)', cursor: 'pointer', padding: '5px 10px',
      fontFamily: 'var(--ed-font)', fontSize: '10.5px', fontWeight: '600',
    }, { type: 'button', text: label });
    node.addEventListener('mousedown', (e) => e.preventDefault());
    node.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
    return node;
  };

  const root = el('div', { display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px solid var(--rte-border)', paddingTop: '6px', marginTop: '2px', minWidth: '380px' });

  const r = el('div', { display: 'flex', alignItems: 'center', gap: '5px' });
  const input = el('input', inputStyle, { placeholder: 'https://example.com' });
  input.value = d.href;
  // `openLink()` (editor-core.js) arms `rteActive` so the block blur this
  // focus steal fires is swallowed; the blur is synchronous inside `focus()`,
  // so releasing right after keeps the guard from outliving its one job
  // (stuck true, it made every later blur -- and so click-outside-to-close --
  // dead, e.g. after cancelling the popover with Escape).
  setTimeout(() => { input.focus(); core.rteActive = false; }, 0);
  // Debounced (typeCommit): each draft update re-renders everything. Flushed
  // explicitly before applyLink -- both Enter and the Apply button (which
  // suppresses blur on mousedown to keep the text selection) read the draft
  // from state, so a pending keystroke commit must land first.
  const hrefCommit = typeCommit((v) => set({ href: v }));
  input.addEventListener('input', (e) => hrefCommit.call(e.target.value));
  input.addEventListener('blur', () => hrefCommit.flush());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); hrefCommit.flush(); core.applyLink(b); }
    if (e.key === 'Escape') core.setState({ linkDraft: null });
  });
  r.appendChild(input);
  if (vars.length) {
    const sel = el('select', { background: 'var(--rte-input)', color: 'var(--rte-text)', border: '1px solid var(--rte-border)', borderRadius: '5px', fontFamily: 'var(--ed-font)', fontSize: '10.5px', padding: '4px', cursor: 'pointer', maxWidth: '110px' }, { title: t('rte.mergeTags') });
    const ph = document.createElement('option'); ph.value = ''; ph.textContent = t('rte.mergeTags'); sel.appendChild(ph);
    vars.forEach((v) => { const o = document.createElement('option'); o.value = TOKEN(v); o.textContent = humanize(v); sel.appendChild(o); });
    sel.addEventListener('change', (e) => { if (e.target.value) { set({ href: (d.href || '') + e.target.value }); e.target.value = ''; } });
    r.appendChild(sel);
  }
  root.appendChild(r);

  const r2 = el('div', { display: 'flex', alignItems: 'center', gap: '8px' });
  const label = el('label', { display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--rte-muted)', fontFamily: 'var(--ed-font)', fontSize: '10.5px', fontWeight: '500', cursor: 'pointer' });
  const cb = el('input', { accentColor: 'var(--ed-accent)', cursor: 'pointer' }, { type: 'checkbox' });
  cb.checked = !!d.blank;
  cb.addEventListener('change', (e) => set({ blank: e.target.checked }));
  label.append(cb, 'Open in new tab');
  r2.appendChild(label);
  r2.appendChild(el('span', { flex: '1' }));
  if (d.editing) r2.appendChild(act('Remove', false, () => core.removeLink(b)));
  r2.appendChild(act('Cancel', false, () => core.setState({ linkDraft: null })));
  r2.appendChild(act(d.editing ? 'Update' : 'Apply', true, () => { hrefCommit.flush(); core.applyLink(b); }));
  root.appendChild(r2);

  return root;
}
