/**
 * The editor's chrome stylesheet -- the only CSS that can't be expressed as
 * an inline `style` attribute: the two chrome palettes (light/dark), the RTE's
 * own token set, shared component classes (segmented controls, tooltips, the
 * sheet-wrap/workspace framing), keyframes, and scrollbars. Selectors kept
 * scoped to `#mc` / `#mc[data-chrome="dark"]` since the Shadow DOM gives them
 * their own namespace. `#mc`'s own height is `100%` here instead of `100vh`,
 * since a Web Component sizes to its host element, not the viewport.
 */
export const STYLE = `
@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap');
:host { display: block; height: 100%; }
#mc, #mc *, #mc *::before, #mc *::after { box-sizing: border-box; }
#mc {
  --ed-font: 'Manrope', 'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  --ed-bg: #f5f7fa; --ed-panel: #ffffff; --ed-panel-2: #f8fafc; --ed-work: #f1f4f8;
  --ed-line: rgba(15,23,42,0.09); --ed-line-2: rgba(15,23,42,0.16);
  --ed-text: #172033; --ed-muted: #667085; --ed-faint: #98a2b3;
  --ed-panel-label: #344054; --ed-panel-value: #475467; --ed-panel-meta: #7b8799;
  --ed-panel-label-size: 12px; --ed-panel-value-size: 11.5px; --ed-panel-meta-size: 9.5px;
  --ed-accent: #0065b3; --ed-accent-strong: #00538f; --ed-accent-ink: #ffffff; --ed-soft: rgba(0,101,179,0.09);
  --ed-grid: rgba(71,85,105,0.10);
  --ed-danger: #dc4c53; --ed-danger-soft: rgba(220,76,83,0.12);
  --ed-success: #1a9f6b; --ed-success-soft: rgba(26,159,107,0.12);
  --ed-radius: 10px; --ed-radius-sm: 6px;
  --ed-shadow-sm: 0 1px 2px rgba(15,23,42,0.06);
  --ed-shadow-md: 0 8px 24px rgba(15,23,42,0.12);
  --ed-shadow-lg: 0 20px 48px rgba(15,23,42,0.16);
  --rte-bg: #ffffff; --rte-panel: #f8fafc; --rte-input: #f1f5f9;
  --rte-border: rgba(15,23,42,0.12); --rte-text: #172033; --rte-muted: #64748b;
  --rte-shadow: 0 16px 42px rgba(15,23,42,0.18); --rte-tip-bg: #172033; --rte-tip-text: #ffffff;
}
#mc[data-chrome="dark"] {
  --ed-bg: #0b1120; --ed-panel: #111827; --ed-panel-2: #182235; --ed-work: #0d1524;
  --ed-line: rgba(226,232,240,0.10); --ed-line-2: rgba(226,232,240,0.18);
  --ed-text: #f1f5f9; --ed-muted: #a8b3c4; --ed-faint: #718096;
  --ed-panel-label: #e2e8f0; --ed-panel-value: #c0cad8; --ed-panel-meta: #8d9aae;
  --ed-accent: #58a8e3; --ed-accent-strong: #8fc4ec; --ed-accent-ink: #08111f; --ed-soft: rgba(88,168,227,0.13);
  --ed-grid: rgba(148,163,184,0.08);
  --ed-danger: #f2777c; --ed-danger-soft: rgba(242,119,124,0.14);
  --ed-success: #4ade95; --ed-success-soft: rgba(74,222,149,0.14);
  --ed-shadow-sm: 0 1px 2px rgba(0,0,0,0.24);
  --ed-shadow-md: 0 8px 24px rgba(0,0,0,0.34);
  --ed-shadow-lg: 0 20px 48px rgba(0,0,0,0.46);
  --rte-bg: #111827; --rte-panel: #182235; --rte-input: #1e293b;
  --rte-border: rgba(226,232,240,0.14); --rte-text: #f8fafc; --rte-muted: #a8b3c4;
  --rte-shadow: 0 18px 46px rgba(0,0,0,0.44); --rte-tip-bg: #e2e8f0; --rte-tip-text: #111827;
}
#mc button, #mc input, #mc select, #mc textarea { border-radius: 8px; }
#mc button { font-family: var(--ed-font); -webkit-tap-highlight-color: transparent; }
#mc button:not(:disabled) { transition-duration: 150ms !important; transition-timing-function: ease !important; }
#mc button:disabled { cursor: default !important; opacity: 0.45; }
#mc input, #mc select, #mc textarea { transition: border-color 150ms ease, background-color 150ms ease, box-shadow 150ms ease; }
/* Custom stepper buttons already cover increment/decrement -- the browser's
   own spinner arrows are redundant chrome-on-chrome and look inconsistent
   across browsers, so they're hidden everywhere a number input appears. */
#mc input[type="number"] { -moz-appearance: textfield; }
#mc input[type="number"]::-webkit-inner-spin-button,
#mc input[type="number"]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
/* Native <select> chrome (system font, OS-drawn arrow) doesn't match the rest
   of the UI -- swap in a plain custom arrow and let everything else (font,
   color, border, radius) keep flowing from the same inline styles as every
   other field. */
/* !important is load-bearing here, not decorative: every select's inline
   style sets background: var(--ed-panel-2) (a shorthand), and the CSS
   background shorthand implicitly resets background-image to none even
   when the declaration never mentions an image -- so without !important
   the inline color wins and silently erases this chevron. */
#mc select {
  appearance: none; -webkit-appearance: none; -moz-appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23667085' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E") !important;
  background-repeat: no-repeat !important; background-position: right 7px center !important; background-size: 11px !important;
  padding-right: 26px !important;
}
#mc[data-chrome="dark"] select {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23a8b3c4' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E") !important;
}
#mc input[type="color"] { border-radius: var(--ed-radius-sm); overflow: hidden; }
#mc input[type="color"]::-webkit-color-swatch { border: 0; }
#mc input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
#mc ::-webkit-scrollbar { width: 9px; height: 9px; }
#mc ::-webkit-scrollbar-thumb { background: var(--ed-line-2); border-radius: 999px; }
#mc ::-webkit-scrollbar-track { background: transparent; }
#mc :focus-visible { outline: 2px solid var(--ed-accent); outline-offset: 2px; }
#mc ::selection { background: rgba(0,101,179,0.22); }
#mc a { color: var(--ed-accent); }
#mc a:hover { color: var(--ed-accent); opacity: 0.72; }
@keyframes mcIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes mcFade { from { opacity: 0; } to { opacity: 1; } }
@keyframes mcPulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
@keyframes mcStoryShimmer { from { background-position: 140% 0; } to { background-position: -40% 0; } }

/*
 * Hover/selection outlines on canvas rows and blocks. Re-rendering on every
 * mouseover to toggle these would rebuild the whole canvas on every pixel of
 * mouse movement, which is what made drag/hover feel un-smooth -- these are
 * real CSS instead, same visual result, zero JS.
 */
.mc-row-el { outline: 1px solid transparent; transition: outline-color 0.12s; }
.mc-row-el.is-selected { outline: 2px solid var(--ed-accent); }
.mc-row-el:not(.is-selected):hover { outline: 1px dashed var(--ed-faint); }
.mc-block-el { outline: 1px solid transparent; outline-offset: 1px; transition: outline-color 0.12s; }
.mc-block-el.is-selected { outline: 2px solid var(--ed-accent); }
.mc-block-el:not(.is-selected):hover { outline: 1px dashed var(--ed-accent); }
/*
 * The grab strip runs the row's whole left edge (see render/canvas.js); the
 * visible part is a round badge straddling the selection border. Fixed
 * #0065b3 (not --ed-accent) for the same reason as the canvas toolbars: the
 * email sheet stays light in both chrome themes.
 */
.mc-row-grip { display: none; }
.mc-row-el:hover .mc-row-grip, .mc-row-el.is-selected .mc-row-grip { display: flex; }
/* The badge's fill lives here, not inline on the element: an inline
   background would outrank the hover rule below and the badge would never
   light up under the cursor. */
.mc-row-grip-handle { background: #0065b3; color: #ffffff; box-shadow: 0 2px 6px rgba(15,23,42,0.3); transition: background 0.14s ease; }
.mc-row-grip:hover .mc-row-grip-handle { background: #004f8c; }
/* The drag slider (render/fields.js isSlider). The track's filled/empty
   split is painted inline as a gradient that follows the thumb; only the
   chrome that CSS pseudo-elements own lives here. */
.mc-slider { -webkit-appearance: none; appearance: none; height: 4px; border-radius: 2px; background: var(--ed-line-2); outline: none; cursor: pointer; }
.mc-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 16px; height: 16px; border-radius: 50%; background: var(--ed-accent); border: 0; box-shadow: 0 1px 4px rgba(15,23,42,0.3); cursor: grab; }
.mc-slider::-moz-range-thumb { width: 16px; height: 16px; border-radius: 50%; background: var(--ed-accent); border: 0; box-shadow: 0 1px 4px rgba(15,23,42,0.3); cursor: grab; }
.mc-slider:focus-visible { box-shadow: 0 0 0 3px var(--ed-soft); }
#mc .mc-slider-field { padding-bottom: 8px; }
/* A section bar that opens a tab sits flush under the tabbar's own
   border-bottom -- its border-top would double that hairline. */
.mc-section-bar:first-child { border-top: 0; }
.mc-rte { overflow: visible; }

/* Brand mark -- the small gradient envelope glyph in the header. */
.mc-brand-mark {
  display: flex; align-items: center; justify-content: center; flex: none;
  width: 26px; height: 26px; border-radius: 8px;
  background: linear-gradient(145deg, #33a3e8, var(--ed-accent) 55%, var(--ed-accent-strong));
  box-shadow: 0 5px 14px rgba(0,101,179,0.28);
  color: #ffffff;
}

/*
 * Shared segmented-control shell -- one bordered/backed track that owns the
 * only visible border, with borderless children floating inside it. Avoids
 * ever doubling a border: each button gets its own smaller inner radius, the
 * wrapper's outer radius is larger, and the gap/padding reveal the track
 * background between items instead of adjoining per-button borders.
 */
.mc-segment { display: flex; align-items: center; gap: 3px; padding: 3px; border: 1px solid var(--ed-line); border-radius: var(--ed-radius); background: var(--ed-panel); }
.mc-segment button { border: 0; border-radius: 7px; cursor: pointer; transition: background 0.16s, color 0.16s; }
.mc-segment button:hover:not(:disabled):not([aria-pressed="true"]) { background: var(--ed-soft) !important; color: var(--ed-accent) !important; }
.mc-segment button[aria-pressed="true"]:hover { background: var(--ed-accent-strong) !important; color: var(--ed-accent-ink) !important; }
.mc-segment button:disabled { cursor: default; opacity: 0.42; }

/*
 * Shared CSS-only tooltip -- a small bubble shown on hover/focus-visible of
 * the positioned parent that owns it, no JS involved in showing/hiding it.
 * dir="down" (below the control, e.g. tabs/segments) or dir="up" (above,
 * e.g. the RTE toolbar) controls which side it renders on.
 */
.mc-tooltip {
  position: absolute; left: 50%; transform: translate(-50%, -2px); z-index: 100;
  padding: 6px 8px; border-radius: 7px; background: var(--rte-tip-bg); color: var(--rte-tip-text);
  font: 500 10.5px/1.2 var(--ed-font); white-space: nowrap;
  opacity: 0; visibility: hidden; pointer-events: none;
  box-shadow: 0 7px 20px rgba(15,23,42,0.22);
  transition: opacity 0.12s ease, transform 0.12s ease, visibility 0s linear 0.12s;
}
.mc-tooltip-down { top: calc(100% + 7px); }
.mc-tooltip-down::before { content: ''; position: absolute; left: 50%; top: -4px; width: 8px; height: 8px; background: var(--rte-tip-bg); transform: translateX(-50%) rotate(45deg); }
.mc-tooltip-up { bottom: calc(100% + 7px); }
.mc-tooltip-up::before { content: ''; position: absolute; left: 50%; bottom: -4px; width: 8px; height: 8px; background: var(--rte-tip-bg); transform: translateX(-50%) rotate(45deg); }
[data-tip]:hover > .mc-tooltip, [data-tip]:focus-visible > .mc-tooltip {
  opacity: 1; visibility: visible; transform: translate(-50%, 0); transition-delay: 0s;
}

@media (prefers-reduced-motion: reduce) {
  #mc *, #mc *::before, #mc *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
}

/* Dotted-grid workspace background, shared by the canvas and the preview body. */
.mc-workspace, .mc-preview-body {
  background-color: var(--ed-work);
  background-image: radial-gradient(circle, var(--ed-grid) 1px, transparent 1.2px);
  background-size: 22px 22px;
}

/*
 * The email sheet gets exactly one visible frame. .mc-sheet-wrap is a pure
 * positioning element (zero padding/border/background/box-shadow) whose only
 * contribution is a drop-shadow filter that hugs the sheet's own silhouette
 * rather than boxing it a second time; the sheet itself ([data-mc-sheet])
 * carries the one real border/radius/shadow, scoped per context since the
 * canvas and the preview modal want slightly different treatments.
 */
/* No 'filter' here: a filter on the wrap forces the browser to re-rasterize
   the whole email document (and re-run the blur) on every repaint inside it --
   selection, hover and typing all stutter on long templates. The sheet's own
   box-shadow below provides the depth at per-element paint cost. */
.mc-sheet-wrap { padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
.mc-workspace [data-mc-sheet="1"] { border: 1px solid var(--ed-line); border-radius: 6px; box-shadow: 0 2px 5px rgba(15,23,42,0.05), 0 14px 38px rgba(15,23,42,0.10); }
#mc[data-chrome="dark"] .mc-workspace [data-mc-sheet="1"] { border-color: rgba(148,163,184,0.4); box-shadow: 0 0 0 1px rgba(15,23,42,0.4), 0 22px 58px rgba(0,0,0,0.36); }
.mc-preview-body [data-mc-sheet="1"] { border: 1px solid var(--ed-line-2); border-radius: 8px; box-shadow: 0 18px 50px rgba(15,23,42,0.13); }
#mc[data-chrome="dark"] .mc-preview-body [data-mc-sheet="1"] { border-color: rgba(148,163,184,0.4); box-shadow: 0 22px 58px rgba(0,0,0,0.4); }

/* Final component polish mirrored from the approved standalone editor. */
#mc { --ed-success: #20a779; --ed-danger: #e05766; }
#mc ::-webkit-scrollbar { width: 8px; height: 8px; }
#mc :focus-visible { outline: 3px solid var(--ed-soft); outline-offset: 1px; }
#mc button, #mc input, #mc textarea, #mc select { border-radius: 8px !important; }
#mc button { transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease, background .18s ease, color .18s ease, filter .18s ease !important; }
#mc button:not(:disabled):active { transform: translateY(1px); }
#mc button:disabled { opacity: .42; cursor: not-allowed !important; }
#mc input, #mc textarea, #mc select { box-shadow: inset 0 0 0 1px transparent; transition: border-color .18s ease, box-shadow .18s ease, background .18s ease !important; }
#mc input:focus, #mc textarea:focus, #mc select:focus { border-color: var(--ed-accent) !important; box-shadow: 0 0 0 3px var(--ed-soft); outline: none; }
/* The stepper's value input is a bare number inside the pill -- the generic
   focus ring above drew a floating box around the digits mid-control; the
   pill itself carries the focus treatment instead (render/fields.js). */
#mc .mc-stepper-input:focus { border-color: transparent !important; box-shadow: none; }
#mc [data-rte-control="1"] { position: relative; overflow: visible !important; border-radius: 5px !important; transition: background .14s ease, color .14s ease, transform .14s ease !important; }
#mc [data-rte-control="1"][data-active="false"]:hover { background: var(--ed-soft) !important; color: var(--ed-accent) !important; }
#mc [data-rte-control="1"]:active { transform: translateY(1px); }
#mc [data-rte-picker="1"] { transition: box-shadow .14s ease, background .14s ease; }
#mc [data-rte-picker="1"]:hover { box-shadow: inset 0 0 0 1px var(--ed-accent), 0 0 0 3px var(--ed-soft) !important; }
#mc .mc-rte-tooltip { position: absolute; left: 50%; bottom: calc(100% + 7px); transform: translate(-50%, 3px); z-index: 120; padding: 5px 7px; border-radius: 5px; background: var(--rte-tip-bg); color: var(--rte-tip-text); font: 500 10px/1.2 var(--ed-font); letter-spacing: 0; white-space: nowrap; opacity: 0; visibility: hidden; pointer-events: none; box-shadow: 0 7px 18px rgba(15,23,42,.20); transition: opacity .12s ease, transform .12s ease, visibility 0s linear .12s; }
#mc .mc-rte-tooltip::after { content: ''; position: absolute; left: 50%; bottom: -3px; width: 7px; height: 7px; background: var(--rte-tip-bg); transform: translateX(-50%) rotate(45deg); }
#mc [data-rte-control="1"]:hover .mc-rte-tooltip, #mc [data-rte-control="1"]:focus-visible .mc-rte-tooltip, #mc [data-rte-picker="1"]:hover .mc-rte-tooltip, #mc [data-rte-picker="1"]:focus-within .mc-rte-tooltip { opacity: 1; visibility: visible; transform: translate(-50%, 0); transition-delay: 0s; }
#mc [data-rte-picker="1"], #mc [data-rte-select="1"] { border-radius: 5px !important; }
#mc [data-rte-root="1"] button, #mc [data-rte-root="1"] input, #mc [data-rte-root="1"] select { border-radius: 5px !important; }
#mc [data-rte-select="1"] select:hover, #mc [data-rte-select="1"]:focus-within select { border-color: var(--ed-accent) !important; box-shadow: 0 0 0 3px var(--ed-soft); }
#mc [data-rte-select="1"] select { background-image: none !important; padding-right: 24px !important; }
#mc .mc-shell { border-color: var(--ed-line) !important; border-radius: 14px; grid-template-rows: 62px 1fr !important; box-shadow: 0 1px 2px rgba(15,23,42,.04), 0 16px 44px rgba(15,23,42,.10) !important; }
/* Opaque, no backdrop-filter: the header sits over the scrolling canvas, so a
   backdrop blur re-composites every scroll frame -- visible scroll jank. */
#mc .mc-header { padding: 0 18px !important; background: var(--ed-panel) !important; }
#mc .mc-brand-mark { width: 30px !important; height: 30px !important; border-radius: 9px; background: linear-gradient(145deg, #33a3e8, #0065b3 56%, #00538f) !important; box-shadow: 0 7px 18px rgba(0,101,179,.25); }
#mc .mc-brand-mark svg { width: 20px; height: 20px; display: block; color: #fff; }
#mc .mc-brand-name { font-family: var(--ed-font) !important; font-size: 17px !important; letter-spacing: -.03em !important; }
#mc .mc-header button { font-family: var(--ed-font) !important; font-size: 10.5px !important; font-weight: 600; letter-spacing: .015em !important; text-transform: none !important; }
#mc .mc-header > div { border-radius: 10px; }
#mc .mc-segment { gap: 3px !important; padding: 3px !important; border: 0 !important; border-radius: 10px; background: var(--ed-panel-2) !important; }
#mc .mc-segment button { min-width: 62px; height: 26px; padding: 0 10px !important; border: 0 !important; border-radius: 7px !important; font-family: var(--ed-font) !important; font-size: 10px !important; font-weight: 600; letter-spacing: .01em !important; text-transform: none !important; }
#mc .mc-field-segment { width: 100%; box-shadow: none; }
#mc .mc-field-segment button { min-width: 0; flex: 1; height: 28px; }
#mc .mc-device-segment { position: relative; z-index: 40; overflow: visible !important; }
#mc .mc-device-segment button { position: relative; min-width: 38px; width: 38px; padding: 0 !important; display: flex; align-items: center; justify-content: center; overflow: visible !important; }
#mc .mc-device-segment button:hover, #mc .mc-device-segment button:focus-visible { z-index: 50; }
#mc .mc-device-segment button svg { width: 15px; height: 15px; display: block; }
#mc .mc-layout { grid-template-columns: minmax(0,1fr) 360px !important; }
#mc .mc-canvas-stage { padding: 28px 40px 150px !important; }
#mc .mc-workspace [data-mc-sheet="1"] { border: 1px solid rgba(15,23,42,.10); border-radius: 4px; background: #ffffff; box-shadow: 0 2px 5px rgba(15,23,42,.05), 0 14px 38px rgba(15,23,42,.10) !important; }
#mc[data-chrome="dark"] .mc-workspace [data-mc-sheet="1"] { border-color: rgba(148,163,184,.46); box-shadow: 0 0 0 1px rgba(15,23,42,.48), 0 22px 58px rgba(0,0,0,.38) !important; }
#mc .mc-preview-body [data-mc-sheet="1"] { border: 1px solid rgba(15,23,42,.12); border-radius: 10px; background: #ffffff; box-shadow: 0 18px 50px rgba(15,23,42,.13) !important; }
#mc[data-chrome="dark"] .mc-preview-body [data-mc-sheet="1"] { border-color: rgba(203,213,225,.42); box-shadow: 0 0 0 1px rgba(15,23,42,.65), 0 24px 65px rgba(0,0,0,.40) !important; }
#mc .mc-inspector { box-shadow: -10px 0 30px rgba(42,47,77,.04); color: var(--ed-panel-label); }
#mc .mc-tabbar { grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); padding: 7px 8px 0; gap: 3px; border-bottom: 0 !important; background: var(--ed-panel) !important; overflow: visible; position: relative; z-index: 12; }
#mc .mc-tabbar button { position: relative; min-width: 0; height: 39px; border-radius: 8px 8px 0 0 !important; padding: 0 !important; display: flex; align-items: center; justify-content: center; font-family: var(--ed-font) !important; }
#mc .mc-tabbar button svg { width: 16px; height: 16px; display: block; }
#mc .mc-tab-surface { width: 100%; min-width: 0; background: var(--ed-panel); color: var(--ed-text); }
#mc .mc-inspector .mc-section-label {
  font-size: 10px !important; line-height: 1.2 !important; font-weight: 700 !important;
  letter-spacing: .07em !important; color: var(--ed-muted) !important;
}
#mc .mc-inspector .mc-section-body { padding: 12px 14px 16px !important; }
#mc .mc-inspector .mc-section-body > :first-child { margin-top: 0 !important; }
#mc .mc-field-list { display: grid; align-content: start; gap: 12px; }
#mc .mc-field-list .mc-field { min-width: 0; }
#mc .mc-field-list .mc-field-row {
  display: grid !important; grid-template-columns: minmax(0, 1fr) 168px;
  align-items: center; column-gap: 14px; min-height: 32px;
}
#mc .mc-field-list .mc-field-row > .mc-field-label { min-width: 0; }
#mc .mc-field-list .mc-field-row > .mc-field-control {
  width: 100% !important; min-width: 0; box-sizing: border-box;
}
#mc .mc-field-list .mc-field-row > .mc-switch { justify-self: end; }
#mc .mc-field-list .mc-color-control .mc-stepper-input { width: auto !important; flex: 1; min-width: 0; }
#mc .mc-field-list .mc-field-label {
  font-family: var(--ed-font) !important; font-size: var(--ed-panel-label-size) !important;
  line-height: 1.4 !important; font-weight: 500 !important; color: var(--ed-panel-label) !important;
}
#mc .mc-field-list input:not([type="range"]):not([type="color"]),
#mc .mc-field-list textarea, #mc .mc-field-list select,
#mc .mc-field-list .mc-field-segment button {
  font-size: var(--ed-panel-value-size) !important; line-height: 1.4 !important;
}
#mc .mc-field-list input:not([type="range"]):not([type="color"]),
#mc .mc-field-list textarea, #mc .mc-field-list select,
#mc .mc-field-list .mc-field-segment button[aria-pressed="false"] {
  color: var(--ed-panel-value) !important;
}
#mc .mc-field-list .mc-stepper span {
  font-size: var(--ed-panel-value-size) !important; color: var(--ed-panel-value) !important;
}
#mc .mc-field-list input:not([type="range"]):not([type="color"]):not(.mc-stepper-input),
#mc .mc-field-list select { min-height: 32px; }
#mc .mc-layer-tree { align-content: start; padding-top: 10px !important; }
#mc .mc-tree-section { min-width: 0; border-bottom: 1px solid var(--ed-line); padding-bottom: 13px !important; }
#mc .mc-tree-section.is-selected { box-shadow: none; }
#mc .mc-tree-section + .mc-tree-section { padding-top: 13px !important; }
#mc .mc-tree-section:last-child { border-bottom: 0; padding-bottom: 0 !important; }
#mc .mc-tree-section-node { min-height: 34px; padding: 5px 6px !important; }
#mc .mc-tree-column-node { min-height: 32px !important; padding-block: 4px !important; }
#mc .mc-tree-block-node { min-height: 32px; padding-block: 4px !important; }
#mc .mc-tree-children {
  position: relative; display: grid; gap: 2px; margin-inline-start: 18px;
  padding-inline-start: 18px;
}
#mc .mc-tree-columns { margin-top: 5px; }
#mc .mc-tree-blocks { margin-top: 2px; margin-bottom: 5px; }
#mc .mc-tree-branch, #mc .mc-tree-children > .mc-tree-node { position: relative; min-width: 0; }
#mc .mc-tree-branch::before, #mc .mc-tree-children > .mc-tree-node::before {
  content: ''; position: absolute; inset-inline-start: -18px; top: 16px;
  width: 17px; border-top: 1px solid var(--ed-line-2);
}
#mc .mc-tree-branch::after, #mc .mc-tree-children > .mc-tree-node::after {
  content: ''; position: absolute; inset-inline-start: -18px; top: -3px; bottom: -3px;
  border-inline-start: 1px solid var(--ed-line-2);
}
#mc .mc-tree-branch:last-child::after, #mc .mc-tree-children > .mc-tree-node:last-child::after {
  bottom: auto; height: 19px;
}
#mc .mc-tree-node { isolation: isolate; }
#mc .mc-tree-block-node > span:nth-child(2) { min-width: 0; }
#mc .mc-layer-tree .mc-tree-title {
  font-size: var(--ed-panel-label-size) !important; line-height: 1.35 !important;
  font-weight: 500 !important; color: var(--ed-panel-label) !important;
}
#mc .mc-layer-tree .mc-tree-section-node .mc-tree-title { font-weight: 600 !important; }
#mc .mc-layer-tree .mc-tree-column-node .mc-tree-title {
  font-size: var(--ed-panel-value-size) !important; color: var(--ed-panel-value) !important;
}
#mc .mc-layer-tree .mc-tree-count,
#mc .mc-layer-tree .mc-tree-type,
#mc .mc-layer-tree .mc-tree-index {
  font-size: var(--ed-panel-meta-size) !important; line-height: 1.3 !important;
  font-weight: 600 !important; color: var(--ed-panel-meta) !important;
}
#mc .mc-layer-tree .mc-tree-type { letter-spacing: .035em !important; }
#mc .mc-layer-tree .mc-tree-section.is-selected .mc-tree-index {
  color: var(--ed-accent-ink) !important;
}
#mc .mc-tab-tooltip { position: absolute; top: calc(100% + 7px); left: 50%; transform: translate(-50%, -2px); z-index: 100; padding: 6px 8px; border-radius: 7px; background: #172033; color: #ffffff; font: 500 10.5px/1.2 var(--ed-font); letter-spacing: 0; text-transform: none; white-space: nowrap; opacity: 0; visibility: hidden; pointer-events: none; box-shadow: 0 7px 20px rgba(15,23,42,.22); transition: opacity .12s ease, transform .12s ease, visibility 0s linear .12s; }
#mc .mc-tab-tooltip::before { content: ''; position: absolute; left: 50%; top: -4px; width: 8px; height: 8px; background: #172033; transform: translateX(-50%) rotate(45deg); }
#mc [data-tip]:hover .mc-tab-tooltip, #mc [data-tip]:focus-visible .mc-tab-tooltip { opacity: 1; visibility: visible; transform: translate(-50%, 0); transition-delay: 0s; }
#mc[data-chrome="dark"] .mc-tab-tooltip, #mc[data-chrome="dark"] .mc-tab-tooltip::before { background: #e2e8f0; color: #111827; }
/* End-aligned tooltip for controls hugging a right edge: hidden tooltips are
   still laid out (visibility, not display), so a centered bubble poking past
   the inspector's edge grew a horizontal scrollbar under the panel. */
#mc .mc-tooltip-end { left: auto; right: 0; transform: translate(0, -2px); }
#mc .mc-tooltip-end::before { left: auto; right: 11px; transform: rotate(45deg); }
#mc [data-tip]:hover > .mc-tooltip-end, #mc [data-tip]:focus-visible > .mc-tooltip-end { transform: translate(0, 0); }
/* No backdrop-filter: the dock floats over the scrolling canvas (every frame
   would re-blur) and its background is opaque anyway, so the blur never shows. */
#mc .mc-zoom { border-color: var(--ed-line) !important; border-radius: 12px; box-shadow: 0 10px 30px rgba(36,41,70,.15) !important; }
#mc .mc-inspector [draggable="true"] { border-radius: 12px; overflow: hidden; }
#mc .mc-shortcuts { border: 0 !important; border-radius: 12px; padding: 14px !important; background: var(--ed-panel-2); box-shadow: inset 0 0 0 1px var(--ed-line); }
/* Dim only, no backdrop blur: blurring the whole editor behind a modal is the
   single most expensive paint the chrome can ask for on weak GPUs. */
#mc .mc-modal-backdrop { background: rgba(14,16,27,.62) !important; }
#mc .mc-modal { border-color: var(--ed-line) !important; border-radius: 18px; overflow: hidden; box-shadow: 0 28px 80px rgba(10,13,28,.30) !important; }
#mc .mc-fullscreen-panel { border-radius: 14px; overflow: hidden; }
#mc .mc-modal button, #mc .mc-fullscreen-panel button { font-family: var(--ed-font) !important; font-size: 10.5px !important; font-weight: 600 !important; letter-spacing: .01em !important; text-transform: none !important; }
#mc .mc-icon-label { display: inline-flex !important; align-items: center; justify-content: center; gap: 6px; }
#mc .mc-icon-label svg, #mc .mc-icon-button svg { width: 14px; height: 14px; display: block; flex: none; }
#mc .mc-icon-button { display: inline-flex !important; align-items: center; justify-content: center; }
#mc .mc-code-panel { grid-template-rows: 58px minmax(0,1fr) auto !important; background: var(--ed-work) !important; }
#mc .mc-code-toolbar, #mc .mc-preview-toolbar { position: relative; z-index: 45; overflow: visible !important; padding: 0 16px !important; background: var(--ed-panel) !important; box-shadow: 0 1px 0 var(--ed-line); }
#mc .mc-code-badge { width: 32px; height: 32px; border-radius: 9px; display: flex !important; align-items: center; justify-content: center; color: var(--ed-accent); background: var(--ed-soft); }
#mc .mc-code-heading { font-family: var(--ed-font) !important; font-size: 14px !important; font-weight: 600 !important; letter-spacing: -.01em !important; }
#mc .mc-code-kicker, #mc .mc-preview-kicker { font-family: var(--ed-font) !important; font-size: 9.5px !important; font-weight: 500; letter-spacing: .025em !important; text-transform: none !important; }
#mc .mc-code-split { gap: 12px; padding: 12px; background: var(--ed-work); }
#mc .mc-code-source, #mc .mc-code-preview { border: 1px solid var(--ed-line) !important; border-radius: 12px; overflow: hidden; background: var(--ed-panel) !important; }
#mc .mc-pane-label { padding: 8px 13px !important; background: var(--ed-panel-2) !important; font-size: 9.5px !important; letter-spacing: .025em !important; text-transform: none !important; }
#mc .mc-code-preview-body { padding: 14px !important; background: var(--ed-work); }
#mc .mc-code-frame { border: 0 !important; border-radius: 9px; box-shadow: 0 5px 20px rgba(15,23,42,.10) !important; }
#mc .mc-code-footer { padding: 8px 16px !important; background: var(--ed-panel); font-family: var(--ed-font) !important; font-size: 9.5px !important; letter-spacing: 0 !important; }
#mc .mc-preview-panel { grid-template-rows: 58px minmax(0,1fr) !important; }
#mc .mc-preview-title { font-family: var(--ed-font); font-size: 12px !important; font-weight: 600; }
#mc .mc-preview-body { padding: 32px 24px !important; background-color: var(--ed-work); background-image: radial-gradient(circle, var(--ed-grid) 1px, transparent 1.2px); background-size: 22px 22px; }
#mc .mc-toast { border-radius: 10px; box-shadow: 0 12px 34px rgba(16,19,36,.28) !important; }
#mc[data-chrome="dark"] .mc-shell { box-shadow: 0 24px 70px rgba(0,0,0,.44) !important; }
#mc[data-chrome="dark"] .mc-header { background: rgba(25,28,41,.88) !important; }
@media (max-width: 1240px) { #mc .mc-layout { grid-template-columns: minmax(0,1fr) 330px !important; } }

/*
 * Inspector switch -- the on/off control in the properties panel. Everything
 * visual hangs off the button's own aria-checked, so there is no second
 * source of truth for "is it on": a pill track that fills with the accent
 * color, and a knob that slides (transform, not left, so the motion stays on
 * the compositor). Lives at the very end of the sheet, after the polish
 * block, because that block's blanket "#mc button ... border-radius: 8px
 * !important" beats plain specificity -- hence the !important here too.
 * (No backticks anywhere in this file's CSS: the whole stylesheet is one
 * template literal, so a backtick inside it ends the string.)
 */
#mc .mc-switch {
  position: relative; flex: none; width: 38px; height: 22px; padding: 0;
  border: 0; border-radius: 999px !important; cursor: pointer;
  background: var(--ed-line-2); box-shadow: inset 0 0 0 1px var(--ed-line);
}
#mc .mc-switch-knob {
  position: absolute; top: 3px; left: 3px; width: 16px; height: 16px;
  border-radius: 50%; background: #ffffff; pointer-events: none;
  box-shadow: 0 1px 2px rgba(15,23,42,0.30), 0 2px 5px rgba(15,23,42,0.14);
  transition: transform 0.18s cubic-bezier(0.22,0.61,0.36,1);
}
#mc .mc-switch[aria-checked="true"] { background: var(--ed-accent); box-shadow: inset 0 0 0 1px var(--ed-accent); }
#mc .mc-switch[aria-checked="true"] .mc-switch-knob { transform: translateX(16px); }
#mc .mc-switch-row:hover .mc-switch { background: color-mix(in srgb, var(--ed-faint) 52%, transparent); }
#mc .mc-switch-row:hover .mc-switch[aria-checked="true"] { background: var(--ed-accent-strong); box-shadow: inset 0 0 0 1px var(--ed-accent-strong); }
#mc .mc-switch-row:hover label { color: var(--ed-text); }
#mc[data-chrome="dark"] .mc-switch-knob { background: #e2e8f0; box-shadow: 0 1px 2px rgba(0,0,0,0.44), 0 2px 5px rgba(0,0,0,0.28); }
/*
 * One-shot slide for the switch the user just clicked. A prop change rebuilds
 * the panel, so the switch that comes back is a brand new node already in its
 * final state -- nothing for a transition to interpolate. render/fields.js tags
 * just that one node with .mc-switch-anim, and these keyframes replay the move
 * from where the old node stood. Panels that merely open keep painting their
 * switches in place, with no animation.
 */
#mc .mc-switch-anim[aria-checked="true"] { animation: mcSwitchOn 0.18s cubic-bezier(0.22,0.61,0.36,1); }
#mc .mc-switch-anim[aria-checked="false"] { animation: mcSwitchOff 0.18s cubic-bezier(0.22,0.61,0.36,1); }
#mc .mc-switch-anim[aria-checked="true"] .mc-switch-knob { animation: mcKnobOn 0.18s cubic-bezier(0.22,0.61,0.36,1); }
#mc .mc-switch-anim[aria-checked="false"] .mc-switch-knob { animation: mcKnobOff 0.18s cubic-bezier(0.22,0.61,0.36,1); }
@keyframes mcSwitchOn { from { background: var(--ed-line-2); } }
@keyframes mcSwitchOff { from { background: var(--ed-accent); } }
@keyframes mcKnobOn { from { transform: translateX(0); } }
@keyframes mcKnobOff { from { transform: translateX(16px); } }

/* The inspector inherits the active chrome palette. Keeping theme ownership
   at #mc makes the header, menus, every panel and every field switch together
   when light/dark changes, instead of leaving the side panel permanently dark. */
`;
