# MailCraft

Drag-and-drop email editor as a Web Component. No dependencies, no framework, no build step.

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
| `locale="de"` | 31 languages, RTL automatic |
| `theme="light" \| "dark"` | host owns light/dark; hides the built-in toggle |
| `ui-font="inherit"` | match your app's font |
| `toolbar="none"` | hide the editor's own top bar |
| `toolbar="undo,redo,export"` | …or keep only these parts |
| `.storageProvider` + `.storageLimits` | image uploads to your backend |
| `.aiProvider` | `async (prompt) => text`, powers the AI draft panel |
| `.messages` | override any UI string |

Every attribute is also a property. Full reference and integration recipes: **[DOCS.md](DOCS.md)**.

## For AI agents

Everything an assistant needs to wire this up correctly:

```
PACKAGE   @seliseblocks/mailcraft — Web Component, zero runtime deps
IMPORT    import '@seliseblocks/mailcraft'   (side effect: registers the element)
          Safe to import under SSR; the element itself renders in a browser only.
ELEMENT   <mailcraft-editor id="editor"></mailcraft-editor>
MOUNT     createEditor(target, options) -> handle   (no tag needed)
          target  = CSS selector or Element; throws if it matches nothing
          options = html, variables, locale, dir, theme, uiFont, toolbar,
                    storageProvider, storageLimits, aiProvider, iconProvider,
                    messages, height, replace, onChange(doc), onExport(html)
          handle  = the METHODS below + .element + .destroy()
          The container supplies the height; the editor fills it.

DATA      HTML in, HTML out. There is no JSON document format in the public API.
          editor.loadTemplate({ name, html })   apply HTML  (undoable, deep-copied)
          editor.importHtml(html)               apply HTML  (same importer)
          editor.exportHtml() -> string         send-ready email HTML
          Persist by storing exportHtml() and passing it back to loadTemplate().
          Unclassifiable markup survives as a raw-HTML block. Nothing is dropped.

EVENTS    'change'  detail = internal doc (do not persist this)
          'export'  detail = HTML string

ATTRS     variables="a,b,c" | locale="de" | theme="dark" | dir="rtl"
          ui-font="inherit" | toolbar="none" | toolbar="undo,redo,export"
PROPS     .variables .toolbar .uiFont .messages .aiProvider .iconProvider
          .storageProvider .storageLimits
METHODS   exportHtml() importHtml(html) loadTemplate(tpl) undo() redo()
          screenshotPng() previewScreenshot() downloadScreenshot() copyScreenshot()

UPLOADS   Both properties are required, or every upload is refused.
          editor.storageLimits   = { accept:['image/jpeg','image/png','image/gif'],
                                     maxBytes: 2*1024*1024 }
          editor.storageProvider = { list(q), upload(file, o), folders?(), remove?(a) }
          The editor never makes a network request itself.

TOOLBAR   Parts: logo status device undo redo theme ai code preview export
          Attribute = allow-list (keep these). Property = { part: false } (drop these).
          Hiding a control never removes the capability — each is also a method.

DO NOT    Do not use getContent()/setContent() — internal, shape may change.
          Do not expect a campaign/title option — there is none; <title> is "Email".
```

## Develop

```sh
npm install && node build.js && npm test
```

`examples/vanilla.html` is a complete host page — open it directly, no server needed.

MIT
