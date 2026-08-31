import { EN } from './en.js';

/**
 * Lazy per-locale loading -- the code-splitting counterpart to tables.js.
 *
 * The 30 non-English tables are over half of everything under src/ (about
 * 82 KB gzipped once minified), and the eager `LOCALE_TABLES` map forces all
 * of them into any bundle that includes the element, whatever language the
 * host actually renders. Each entry here is a *literal* dynamic import, which
 * is the shape every bundler code-splits on: an app that never sets `locale`
 * ships no tables at all, and one that sets `locale="fr"` fetches one small
 * chunk on demand. tables.js stays exported for a host that wants the whole
 * map eagerly (a language switcher with instant previews, say).
 *
 * The single-file demo bundle is unaffected: build.js rewrites `import(...)`
 * onto its synchronous module map, so attribute-driven switching keeps
 * working from `file://` with no network fetch.
 */
export const LOCALE_LOADERS = {
  en: () => import('./en.js').then((m) => m.EN),
  ar: () => import('./ar.js').then((m) => m.AR),
  bg: () => import('./bg.js').then((m) => m.BG),
  bn: () => import('./bn.js').then((m) => m.BN),
  ca: () => import('./ca.js').then((m) => m.CA),
  cs: () => import('./cs.js').then((m) => m.CS),
  da: () => import('./da.js').then((m) => m.DA),
  de: () => import('./de.js').then((m) => m.DE),
  'de-CH': () => import('./de-CH.js').then((m) => m.DE_CH),
  dz: () => import('./dz.js').then((m) => m.DZ),
  el: () => import('./el.js').then((m) => m.EL),
  es: () => import('./es.js').then((m) => m.ES),
  et: () => import('./et.js').then((m) => m.ET),
  fi: () => import('./fi.js').then((m) => m.FI),
  fr: () => import('./fr.js').then((m) => m.FR),
  hr: () => import('./hr.js').then((m) => m.HR),
  hu: () => import('./hu.js').then((m) => m.HU),
  it: () => import('./it.js').then((m) => m.IT),
  lt: () => import('./lt.js').then((m) => m.LT),
  lv: () => import('./lv.js').then((m) => m.LV),
  nb: () => import('./nb.js').then((m) => m.NB),
  nl: () => import('./nl.js').then((m) => m.NL),
  pl: () => import('./pl.js').then((m) => m.PL),
  pt: () => import('./pt.js').then((m) => m.PT),
  ro: () => import('./ro.js').then((m) => m.RO),
  ru: () => import('./ru.js').then((m) => m.RU),
  sk: () => import('./sk.js').then((m) => m.SK),
  sl: () => import('./sl.js').then((m) => m.SL),
  sv: () => import('./sv.js').then((m) => m.SV),
  tr: () => import('./tr.js').then((m) => m.TR),
  uk: () => import('./uk.js').then((m) => m.UK),
};

// Module-level (not per-element): two editors on one page asking for the same
// locale should trigger one fetch and share the parsed table. English is
// seeded -- it is the translator's built-in base, always statically present.
const cache = { en: EN };
const pending = {};

/**
 * The already-loaded table for a tag. `undefined` means "shipped but not
 * loaded yet" (call `loadLocale` and re-render when it lands); `null` means
 * "no such locale" -- render the English base, exactly what the old eager
 * `LOCALE_TABLES[tag] || null` lookup did for an unknown tag.
 */
export function localeTable(tag) {
  if (Object.prototype.hasOwnProperty.call(cache, tag)) return cache[tag];
  return LOCALE_LOADERS[tag] ? undefined : null;
}

/** Fetches (once) and caches a locale's table; resolves null for a tag that does not ship. */
export function loadLocale(tag) {
  const load = LOCALE_LOADERS[tag];
  if (!load) return Promise.resolve(null);
  if (!pending[tag]) {
    pending[tag] = load().then((table) => { cache[tag] = table; return table; });
  }
  return pending[tag];
}
