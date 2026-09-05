import { icon } from '../core/icons.js';
import { transcodeShot } from './screenshot.js';

/**
 * Story-style screenshot viewer: the PNG that `render/screenshot.js` produces
 * is a single very tall image, which is exactly the wrong shape for a modal.
 * Rather than hand the user a file and hope they open it, this pages through
 * the capture the way a phone story does -- a segmented progress rail, one
 * screen at a time, auto-advancing -- so the whole template can be reviewed
 * in place. Downloading becomes one of the actions under the card instead of
 * the only thing the button does.
 *
 * Everything animates on `transform`/`opacity` alone (never a
 * layout-affecting property), which is what keeps the advance smooth even on
 * a very long template.
 *
 * The viewer owns no core state: it is opened imperatively and revokes its
 * own object URL, so a re-render of the editor underneath never disturbs it.
 */

/** How long one screen holds before advancing. */
const PAGE_MS = 3600;
/** Slide duration between screens -- long enough to read as a scroll, short enough not to drag. */
const SLIDE_MS = 560;
/**
 * Each advance moves 92% of a card height, not 100%: the repeated sliver of
 * the previous screen is what makes the jump legible as "further down the
 * same email" rather than a cut to an unrelated image.
 */
const STEP = 0.92;

/**
 * What the download format toggle cycles through. The capture itself is
 * always PNG (lossless preview, and the clipboard accepts nothing else);
 * a lossy pick re-encodes that one capture at download time. Format
 * acronyms are proper names, so the labels are not translated.
 */
const FORMATS = [
  { id: 'png', label: 'PNG' },
  { id: 'jpeg', label: 'JPG' },
  { id: 'webp', label: 'WEBP' },
];

function el(tag, css, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  if (css) node.style.cssText = css;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) continue;
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  kids.flat().forEach((c) => { if (c != null && c !== false) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
  return node;
}

const GHOST = "border: 1px solid rgba(255,255,255,0.22); background: rgba(255,255,255,0.1); color: #fff; cursor: pointer; height: 30px; border-radius: 8px; display: flex; align-items: center; justify-content: center; gap: 7px; font-family: var(--ed-font); font-size: 11.5px; font-weight: 600; transition: background 0.16s, border-color 0.16s, opacity 0.16s;";

function ghostBtn(css, label, iconName, onClick, withText) {
  const btn = el('button', GHOST + css, { type: 'button', title: label, 'aria-label': label });
  btn.iconSlot = icon(iconName, 14);
  btn.labelSlot = withText ? el('span', '', { text: label }) : null;
  btn.append(btn.iconSlot);
  if (btn.labelSlot) btn.append(btn.labelSlot);
  btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(255,255,255,0.16)'; btn.style.borderColor = 'rgba(255,255,255,0.4)'; });
  btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(255,255,255,0.07)'; btn.style.borderColor = 'rgba(255,255,255,0.22)'; });
  btn.addEventListener('click', onClick);
  return btn;
}

/**
 * `hooks.capture()` -> Promise<Blob>, called on open and on retry;
 * `hooks.download(blob)` and `hooks.copy(blob)` run the host's own save and
 * clipboard flows so the toasts stay consistent with the rest of the editor.
 *
 * (`export const` + function expression, not `export function`: build.js's
 * transform only recognizes `export (const|function|class)` -- either form
 * works, and this file follows screenshot.js.)
 */
export const createStoryViewer = function (core, hooks) {
  const t = (key, params) => core.t(key, params);

  const s = {
    open: false, page: 0, pages: 1, playing: true, done: false, held: false,
    remaining: PAGE_MS, startedAt: 0, timer: 0, token: 0,
    url: '', blob: null, natW: 0, natH: 0, cardW: 0, cardH: 0, showH: 0,
    format: 0, saving: false,
  };

  // ---- chrome -----------------------------------------------------------

  // Dim only, no backdrop blur -- a full-screen blur is a many-frame stall on
  // weak GPUs each time the overlay fades in; the deeper dim carries the focus.
  const overlay = el('div', 'position: absolute; inset: 0; z-index: 78; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 11px; padding: 22px; box-sizing: border-box; background: rgba(9,11,16,0.86); opacity: 0; transition: opacity 0.22s ease;', { class: 'mc-story' });
  // Clicking the dark surround closes; clicks on the card are the tap zones'
  // business and must not fall through to here.
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  const rail = el('div', 'display: none; gap: 4px; height: 3px; flex: none;');
  const headRow = el('div', 'display: flex; align-items: center; gap: 10px; flex: none;');
  const headText = el('div', 'flex: 1; min-width: 0;');
  const kickerEl = el('div', 'font-family: ui-monospace, monospace; font-size: 8.5px; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(255,255,255,0.5);');
  // The capture's dimensions and page position live under the kicker, where a
  // full header line keeps them legible -- squeezed into the footer next to
  // the buttons they ellipsized on any card narrow enough to matter.
  const metaEl = el('div', 'display: none; margin-top: 4px; font-family: ui-monospace, monospace; font-size: 9px; letter-spacing: 0.09em; color: rgba(255,255,255,0.42); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;');
  headText.append(kickerEl, metaEl);
  const closeBtn = ghostBtn('width: 30px; padding: 0;', t('action.close'), 'x', () => close());
  headRow.append(headText, closeBtn);

  const card = el('div', 'position: relative; overflow: hidden; border-radius: 16px; background: #fff; flex: none; box-shadow: 0 26px 70px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.09); transform: scale(0.965) translateY(10px); opacity: 0; transition: transform 0.34s cubic-bezier(0.22,0.61,0.36,1), opacity 0.24s ease;');
  const shot = el('img', 'position: absolute; left: 0; top: 0; width: 100%; display: block; opacity: 0; transform: translate3d(0,0,0); transition: opacity 0.32s ease;', { alt: '' });
  card.appendChild(shot);

  // Skeleton: shown while the capture renders and cross-faded out when the
  // image arrives, so the card never flashes empty or resizes under the eye.
  const skeleton = el('div', 'position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 11px; background: var(--ed-panel); color: var(--ed-faint); transition: opacity 0.28s ease;');
  const shimmer = el('div', 'position: absolute; inset: 0; background: linear-gradient(100deg, transparent 22%, var(--ed-soft) 40%, transparent 58%); background-size: 260% 100%; animation: mcStoryShimmer 1.6s linear infinite;');
  const skelText = el('div', 'position: relative; font-family: var(--ed-font); font-size: 12.5px; font-weight: 600; color: var(--ed-text);');
  const skelHint = el('div', 'position: relative; font-family: ui-monospace, monospace; font-size: 9.5px; letter-spacing: 0.07em; line-height: 1.7; color: var(--ed-faint); max-width: 76%; text-align: center;');
  const retryBtn = el('button', 'position: relative; display: none; border: 1px solid var(--ed-line); background: transparent; color: var(--ed-text); cursor: pointer; height: 30px; padding: 0 13px; border-radius: 8px; align-items: center; gap: 7px; font-family: var(--ed-font); font-size: 11.5px; font-weight: 600;', { type: 'button' });
  retryBtn.append(icon('refresh', 14), el('span', '', { text: t('story.retry') }));
  retryBtn.addEventListener('click', () => load());
  skeleton.append(shimmer, skelText, skelHint, retryBtn);
  card.appendChild(skeleton);

  // Tap zones, story grammar: the left third steps back, the rest forward.
  // A press-and-hold pauses and resumes on release, so `pointerdown` starts
  // the pause and only a short press counts as a navigating tap.
  const zone = (css, onTap) => {
    const z = el('div', 'position: absolute; top: 0; bottom: 0; ' + css + ' cursor: pointer;');
    let downAt = 0;
    z.addEventListener('pointerdown', () => { downAt = performance.now(); if (s.playing && !s.done) pause(true); });
    const up = () => {
      if (!downAt) return;
      const held = performance.now() - downAt;
      downAt = 0;
      if (held < 220) onTap();
      else if (s.held) play();
    };
    z.addEventListener('pointerup', up);
    z.addEventListener('pointerleave', up);
    return z;
  };
  card.append(
    zone('left: 0; width: 32%;', () => step(-1)),
    zone('left: 32%; right: 0;', () => step(1)),
  );

  // One floating action bar with a real hierarchy: Download is the solid
  // primary, Copy a quiet neighbour, play/pause a small transport control,
  // and the format is a segmented PNG/JPG/WEBP picker -- all three values
  // visible with the active one lit, instead of a chip that cycles blind.
  const footer = el('div', 'display: flex; align-items: center; justify-content: center; flex: none;');
  const BAR_BTN = 'border: none; background: transparent; color: rgba(255,255,255,0.92); cursor: pointer; height: 34px; border-radius: 999px; display: flex; align-items: center; justify-content: center; gap: 7px; font-family: var(--ed-font); font-size: 11.5px; font-weight: 600; transition: background 0.16s, color 0.16s, opacity 0.16s;';
  const barBtn = (css, label, iconName, onClick, opts = {}) => {
    const btn = el('button', BAR_BTN + css, { type: 'button', title: label, 'aria-label': label });
    btn.iconSlot = icon(iconName, 14);
    btn.labelSlot = opts.text ? el('span', '', { text: label }) : null;
    btn.append(btn.iconSlot);
    if (btn.labelSlot) btn.append(btn.labelSlot);
    const rest = opts.restBg || 'transparent';
    const hover = opts.hoverBg || 'rgba(255,255,255,0.12)';
    btn.addEventListener('mouseenter', () => { btn.style.background = hover; });
    btn.addEventListener('mouseleave', () => { btn.style.background = rest; });
    btn.addEventListener('click', onClick);
    return btn;
  };

  const playBtn = barBtn('width: 34px; padding: 0;', t('story.pause'), 'pause', () => (s.playing ? pause(false) : play()));
  const copyBtn = barBtn('padding: 0 13px;', t('story.copy'), 'copy', () => hooks.copy(s.blob), { text: true });

  // Format acronyms are proper names, so the segment labels themselves are
  // not translated; the shared tooltip is.
  const segBtns = [];
  const seg = el('div', 'display: flex; align-items: center; gap: 2px; padding: 3px; background: rgba(0,0,0,0.35); border-radius: 999px; flex: none; transition: opacity 0.16s;');
  FORMATS.forEach((fmt, i) => {
    const b = el('button', 'border: none; cursor: pointer; height: 26px; padding: 0 11px; border-radius: 999px; background: transparent; color: rgba(255,255,255,0.55); font-family: ui-monospace, monospace; font-size: 8.5px; font-weight: 700; letter-spacing: 0.09em; transition: background 0.16s, color 0.16s;', { type: 'button', text: fmt.label });
    b.addEventListener('click', () => { s.format = i; syncFormat(); });
    b.addEventListener('mouseenter', () => { if (s.format !== i) { b.style.color = '#fff'; b.style.background = 'rgba(255,255,255,0.1)'; } });
    b.addEventListener('mouseleave', () => syncFormat());
    segBtns.push(b);
    seg.appendChild(b);
  });

  const dlBtn = barBtn('padding: 0 16px; font-weight: 700; background: #fff; color: #14171c;', t('story.download', { fmt: FORMATS[0].label }), 'download', () => download(), { text: true, restBg: '#fff', hoverBg: '#dfe5ee' });

  const bar = el('div', 'display: flex; align-items: center; gap: 6px; padding: 5px; background: rgba(23,26,34,0.92); border: 1px solid rgba(255,255,255,0.14); border-radius: 999px; box-shadow: 0 18px 44px rgba(0,0,0,0.5);');
  bar.append(playBtn, copyBtn, seg, dlBtn);
  footer.append(bar);

  function syncFormat() {
    const fmt = FORMATS[s.format];
    segBtns.forEach((b, i) => {
      const on = i === s.format;
      b.style.background = on ? '#fff' : 'transparent';
      b.style.color = on ? '#14171c' : 'rgba(255,255,255,0.55)';
      b.title = t('story.format');
      b.setAttribute('aria-label', t('story.format') + ' — ' + FORMATS[i].label);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    dlBtn.labelSlot.textContent = t('story.download', { fmt: fmt.label });
    dlBtn.title = t('story.download', { fmt: fmt.label });
    dlBtn.setAttribute('aria-label', dlBtn.title);
  }
  syncFormat();

  /**
   * PNG downloads hand the capture over as-is; a lossy pick re-encodes it
   * first (against the template's page colour -- JPEG has no alpha). The
   * `saving` latch keeps a double-click from encoding twice, and an encoder
   * failure falls back to the lossless capture rather than saving nothing.
   */
  async function download() {
    if (!s.blob || s.saving) return;
    const fmt = FORMATS[s.format];
    let out = s.blob;
    if (fmt.id !== 'png') {
      s.saving = true;
      try { out = await transcodeShot(s.blob, { format: fmt.id }, core.state.doc.theme.bg); }
      catch { out = s.blob; }
      finally { s.saving = false; }
    }
    hooks.download(out);
  }

  overlay.append(rail, headRow, card, footer);

  // ---- timing -----------------------------------------------------------

  function fills() { return Array.from(rail.children).map((seg) => seg.firstChild); }

  /** Paints the rail for the current screen at `fraction`, optionally running the remainder of that screen's fill. */
  function paintRail(fraction, animate) {
    fills().forEach((fill, i) => {
      fill.style.transition = 'none';
      if (i < s.page) { fill.style.transform = 'scaleX(1)'; return; }
      if (i > s.page) { fill.style.transform = 'scaleX(0)'; return; }
      fill.style.transform = 'scaleX(' + fraction + ')';
      if (!animate) return;
      void fill.offsetWidth; // commit the start value before arming the run
      fill.style.transition = 'transform ' + Math.max(0, s.remaining) + 'ms linear';
      fill.style.transform = 'scaleX(1)';
    });
  }

  /**
   * Time is tracked as "milliseconds still owed on this screen" rather than
   * read back off the animation, so a pause and resume can hand the rail an
   * exact starting fraction instead of sampling a computed transform matrix.
   */
  function arm() {
    clearTimeout(s.timer);
    if (!s.playing || s.done || s.pages < 2) return;
    s.startedAt = performance.now();
    paintRail(1 - s.remaining / PAGE_MS, true);
    s.timer = setTimeout(() => step(1), s.remaining);
  }

  function pause(held) {
    if (!s.playing) return;
    clearTimeout(s.timer);
    s.remaining = Math.max(0, s.remaining - (performance.now() - s.startedAt));
    s.playing = false;
    s.held = !!held; // a hold resumes on release; the button toggle stays paused
    paintRail(1 - s.remaining / PAGE_MS, false);
    syncPlayBtn();
  }

  function play() {
    s.held = false;
    if (s.done) { goto(0); return; }
    s.playing = true;
    arm();
    syncPlayBtn();
  }

  function syncPlayBtn() {
    const label = s.done ? t('story.replay') : s.playing ? t('story.pause') : t('story.play');
    const name = s.done ? 'refresh' : s.playing ? 'pause' : 'play';
    const next = icon(name, 14);
    playBtn.replaceChild(next, playBtn.iconSlot);
    playBtn.iconSlot = next;
    playBtn.title = label;
    playBtn.setAttribute('aria-label', label);
  }

  // ---- paging -----------------------------------------------------------

  function offsetFor(page) {
    // Shorter than the card (a very short template): centered, never paged.
    if (s.showH <= s.cardH) return Math.round((s.cardH - s.showH) / 2);
    return -Math.min(Math.round(page * s.cardH * STEP), Math.round(s.showH - s.cardH));
  }

  function goto(page, animate) {
    const next = Math.max(0, Math.min(s.pages - 1, page));
    s.page = next;
    s.remaining = PAGE_MS;
    if (s.done) { s.done = false; s.playing = true; } // replaying from the end
    shot.style.transition = animate === false
      ? 'opacity 0.32s ease'
      : 'transform ' + SLIDE_MS + 'ms cubic-bezier(0.22,0.61,0.36,1), opacity 0.32s ease';
    shot.style.transform = 'translate3d(0, ' + offsetFor(next) + 'px, 0)';
    renderMeta();
    arm();
    syncPlayBtn();
  }

  /** One tap/arrow move. Running off the end stops on the last screen rather than looping. */
  function step(dir) {
    if (dir > 0 && s.page >= s.pages - 1) {
      clearTimeout(s.timer);
      s.done = true;
      s.playing = false;
      s.held = false;
      paintRail(1, false);
      syncPlayBtn();
      return;
    }
    if (dir < 0 && s.page === 0) { goto(0); return; }
    goto(s.page + dir);
  }

  function renderMeta() {
    metaEl.textContent = s.natW ? t('story.meta', { w: s.natW, h: s.natH, i: s.page + 1, n: s.pages }) : '';
    metaEl.style.display = s.natW ? 'block' : 'none';
  }

  // ---- layout -----------------------------------------------------------

  /**
   * Sizes the card from the space the shell actually has: as tall as the
   * overlay allows, and no wider than 3/4 of that (capped at 430px), which
   * keeps a 620px-wide email readable instead of shrinking it to a thumbnail.
   * Re-run on resize, and once more when the image's intrinsic size is known.
   */
  function layout() {
    if (!s.open) return;
    // 44 is the overlay's own padding; 118 covers the chrome around the card:
    // rail (3), the two-line header (~36), the action bar (~46) and the gaps.
    const availH = Math.max(280, overlay.clientHeight - 44 - 118);
    const availW = Math.max(240, overlay.clientWidth - 44);
    s.cardH = availH;
    s.cardW = Math.max(240, Math.min(430, availW, Math.round(availH * 0.75)));
    card.style.width = s.cardW + 'px';
    card.style.height = s.cardH + 'px';
    [rail, headRow, footer].forEach((n) => { n.style.width = s.cardW + 'px'; });
    // On a narrow card the full bar cannot fit; Copy folds to its icon so the
    // primary Download keeps its label.
    const tight = s.cardW < 390;
    copyBtn.labelSlot.style.display = tight ? 'none' : '';
    copyBtn.style.width = tight ? '34px' : '';
    copyBtn.style.padding = tight ? '0' : '0 13px';
    if (!s.natW) return;
    s.showH = s.cardW * (s.natH / s.natW);
    s.pages = s.showH <= s.cardH ? 1 : Math.ceil((s.showH - s.cardH) / (s.cardH * STEP)) + 1;
    buildRail();
    goto(Math.min(s.page, s.pages - 1), false);
  }

  function buildRail() {
    rail.innerHTML = '';
    rail.style.display = s.pages > 1 ? 'flex' : 'none';
    for (let i = 0; i < s.pages; i++) {
      const fill = el('div', 'width: 100%; height: 100%; border-radius: 2px; background: #fff; transform: scaleX(0); transform-origin: left center;');
      rail.appendChild(el('div', 'flex: 1; height: 100%; border-radius: 2px; background: rgba(255,255,255,0.24); overflow: hidden;', {}, fill));
    }
  }

  // ---- load / open / close ----------------------------------------------

  function setActionsEnabled(on) {
    [copyBtn, dlBtn, playBtn, ...segBtns].forEach((b) => {
      b.disabled = !on;
      b.style.pointerEvents = on ? '' : 'none';
    });
    // The segmented picker dims as one unit -- fading its segments separately
    // would leave the inset track behind them at full strength.
    [copyBtn, playBtn, dlBtn, seg].forEach((n) => { n.style.opacity = on ? '' : '0.4'; });
  }

  function showSkeleton(failed) {
    skeleton.style.display = 'flex';
    skeleton.style.opacity = '1';
    shimmer.style.display = failed ? 'none' : 'block';
    skelText.textContent = failed ? t('story.failed') : t('story.rendering');
    skelHint.textContent = failed ? t('story.failedHint') : t('story.renderingHint');
    retryBtn.style.display = failed ? 'flex' : 'none';
    setActionsEnabled(false);
  }

  /**
   * `token` guards every async landing: closing (or retrying) bumps it, so a
   * capture that finishes after the user moved on can never paint into the
   * card or leak its object URL.
   */
  function load() {
    const token = ++s.token;
    releaseUrl();
    Object.assign(s, { blob: null, natW: 0, natH: 0, page: 0, pages: 1, done: false, playing: true, held: false, remaining: PAGE_MS });
    clearTimeout(s.timer);
    shot.style.opacity = '0';
    rail.style.display = 'none';
    renderMeta();
    showSkeleton(false);
    hooks.capture().then((blob) => {
      if (token !== s.token || !s.open) return;
      s.blob = blob;
      s.url = URL.createObjectURL(blob);
      shot.onload = () => {
        if (token !== s.token) return;
        s.natW = shot.naturalWidth;
        s.natH = shot.naturalHeight;
        layout();
        shot.style.opacity = '1';
        skeleton.style.opacity = '0';
        setTimeout(() => { if (token === s.token) skeleton.style.display = 'none'; }, 300);
        setActionsEnabled(true);
        // A template that fits on one screen has nothing to advance through:
        // land on "replay" rather than running an invisible timer.
        if (s.pages < 2) { s.done = true; s.playing = false; }
        syncPlayBtn();
        arm();
      };
      shot.src = s.url;
    }, () => {
      if (token !== s.token || !s.open) return;
      showSkeleton(true);
    });
  }

  function releaseUrl() {
    if (!s.url) return;
    URL.revokeObjectURL(s.url);
    s.url = '';
  }

  /**
   * Escape and the arrow keys are claimed in the capture phase: the editor's
   * own window-level handler (editor-core `mountKeyboard`) would otherwise
   * close every modal underneath on the same Escape that closes the story.
   */
  function onKey(e) {
    if (!s.open) return;
    if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.stopPropagation(); pause(false); step(1); return; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.stopPropagation(); pause(false); step(-1); return; }
    if (e.key === ' ') { e.stopPropagation(); e.preventDefault(); if (s.playing) pause(false); else play(); }
  }

  let wheelAt = 0;
  card.addEventListener('wheel', (e) => {
    e.preventDefault();
    const now = performance.now();
    // One screen per gesture: a trackpad fires dozens of small deltas, and
    // acting on each would race the slide against itself.
    if (now - wheelAt < SLIDE_MS * 0.8 || Math.abs(e.deltaY) < 6) return;
    wheelAt = now;
    pause(false);
    step(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });

  function open() {
    if (s.open) return;
    s.open = true;
    overlay.style.display = 'flex';
    overlay.removeAttribute('aria-hidden');
    kickerEl.textContent = t('story.kicker');
    void overlay.offsetWidth; // start the fade from 0, not from "already shown"
    overlay.style.opacity = '1';
    card.style.transform = 'scale(1) translateY(0)';
    card.style.opacity = '1';
    layout();
    load();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', layout);
    closeBtn.focus({ preventScroll: true });
  }

  function close() {
    if (!s.open) return;
    s.open = false;
    s.token++;
    clearTimeout(s.timer);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', layout);
    overlay.style.opacity = '0';
    card.style.transform = 'scale(0.965) translateY(10px)';
    card.style.opacity = '0';
    setTimeout(() => {
      if (s.open) return; // reopened during the fade -- leave it as it is
      overlay.style.display = 'none';
      overlay.setAttribute('aria-hidden', 'true');
      shot.removeAttribute('src');
      releaseUrl();
      s.blob = null;
    }, 240);
  }

  /** Re-labels the viewer in place after a `locale`/`.messages` change. */
  function retranslate() {
    closeBtn.title = t('action.close');
    closeBtn.setAttribute('aria-label', t('action.close'));
    copyBtn.labelSlot.textContent = t('story.copy');
    copyBtn.title = t('story.copy');
    syncFormat();
    retryBtn.lastChild.textContent = t('story.retry');
    if (s.open) { kickerEl.textContent = t('story.kicker'); renderMeta(); }
    syncPlayBtn();
  }

  return { node: overlay, open, close, retranslate, isOpen: () => s.open };
};
