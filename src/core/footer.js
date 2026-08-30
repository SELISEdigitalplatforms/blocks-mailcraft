/**
 * The attribution strip along the bottom of the shell -- by default
 * "Powered by SELISE Blocks (c) 2026".
 *
 * It is configurable for the same reason the top bar is (core/toolbar.js): the
 * editor is embedded inside chrome the host already owns, and a host with its
 * own footer, its own attribution, or a white-label agreement should not have
 * to fight a bar it cannot address. So the strip can carry the host's own
 * line, point at the host's own link, or be removed outright.
 *
 * The default text lives in the message table (`footer.poweredBy`), not here,
 * so it translates with `locale` and can be overridden per-string through
 * `.messages` like every other label.
 */

/** The same "off" spellings the toolbar accepts -- markup only has strings, and one convention beats two. */
const HIDDEN = ['none', 'hidden', 'off', 'false'];

/**
 * A footer link is host-authored, but it is rendered inside the editor's own
 * DOM, so the scheme is allowlisted the way `cssUrl` allowlists image sources:
 * a relative path has no scheme and is fine, `javascript:` resolves to nothing
 * rather than becoming a click target in someone else's UI.
 */
function safeHref(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  const scheme = raw.match(/^([a-z][a-z0-9+.-]*):/i);
  if (scheme && !/^(https?|mailto)$/i.test(scheme[1])) return '';
  return raw;
}

/**
 * Normalizes whatever the host set into `{ text, href, target }`, or `null`
 * for "no footer at all".
 *
 * Accepts, in the shapes a Web Component gets configured through:
 *
 *   - unset (`null`/`undefined`)  the built-in attribution
 *   - `false` or `"none"`        no strip at all
 *   - a string                   replaces the text (`footer="© 2026 Acme"`)
 *   - an object                  `{ text, href, target, show }` -- text plus a
 *                                link, for a host that wants its own mark to
 *                                lead somewhere
 *
 * `text: null` in the result means "use the translated default": the string is
 * resolved through the translator at render time, so it follows `locale` and
 * `.messages` instead of being frozen here. An explicit empty string is
 * honored as empty, for a host that wants a link and nothing else.
 */
export function resolveFooter(value) {
  if (value === false) return null;
  if (value == null) return { text: null, href: '', target: '' };

  if (typeof value === 'string') {
    const raw = value.trim();
    if (HIDDEN.indexOf(raw.toLowerCase()) >= 0) return null;
    return { text: raw || null, href: '', target: '' };
  }

  if (typeof value === 'object') {
    if (value.show === false) return null;
    return {
      text: value.text == null ? null : String(value.text),
      href: safeHref(value.href),
      // Only meaningful alongside an href; the default is applied at render,
      // so this stays a plain description of what the host asked for.
      target: value.target ? String(value.target) : '',
    };
  }

  return { text: null, href: '', target: '' };
}
