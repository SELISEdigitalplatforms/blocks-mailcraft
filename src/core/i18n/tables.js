import { EN } from './en.js';
import { AR } from './ar.js';
import { BG } from './bg.js';
import { BN } from './bn.js';
import { CA } from './ca.js';
import { CS } from './cs.js';
import { DA } from './da.js';
import { DE } from './de.js';
import { DE_CH } from './de-CH.js';
import { DZ } from './dz.js';
import { EL } from './el.js';
import { ES } from './es.js';
import { ET } from './et.js';
import { FI } from './fi.js';
import { FR } from './fr.js';
import { HR } from './hr.js';
import { HU } from './hu.js';
import { IT } from './it.js';
import { LT } from './lt.js';
import { LV } from './lv.js';
import { NB } from './nb.js';
import { NL } from './nl.js';
import { PL } from './pl.js';
import { PT } from './pt.js';
import { RO } from './ro.js';
import { RU } from './ru.js';
import { SK } from './sk.js';
import { SL } from './sl.js';
import { SV } from './sv.js';
import { TR } from './tr.js';
import { UK } from './uk.js';

/**
 * Every shipped message table, keyed by the same tag `LOCALES` (index.js)
 * lists -- what lets the element resolve its `locale` attribute to a table on
 * its own, so a host switches language by setting one attribute instead of
 * importing and assigning a table by hand.
 *
 * Deliberately a separate module from index.js's metadata-only `LOCALES`:
 * importing this one pulls all translations in. The element accepts that
 * (host-driven language is worth it, and the demo bundle carries every module
 * anyway); a size-sensitive host that bypasses the attribute can still
 * deep-import a single `core/i18n/<tag>.js` and assign `.messages` itself.
 */
export const LOCALE_TABLES = {
  en: EN, ar: AR, bg: BG, bn: BN, ca: CA, cs: CS, da: DA, de: DE, 'de-CH': DE_CH,
  dz: DZ, el: EL, es: ES, et: ET, fi: FI, fr: FR, hr: HR, hu: HU, it: IT,
  lt: LT, lv: LV, nb: NB, nl: NL, pl: PL, pt: PT, ro: RO, ru: RU, sk: SK,
  sl: SL, sv: SV, tr: TR, uk: UK,
};
