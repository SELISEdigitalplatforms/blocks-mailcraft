# MailCraft Editor

Drag-and-drop email template editor distributed through npm as a zero-dependency Web Component. No framework required.

## Install

```sh
npm install @seliseblocks/mailcraft
```

```js
import '@seliseblocks/mailcraft';
```

Import the package once to register the custom element, then use it in your markup:

```html
<mailcraft-editor id="editor"></mailcraft-editor>
```

Named exports such as `MailCraftEditor`, `EditorCore`, `LOCALES`, and `validateFiles` are available from the same npm entry when needed.

The package is safe to import in a server-rendered application, but the editor itself renders in the browser. Create or display `<mailcraft-editor>` on the client.

That is a working editor. Everything below is optional.

## Get the HTML out

```js
const html = editor.exportHtml();          // send-ready email HTML
const doc  = editor.getContent();          // JSON, to store and reload later

editor.setContent(doc);                    // restore
editor.addEventListener('change', (e) => save(e.detail));
```

## Name the campaign

```html
<mailcraft-editor campaign="Welcome email"></mailcraft-editor>
```

Sets the exported `<title>` and the download filename. Unset, they fall back to `Email` / `email.html`.

## Merge variables

```html
<mailcraft-editor variables="first_name,company,unsubscribe_url"></mailcraft-editor>
```

Users insert these from the toolbar; they export as `{{first_name}}`.

## Language and theme

```html
<mailcraft-editor locale="de" theme="dark"></mailcraft-editor>
```

31 locales, RTL automatic (`locale="ar"`). While `theme` is set the host owns it and the editor hides its own toggle.

The editor UI uses Manrope by default. To match the host application's font, pass `ui-font="inherit"`; an explicit CSS font-family stack is also accepted:

```html
<mailcraft-editor ui-font="inherit"></mailcraft-editor>
<mailcraft-editor ui-font="'IBM Plex Sans', Arial, sans-serif"></mailcraft-editor>
```

The same option is available as `editor.uiFont`. It changes editor chrome only, not the fonts inside the email document.

## File uploads

Two properties. Both are required to accept uploads — without them the library keeps its built-in demo files.

```js
// 1. What may be uploaded. No defaults ship: unset means uploads are refused.
editor.storageLimits = {
  accept: ['image/jpeg', 'image/png', 'image/gif'],
  maxBytes: 2 * 1024 * 1024,
  maxWidth: 1600, maxHeight: 1600,     // optional
  maxFilesPerDrop: 20,                 // optional
  allowSvg: false,                     // SVG needs this AND a place in `accept`
};

// 2. Where it goes. Any backend — the editor never makes a request itself.
editor.storageProvider = {
  async list({ folderId, cursor, query, signal }) {
    const r = await api.images({ folderId, cursor, query });
    return {
      items: r.files.map((f) => ({
        id: f.id, name: f.name, url: f.url,
        folderId: f.folderId, w: f.width, ht: f.height, size: f.bytes,
      })),
      cursor: r.next ?? null,            // null when there are no more pages
    };
  },

  async upload(file, { folderId, width, height, signal }) {
    const saved = await api.upload(file, folderId);
    return { id: saved.id, name: file.name, url: saved.url,
             folderId, w: width, ht: height, size: file.size };
  },

  async folders() { return api.folders(); },            // optional: [{id, name}]
  async remove(asset) { await api.delete(asset.id); },  // optional
};
```

`url` must still resolve **after the campaign is sent** — a URL that expires in an hour produces mail whose images are already broken when it lands.

Formats are checked by reading the file's leading bytes, not `file.type`, so a renamed `.svg` cannot slip through.

## Templates

Templates are host content **and host UI**. The editor has no template gallery, no Templates tab, and ships no catalogue — you render your own picker (a page, a modal, a dropdown) and push the chosen template in:

```js
editor.loadTemplate({ name: 'Welcome', html: '<html>…</html>' });  // raw email HTML, via the importer
editor.loadTemplate({ name: 'Welcome', doc: savedDoc });           // a saved document object
editor.loadTemplate({ name: 'Digest',  build: () => makeDoc() });  // built per use
```

`html` for a real email you already have (the importer converts it — same path as `importHtml`), `doc` for a document captured earlier, `build()` for one made on demand. Either way the editor deep-copies, so your object is never mutated, and applying a template is a normal undoable edit with a toast.

The other direction — storing what the user built as a template of your own:

```js
const doc = editor.getContent();      // editor -> host (document object)
const html = editor.exportHtml();     // editor -> host (email HTML)
```

Ready-made example templates live as plain HTML files in [`examples/templates/`](examples/templates/), with a host-side picker wired up in [`examples/vanilla.html`](examples/vanilla.html) — both are host-app content, not part of the editor.

## Import existing HTML

```js
editor.importHtml(html);
```

Converts real-world email HTML into editable blocks — inline- and class-styled markup, builder scaffolding, per-side borders, card columns, social strips, theme extraction. Nested grids and `rowspan`/`colspan` survive as raw-HTML blocks: rendered and exported, not block-editable.

## Everything else

| | |
|---|---|
| `screenshotPng()` | full template as a PNG `Blob` |
| `downloadScreenshot()` / `copyScreenshot()` | save or clipboard |
| `undo()` / `redo()` | |
| `.messages` | override any UI string |
| `.aiProvider` | `async (prompt) => text`, powers the AI draft panel |
| `.iconProvider` | supply your own social icon art |
| `export` event | fires on export, `detail` is the HTML |

Documents autosave to `localStorage` per browser tab. With a `storageProvider` set, uploaded files are never written there.

A complete host page is in [`examples/vanilla.html`](examples/vanilla.html).

## Development

```
node build.js     # rebuild dist/ after any change under src/
npm test          # unit suite: storage, export, templates — no dependencies, no DOM
```

Double-clicking `examples/vanilla.html` opens the editor — the example emails are inlined in the page, so nothing is fetched and no server is needed. The same emails also live as standalone files in `examples/templates/`, for hosts to copy.

The importer has no automated coverage; verify importer changes by hand through the Code modal.
