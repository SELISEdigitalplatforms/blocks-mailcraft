# Contributing to MailCraft

Thanks for contributing. This guide covers the day-to-day workflow for this repository. See `README.md` for environment setup and the host-facing API.

## Branch model

`main` is the only long-lived branch and holds production-ready code. There is no integration branch.

Work on a short-lived branch cut from `main`, named for the change (`fix/import-stray-table`, `feat/storage-provider`), and open a pull request back into `main`. Delete the branch once it merges. Do not commit directly to `main`, do not force-push it, and do not rewrite published history.

## Commit conventions

Match the style already in the log. Most commits use Conventional Commits (`type(scope): subject`); a plain imperative subject is also fine for straightforward changes. Keep the subject concise and explain the what and the why in the body when it is not obvious.

## Reporting a security issue

Do not open a public issue for a suspected vulnerability. Follow the private disclosure process in [SECURITY.md](SECURITY.md).

## Repository layout

- `src/core/`: state and logic, no DOM rendering (`editor-core.js`, blocks, import/export, sanitize, storage, i18n).
- `src/render/`: all DOM building; the canvas is torn down and rebuilt per state change.
- `src/index.js` / `src/mailcraft-editor.js`: package entry and the `<mailcraft-editor>` element.
- `examples/`: the `vanilla.html` demo (loads `dist/`, never `src/`) and `examples/templates/` — host-content example emails, mirrored byte-identically as inline blocks in the demo.
- `test/`: dependency-free, DOM-free node suites (`storage`, `export`, `templates`, `system`, `toolbar`).
- `build.js`: the zero-dependency bundler; `dist/` is generated output.

## Build and tests

After any change under `src/`, rebuild — the demo page loads `dist/mailcraft-editor.bundle.js`, so a change is not visible until then:

```bash
node build.js
npm test
```

The suites stub `localStorage` and run against `src/` directly; no DOM and no dependencies. The HTML importer has no automated coverage — verify importer changes by hand through the Code modal or a headless Chrome `--dump-dom` page.

## Bundler constraints

`build.js` is a deliberate regex-transform bundler. It only understands:

- `import { a, b as c } from '...'` (single-line)
- `export { a, b } from '...'`, `export const|function|class|async function NAME`

No `export default`, no bare `export { ... }`, no multi-line imports, no dynamic `import()`. A new file using anything else fails the build with "unhandled export syntax".

## Conventions

Follow the conventions the code already uses:

- Plain JavaScript ESM, web-safe and dependency-free; nothing is imported that is not in this repo.
- Comments explain *why* (the bug a guard prevents, the constraint that forced a shape) — match the existing density; no change-narration comments.
- Inspector labels use plain, non-technical language; developer-grade controls go behind the "Advanced options" switch.
- Accent color is `#0065b3` (dark variant `#58a8e3`) via `--ed-*` tokens in `render/style.js`.
- i18n: chrome strings live in `core/i18n/en.js`; locales are overlays, English is the fallback; inspector field labels are deliberately hardcoded English.
- Source files carry mixed CRLF/LF line endings — expect exact-match edits to fail on the newline alone and re-read before editing.
- `examples/templates/*.html` and the inline blocks in `examples/vanilla.html` must stay byte-identical; edit the files, then re-sync the mirror.

## Backward-compatible changes

Documents persist in users' `localStorage` and templates are stored host-side, both possibly written by older builds:

- Never make a renderer require a prop without a fallback; `migrateDoc`/`normalizeDoc` backfill old saved docs.
- A block type this build does not know is dropped by `migrateDoc` (core/blocks.js), and a row left empty by that drop goes with it. If you ever retire a type that shipped, convert it there instead so nothing saved is lost.
- The public host seam (`loadTemplate`, `setContent`/`getContent`, `storageProvider`, attributes) is consumed by shipping apps: keep old names working, deprecated and forwarding, and never change a persisted state shape without a migration path.
