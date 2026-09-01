# Changelog

All notable changes to `@seliseblocks/mailcraft` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
