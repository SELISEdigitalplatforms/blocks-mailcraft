# Changelog

All notable changes to `@seliseblocks/mailcraft` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
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
