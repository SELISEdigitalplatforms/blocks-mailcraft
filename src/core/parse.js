export function parseItems(s) {
  return String(s || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf('|');
    return i < 0 ? { label: l, href: '#' } : { label: l.slice(0, i).trim(), href: l.slice(i + 1).trim() };
  });
}

export function cellsOf(p) {
  return String(p.data || '').split('\n').filter((l) => l.trim()).map((l) => l.split('|').map((c) => c.trim()));
}
