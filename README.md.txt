<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/brand/blocks-mailcraft-dark.svg">
  <img src="assets/brand/blocks-mailcraft-light.svg" alt="Blocks MailCraft" height="72">
</picture>

Drag-and-drop email editor as a Web Component. No dependencies, no framework, no build step.

**[Live demo](https://mailcraft.seliseblocks.com/examples/vanilla.html)** · **[Documentation](https://mailcraft.seliseblocks.com/DOCS.html)**

```sh
npm install @seliseblocks/mailcraft
```

## Use

```js
import '@seliseblocks/mailcraft';   // registers <mailcraft-editor>
```

```html
<mailcraft-editor id="editor"></mailcraft-editor>
```

Or mount it into a container from code, without writing the tag:

```js
import { createEditor } from '@seliseblocks/mailcraft';

const editor = createEditor('#mail', { html, toolbar: false });
editor.exportHtml();
editor.destroy();
```

That is a working editor. It speaks HTML in both directions — there is no document format to store or migrate:

```js
editor.loadTemplate({ name: 'Welcome', html });   // give it HTML
const html = editor.exportHtml();                 // get send-ready HTML back
```

Exported HTML is valid input to `loadTemplate`, so saving the export *is* saving the user's work.

## Configure

| | |
|---|---|
| `variables="first_name,company"` | merge tags, exported as `{{first_name}}` |
| Condition / Loop blocks | dynamic content — exported as `{{#if …}}` / `{{#each …}}` for your sending engine |
| `locale="de"` | 31 languages, RTL automatic |
| `theme="light" \| "dark"` | host owns light/dark; hides the built-in toggle |
| `ui-font="inherit"` | match your app's font |
| `accent="#e11d48"` | your brand color, everywhere the editor is accented; also `var(--brand)` or `inherit` |
| `toolbar="none"` | hide the editor's own top bar |
| `footer="none"` | drop the "Powered by SELISE Blocks © 2026" strip, or pass your own line |
| `toolbar="undo,redo,export"` | …or keep only these parts |
| `.storageProvider` + `.storageLimits` | image uploads to your backend |
| `.aiProvider` | `async (prompt) => text`, powers the AI draft panel |
| `.messages` | override any UI string |

Every attribute is also a property. TypeScript declarations ship with the package. Full reference and integration recipes: **[DOCS.md](DOCS.md)**.

## Paste into your AI agent

Everything an assistant needs to wire this up correctly:

```
PACKAGE   @seliseblocks/mailcraft — Web Component, zero runtime deps
IMPORT    import '@seliseblocks/mailcraft'   (side effect: registers the element)
          Safe to import under SSR; the element itself renders in a browser only.
TYPES     TypeScript declarations ship in the package (types/index.d.ts) for every
          named export; 'mailcraft-editor' is registered in HTMLElementTagNameMap.
ELEMENT   <mailcraft-editor id="editor"></mailcraft-editor>
MOUNT     createEditor(target, options) -> handle   (no tag needed)
          target  = CSS selector or Element; throws if it matches nothing
          options = html, name, variables, locale, dir, theme, uiFont, accent, toolbar,
                    footer, storageProvider, storageLimits, aiProvider, iconProvider,
                    messages, height, replace, onChange(doc), onExport(html)
                    name = template name for `html`; read only alongside it
          handle  = the METHODS below + .element + .destroy()
          The container supplies the height; the editor fills it.

DATA      HTML in, HTML out. There is no JSON document format in the public API.
          editor.loadTemplate({ name, html })   apply HTML  (undoable, deep-copied)
          editor.importHtml(html)               apply HTML  (same importer)
          editor.exportHtml() -> string         send-ready email HTML
          Persist by storing exportHtml() and passing it back to loadTemplate().
          Unclassifiable markup survives as a raw-HTML block. Nothing is dropped.
          Condition/Loop blocks export literal {{#if expr}}/{{#each expr}} tags
          (always balanced) for the host's templating engine; never evaluated
          by the editor, and re-import restores them as blocks.

EVENTS    'change'  detail = internal doc (do not persist this)
          'export'  detail = HTML string

ATTRS     variables="a,b,c" | locale="de" | theme="dark" | dir="rtl"
          ui-font="inherit" | accent="#e11d48" | accent="var(--brand)"
          toolbar="none" | toolbar="undo,redo,export" | footer="none"
PROPS     .variables .toolbar .footer .uiFont .accent .messages .aiProvider .iconProvider
          .storageProvider .storageLimits
METHODS   exportHtml() importHtml(html) loadTemplate(tpl) undo() redo()
          screenshotPng() previewScreenshot() downloadScreenshot() copyScreenshot()

KEYS      Bound on window, so they survive toolbar="none":
          Esc (leave field / deselect + close), Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z,
          Ctrl/Cmd+E (export dialog), Ctrl/Cmd+K (link, while editing),
          Ctrl/Cmd+D (duplicate), Backspace|Delete (delete selection).

UPLOADS   A provider plus `maxBytes` are required, or every upload is refused;
          every image type is allowed unless `accept` narrows it.
          editor.storageLimits   = { maxBytes: 2*1024*1024,
                                     accept:['image/jpeg','image/png'] }  // accept optional
          editor.storageProvider = { list(q), upload(file, o), folders?(), remove?(a),
                                     limits? }
          provider.limits is merged per key under .storageLimits, and satisfies
          the requirement on its own. With no provider the library is empty and
          local to the draft — the package ships no files of its own.
          The editor never talks to a backend of its own; its only fetch is the
          screenshot capture inlining the template's own images.

TOOLBAR   Parts: logo status device undo redo theme ai code preview export
          Attribute = allow-list (keep these). Property = { part: false } (drop these).
          none|hidden|off|false = no bar at all; all = the default.
          Hidden undo/redo/export stay reachable — methods, plus Ctrl/Cmd+Z, +E.
          preview, code and ai are bar-only: hiding them removes the panel.

DO NOT    Do not use getContent()/setContent() — internal, shape may change.
          Do not expect a campaign/title option — there is none; <title> is "Email".
```

## Develop

```sh
npm install && node build.js && npm test
```

`examples/vanilla.html` is a complete host page — open it directly, no server needed. It ships in the npm package too, so it is there after an install; the [hosted copy](https://mailcraft.seliseblocks.com/examples/vanilla.html) is the same file.

MIT
