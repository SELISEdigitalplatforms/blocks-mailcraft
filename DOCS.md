# MailCraft — product & integration guide

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
| Size | ~553 KB minified, ~152 KB gzipped, one file |
| Languages | 31, RTL automatic |
| Content blocks | 18 — text, heading, image, button, divider, spacer, social, video, countdown, menu, list, table, box, html, css, code, svg, embed |

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

### 2. The editor never makes a network request

There is no `fetch` anywhere in the package. No base URL, no auth, no upload endpoint, no telemetry.

Image storage is a plain object the host assigns:

```js
editor.storageProvider = { list, upload, folders?, remove? };
```

You write those functions next to the auth and base URL you already own, and point them at S3, a DMS, a CDN or your own API. No adapter ships in the package, on purpose: an adapter is a mapping onto someone else's API surface, so vendoring one would mean republishing this package every time that surface moves.

The same applies to AI (`.aiProvider` is one `async (prompt) => text` function) and to social icons (`.iconProvider`).

### 3. Upload policy belongs to the host

The package ships **no default limits**. What an email may carry depends on the sending platform's caps, the audience's mail clients, and the host's own product rules — none of which this package can know.

With a provider wired and no limits declared, uploads are refused rather than waved through. Silently accepting anything is the exact failure the limits exist to prevent.

Two supporting details:

- **Formats are decided by reading the file's leading bytes**, not `file.type`. The browser fills `file.type` in from the extension, so renaming `payload.svg` to `photo.png` would otherwise walk a script-bearing document straight into the editor's own DOM, where the library tile renders it.
- **SVG needs a second, explicit opt-in** (`allowSvg: true`) even when listed in `accept`. It is the one image type that is also a script host, and no one should enable it by pasting a permissive MIME list.

Validation runs *before* the provider is called, so a rejected file never reaches your backend — which matters for any store where minting an upload URL also creates the file record.

### 4. The editor's chrome is the host's decision

An editor embedded in a product that already has a header, a breadcrumb and a Save button ends up with two bars and two logos stacked on each other. So the top bar is switchable down to the individual control, and can be removed entirely.

Hiding a control never removes the capability: every one is also a method on the element, so a host that renders its own bar keeps all of it. Keyboard shortcuts are bound on the document and work either way.

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

Applying one is a normal undoable edit with a toast, and your string is never mutated. Ready-made examples live in [`examples/templates/`](examples/templates/) with a working picker in [`examples/vanilla.html`](examples/vanilla.html) — both host-app content, not part of the package.

## Merge variables

```html
<mailcraft-editor variables="first_name,company,unsubscribe_url"></mailcraft-editor>
```

Users insert them from the toolbar; they export as `{{first_name}}`.

## Image uploads

Both properties are required. Without them the library keeps its built-in demo files and every upload is refused.

```js
editor.storageLimits = {
  accept: ['image/jpeg', 'image/png', 'image/gif'],
  maxBytes: 2 * 1024 * 1024,
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
```

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

Override any individual string:

```js
editor.messages = { 'action.export': 'Send to campaign' };
```

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
| `toolbar` | `none`, or a comma list of the parts to keep |
| `footer` | `none`, or any string to use as the line |

### Properties

| property | type |
|---|---|
| `.variables` | string or array |
| `.toolbar` | `false`, or `{ part: false }` |
| `.footer` | `false`, a string, or `{ text, href, target }` |
| `.uiFont` | string |
| `.accent` | string |
| `.messages` | `{ key: string }` |
| `.storageProvider` | `{ list, upload, folders?, remove? }` |
| `.storageLimits` | `{ accept, maxBytes, maxWidth?, maxHeight?, maxFilesPerDrop?, allowSvg? }` |
| `.aiProvider` | `async (prompt) => text` |
| `.iconProvider` | social-icon override |

### Package exports

| export | what it is |
|---|---|
| `createEditor(target, options)` | mount into a container, returns a handle |
| `isReady()` | whether the custom element is registered |
| `MailCraftEditor` | the element class |
| `LOCALES`, `LOCALE_TABLES`, `createTranslator` | i18n |
| `validateFiles`, `acceptAttribute`, `sanitizeName` | upload validation, reusable outside the editor |
| `EditorCore`, `renderDoc`, `BLOCKS`, `LAYOUTS` | internals, for building your own UI on top |

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

---

# How it works inside

Useful when debugging an integration, and required reading before contributing.

**Core / render split.** `src/core/` holds state and logic and never touches the DOM; `src/render/` builds all of it. The canvas is torn down and rebuilt on every state change — no diffing — and focus and caret survive through `data-focus-key` and `render/focus-preserve.js`.

**Shadow DOM everywhere.** The editor's styles and the host's cannot reach each other. Two consequences if you script against it: `window.getSelection()` does not see inside, and window-level listeners see a retargeted `event.target` — the host element, not the real node.

**Rows → columns → blocks.** A document is rows, each holding columns, each holding blocks. Older documents stay valid because every renderer falls back when a prop is missing, and a normalization pass fills the gaps on the way in.

**Import.** Real-world email HTML — inline and class styles, builder scaffolding, per-side borders, card columns, social strips — becomes native blocks wherever the shape is recognizable. Nested grids and `rowspan`/`colspan` survive as raw-HTML blocks: rendered and exported, not block-editable.

**Export** reads back the rendered DOM, so what the user sees is what ships. Import and export are meant to stay round-trip compatible.

**Build.** `build.js` is a zero-dependency bundler that turns the ESM sources into one plain `<script>`, then minifies through esbuild with a sourcemap alongside. esbuild is a dev dependency only — consumers install nothing transitive, and a clone with no `node_modules` still produces a working bundle.

```sh
npm install       # one devDependency (esbuild)
node build.js     # rebuild dist/ after any change under src/
npm test          # storage, export, templates, toolbar, system — no DOM needed
```

Deeper notes for contributors and coding agents live in [AGENTS.md](AGENTS.md).

---

MIT
