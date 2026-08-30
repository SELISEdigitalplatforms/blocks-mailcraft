/**
 * The storage contract.
 *
 * This file is deliberately transport-free: no `fetch`, no auth, no origin, no
 * backend of any kind. The editor talks to a plain object supplied by the host
 * (`editor.storageProvider = …`) in exactly the way it talks to `aiProvider` --
 * so a host can back the file library with S3, a DMS, a CDN or its own proxy
 * without this package knowing which.
 *
 * No adapter ships here, deliberately. An adapter is a mapping onto somebody
 * else's API surface, so vendoring one would mean republishing this package
 * every time that surface moves. The host writes its own, next to the auth and
 * base URL it already owns.
 *
 * @typedef {Object} Asset
 * @property {string} id        Stable id. With a provider this is the backend's file id -- `remove()` gets it back verbatim.
 * @property {string} name      Display/file name.
 * @property {string} url       Resolvable image URL. Must outlive the send: an email renders it long after the editor closed.
 * @property {string} folder    Folder display name.
 * @property {string} [folderId] Backend folder id, when the provider has one.
 * @property {number} w         Pixel width (0 when unknown).
 * @property {number} ht        Pixel height (0 when unknown).
 * @property {number} size      Bytes.
 *
 * @typedef {Object} StorageProvider
 * @property {() => Promise<Array<{id: string, name: string}>>} [folders]
 *   Selectable folders. Omit for a flat library.
 * @property {(q: {folderId: string, cursor: ?string, query: string}) => Promise<{items: Asset[], cursor: ?string}>} list
 *   One page of assets. `cursor` is opaque -- whatever the provider returned last, handed back to fetch the next page.
 * @property {(file: File, o: {folderId: string, width: number, height: number, signal: ?AbortSignal}) => Promise<Asset>} upload
 *   Stores one already-validated file and resolves to the asset that represents it.
 * @property {(asset: Asset) => Promise<void>} [remove]
 *   Deletes. Without it the library's DEL only drops the tile from view.
 * @property {StorageLimits} [limits]
 *   Provider-declared ceilings. `editor.storageLimits` wins over these.
 *
 * @typedef {Object} StorageLimits
 * @property {string[]} accept   Allowed MIME types, e.g. `['image/jpeg','image/png','image/gif']`. Required.
 * @property {number} maxBytes   Per-file byte ceiling. Required.
 * @property {number} [maxWidth]
 * @property {number} [maxHeight]
 * @property {number} [maxFilesPerDrop]
 * @property {boolean} [allowSvg] SVG is refused even when listed in `accept` unless this is also true -- see `storage-limits.js`.
 */

/** The synthetic "everything" folder. Its id is empty so a provider reading `folderId` sees "no folder filter", not a magic name. */
export const ALL_FOLDER_ID = '';

/**
 * Coerces whatever a provider returned into the shape the renderer indexes
 * into. A provider that forgets `w`/`ht` should degrade to a tile without
 * dimensions, not to `undefined×undefined` printed in the UI -- and `probe`
 * (what the limits check already measured client-side) fills those in for
 * backends that don't store image dimensions at all.
 */
export function normalizeAsset(raw, probe) {
  const a = raw || {};
  return {
    id: String(a.id ?? a.itemId ?? ''),
    name: String(a.name ?? (probe && probe.name) ?? 'file'),
    url: String(a.url ?? ''),
    folder: String(a.folder ?? ''),
    folderId: a.folderId != null ? String(a.folderId) : undefined,
    w: Number(a.w ?? (probe && probe.w) ?? 0) || 0,
    ht: Number(a.ht ?? (probe && probe.ht) ?? 0) || 0,
    size: Number(a.size ?? (probe && probe.size) ?? 0) || 0,
  };
}

/**
 * `editor.storageLimits` over `provider.limits`, per key rather than
 * wholesale: a host that only wants to tighten `maxBytes` shouldn't have to
 * restate the provider's `accept` list to do it.
 */
export function resolveLimits(hostLimits, providerLimits) {
  if (!hostLimits && !providerLimits) return null;
  return Object.assign({}, providerLimits || {}, hostLimits || {});
}

/** Names the methods a provider is missing, for a loud failure at assignment rather than a quiet one on first upload. */
export function providerProblems(p) {
  if (!p || typeof p !== 'object') return ['storageProvider must be an object'];
  const missing = ['list', 'upload'].filter((k) => typeof p[k] !== 'function');
  return missing.length ? [`storageProvider is missing ${missing.join(' and ')}`] : [];
}
