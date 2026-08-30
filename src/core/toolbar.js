/**
 * Which parts of the editor's own top bar are shown.
 *
 * Hosts embed the editor inside chrome they already own -- a page header, a
 * breadcrumb, their own Save/Send buttons -- where a second bar with a second
 * logo reads as two applications stacked on top of each other. The bar is
 * therefore configurable down to the individual control, and can be removed
 * entirely.
 *
 * What that costs: `undo`, `redo` and `export` have element-level equivalents
 * (`undo()`, `redo()`, `exportHtml()`), so hiding those is only declining to
 * render the button. `preview`, `code` and `ai` open panels that nothing in
 * the public API opens -- a host that hides them is giving the panel up, not
 * just the button. DOCS.md carries the same table for integrators.
 *
 * Keyboard shortcuts are unaffected by any of this -- they are bound on the
 * document, not on the bar -- so Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z and Ctrl/Cmd+E
 * (the export dialog, and the Screenshot button inside it) work with no bar
 * at all.
 */

/** Every switchable part, in the order it appears in the bar. */
export const TOOLBAR_ITEMS = ['logo', 'status', 'device', 'undo', 'redo', 'theme', 'ai', 'code', 'preview', 'export'];

const HIDDEN = ['none', 'hidden', 'off', 'false'];

/**
 * Normalizes whatever the host set into `{ item: boolean }`, or `null` for
 * "no bar at all".
 *
 * Accepts, in the two shapes a Web Component gets configured through:
 *
 *   - property: `false` (no bar), or an object of overrides where only the
 *     keys set to `false` are turned off -- so `{ logo: false }` keeps every
 *     control and drops just the brand, without restating the other nine.
 *   - attribute: `"none"` (no bar), or a comma list naming the items to keep
 *     (`toolbar="undo,redo,export"`). Markup has only strings to work with,
 *     and an allow-list is the readable half of the two: the alternative is
 *     spelling out the seven things you did not want.
 *
 * Unset means everything is shown -- the editor is fully usable standalone,
 * and configuring the bar is opt-in.
 *
 * An empty result (every item switched off) collapses to `null`: an empty
 * 54px bar is not what anyone meant by turning off the last control.
 */
export function resolveToolbar(value) {
  if (value === false) return null;
  if (typeof value === 'string' && HIDDEN.indexOf(value.trim().toLowerCase()) >= 0) return null;

  const on = {};
  TOOLBAR_ITEMS.forEach((k) => { on[k] = true; });

  if (value && typeof value === 'object') {
    TOOLBAR_ITEMS.forEach((k) => { if (value[k] === false) on[k] = false; });
  } else if (typeof value === 'string' && value.trim() && value.trim().toLowerCase() !== 'all') {
    const keep = value.split(',').map((s) => s.trim()).filter(Boolean);
    TOOLBAR_ITEMS.forEach((k) => { on[k] = keep.indexOf(k) >= 0; });
  }

  return TOOLBAR_ITEMS.some((k) => on[k]) ? on : null;
}

/** Stable string for a resolved config, so a re-set that changes nothing does not cost a shell rebuild. */
export function toolbarKey(on) {
  return on ? TOOLBAR_ITEMS.map((k) => (on[k] ? '1' : '0')).join('') : 'none';
}
