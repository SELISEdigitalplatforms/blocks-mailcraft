import { EN as ENBase } from './en.js';

/**
 * Builds a translator. `overrides` is whatever a host passes as `.messages`
 * on the element -- a host's own table, an imported locale, or both merged
 * via `defineMessages` below.
 *
 * Three deliberate properties:
 * 1. English always resolves. A locale is an overlay, never a replacement,
 *    so a partial or missing translation shows English rather than a gap.
 * 2. Params interpolate `{name}`.
 * 3. A truly missing key (not in `overrides`, not in `EN`) renders as the
 *    key itself, not an empty string -- a visible `toast.deleted` in the UI
 *    is obviously wrong and names the exact key to add, where blank text
 *    just looks like a broken build.
 */
export function createTranslator(overrides) {
  const table = overrides || {};
  return function t(key, params) {
    const template = table[key] ?? ENBase[key] ?? key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (whole, name) => (name in params ? String(params[name]) : whole));
  };
}

/** Merges a locale over a base, for a host assembling its own table -- the documented way to combine a shipped locale with a few product-specific overrides. */
export function defineMessages(base, overrides) {
  return Object.assign({}, base, overrides);
}

/** Keys in `base` that `locale` does not translate. What a translator has left to do. */
export function missingKeys(locale, base) {
  const source = base || ENBase;
  return Object.keys(source).filter((key) => locale[key] === undefined).sort();
}

/**
 * Every locale that ships, for a host building a language switcher.
 * Metadata only -- no message tables -- so listing the locales never pulls
 * every translation file into a consumer's bundle; a host deep-imports the
 * one it wants, e.g. `mailcraft-editor/src/core/i18n/bn.js`.
 */
export const LOCALES = [
  { tag: 'en', name: 'English' },
  { tag: 'ar', name: 'Arabic', rtl: true },
  { tag: 'bn', name: 'Bangla' },
  { tag: 'dz', name: 'Dzongkha' },
  { tag: 'bg', name: 'Bulgarian' },
  { tag: 'ca', name: 'Catalan' },
  { tag: 'cs', name: 'Czech' },
  { tag: 'da', name: 'Danish' },
  { tag: 'de', name: 'German' },
  { tag: 'de-CH', name: 'Swiss German' },
  { tag: 'el', name: 'Greek' },
  { tag: 'es', name: 'Spanish' },
  { tag: 'et', name: 'Estonian' },
  { tag: 'fi', name: 'Finnish' },
  { tag: 'fr', name: 'French' },
  { tag: 'hr', name: 'Croatian' },
  { tag: 'hu', name: 'Hungarian' },
  { tag: 'it', name: 'Italian' },
  { tag: 'lt', name: 'Lithuanian' },
  { tag: 'lv', name: 'Latvian' },
  { tag: 'nb', name: 'Norwegian Bokmål' },
  { tag: 'nl', name: 'Dutch' },
  { tag: 'pl', name: 'Polish' },
  { tag: 'pt', name: 'Portuguese' },
  { tag: 'ro', name: 'Romanian' },
  { tag: 'ru', name: 'Russian' },
  { tag: 'sk', name: 'Slovak' },
  { tag: 'sl', name: 'Slovenian' },
  { tag: 'sv', name: 'Swedish' },
  { tag: 'tr', name: 'Turkish' },
  { tag: 'uk', name: 'Ukrainian' },
];

/** `true` when the tag is written right to left. Metadata only -- `dir` is still what actually flips the layout. */
export function isRtl(tag) {
  const entry = LOCALES.find((l) => l.tag === tag);
  return entry ? entry.rtl === true : false;
}

export { EN, MESSAGE_KEYS } from './en.js';
