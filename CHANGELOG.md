# Changelog

All notable changes to `@seliseblocks/mailcraft` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.16] — 2026-09-05

### Fixed
- **The screenshot viewer opens and slides smoothly.** Three sources of jank, all on the main thread at once: the capture's heavy bursts (render, layout, serialize, rasterize, encode) started inside the entrance animation and stuttered it — the skeleton now goes up immediately and the capture waits for the chrome to finish arriving; the skeleton's shimmer animated `background-position`, a full-card repaint per frame exactly while that work ran — it sweeps on a composited `transform` now; and the tall capture image wasn't pinned to its own compositor layer, so a slide could re-rasterize megapixels mid-transition — `will-change: transform` keeps it promoted, and the image is fully decoded off-screen before it fades in.
- **Faster reopen on photo-heavy templates.** Every capture re-fetched and re-inlined each external image; the inlined bytes are now cached per URL for the session (a failed fetch is evicted, so a transient network error is not pinned).
- **The viewer no longer reads as a modal stacked on the export dialog.** Opened from the dialog's Screenshot button, the dialog is parked while the viewer is up and restored when it closes; the backdrop also dims deeper (0.86 → 0.94), so bright chrome underneath stops bleeding through the viewer's own header.

## [0.2.15] — 2026-09-05

### Added
- **Compressed screenshots.** `screenshotPng(options)` takes `{ format: 'png' | 'jpeg' | 'webp', quality: 0–1, scale }`, so a long template can be captured as a JPG or WebP at a fraction of the PNG's size (PNG stays the lossless default). The capture itself is still one lossless render; a lossy pick re-encodes it at download time against the template's page colour, and never captures twice. `downloadScreenshot(blob?, options?)` passes the options through and names the file by the format that was actually encoded (a browser without a WebP encoder falls back to PNG, per spec). Copy still hands the clipboard a PNG — it accepts nothing else.
- **The screenshot viewer's actions are one floating control bar now.** Play/pause and Copy sit as quiet segments beside a segmented **PNG | JPG | WEBP** picker (all three visible, the active one lit) and a solid Download button that renames itself with the chosen format. The capture's dimensions and screen position moved up under the Screenshot kicker, where a full header line keeps them from truncating; on narrow cards Copy folds to its icon so Download keeps its label.
- **The demo templates have product and hero imagery now.** Six of the example templates (back in stock, cart left behind, rate your headphones, meet Nova, The Sunday Brief, your order shipped) were shipping with no images at all — colour tiles stood in where a product shot or hero belongs. Each now carries flat SVG illustrations as self-contained `data:` URIs, so the gallery keeps working from `file://`, offline, and inside the screenshot capture's no-network rule. All six still converge as save round-trip fixed points.

### Changed
- The `action.downloadPng` message key is retired in favour of `story.download` (`'Download {fmt}'`) and the new `story.format` hint, in all 31 locales. A host override table using the old key should move to the new ones.

## [0.2.14] — 2026-09-03

### Fixed
- **The text toolbar's `−`/`+` size buttons resize just the selected text.** They were block-level only: with a run of text selected they still rewrote the block's size, so "make these two words bigger" resized the whole block — while every neighbouring control (bold, color, highlight) is selection-scoped. With a selection inside a text block, `±` now wraps exactly the selected run in its own font size, steps that same run on repeated clicks instead of nesting a wrapper per click, and applies at the innermost level so it wins over any inline size an imported design carries. The change commits, exports and undoes exactly like bold does. A bare caret or a select-all keeps the block-level master scale (which rescales mixed sizes proportionally), and the toolbar's px readout now shows the size at the caret, refreshing as the caret crosses differently-sized runs. Headings stay block-level: their content is stored as plain text, which cannot carry a per-run size.
- **A left- or right-aligned button no longer collapses its block on the canvas.** Browsers map the table `align` attribute — which classic Outlook needs — to a CSS float, which took the pill out of flow: the block collapsed to its padding and the button painted over the block below. An inline `float:none` cancels the hint everywhere floats work, while Word, which ignores CSS float, still honours the attribute.

## [0.2.13] — 2026-09-03

### Added
- **The code view's source and preview panes are now inspect-linked, DevTools-style.** Click (or arrow) the caret anywhere in the source and the element it sits in is outlined and scrolled into view in the live preview; click any element in the preview and its open tag is selected in the source, with the line scrolled into view and flashed. The mapping counts same-tag elements on both sides — immune to the parser's inserted `<tbody>`s and to the preview-only `{{#if}}` chips, which now carry a `data-mc-deco` marker and are skipped — and when the counts disagree mid-edit it walks up to the nearest ancestor that still lines up rather than guessing. The outline is injected into the preview document the same way the preview scrollbar chrome is: the source string, Apply and Export stay byte-for-byte untouched. Clicking a link in the preview now inspects it instead of navigating the preview away.
- **Format** button in the source pane: a conservative pretty-printer (two-space indentation, one structural tag per line) that only moves whitespace the renderer cannot see. It never invents a space between inline or inline-block elements (hybrid email columns survive), keeps `<style>`, `<pre>` and MSO conditional comments byte-identical, gives `{{#if}}`/`{{/each}}` tags their own lines, and is idempotent. Formatting is a pane edit like any other — nothing reaches the canvas until Apply.
- **Word wrap** toggle in the source pane: wrap off shows one source line per numbered row with a shared horizontal scroll. The preference persists per browser.
- **Find and replace** (Ctrl+F / Cmd+F): a floating bar over the source pane with case-insensitive matches highlighted in the code, a current-match counter, Enter/Shift+Enter to step, Replace and Replace all, plus a **go-to-line** field (Ctrl+G). Escape closes the bar without closing the modal.
- **The source pane types like an editor now.** Enter auto-indents to the current line's depth, Tab and Shift+Tab indent and outdent multi-line selections, and the caret's line gets a wash with an accent line number.

### Fixed
- **Ctrl+Z works in the code editor again.** The old Tab handler reassigned the textarea's value, which silently wiped the browser's native undo stack; every programmatic edit (Tab, Enter, Format, Replace) now goes through `insertText`, so the whole editing session stays undoable.

## [0.2.12] — 2026-09-03

### Fixed
- **Clicking outside closes the floating text toolbar again after any toolbar detour.** The guard that keeps an edit alive while a toolbar control takes focus was a one-way latch: any interaction that never committed — a dismissed Text style or Merge tags dropdown, a cancelled color dialog, the link popover left with Escape or Cancel, even a click on the toolbar's own padding — left it armed forever, and every later blur was swallowed, so the toolbar could not be dismissed no matter where you clicked. The guard is now scoped to its own press, and a completed click outside both the edited block and the toolbar ends the edit explicitly — committing the content exactly as leaving the block does. That explicit close also covers what a blur never could: once focus has moved into a toolbar control, the block has no blur left to fire, so before this there was no event to close the toolbar at all. Text selections that start in the block and end outside it, clicks on the toolbar itself, and scrollbar drags all keep the edit open, as before.

## [0.2.11] — 2026-09-02

### Fixed
- **Text size moves a mixed-size block again while it is being edited.** On a block whose paragraphs carry their own `font-size` (every imported or AI-drafted design), the block-level size acts as a master scale and rewrites those inline sizes — but with the block focused, the render that followed folded the still-unrewritten contenteditable back over the fresh props, so the `size` prop climbed with each click of the toolbar's `+` while the text on screen never moved. Props now keep the right of way until the rebuild that carries them into the DOM, and the same guard covers Text color, Line spacing, Text weight and Align. Uncommitted typing is folded into props before the rewrite runs, so it is fed the live content instead of replacing it.
- **Undo reaches the block you are editing.** The same live-edit sync copied the pre-undo contenteditable straight back over the restored document, so an undo reverted everything except the block under the cursor. Both directions of history now fold the live node in before the step is recorded — redo comes back with the last keystrokes, not without them — and hand the restored document to the rebuild.
- **Two quick clicks of the RTE's `+` count twice.** The pair used to move nothing on a mixed-size block: the second click read its base off the toolbar's own stale copy of the block and re-applied the first click's value, then wrote the pre-scale markup back over the rescaled one. Resizing from the toolbar is also a single undo step now, not two.
- **Picking a block font no longer eats the imported one.** An explicit font is applied by stripping the descendants' own declarations from the rendered DOM, never from the document — which is what lets the control's Inherit setting hand the imported per-paragraph typography back. With the block focused, the live-edit fold wrote that strip into the document anyway, so changing your mind had nothing left to restore. The fold now ignores a node the render itself decorated and still captures every real edit.
- **A styled `<div>` keeps its background on import.** The panel every transactional template puts around a verification code — `<div style="background-color:#eff6fc;border-radius:8px;padding:18px 24px">` — came back unpainted the moment the HTML was applied to the canvas or saved: the import sanitizer's tag whitelist has no `DIV` (arbitrary paste brings div soup), so the wrapper was flattened away and its color, border and radius went with it. The container styling is now read into the block's own **Box & border** props instead, so the panel survives, round-trips through export, and the color is editable in the inspector rather than baked into markup. A painted div is also its own block now — a background-only one carried no padding to mark a boundary, so it used to merge into the prose around it. Padding stays the block's own `py`/`px`, which keeps asymmetric source values (`18px 24px`) the single-value box padding cannot express.

## [0.2.10] — 2026-09-01

### Fixed
- **A per-block font survives a save.** Heading, text, list, button, menu and table blocks read their `font-family` back on import, so a font chosen in the inspector is still there after export → reload. A text run claims its family at block level only when every piece of the run shares it — a mixed-typography run keeps its inline declarations instead — and a claimed family is removed from the run's own HTML, so the same declaration never ships twice and a second save produces the same bytes as the first.
- The heading block's **Condensed** stack folds back into the Font style toggle it came from, instead of importing as an opaque per-block font.
- The document font is read from the `<body>` first. The element scan that stood in for it crowned the *first block's* font, so one custom-font heading at the top of an email flipped the whole theme on reload; the scan stays as the fallback for emails that declare nothing on the body.
- **An imported font stack is now selectable in the Font controls.** The select ships ten email-safe stacks and an imported email's stack matches none of them — a `<select>` whose value is in no option shows nothing selected, so the panel read "Inherit — theme font" about a heading really set in Georgia, and the only way to learn what font it was was to overwrite it. The document's own stack keeps a seat of its own, labelled by its first family.
- **Values that only restate the theme are inherit again.** The exporter writes every inherited value as a concrete declaration, so a round trip used to come back with the theme font, text ink and content background stamped onto every block and row as an explicit override — visually identical, but a later theme edit no longer reached anything. Anything genuinely different from the theme is a real override and stays.
- Styling that quietly reset on every save/reload is read back: a **list**'s font, size, ink, line spacing, item gap and spacing; a **table**'s font, size, width, cell padding, alignment and header tint; a **menu**'s item spacing; an **image** block's own padding; a **divider**'s spacing (a declared zero included, so a tightened divider stops springing back to 14px); a **column**'s border.
- Zebra striping is claimed only from the renderer's own stripe tint, and only where there are enough body rows to tell — imported tables were striped by default before, whether the source was or not.
- A section's **background overlay** survives. The tint ships as the exporter's own `linear-gradient(rgba(20,22,24,α)…)` over the photo; unread, the percentage vanished on every save while the image stayed. Only that exact signature is folded back — a foreign gradient says nothing about MailCraft's tint and stays out of the model.
- **The save → reload round trip now preserves every remaining inspector control** (a full fidelity pass against the exporter's own markup — export → import → export is byte-identical from the first reload on):
  - A **linked image**'s width — it lives on the wrapping anchor, so every linked logo reloaded at full width.
  - A **heading**'s line spacing and its own padding, an explicit zero included.
  - **Social strips**: Outline and Bare no longer reload as filled Square badges (`background:transparent` is the absence of a fill, not a fill); a badge strip keeps its fill color instead of the black/white contrast ink painted over it; per-network colors fold back into the **Brand** palette; icon spacing reads off the anchors instead of the row gutter; and a strip with **Show network names** on reloads as the social block it is — it used to come back as a menu of links.
  - A text block's **Show on** (device visibility) — recognized blocks kept it, text runs dropped it.
  - Adjacent zero-padded **text blocks stay separate blocks**: buffered together, the second lost its size, weight — everything — on every save. A text block's declared-zero spacing sticks, too.
  - **Rows**: vertical align; the single-column gutter (content crept 10px wider per side on every reload — a social strip's or data table's row included); the outside-margin sliders' values; and the explicit mobile modes (two-up, reverse) read back off their own classes.
  - **Columns**: background, radius, inner padding and border now survive `loadTemplate`/`loadDoc` at all — `normalizeDoc` rebuilt every column without its styling, so a card column lost its paint before the export ever ran.
  - The **Inline SVG block no longer vanishes** on reload (previously the sanitizer dropped the drawing and the whole row with it), and the export now ships the same width-carrying span the canvas draws, so the Width slider reaches sent mail and reads back.
  - **Line spacing stops drifting**: the exporter ships line-height in px (Outlook needs a length), and dividing back rarely landed on the slider's value — 1.6 at 16px reloaded as 1.625, moving again on every save. Recovered ratios snap to the nearest slider step that reproduces the same pixels.
  - Colors reload as the **hex** the picker understands, not CSSOM's `rgb(…)` serialization (button, divider, menu, social) — also what lets the theme-equality folds actually match.
  - **`theme.link` is no longer hijacked on import** by menu items, whose navigation color outvoted the document's real links.
  - Dynamic-content **marker rows stop picking up wrapper backgrounds** — a page background stamped onto one painted a colored band in the canvas that no sent mail would show.
- HTML import: a nested layout table's header-cell veto now applies only to the candidate's own row, so a **data table inside a column** keeps the gutter around it.

### Added
- **Fidelity markers.** A handful of blocks render into markup that cannot be read back into the block it came from — a countdown bakes its digits into text, a video is just a linked image, a section box and a code sample are styled divs like any other, a raw-CSS block is a bare `<style>`, and a flex/grid row is a div no table walker can re-shape. The export now stamps a compact attribute layer (`data-mc`, `data-mcp`, `data-mcr`, plus the inert `mc-keep` class) that the importer trusts when present and ignores otherwise; mail clients ignore unknown attributes wholesale. The payoff on reload: a **countdown is live again** instead of stale baked digits, video / section box / code / raw CSS keep their identity and every setting, **flex and grid rows stop collapsing to one column**, and "On mobile: Keep columns" survives. Content halves are still read from the rendered markup and sanitized like any import — a marker is data about a block, never markup to inject. Hosts that want pristine HTML can pass `exportHtml({ markers: false })` and accept the lossy (content-preserving) reload.
- **The theme's Link color now does something.** It was a dead control end-to-end: the canvas painted content links in the *host's* brand accent, the export shipped no color (recipients saw their client's default blue), and the importer re-guessed the value from a vote that menu items always won. Now the canvas paints sheet links from the theme, the export stamps the color inline on every anchor that has none of its own (mail clients have no stylesheet to inherit from — a hand-colored link keeps its color), the import folds restated stamps back to inherit so a later Link color edit still reaches every link, and menu/social anchors are barred from the recovery vote.
- **Row outside margins render in sent mail, and Max width ships at all.** Margins were exported on a `<td>`, which every major client ignores; Max width existed only on the canvas. Both now ride a wrapper `<div>` inside the cell — margins outside the painted box, exactly as the canvas draws it, auto-centered when capped — and read back on reload. Rows using neither keep the old markup byte for byte.
- The **raw-CSS block round-trips as itself**: it reloaded as an opaque HTML block while its rules were *also* folded inline onto every matched element, doubling the styling on each save. Marked, it comes back as the css block (note included) and the fold skips it; foreign `<style>` tags keep today's fold-inline behaviour.
- `test/roundtrip.test.mjs` — the round-trip fidelity suite: one assertion per inspector control (blocks, rows, columns, theme), block-identity coverage for every marked type, a byte-convergence check, and the `markers: false` degradation floor asserting no content is ever silently dropped. Runs in `npm test`.

### Removed
- The **Embed block**. It exported an `<iframe>`, and mail clients strip iframes wholesale — Gmail, every Outlook, Yahoo and the rest drop the tag or render a blank gap — so the block only worked in browser contexts and shipped dead weight in every real send. A document saved with one loses nothing: it reloads as a raw-HTML block holding the same iframe markup it always exported.

## [0.2.9] — 2026-09-01

### Fixed
- HTML import keeps a section that paints one background image as **one row**: builder sections (Beefree, Stripo — `table.row[background-image]` holding a stack of per-block tables) previously shredded into one row per block, each stamped with its own copy of the background image, so the export re-drew the image's top slice once per block. Blocks keep their per-block padding through the merge; rows with their own background, frame or image are real band boundaries and are never merged.
- HTML import reads the section cell's own background color ahead of its wrapper's — a dark hero cell inside a white content table kept `#ffffff` before, so white text over a background photo sat on a white band whenever the image hadn't loaded. Legacy `bgcolor` on a `<tr>` is now read too.
- Imported headings inherit `color` and `text-align` from the section cell the way text runs always did — a white `<h1>` whose color lived on the `<td>` imported in the default dark ink and vanished into the hero image. An own value on the heading still wins.
- A bare text run with no element of its own (`<td style="font-size:30px;font-weight:800;color:#0065b2">{{Code}}</td>`) now reads its typography off the surrounding cell — verification codes and similar merge-tag cells imported at the theme default before, dropping size, weight, color and line-height on every save.
- A card drawn across several stacked content tables (top piece `border-radius:16px 16px 0 0; border-bottom:none`, side-borders-only middles, bottom piece `0 0 16px 16px`) no longer doubles its frame: the fragments are consumed into the one canvas frame the theme claims, while horizontal edges between sections survive as separators.
- Beefree-style dividers — a content-free cell whose only drawing is a `border-top`, usually in a `width="20%"` inner table — import as the divider block they draw instead of a junk text row holding a hair space.
- Empty `<p></p>` elements no longer import as phantom padded rows.
- The inspector's color swatch normalizes `rgb()`, `rgba()` and 3-digit hex before feeding the native picker, which only accepts `#rrggbb` — imported non-hex colors showed a black swatch and opened the picker at black.
- Text size, Text color, Line spacing, Text weight and Align now reach imported (and AI-drafted) text and list blocks whose content carries its own inline styles. Text size scales the inline hierarchy proportionally (a 15/26/15px block moved to a 45px base becomes 45/78/45); the other controls take ownership of their property, the way the Font control already did. The rewrite happens only when the control is moved, lands in a single undo step, and untouched documents are never rewritten.
- The rich-text toolbar's Smaller/Larger text buttons clamp to the same range as the inspector (8–96 for text, 12–120 for headings). Previously they clamped to a private 10–64, so one "Larger text" click on a 96px block shrank it to 64.
- The Smaller/Larger text buttons no longer appear on Section box and Raw HTML blocks, where no size is rendered — clicking them only wrote an inert `size` value into the saved document.
- Imported list items now pass through the same sanitizer as every other import path: event handlers, classes and `mso-*` noise are stripped while whitelisted inline typography survives.
- The docs site's Quick-start hero follows the site's own theme toggle instead of the OS scheme, so the colour logo shows on the light page (the near-white dark-mode wordmark no longer paints on white).

### Added
- Copy button in the code view's toolbar — puts the source pane on the clipboard, unsaved edits included, with a "Copied" confirmation. Localized in all 31 locales from existing strings.

## [0.2.8] — 2026-09-01

### Added
- Mobile layout modes and per-device visibility handling.
- Open Graph card generation tooling.

### Fixed
- HTML import preserves the row → column → blocks structure.
- Docs site renders the Quick start page (`/README.html` no longer 404s).

## [0.2.7] — 2026-09-01

### Added
- Brand artwork SVGs and theme-aware logo rendering.

### Fixed
- Drag and drop: dropped sections land where the indicator line shows.

## [0.2.6] — 2026-08-31

### Fixed
- Round-trip: saving never mutates the design.

## [0.2.5] — 2026-08-31

### Fixed
- Visible elevation on the settings panel.

## [0.2.4] — 2026-08-31

### Added
- Marketing homepage on the docs site.

### Fixed
- Slider behaviour under RTL locales.

## [0.2.3] — 2026-08-31

### Added
- Full content-area border as a theme option.

## [0.2.2] — 2026-08-31

### Changed
- Locales load lazily, one file per language, instead of shipping all translations up front.
- Preview polish.

## [0.2.1] — 2026-08-31

### Changed
- Canvas and chrome polish.

## [0.2.0] — 2026-08-31

### Added
- TypeScript declarations ship with the package.
- Condition and Loop dynamic-content marker blocks, exported as literal `{{#if}}` / `{{#each}}` template tags.
- Expanded translations and improved AI draft functionality.

### Removed
- Seeded example assets in the library; local library handling improved.

## [0.1.1] — 2026-08-30

### Added
- Documentation site; the full configuration surface documented; restyled demo.

### Fixed
- Contributing link 404; dark scrollbar on a light page.

## [0.1.0] — 2026-08-30

Initial release: a drag-and-drop HTML email editor packaged as a zero-dependency Web Component — HTML-only host contract, configurable top bar, `createEditor` mount API, minified single-file build, and a test suite covering the core, render layer and keyboard shortcuts.
