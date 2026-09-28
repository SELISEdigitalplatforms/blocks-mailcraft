export function parseItems(s) {
  return String(s || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf('|');
    return i < 0 ? { label: l, href: '#' } : { label: l.slice(0, i).trim(), href: l.slice(i + 1).trim() };
  });
}

export function cellsOf(p) {
  return String(p.data || '').split('\n').filter((l) => l.trim()).map((l) => l.split('|').map((c) => c.trim()));
}

/*
 * A social item may carry its own icon: `Label|URL|IconURL`. The third field
 * is taken as an icon only when it reads as an image source, so every line
 * written before icons existed -- including a link whose URL itself holds a
 * `|` -- parses exactly as `parseItems` always did. Schemes are allowlisted
 * like the library's own sources (a storage provider may hand back a rooted
 * `/path`, a `blob:` or a `cid:`): a `javascript:` "icon" is not one.
 */
const ICON_SRC = /^(?:https?:\/\/|\/|data:image\/|blob:|cid:|\{\{)/i;
export const socialIconSrc = (u) => {
  const s = String(u == null ? '' : u).trim();
  return ICON_SRC.test(s) && !/[\s"<>]/.test(s) ? s : '';
};

export function parseSocialItems(s) {
  return parseItems(s).map((it) => {
    const i = it.href.lastIndexOf('|');
    if (i < 0) return { label: it.label, href: it.href, icon: '' };
    const icon = socialIconSrc(it.href.slice(i + 1));
    return icon ? { label: it.label, href: it.href.slice(0, i).trim(), icon } : { label: it.label, href: it.href, icon: '' };
  });
}

/** The inverse of parseSocialItems; a line without an icon is written exactly as before icons existed. */
export function socialItemsString(items) {
  return items.map((it) => (it.label || '') + '|' + (it.href || '') + (socialIconSrc(it.icon) ? '|' + socialIconSrc(it.icon) : '')).join('\n');
}
