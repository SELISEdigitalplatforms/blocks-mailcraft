/**
 * Hand-written type declarations for `@seliseblocks/mailcraft`.
 *
 * The runtime is plain JavaScript; these types describe the public contract
 * documented in DOCS.md. Anything DOCS.md calls internal (`EditorCore`,
 * `renderDoc`, the document object) is typed loosely on purpose — its shape
 * is free to change between versions.
 */

// ---------------------------------------------------------------------------
// i18n

/** A message table: i18n keys to translated strings. `EN` holds every key. */
export type MessageTable = Record<string, string>;

export interface LocaleInfo {
  tag: string;
  name: string;
  rtl?: boolean;
}

/** The 31 shipped locale tags. */
export type LocaleTag =
  | 'en' | 'ar' | 'bg' | 'bn' | 'ca' | 'cs' | 'da' | 'de' | 'de-CH' | 'dz'
  | 'el' | 'es' | 'et' | 'fi' | 'fr' | 'hr' | 'hu' | 'it' | 'lt' | 'lv'
  | 'nb' | 'nl' | 'pl' | 'pt' | 'ro' | 'ru' | 'sk' | 'sl' | 'sv' | 'tr' | 'uk';

/** Every locale that ships — metadata only, no message tables. */
export const LOCALES: readonly LocaleInfo[];

/** Every shipped message table, keyed by locale tag. Importing this pulls all translations in. */
export const LOCALE_TABLES: Record<LocaleTag, MessageTable>;

/** One lazy loader per shipped locale — literal dynamic imports, so bundlers code-split each table into its own chunk. What the element's `locale` attribute resolves through. */
export const LOCALE_LOADERS: Record<LocaleTag, () => Promise<MessageTable>>;

/** Fetches (once) and caches a locale's table; resolves `null` for a tag that does not ship. Useful for prefetching before setting `locale`. */
export function loadLocale(tag: string): Promise<MessageTable | null>;

/** The already-loaded table for a tag: the table, `undefined` (ships but not loaded yet), or `null` (does not ship). */
export function localeTable(tag: string): MessageTable | null | undefined;

/** The English table — the fallback for every key a custom table leaves out. */
export const EN: MessageTable;

/** Every message key the editor ever asks for. */
export const MESSAGE_KEYS: readonly string[];

/** Resolves a key against `overrides`, then `EN`, then the key itself; interpolates `{name}` params. */
export function createTranslator(
  overrides?: MessageTable | null,
): (key: string, params?: Record<string, string | number>) => string;

/** Merges a locale over a base — the documented way to build a `.messages` value. */
export function defineMessages(base: MessageTable, overrides?: MessageTable): MessageTable;

/** Keys in `base` (default: `EN`) that `locale` does not translate, sorted. */
export function missingKeys(locale: MessageTable, base?: MessageTable): string[];

/** Whether a locale tag is written right-to-left. Metadata — `dir` is what flips the layout. */
export function isRtl(tag: string): boolean;

// ---------------------------------------------------------------------------
// Storage: the file-library contract the host implements

export interface Asset {
  /** Stable id. With a provider this is the backend's file id — `remove()` gets it back verbatim. */
  id: string;
  /** Display/file name. */
  name: string;
  /** Resolvable image URL. Must outlive the send: an email renders it long after the editor closed. */
  url: string;
  /** Folder display name. */
  folder: string;
  /** Backend folder id, when the provider has one. */
  folderId?: string;
  /** Pixel width (0 when unknown). */
  w: number;
  /** Pixel height (0 when unknown). */
  ht: number;
  /** Bytes. */
  size: number;
}

export interface StorageLimits {
  /**
   * Allowed MIME types. Omitted or empty means every image type the validator
   * recognizes (SVG still needs `allowSvg`).
   */
  accept?: string[];
  /** Per-file byte ceiling. Required. */
  maxBytes: number;
  maxWidth?: number;
  maxHeight?: number;
  maxFilesPerDrop?: number;
  /** SVG is refused even when listed in `accept` unless this is also true. */
  allowSvg?: boolean;
}

export interface StorageListQuery {
  folderId: string;
  /** Opaque — whatever the provider returned last, handed back to fetch the next page. */
  cursor: string | null;
  query: string;
  /** Aborted when a newer listing supersedes this one. */
  signal?: AbortSignal | null;
}

export interface StorageListResult {
  items: Asset[];
  /** `null` when there are no more pages. */
  cursor: string | null;
}

export interface StorageUploadInfo {
  folderId: string;
  /** Pixel dimensions the validation pass already measured client-side. */
  width: number;
  height: number;
  signal?: AbortSignal | null;
}

export interface StorageProvider {
  /** One page of assets. */
  list(q: StorageListQuery): Promise<StorageListResult>;
  /** Stores one already-validated file and resolves to the asset that represents it. */
  upload(file: File, info: StorageUploadInfo): Promise<Asset>;
  /** Selectable folders. Omit for a flat library. */
  folders?(): Promise<Array<{ id: string; name: string }>>;
  /** Deletes. Without it the library's DEL only drops the tile from view. */
  remove?(asset: Asset): Promise<void>;
  /** Provider-declared ceilings. `editor.storageLimits` wins over these, per key. */
  limits?: StorageLimits;
}

/** The synthetic "all files" folder id (the empty string). */
export const ALL_FOLDER_ID: '';

/** Coerces whatever a provider returned into the library's asset shape; `probe` fills in what the client already measured. */
export function normalizeAsset(
  raw: unknown,
  probe?: { name?: string; w?: number; ht?: number; size?: number } | null,
): Asset;

/** `hostLimits` over `providerLimits`, per key. `null` when neither is set. */
export function resolveLimits(
  hostLimits?: Partial<StorageLimits> | null,
  providerLimits?: Partial<StorageLimits> | null,
): StorageLimits | null;

// ---------------------------------------------------------------------------
// Upload validation, reusable outside the editor

export interface AcceptedFile {
  file: File;
  /** Sanitized name — see `sanitizeName`. */
  name: string;
  /** Byte-sniffed MIME type, never `file.type`. */
  type: string;
  size: number;
  w: number;
  ht: number;
}

export interface RejectedFile {
  name: string;
  /** An i18n key (`storage.err*`) naming the reason, translated by the same table as the chrome. */
  key: string;
  params: Record<string, string | number>;
}

/** Splits a file list into what may be uploaded and what may not, against the given limits. */
export function validateFiles(
  list: ArrayLike<File> | Iterable<File> | null | undefined,
  limits?: Partial<StorageLimits> | null,
): Promise<{ accepted: AcceptedFile[]; rejected: RejectedFile[] }>;

/** Strips path syntax and control characters from a filename and caps its length. */
export function sanitizeName(name: string): string;

/** An `accept` attribute for the file picker, so the OS dialog greys out what validation would refuse. */
export function acceptAttribute(limits?: Partial<StorageLimits> | null): string;

/** The i18n key naming what a limits object is missing, or `null` when it is usable. */
export function limitsProblem(limits: unknown): string | null;

// ---------------------------------------------------------------------------
// Editor options shared by the attribute/property surface and createEditor

export type ToolbarPart =
  | 'logo' | 'status' | 'device' | 'undo' | 'redo'
  | 'theme' | 'ai' | 'code' | 'preview' | 'export';

/**
 * The `toolbar` property: `false` for no bar, or an object where only the
 * keys set to `false` do anything — unlisted parts stay on. (The attribute
 * form is a string: `none`, `all`, or a comma list of the parts to keep.)
 */
export type ToolbarOption = boolean | string | Partial<Record<ToolbarPart, boolean>>;

/** The `footer` property: `false` to remove the strip, a string to replace the line, or a config object. */
export type FooterOption =
  | boolean
  | string
  | { text?: string; href?: string; target?: string; show?: boolean };

/** One `async (prompt) => text` function — the whole AI seam. */
export type AiProvider = (prompt: string) => string | Promise<string>;

/** Social-icon override. Falls back to the built-in icon when unset, throwing, or returning a non-node. */
export type IconProvider = (
  platformKey: string,
  ctx: { label: string; size: number; color: string },
) => Node;

/**
 * The editor's internal document. NOT a public contract — the shape is free
 * to change between versions. Store `exportHtml()` instead; this type exists
 * so the `change` event and the internal accessors have something to name.
 */
export type EmailDocument = Record<string, any>;

/** What `loadTemplate` accepts: `html` (through the importer), a `doc`, or a `build()` that makes one per use. */
export interface Template {
  name?: string;
  html?: string;
  doc?: EmailDocument;
  build?: () => EmailDocument;
}

// ---------------------------------------------------------------------------
// The element

export interface MailCraftEditorEventMap extends HTMLElementEventMap {
  /** The internal document — for dirty-tracking, not persistence. */
  change: CustomEvent<EmailDocument>;
  /** The exported HTML string. */
  export: CustomEvent<string>;
}

/**
 * The `<mailcraft-editor>` custom element. Importing the package registers it.
 */
export class MailCraftEditor extends HTMLElement {
  /** Merge variables. Reads back as an array; accepts a comma-separated string or an array. */
  get variables(): string[];
  set variables(value: string | string[]);

  /** `false` for no bar, `{ part: false }` to drop parts. Reads back whatever was set (or the attribute string). */
  get toolbar(): ToolbarOption;
  set toolbar(value: ToolbarOption);

  /** `false` to remove the strip, a string to replace it, or `{ text, href, target, show }`. */
  get footer(): FooterOption;
  set footer(value: FooterOption);

  /** `inherit` or a CSS font-family stack. Editor chrome only. */
  uiFont: string;

  /** A CSS color, `var(--token)`, or `inherit`. One color repaints the editor chrome. */
  accent: string;

  /** Per-key overrides for the UI strings; `EN` lists every key. */
  messages: MessageTable | null;

  aiProvider: AiProvider | null;
  iconProvider: IconProvider | null;

  /** `null` drops back to the empty local library. */
  storageProvider: StorageProvider | null;

  /** Merged over `storageProvider.limits` per key, this side winning. */
  storageLimits: StorageLimits | null;

  /** Send-ready email HTML — valid input to the importer, so saving the export is saving the work. */
  exportHtml(): string;

  /** Parses email HTML back onto the canvas. Returns the number of rows produced. */
  importHtml(html: string): number;

  /** Applies a template as a normal undoable edit. The input is never mutated. */
  loadTemplate(tpl: Template): void;

  undo(): void;
  redo(): void;

  /** The full template as a PNG. */
  screenshotPng(): Promise<Blob>;

  /** Opens the story-style screenshot viewer. */
  previewScreenshot(): void;

  /** Saves a screenshot — captures first if no blob is passed. */
  downloadScreenshot(blob?: Blob): Promise<void>;

  /** Copies a screenshot to the clipboard — captures first if no blob is passed. */
  copyScreenshot(blob?: Blob): Promise<void>;

  /**
   * NOT public API: the internal document, kept for undo, autosave and tests.
   * Its shape is free to change between versions — store `exportHtml()` instead.
   */
  getContent(): EmailDocument;
  /** NOT public API — see `getContent`. */
  setContent(doc: EmailDocument): void;

  /** The internal engine. Its shape is free to change between versions. */
  readonly core: EditorCore;

  addEventListener<K extends keyof MailCraftEditorEventMap>(
    type: K,
    listener: (this: MailCraftEditor, ev: MailCraftEditorEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof MailCraftEditorEventMap>(
    type: K,
    listener: (this: MailCraftEditor, ev: MailCraftEditorEventMap[K]) => any,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

// ---------------------------------------------------------------------------
// createEditor — mount into a container

export interface CreateEditorOptions {
  /** Initial email HTML, applied through the importer as an undoable edit. */
  html?: string;
  /** Template name for that content — only read alongside `html`. */
  name?: string;
  variables?: string | string[];
  /** One of the 31 shipped tags. */
  locale?: string;
  /** Defaults from `locale`. */
  dir?: 'ltr' | 'rtl';
  theme?: 'light' | 'dark';
  uiFont?: string;
  accent?: string;
  toolbar?: ToolbarOption;
  footer?: FooterOption;
  storageProvider?: StorageProvider | null;
  storageLimits?: StorageLimits | null;
  aiProvider?: AiProvider | null;
  iconProvider?: IconProvider | null;
  messages?: MessageTable | null;
  /** Sets the container's height; a number is treated as px. Omit it and your CSS decides. */
  height?: string | number;
  /** Empty the container first (default: append). */
  replace?: boolean;
  onChange?(doc: EmailDocument): void;
  onExport?(html: string): void;
}

export interface EditorHandle {
  /** The underlying custom element — everything the wrapper does not forward. */
  element: MailCraftEditor;
  /** Removes the editor and detaches the listeners this call attached. */
  destroy(): void;
  exportHtml(): string;
  importHtml(html: string): number;
  loadTemplate(tpl: Template): void;
  undo(): void;
  redo(): void;
  screenshotPng(): Promise<Blob>;
  previewScreenshot(): void;
  downloadScreenshot(blob?: Blob): Promise<void>;
  copyScreenshot(blob?: Blob): Promise<void>;
}

/** Creates a `<mailcraft-editor>` inside `target` (a CSS selector or element). Throws when nothing matches. */
export function createEditor(target: string | Element, options?: CreateEditorOptions): EditorHandle;

/** True once the custom element is registered — importing the package is what registers it. */
export function isReady(): boolean;

// ---------------------------------------------------------------------------
// Internals, exported for building your own UI on top.
// Typed loosely on purpose: their shapes are free to change between versions.

export class EditorCore {
  constructor(options?: {
    variables?: string | string[];
    aiProvider?: AiProvider | null;
    iconProvider?: IconProvider | null;
    messages?: MessageTable | null;
    storageProvider?: StorageProvider | null;
    storageLimits?: StorageLimits | null;
  });
  state: Record<string, any>;
  [key: string]: any;
}

/** Renders the document tree: `live = true` is the editable canvas, `false` the static preview/export tree. */
export function renderDoc(core: EditorCore, live?: boolean): HTMLElement;

export interface BlockDef {
  type: string;
  code: string;
  label: string;
  hint: string;
  make(): Record<string, any>;
}

/** The 20 content-block definitions. */
export const BLOCKS: BlockDef[];

/** Compound presets — `build()` returns full row(s) built from ordinary blocks. */
export const GROUPS: Record<string, { label: string; icon: string; build(): Array<Record<string, any>> }>;

/** The section layouts (column span presets). */
export const LAYOUTS: Array<{ spans: number[]; label: string }>;

/** The palette order: `t` names a block type, `g` a group. */
export const PALETTE: Array<{ t?: string; g?: string }>;

// ---------------------------------------------------------------------------

declare global {
  interface HTMLElementTagNameMap {
    'mailcraft-editor': MailCraftEditor;
  }
}
