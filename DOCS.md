# Blocks MailCraft — product & integration guide

[README.md](README.md) is the five-minute version. This is the rest: what it is, why it works the way it does, and how to wire it into a real application.

## Contents

- [What it is](#what-it-is)
- [Why it is built this way](#why-it-is-built-this-way)
- [How to use it](#how-to-use-it)
  - [Install](#install)
  - [Two ways to mount](#two-ways-to-mount)
  - [Framework wiring](#framework-wiring)
  - [Saving and restoring](#saving-and-restoring)
  - [Templates](#templates)
  - [Merge variables](#merge-variables)
  - [Image uploads](#image-uploads)
  - [Choosing what the top bar shows](#choosing-what-the-top-bar-shows)
  - [Keyboard shortcuts](#keyboard-shortcuts)
  - [The footer strip](#the-footer-strip)
  - [Language, direction and theme](#language-direction-and-theme)
  - [Matching your app's typography](#matching-your-apps-typography)
  - [Matching your brand color](#matching-your-brand-color)
- [API reference](#api-reference)
- [How it works inside](#how-it-works-inside)

---

# What it is

A drag-and-drop editor for **HTML email**, packaged as a single Web Component.

```html
<mailcraft-editor></mailcraft-editor>
```

A user drags rows and blocks onto a canvas, edits text in place, styles it in an inspector panel, and gets email HTML that renders in Outlook, Gmail and Apple Mail. The host application gets one tag and two methods.

**What it is not:** a sending platform, a template gallery, a media library, or a CMS. It edits one email and hands it back. Sending, storing, cataloguing and serving files stay with the host, which already has systems for all four.

### At a glance

| | |
|---|---|
| Distribution | npm — `@seliseblocks/mailcraft` — or one `<script>` tag |
| Runtime dependencies | none |
| Framework | none — a custom element works in React, Angular, Vue, Svelte and plain HTML |
| Isolation | Shadow DOM; the editor's CSS and the host's cannot reach each other |
| Size | ~639 KB minified, ~172 KB gzipped, one file |
| Languages | 31, RTL automatic |
| Content blocks | 20 — text, heading, image, button, divider, spacer, social, video, countdown, menu, list, table, box, html, css, code, svg, embed, condition, loop |

---

# Why it is built this way

Four decisions shape the whole API. Each is a constraint the host would otherwise inherit.

### 1. HTML in, HTML out — no document format

The obvious design is to expose the editor's internal document as JSON and let hosts store that. It is also the one that ages worst: the moment a host persists that JSON, its shape becomes a public contract. Every new block type, every renamed prop, every changed default becomes a migration the host has to run against rows in its own database.

So the public contract is HTML, in both directions:

```js
editor.loadTemplate({ name: 'Welcome', html });
const html = editor.exportHtml();
```

Exported HTML is valid input to the importer, so **saving the export is saving the work**. The host stores a string in a column it already understands, and can send it, diff it, preview it, or open it in any other tool — none of which is true of a private JSON shape.

The internal document still exists. It is simply not yours to hold.

### 2. The editor never talks to a backend of its own

No base URL, no auth, no upload endpoint, no telemetry. The one `fetch` in the package is the screenshot capture inlining the images *your template already shows* so they can be drawn into the PNG — best-effort and CORS-bound, and an image the remote server refuses degrades to a blank pixel rather than a failed capture.

Image storage is a plain object the host assigns:

```js
editor.storageProvider = { list, upload, folders?, remove? };
```

You write those functions next to the auth and base URL you already own, and point them at S3, a DMS, a CDN or your own API. No adapter ships in the package, on purpose: an adapter is a mapping onto someone else's API surface, so vendoring one would mean republishing this package every time that surface moves.

The same applies to AI (`.aiProvider` is one `async (prompt) => text` function) and to social icons (`.iconProvider`).

### 3. Upload policy belongs to the host — formats excepted

Sizes and counts ship undefaulted: what an email may carry depends on the sending platform's caps and the host's own product rules — none of which this package can know. With a provider wired and no `maxBytes` declared, uploads are refused rather than waved through.

Formats are the one default: **every image type is allowed** — JPEG, PNG, GIF, WebP, BMP, TIFF, ICO, AVIF, HEIC — unless `accept` lists a narrower set. SVG keeps its own gate below.

Two supporting details:

- **Formats are decided by reading the file's leading bytes**, not `file.type`. The browser fills `file.type` in from the extension, so renaming `payload.svg` to `photo.png` would otherwise walk a script-bearing document straight into the editor's own DOM, where the library tile renders it.
- **SVG needs a second, explicit opt-in** (`allowSvg: true`) even when listed in `accept`. It is the one image type that is also a script host, and no one should enable it by pasting a permissive MIME list.

Validation runs *before* the provider is called, so a rejected file never reaches your backend — which matters for any store where minting an upload URL also creates the file record.

### 4. The editor's chrome is the host's decision

An editor embedded in a product that already has a header, a breadcrumb and a Save button ends up with two bars and two logos stacked on each other. So the top bar is switchable down to the individual control, and can be removed entirely.

Most of what the bar does survives without it. Undo, redo and export are element methods; the screenshot methods never needed the bar at all; and the keyboard shortcuts are bound at the window level, not on the bar, so `Ctrl/Cmd+Z`, `Shift+Ctrl/Cmd+Z` and `Ctrl/Cmd+E` keep working either way. Three panels are opened only from the bar, though — the live **preview** overlay, the **Code** modal and the **AI draft** panel — so dropping those parts does take them out of reach. The table under [Choosing what the top bar shows](#choosing-what-the-top-bar-shows) says which is which.

---

# How to use it

## Install

```sh
npm install @seliseblocks/mailcraft
```

```js
import '@seliseblocks/mailcraft';   // side effect: registers <mailcraft-editor>
```

Named exports (`MailCraftEditor`, `EditorCore`, `LOCALES`, `validateFiles`, …) come from the same entry.

**TypeScript** works out of the box — the package ships declarations (`types/index.d.ts`) for every named export, and registers `mailcraft-editor` in `HTMLElementTagNameMap`, so `document.createElement('mailcraft-editor')` and `querySelector('mailcraft-editor')` come back typed. The contract types (`StorageProvider`, `StorageLimits`, `Asset`, `ToolbarOption`, `FooterOption`, `CreateEditorOptions`, …) are exported for your own signatures:

```ts
import type { StorageProvider, StorageLimits } from '@seliseblocks/mailcraft';
```

**Server-side rendering:** the module defines a custom element, so import it in the browser only — inside a `useEffect`, an `onMounted`, or a `dynamic(..., { ssr: false })` component.

Without a bundler:

```html
<script src="https://unpkg.com/@seliseblocks/mailcraft/dist/mailcraft-editor.bundle.js"></script>
```

## Two ways to mount

**As a tag**, when the container is part of your markup:

```html
<mailcraft-editor id="editor" toolbar="none"></mailcraft-editor>
```

**Into a container from code**, the shape most JS widgets ship with — you hand it a target and options, and get a handle back:

```js
import { createEditor } from '@seliseblocks/mailcraft';

const editor = createEditor('#mail', {
  html,                                  // initial content, through the importer
  name: 'Welcome',                       // template name for that content (optional)
  variables: ['first_name', 'company'],
  locale: 'de',
  toolbar: { logo: false },
  storageProvider, storageLimits,
  onChange(doc) { setDirty(true); },
  onExport(html) { save(html); },
});

editor.exportHtml();
editor.element;      // the underlying <mailcraft-editor>, for anything not forwarded
editor.destroy();    // removes it; anything else in the container is left alone
```

`target` is a CSS selector or an element, and a target that matches nothing throws rather than failing silently. The handle forwards `exportHtml`, `importHtml`, `loadTemplate`, `undo`, `redo`, `screenshotPng`, `previewScreenshot`, `downloadScreenshot` and `copyScreenshot`.

Every option, in full:

| option | what it does |
|---|---|
| `html` | initial content, applied through the importer as an undoable edit |
| `name` | the template name that content is loaded under — only read alongside `html`, and defaults to `''` |
| `variables`, `locale`, `dir`, `theme`, `uiFont`, `accent` | the attributes, under their property spellings (`uiFont` is `ui-font` in markup) |
| `toolbar`, `footer` | as documented below — objects and `false` included, since these are set as properties |
| `storageProvider`, `storageLimits`, `aiProvider`, `iconProvider`, `messages` | the property-only options |
| `height` | sets the *container's* height; a number is treated as `px`. Omit it and your CSS decides |
| `replace` | empty the container first (default: append) |
| `onChange(doc)`, `onExport(html)` | the two events, as callbacks. `destroy()` detaches them |

It is a wrapper, not a second implementation — it creates the same element and sets the same attributes and properties. The only thing it adds is not having to know which options are attributes (strings) and which must be properties (objects and functions).

**The container supplies the height.** The editor is `display: block; height: 100%`, so `#mail { height: 560px }` in your CSS, a flex/grid cell, or `{ height: 560px }` in the options — all work. Nothing is guessed for you.

By default the editor is appended, so existing content in the container survives; pass `{ replace: true }` to empty it first.

## Framework wiring

The element is framework-agnostic; only the plumbing differs.

**React** — attributes carry strings, so set objects and functions as properties on a ref:

```jsx
import { useEffect, useRef } from 'react';

export function EmailEditor({ html, onSave }) {
  const ref = useRef(null);

  useEffect(() => {
    import('@seliseblocks/mailcraft').then(() => {
      const el = ref.current;
      el.storageLimits = { accept: ['image/jpeg', 'image/png'], maxBytes: 2e6 };
      el.storageProvider = myProvider;
      if (html) el.loadTemplate({ name: 'Draft', html });
    });
  }, []);

  return (
    <>
      <mailcraft-editor ref={ref} toolbar="none" variables="first_name,company" />
      <button onClick={() => onSave(ref.current.exportHtml())}>Save</button>
    </>
  );
}
```

**Angular** — add `CUSTOM_ELEMENTS_SCHEMA` to the module, then drive it from a `ViewChild` the same way.

**Vue / Svelte** — both set DOM properties for non-string bindings automatically, so `<mailcraft-editor :toolbar="cfg">` works as written.

## Saving and restoring

```js
// save
await api.saveDraft(id, editor.exportHtml());

// restore
editor.loadTemplate({ name: 'Draft', html: await api.loadDraft(id) });
```

Editing continues where it left off. Anything the importer cannot classify into an editable block survives as a raw-HTML block — rendered and exported, never dropped.

The editor also autosaves to `localStorage`, scoped **per browser tab**, so two tabs are two independent documents. That is a convenience for reload, not your persistence layer.

## Templates

Templates are host content **and** host UI. The editor ships no catalogue and has no Templates tab — you render your own picker and push the choice in:

```js
editor.loadTemplate({ name: 'Welcome', html });
```

Applying one is a normal undoable edit with a toast, and your string is never mutated. Ready-made examples ship in the package under `examples/templates/`, with a working picker in [`examples/vanilla.html`](examples/vanilla.html) — both host-app content, shipped in the package for you to lift but not part of its API.

## Merge variables

```html
<mailcraft-editor variables="first_name,company,unsubscribe_url"></mailcraft-editor>
```

Users insert them from the toolbar; they export as `{{first_name}}`.

### Conditions and loops

**Condition** and **Loop** are blocks in the palette. Dropping one inserts a *pair* of markers — a start band and an end band — and everything the user drags between them is what the logic applies to. Dropped inside a column, the pair wraps blocks; dropped onto the canvas between sections, each marker gets a slim row of its own, so whole sections can be moved between them. From then on each half is an ordinary block: moved, duplicated or deleted independently.

Like merge tags, the editor never evaluates the expressions — the export emits literal Handlebars-style tags at the markers' positions for your templating engine to run at send time:

```html
{{#if has_order}}
{{#each order.items}}
…whatever sits between the markers, once per item…
{{/each}}
{{/if}}
```

The exporter balances the document as a whole: a stray end marker emits nothing, and a start whose end was deleted is auto-closed after the last row, so the output template is always well-formed. Marker-only rows emit just the tag — no empty `<tr>` band reaches a recipient — and inside a loop, item-scoped merge tags (`{{ this.name }}`, `{{ price }}`) pass through like any other token. The markers render as dashed teal `SHOW IF` / violet `REPEAT EACH` bands on the canvas, in the preview, and in the code view's live pane — every editor surface shows the template the way it shows merge tokens — while a recipient sees nothing but the engine's output. Exported tags round-trip: re-importing the HTML restores them as marker blocks in the same positions.

A start marker's expression field suggests the host's `variables` in a dropdown but stays free text, since conditions and loops routinely reference names that aren't inline tokens (`order.items`, a boolean flag, whatever your engine understands).

## Image uploads

A provider and a `maxBytes` ceiling are both required. The package ships no files of its own: with no provider the library opens empty and holds only what is dropped into it — data URIs, kept in the local draft, which no email client renders. With a provider but no `maxBytes` every upload is refused.

```js
editor.storageLimits = {
  maxBytes: 2 * 1024 * 1024,
  accept: ['image/jpeg', 'image/png', 'image/gif'],  // optional: omit to allow every image type
  maxWidth: 1600, maxHeight: 1600,   // optional
  maxFilesPerDrop: 20,               // optional
  allowSvg: false,                   // SVG needs this AND a place in `accept`
};

editor.storageProvider = {
  async list({ folderId, cursor, query, signal }) {
    const r = await api.images({ folderId, cursor, query });
    return {
      items: r.files.map((f) => ({
        id: f.id, name: f.name, url: f.url,
        folderId: f.folderId, w: f.width, ht: f.height, size: f.bytes,
      })),
      cursor: r.next ?? null,          // null when there are no more pages
    };
  },

  async upload(file, { folderId, width, height, signal }) {
    const saved = await api.upload(file, folderId);
    return { id: saved.id, name: file.name, url: saved.url,
             folderId, w: width, ht: height, size: file.size };
  },

  async folders() { return api.folders(); },            // optional: [{ id, name }]
  async remove(asset) { await api.delete(asset.id); },  // optional
};
```

Why the shape is what it is:

- `cursor` is opaque — whatever you returned last, handed back for the next page. Folder and search are the backend's job; re-filtering the current page client-side would hide matches on the next one.
- `signal` is an `AbortSignal`. Listings and uploads get **separate** abort scopes: changing folder cancels the listing it supersedes, but must never kill uploads already in flight.
- Without `remove`, the library's delete only drops the tile from view.
- **`url` must still resolve after the email is sent.** A URL that expires in an hour produces mail whose images are already broken when it lands.

A provider may also carry its own `limits` object, for a backend that knows its own ceilings:

```js
editor.storageProvider = { list, upload, limits: { accept: [...], maxBytes: 5e6 } };
```

The two are merged **per key**, with `editor.storageLimits` winning — so a provider can ship sane defaults and the host can still tighten one number without restating the rest. Either source satisfies the "`maxBytes` is required" rule; only a file that passes the merged result reaches `upload`.

Setting `editor.storageProvider = null` drops back to that empty local library.

`examples/vanilla.html` wires a working provider over IndexedDB — latency, cursor paging, server-side folders and search, uploads that survive a reload, deletes that stay deleted. It is the shape of a real integration with `fetch` swapped out, and it is where every file in the live demo's Assets modal comes from.

## Choosing what the top bar shows

```html
<mailcraft-editor toolbar="none"></mailcraft-editor>                <!-- no bar -->
<mailcraft-editor toolbar="undo,redo,export"></mailcraft-editor>    <!-- only these -->
```

```js
editor.toolbar = false;                        // no bar
editor.toolbar = { logo: false, ai: false };   // drop these, keep the rest
```

Parts: `logo`, `status`, `device`, `undo`, `redo`, `theme`, `ai`, `code`, `preview`, `export`.

The **attribute names what to keep**; the **property names what to drop**. Markup has only strings to work with, and an allow-list reads better there than spelling out the seven things you did not want. Switching every part off collapses to no bar rather than an empty strip.

`none` is the documented spelling for "no bar"; `hidden`, `off` and `false` are accepted as the same thing, and `toolbar="all"` is the explicit form of the default. The property takes `false` for no bar, and an object where only the keys set to `false` do anything — unlisted parts stay on.

### What a hidden part costs you

| part | with the bar gone |
|---|---|
| `undo` / `redo` | `editor.undo()`, `editor.redo()`, plus `Ctrl/Cmd+Z` and `Shift+Ctrl/Cmd+Z` |
| `export` | `editor.exportHtml()` returns the HTML; `Ctrl/Cmd+E` still opens the export dialog, and the Screenshot button lives inside it |
| `preview` | **bar-only** — the live desktop/mobile overlay has no method and no shortcut |
| `code` | **bar-only** — the import/export-HTML modal. `editor.importHtml(html)` covers the import half |
| `ai` | **bar-only** — the draft panel. `.aiProvider` is your function, so a host can call it directly |
| `theme` | set the `theme` attribute yourself; while it is set the toggle is hidden anyway |
| `logo`, `status`, `device` | display and view state only, nothing to lose |

Screenshots are unaffected by any of this: `screenshotPng()`, `previewScreenshot()`, `downloadScreenshot()` and `copyScreenshot()` are element methods.

`editor.core` reaches the rest (`core.openCode()`, `core.setState({ aiOpen: true })`, `core.setState({ previewOpen: true })`), but `EditorCore` is internal — its shape is free to change between versions. Keep `code`, `ai` or `preview` in the bar if you need them.

## Keyboard shortcuts

Bound at the window level while the editor is connected, so they work with any bar configuration, including none.

| keys | what it does |
|---|---|
| `Esc` | in a field: leave the field. Otherwise: clear the selection and close any open panel |
| `Ctrl/Cmd` + `Z` | undo |
| `Shift` + `Ctrl/Cmd` + `Z` | redo |
| `Ctrl/Cmd` + `E` | open the export dialog |
| `Ctrl/Cmd` + `K` | link the selected text — only while editing text |
| `Ctrl/Cmd` + `D` | duplicate the selected row or block |
| `Backspace` / `Delete` | delete the selected row or block |

Typing is never hijacked: inside a form field, `Ctrl/Cmd+Z` is the browser's own field undo and `Delete` deletes a character, not the block. Rich-text blocks are the exception for undo — their edits commit on blur, so document undo is what you want there. The screenshot viewer claims `Esc`, the arrow keys and `Space` while it is open.

One caveat if your app binds the same keys: the handler asks whether the event came from a text field, not whether it came from inside the editor. `Ctrl/Cmd+E` anywhere on the page opens the export dialog, and `Backspace` on a non-field element elsewhere in your UI deletes the editor's selected block. An editor kept on a route of its own never notices; one sitting beside your own keyboard-driven UI might, and the fix is to `stopPropagation()` on the keydowns you own before they reach `window`.

## The footer strip

The editor carries a one-line attribution along the bottom of the shell:

> Powered by SELISE Blocks © 2026

It is configurable the same way the top bar is — replace the line, point it
somewhere, or remove it:

```html
<mailcraft-editor footer="none"></mailcraft-editor>            <!-- no strip -->
<mailcraft-editor footer="© 2026 Acme"></mailcraft-editor>     <!-- your line -->
```

```js
editor.footer = false;                                            // no strip
editor.footer = '© 2026 Acme';                                    // your line
editor.footer = { text: 'Acme Mail', href: 'https://acme.test' }; // ...with a link
editor.footer = { show: false };                                  // no strip, from a config object
```

`{ show: false }` is there for hosts that build the footer config as an object and would rather flip a flag than swap the whole value for `false`. As with the toolbar, `hidden`, `off` and `false` work in the attribute wherever `none` does.

A link opens in a new tab (`rel="noopener noreferrer"`) so a click never carries
unsaved work out of the editor; pass `target` to override. Schemes are
allowlisted to `http(s)`, `mailto` and relative paths — the strip renders inside
the editor's own DOM.

The default line is a translated string, not baked-in text, so it follows
`locale` and can be reworded like any other label:

```js
editor.messages = { 'footer.poweredBy': 'Powered by Acme' };
```

Hiding the strip collapses its row — the canvas keeps every pixel it had.

## Language, direction and theme

```html
<mailcraft-editor locale="de" theme="dark"></mailcraft-editor>
```

31 locales ship. `dir` follows the locale automatically (`locale="ar"` gives RTL) and can be overridden. While `theme` is set the host owns light/dark and the editor hides its own toggle.

Tables load lazily: in a bundled app each locale is its own code-split chunk, fetched the first time its tag is used, so you ship only the languages you render (English is always built in). The chrome shows English for the instant the chunk takes to arrive; call `loadLocale(tag)` ahead of time to have it ready before you flip the attribute. The single-file CDN bundle carries every table, so switching there is always instant.

Override any individual string:

```js
editor.messages = { 'action.export': 'Send to campaign' };
```

Every key, with its English default, is listed in [Every message key](#every-message-key). English is always the floor: a key your table leaves out shows the built-in English rather than a gap, and `missingKeys(yourTable)` tells you what a full replacement still lacks.

## Matching your app's typography

```html
<mailcraft-editor ui-font="inherit"></mailcraft-editor>
<mailcraft-editor ui-font="'IBM Plex Sans', Arial, sans-serif"></mailcraft-editor>
```

Editor chrome only — never the fonts inside the email being edited.

## Matching your brand color

```html
<mailcraft-editor accent="#e11d48"></mailcraft-editor>
<mailcraft-editor accent="var(--brand)"></mailcraft-editor>
<mailcraft-editor accent="inherit"></mailcraft-editor>
```

One color repaints every accented pixel in the editor — there is no second
place to set. It reaches:

| | |
|---|---|
| header | brand mark, code badge, undo/redo and export states |
| inspector | active tabs and segments, focus rings, switches, sliders, field focus |
| RTE | active controls, hover states, the color-picker ring |
| canvas | row and block selection outlines, hover dashes, the drag insertion line, drop-target outlines |
| canvas | the row **grip badge** and the block toolbars sitting on the email sheet |
| everywhere | text selection, tinted washes, hover shades |

`var(--brand)` is read off the host element; `inherit` reads the host's CSS
`accent-color`.

Contrast is corrected per surface, not just picked. The editor paints on two:
the **panels**, which follow the light/dark theme, and the **email sheet**,
which is a white page in both. A brand color is fitted separately against each
— darkened where it would wash out on white, lightened where it would vanish on
the dark panels, each only as far as WCAG AA needs — so the grip badge on the
page never inherits the pale accent the dark chrome needs. Text drawn *on* the
accent flips between white and near-black to stay legible. A brand color that
already passes is used exactly as given. An unusable value is ignored, with a
console warning, and the built-in accent stays.

Nothing notifies an element that a CSS custom property changed, so if your own
`--brand` moves at runtime, re-set the attribute to have it re-read:

```js
document.documentElement.style.setProperty('--brand', next);
editor.accent = 'var(--brand)';   // same string: re-reads the token
editor.accent = next;             // ...or just hand over the literal
```

Editor chrome only — colors inside the email being edited belong to the
template, not to your app.

---

# API reference

### Attributes

| attribute | values |
|---|---|
| `variables` | comma-separated merge tags |
| `locale` | any of the 31 shipped tags |
| `dir` | `ltr` / `rtl` — defaults from `locale` |
| `theme` | `light` / `dark` |
| `ui-font` | `inherit` or a CSS font-family stack |
| `accent` | a CSS color, `var(--your-token)`, or `inherit` (the host's `accent-color`) |
| `toolbar` | `none` (or `hidden` / `off` / `false`), `all`, or a comma list of the parts to keep |
| `footer` | `none` (or `hidden` / `off` / `false`), or any string to use as the line |

### Properties

| property | type |
|---|---|
| `.variables` | string or array |
| `.toolbar` | `false`, or `{ part: false }` |
| `.footer` | `false`, a string, or `{ text, href, target, show }` |
| `.uiFont` | string |
| `.accent` | string |
| `.messages` | `{ key: string }` |
| `.storageProvider` | `{ list, upload, folders?, remove?, limits? }` — `null` drops back to the empty local library |
| `.storageLimits` | `{ accept?, maxBytes, maxWidth?, maxHeight?, maxFilesPerDrop?, allowSvg? }`, merged over `provider.limits` per key |
| `.aiProvider` | `async (prompt) => text` |
| `.iconProvider` | `(platformKey, { label, size, color }) => Node` — social-icon override; falls back to the built-in icon when it is unset, throws, or returns a non-node |

### Package exports

| export | what it is |
|---|---|
| `createEditor(target, options)` | mount into a container, returns a handle |
| `isReady()` | whether the custom element is registered |
| `MailCraftEditor` | the element class |
| `LOCALES`, `LOCALE_TABLES`, `createTranslator` | i18n: the shipped tags, their tables, and the translator the editor uses |
| `LOCALE_LOADERS`, `loadLocale(tag)` | lazy per-locale table loading — what the `locale` attribute resolves through, so a bundled app ships only the locales it uses. `loadLocale` prefetches one (e.g. before flipping `locale` at runtime) |
| `defineMessages(base, overrides)` | merge a shipped locale with your own overrides — the supported way to build a `.messages` value |
| `missingKeys(locale, base)` | keys `base` has that `locale` does not translate. What a translator has left to do |
| `EN`, `MESSAGE_KEYS` | the English table and every key in it — listed in [Every message key](#every-message-key) |
| `isRtl(tag)` | whether a locale tag is right-to-left. Metadata — `dir` is what actually flips the layout |
| `validateFiles`, `acceptAttribute`, `sanitizeName` | upload validation, reusable outside the editor |
| `limitsProblem(limits)` | what a limits object is missing, if anything — the check that refuses uploads |
| `resolveLimits(hostLimits, providerLimits)` | the per-key merge the editor applies to the two limit sources |
| `normalizeAsset(raw, probe)`, `ALL_FOLDER_ID` | coerce a provider's item into the library's asset shape; the id of the synthetic "all files" folder (`''`) |
| `EditorCore`, `renderDoc`, `BLOCKS`, `GROUPS`, `LAYOUTS`, `PALETTE` | internals, for building your own UI on top |

### Methods

| method | returns |
|---|---|
| `exportHtml()` | send-ready email HTML |
| `importHtml(html)` | number of rows produced |
| `loadTemplate({ name, html })` | — |
| `undo()` / `redo()` | — |
| `screenshotPng()` | full template as a PNG `Blob` |
| `previewScreenshot()` | opens the story-style viewer |
| `downloadScreenshot(blob?)` / `copyScreenshot(blob?)` | save / clipboard — captures first if no blob is passed |

### Events

| event | `detail` |
|---|---|
| `change` | the internal document — for dirty-tracking, not persistence |
| `export` | the exported HTML string |

### Not public API

`getContent()` / `setContent(doc)` expose the internal document. They exist because undo, autosave and the test suite need them. The shape is free to change between versions — store `exportHtml()` instead.

### Every message key

The complete catalog of UI strings that `.messages` accepts — every key the editor ever asks for, with its built-in English text. In code the same catalog is `EN` (keys with values) and `MESSAGE_KEYS` (just the keys), and `missingKeys(yourTable)` diffs a custom table against it.

<!-- message-keys:begin — generated by build.js from src/core/i18n/en.js; edit en.js and run `node build.js`, never this table. -->

| key | English default |
|---|---|
| `action.aiDraft` | Draft |
| `action.aiDraftHint` | Draft email content with AI |
| `action.applyToCanvas` | Apply to canvas |
| `action.applyToCanvasHint` | Parse the source back into editable rows |
| `action.chromeHint` | Light / dark editor chrome |
| `action.chromeHintToDark` | Dark mode |
| `action.chromeHintToLight` | Light mode |
| `action.chromeToDark` | Dark |
| `action.chromeToLight` | Light |
| `action.close` | Close |
| `action.closeWithoutApplyingHint` | Close without applying |
| `action.code` | Code |
| `action.codeHint` | Edit the raw HTML with a live preview |
| `action.deleteHint` | Delete — ⌫ |
| `action.download` | Download |
| `action.downloadPng` | Download PNG |
| `action.duplicateHint` | Duplicate — ⌘D |
| `action.export` | Export |
| `action.exportHint` | Export your email |
| `action.preview` | Preview |
| `action.previewHint` | Preview the email |
| `action.redoHint` | Redo — ⌘⇧Z |
| `action.reload` | Reload |
| `action.reloadHint` | Reload the source from the canvas |
| `action.screenshot` | Screenshot |
| `action.screenshotHint` | Preview the full template as an image, then download it |
| `action.undoHint` | Undo — ⌘Z |
| `action.upload` | Upload |
| `ai.actionInsertButton` | Insert as button |
| `ai.actionInsertHeading` | Insert as heading |
| `ai.actionInsertText` | Insert as text block |
| `ai.briefLabel` | What is this email about? |
| `ai.briefPlaceholder` | e.g. Autumn outerwear drop, 15% for subscribers, free shipping over $150 |
| `ai.disclosure` | AI creates suggestions from your brief. Review and edit the result before sending. |
| `ai.generate` | Generate draft with AI |
| `ai.goal` | Goal |
| `ai.kindBody` | Body copy |
| `ai.kindButton` | Button label |
| `ai.kindHeadline` | Headline |
| `ai.tone` | Tone |
| `ai.writing` | Writing… |
| `blocks.count` | {count} blocks |
| `blocks.dragHint` | Drag a block onto the canvas |
| `canvas.meta` | {rows} rows · {blocks} blocks · {width}px |
| `code.applyNote` | Apply parses each top-level table row back into a canvas row you can still select, reorder and delete — hand-written markup survives the round trip. |
| `code.liveHtmlPreviewTitle` | Live HTML preview |
| `code.livePreview` | Live preview |
| `code.meta` | {kb} KB · {lines} lines |
| `code.source` | Source |
| `code.statusEdited` | Code view — edited — preview live, not yet applied |
| `code.statusSynced` | Code view — in sync with the canvas |
| `device.desktop` | Desktop |
| `device.desktopHint` | Desktop width |
| `device.mobile` | Mobile |
| `device.mobileHint` | Mobile width |
| `export.copied` | Copied |
| `export.copy` | Copy email |
| `export.meta` | {kb} KB · ready to copy or download |
| `files.dragToCanvas` | Drag any file straight onto the canvas to place it as an image block. |
| `files.libraryCount` | Library — {count} files |
| `files.openManager` | Open media library |
| `footer.poweredBy` | Powered by SELISE Blocks © 2026 |
| `inspector.blockProperties` | Block properties |
| `inspector.emptyBody` | Pick a row or block on the canvas to style it here. Drag blocks in from the <strong style="color: var(--ed-text); font-weight: 600;">Content blocks</strong> tab; double-click any text to edit it in place. |
| `inspector.nothingSelected` | Nothing selected |
| `inspector.sectionLabel` | Section |
| `inspector.sectionProperties` | Section properties |
| `inspector.shortcuts` | Shortcuts |
| `inspector.title` | Inspector |
| `layers.blockCount` | {count} blocks |
| `layers.column` | Column {index} |
| `layers.sectionMulti` | Section · {count} columns |
| `layers.sectionSingle` | Section |
| `layers.structure` | Structure |
| `library.allFiles` | All files |
| `library.clickToPlace` | Click a file to place it · drag a file onto the canvas |
| `library.clickToReplace` | Click a file to replace the selected image |
| `library.del` | DEL |
| `library.deleteFileHint` | Delete file |
| `library.dropHint` | Drop image files here to upload — or use the Upload button. |
| `library.empty` | No files here yet. |
| `library.folders` | Folders |
| `library.loadMore` | Load more |
| `library.searchPlaceholder` | Search files… |
| `library.storageLabel` | {count} files · {size} |
| `modal.aiDraft` | AI writing assistant |
| `modal.aiDraftTitle` | Draft your email with AI |
| `modal.assetsTitle` | Assets |
| `modal.export` | Export |
| `modal.exportTitle` | Your email is ready |
| `modal.fileManager` | Media library |
| `modal.rawHtmlTitle` | Raw HTML, live preview |
| `modal.replaceImage` | Replace image |
| `preview.kickerDesktop` | Preview — desktop {width}px |
| `preview.kickerMobile` | Preview — mobile 375px |
| `rows.canvasModel` | Canvas model |
| `rows.customMarkup` | Custom markup |
| `rows.hintRows` | Section based: drop a layout first, then drop blocks into its columns — every section carries its own background, border, flex or grid settings. |
| `rows.hintStack` | Free stack: skip layouts — every block you drop becomes its own full-width section, stacked in order. |
| `rows.htmlRowHint` | Drag in, or click to append — a full-bleed row you fill with raw HTML |
| `rows.modeFreeStack` | Free stack |
| `rows.modeRowBased` | Row based |
| `rows.rawHtmlDesc` | Full-bleed section, your markup, still draggable |
| `rows.rawHtmlSection` | Raw HTML section |
| `rows.sectionLayouts` | Section layouts |
| `rte.clearFormatting` | Clear formatting |
| `rte.highlightColor` | Highlight color |
| `rte.mergeTags` | Merge Tags |
| `rte.noMergeTags` | No merge tags available |
| `rte.removeHighlight` | Remove highlight |
| `rte.textColor` | Text color |
| `rte.textStyle` | Text style |
| `shortcut.delete` | ⌫ — delete selection |
| `shortcut.duplicate` | ⌘D — duplicate selection |
| `shortcut.escape` | ESC — deselect, close |
| `shortcut.export` | ⌘E — export email |
| `shortcut.undoRedo` | ⌘Z / ⌘⇧Z — undo, redo |
| `status.autosaveOn` | autosave on |
| `status.saveFailed` | not saved — storage full |
| `status.saved` | saved {time} |
| `storage.errDeleteFailed` | {name} could not be deleted — {reason} |
| `storage.errDimensions` | {name} is {w}×{ht}px — the limit is {maxW}×{maxH}px. |
| `storage.errFormat` | {name} is a {type} file, which is not allowed here. |
| `storage.errLoadFailed` | The file library could not be loaded — {reason} |
| `storage.errNoLimits` | Uploads are switched off: this app has not set any upload limits. |
| `storage.errNoMaxBytes` | Uploads are switched off: no maximum file size has been set. |
| `storage.errSvg` | {name} is an SVG, which this app does not accept. |
| `storage.errTooLarge` | {name} is {size} — the limit is {max}. |
| `storage.errTooMany` | Only {max} files can be uploaded at once. |
| `storage.errUnreadable` | {name} is not a readable image. |
| `storage.errUploadFailed` | {name} could not be uploaded — {reason} |
| `storage.loading` | Loading files… |
| `storage.uploading` | Uploading {count}… |
| `story.copy` | Copy |
| `story.failed` | Screenshot failed |
| `story.failedHint` | An image in the template could not be loaded for capture. |
| `story.kicker` | Screenshot |
| `story.meta` | {w}×{h} · screen {i} of {n} |
| `story.pause` | Pause |
| `story.play` | Play |
| `story.rendering` | Rendering the screenshot |
| `story.renderingHint` | Painting every block at 2× — this takes a moment on a long template. |
| `story.replay` | Replay |
| `story.retry` | Try again |
| `tab.blocks` | Content blocks |
| `tab.blocksHint` | Content blocks and variables |
| `tab.data` | Variables |
| `tab.dataHint` | Variables provided by your code |
| `tab.design` | Design |
| `tab.designHint` | Style the selection |
| `tab.files` | Assets |
| `tab.filesHint` | Asset library |
| `tab.layers` | Layers |
| `tab.layersHint` | Document structure |
| `tab.rows` | Sections |
| `tab.rowsHint` | Section layouts and canvas model |
| `tab.settings` | Settings |
| `tab.settingsHint` | Email settings |
| `toast.assetDeleted` | {name} deleted |
| `toast.buttonAdded` | Button added |
| `toast.duplicated` | Duplicated |
| `toast.fileUploadedMany` | {count} files uploaded |
| `toast.fileUploadedOne` | 1 file uploaded |
| `toast.headingAdded` | Heading added |
| `toast.htmlCopied` | HTML copied to clipboard |
| `toast.imageAdded` | Image added to canvas |
| `toast.imageReplaced` | Image replaced |
| `toast.parseError` | Could not parse that HTML |
| `toast.pngCopied` | Screenshot copied to clipboard |
| `toast.pngCopyFailed` | This browser would not accept an image on the clipboard |
| `toast.pngFailed` | Screenshot failed — an external image could not be loaded |
| `toast.pngSaved` | Screenshot downloaded |
| `toast.snippetCopied` | {name} copied — select a text block to insert it |
| `toast.snippetDefaultLabel` | Snippet |
| `toast.snippetInserted` | {name} inserted |
| `toast.sourceAppliedMany` | Source applied — {rows} rows back on the canvas |
| `toast.sourceAppliedOne` | Source applied — 1 row back on the canvas |
| `toast.sourceReloaded` | Source reloaded from canvas |
| `toast.templateLoaded` | {name} loaded |
| `toast.textBlockAdded` | Text block added |
| `vars.declaredNote` | Declared by your application — the canvas always shows the token, never a value. |
| `vars.filterPlaceholder` | Filter variables… |
| `vars.fromCode` | {count} from your code |
| `vars.insert` | insert |
| `vars.insertHint` | Click to insert into the selected text, heading or button |
| `vars.noMatch` | No variable matches that filter. |
| `vars.noneDeclared` | Your application has not declared any variables yet. |
| `vars.rteHint` | While editing text you can also pick a variable straight from the inline toolbar’s dropdown. |
| `vars.title` | Variables |

<!-- message-keys:end -->

---

# How it works inside

Useful when debugging an integration, or before changing the source.

**Core / render split.** `src/core/` holds state and logic and never touches the DOM; `src/render/` builds all of it. The canvas is torn down and rebuilt on every state change — no diffing — and focus and caret survive through `data-focus-key` and `render/focus-preserve.js`.

**Shadow DOM everywhere.** The editor's styles and the host's cannot reach each other. Two consequences if you script against it: `window.getSelection()` does not see inside, and window-level listeners see a retargeted `event.target` — the host element, not the real node.

**Rows → columns → blocks.** A document is rows, each holding columns, each holding blocks. Older documents stay valid because every renderer falls back when a prop is missing, and a normalization pass fills the gaps on the way in.

**Import.** Real-world email HTML — inline and class styles, builder scaffolding, per-side borders, card columns, social strips — becomes native blocks wherever the shape is recognizable. Nested grids and `rowspan`/`colspan` survive as raw-HTML blocks: rendered and exported, not block-editable.

**Export** reads back the rendered DOM, so what the user sees is what ships. Import and export are meant to stay round-trip compatible.

**Build.** `build.js` is a zero-dependency bundler that turns the ESM sources into one plain `<script>`, then minifies through esbuild with a sourcemap alongside. esbuild is a dev dependency only — consumers install nothing transitive, and a clone with no `node_modules` still produces a working bundle.

```sh
npm install       # devDependencies only: esbuild (minify), jsdom (DOM tests), c8 (coverage)
node build.js     # rebuild dist/ after any change under src/
npm test          # 13 suites — core logic runs DOM-free, the editor/importer suites run on jsdom
```

Deeper notes for coding agents and anyone changing the source live in `AGENTS.md` in the repository.

---

MIT
