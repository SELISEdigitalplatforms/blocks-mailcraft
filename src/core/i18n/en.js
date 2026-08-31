/**
 * The English message table -- the only locale that ships inside the core
 * bundle. Every other language is a separate module under this same folder
 * that a host app imports and hands to the editor as `.messages` (see
 * `index.js`'s `createTranslator`).
 *
 * Flat, not nested: keys are `<area>.<thing>` and nothing deeper, so the
 * dotted prefix gives the grouping without a path-resolver. Scope is editor
 * chrome only -- panel names, toolbar actions, empty states, modals, status
 * and toast text. Block-type names, per-field inspector labels ("Padding
 * top / bottom", etc.) and default email content are not translated here;
 * those are either data (`core/blocks.js`) or a
 * deliberately separate follow-up pass.
 */
export const EN = {
  // Header
  'action.undoHint': 'Undo — ⌘Z',
  'action.redoHint': 'Redo — ⌘⇧Z',
  'action.chromeToDark': 'Dark',
  'action.chromeToLight': 'Light',
  'action.chromeHint': 'Light / dark editor chrome',
  'action.chromeHintToDark': 'Dark mode',
  'action.chromeHintToLight': 'Light mode',
  'action.aiDraft': 'Draft',
  'action.aiDraftHint': 'Draft email content with AI',
  'action.code': 'Code',
  'action.codeHint': 'Edit the raw HTML with a live preview',
  'action.preview': 'Preview',
  'action.previewHint': 'Preview the email',
  'action.export': 'Export',
  'action.exportHint': 'Export your email',

  // Device segment (header, preview modal, code modal)
  'device.desktop': 'Desktop',
  'device.desktopHint': 'Desktop width',
  'device.mobile': 'Mobile',
  'device.mobileHint': 'Mobile width',

  // Autosave status (header)
  'status.autosaveOn': 'autosave on',
  'status.saved': 'saved {time}',
  'status.saveFailed': 'not saved — storage full',

  // Main canvas dock pill
  'canvas.meta': '{rows} rows · {blocks} blocks · {width}px',

  // Tab bar
  'tab.design': 'Design',
  'tab.designHint': 'Style the selection',
  'tab.blocks': 'Content blocks',
  'tab.blocksHint': 'Content blocks and variables',
  'tab.rows': 'Sections',
  'tab.rowsHint': 'Section layouts and canvas model',
  'tab.files': 'Assets',
  'tab.filesHint': 'Asset library',
  'tab.layers': 'Layers',
  'tab.layersHint': 'Document structure',
  // Renamed from tab.theme/tab.themeHint ("Theme / Global styles") when the
  // panel stopped being about theming alone. Every shipped locale translates
  // the new names; test/system.test.mjs fails if one falls back to English.
  'tab.settings': 'Settings',
  'tab.settingsHint': 'Email settings',
  'tab.data': 'Variables',
  'tab.dataHint': 'Variables provided by your code',

  // Design tab
  'inspector.blockProperties': 'Block properties',
  'inspector.sectionProperties': 'Section properties',
  'inspector.title': 'Inspector',
  'inspector.sectionLabel': 'Section',
  'inspector.nothingSelected': 'Nothing selected',
  'action.duplicateHint': 'Duplicate — ⌘D',
  'action.deleteHint': 'Delete — ⌫',
  'inspector.emptyBody':
    'Pick a row or block on the canvas to style it here. Drag blocks in from the <strong style="color: var(--ed-text); font-weight: 600;">Content blocks</strong> tab; double-click any text to edit it in place.',
  'inspector.shortcuts': 'Shortcuts',
  'shortcut.undoRedo': '⌘Z / ⌘⇧Z — undo, redo',
  'shortcut.duplicate': '⌘D — duplicate selection',
  'shortcut.delete': '⌫ — delete selection',
  'shortcut.export': '⌘E — export email',
  'shortcut.escape': 'ESC — deselect, close',

  // Blocks tab
  'blocks.dragHint': 'Drag a block onto the canvas',
  'blocks.count': '{count} blocks',

  // Rows (Sections) tab
  'rows.sectionLayouts': 'Section layouts',
  'rows.customMarkup': 'Custom markup',
  'rows.htmlRowHint': 'Drag in, or click to append — a full-bleed row you fill with raw HTML',
  'rows.rawHtmlSection': 'Raw HTML section',
  'rows.rawHtmlDesc': 'Full-bleed section, your markup, still draggable',
  'rows.canvasModel': 'Canvas model',
  'rows.modeRowBased': 'Row based',
  'rows.modeFreeStack': 'Free stack',
  'rows.hintRows':
    'Section based: drop a layout first, then drop blocks into its columns — every section carries its own background, border, flex or grid settings.',
  'rows.hintStack': 'Free stack: skip layouts — every block you drop becomes its own full-width section, stacked in order.',


  // Files tab (sidebar)
  'files.libraryCount': 'Library — {count} files',
  'files.openManager': 'Open media library',
  'files.dragToCanvas': 'Drag any file straight onto the canvas to place it as an image block.',

  // Layers (Tree) tab
  'layers.structure': 'Structure',
  'layers.sectionSingle': 'Section',
  'layers.sectionMulti': 'Section · {count} columns',
  'layers.column': 'Column {index}',
  'layers.blockCount': '{count} blocks',

  // Data (Vars) tab
  'vars.title': 'Variables',
  'vars.fromCode': '{count} from your code',
  'vars.declaredNote': 'Declared by your application — the canvas always shows the token, never a value.',
  'vars.filterPlaceholder': 'Filter variables…',
  'vars.insertHint': 'Click to insert into the selected text, heading or button',
  'vars.insert': 'insert',
  'vars.noMatch': 'No variable matches that filter.',
  'vars.noneDeclared': 'Your application has not declared any variables yet.',
  'vars.rteHint': 'While editing text you can also pick a variable straight from the inline toolbar’s dropdown.',

  // Library modal
  'modal.fileManager': 'Media library',
  'modal.assetsTitle': 'Assets',
  'modal.replaceImage': 'Replace image',
  'library.searchPlaceholder': 'Search files…',
  'action.upload': 'Upload',
  'library.clickToPlace': 'Click a file to place it · drag a file onto the canvas',
  'library.clickToReplace': 'Click a file to replace the selected image',
  'library.storageLabel': '{count} files · {size}',
  'library.folders': 'Folders',
  'library.dropHint': 'Drop image files here to upload — or use the Upload button.',
  'library.deleteFileHint': 'Delete file',
  'library.del': 'DEL',
  'toast.assetDeleted': '{name} deleted',
  'library.allFiles': 'All files',
  'library.loadMore': 'Load more',
  'library.empty': 'No files here yet.',

  // Host-supplied storage (core/storage-limits.js, core/storage.js). The
  // limits are the host app's to set -- these strings only report them.
  'storage.loading': 'Loading files…',
  'storage.uploading': 'Uploading {count}…',
  'storage.errLoadFailed': 'The file library could not be loaded — {reason}',
  'storage.errNoLimits': 'Uploads are switched off: this app has not set any upload limits.',
  'storage.errNoMaxBytes': 'Uploads are switched off: no maximum file size has been set.',
  'storage.errTooLarge': '{name} is {size} — the limit is {max}.',
  'storage.errFormat': '{name} is a {type} file, which is not allowed here.',
  'storage.errSvg': '{name} is an SVG, which this app does not accept.',
  'storage.errDimensions': '{name} is {w}×{ht}px — the limit is {maxW}×{maxH}px.',
  'storage.errTooMany': 'Only {max} files can be uploaded at once.',
  'storage.errUnreadable': '{name} is not a readable image.',
  'storage.errUploadFailed': '{name} could not be uploaded — {reason}',
  'storage.errDeleteFailed': '{name} could not be deleted — {reason}',

  // Export modal
  'modal.export': 'Export',
  'modal.exportTitle': 'Your email is ready',
  'export.copy': 'Copy email',
  'export.copied': 'Copied',
  'action.download': 'Download',
  'export.meta': '{kb} KB · ready to copy or download',

  // Code modal
  'modal.rawHtmlTitle': 'Raw HTML, live preview',
  'code.statusEdited': 'Code view — edited — preview live, not yet applied',
  'code.statusSynced': 'Code view — in sync with the canvas',
  'action.reload': 'Reload',
  'action.reloadHint': 'Reload the source from the canvas',
  'action.applyToCanvas': 'Apply to canvas',
  'action.applyToCanvasHint': 'Parse the source back into editable rows',
  'action.closeWithoutApplyingHint': 'Close without applying',
  'code.source': 'Source',
  'code.livePreview': 'Live preview',
  'code.liveHtmlPreviewTitle': 'Live HTML preview',
  'code.applyNote':
    'Apply parses each top-level table row back into a canvas row you can still select, reorder and delete — hand-written markup survives the round trip.',
  'code.meta': '{kb} KB · {lines} lines',
  'toast.sourceReloaded': 'Source reloaded from canvas',
  'toast.sourceAppliedOne': 'Source applied — 1 row back on the canvas',
  'toast.sourceAppliedMany': 'Source applied — {rows} rows back on the canvas',
  'toast.parseError': 'Could not parse that HTML',

  // AI copy modal
  'modal.aiDraft': 'AI writing assistant',
  'modal.aiDraftTitle': 'Draft your email with AI',
  'ai.disclosure': 'AI creates suggestions from your brief. Review and edit the result before sending.',
  'ai.goal': 'Goal',
  'ai.tone': 'Tone',
  'ai.briefLabel': 'What is this email about?',
  'ai.briefPlaceholder': 'e.g. Autumn outerwear drop, 15% for subscribers, free shipping over $150',
  'ai.generate': 'Generate draft with AI',
  'ai.writing': 'Writing…',
  'ai.kindHeadline': 'Headline',
  'ai.kindBody': 'Body copy',
  'ai.kindButton': 'Button label',
  'ai.actionInsertHeading': 'Insert as heading',
  'ai.actionInsertText': 'Insert as text block',
  'ai.actionInsertButton': 'Insert as button',
  'toast.headingAdded': 'Heading added',
  'toast.textBlockAdded': 'Text block added',
  'toast.buttonAdded': 'Button added',

  // Preview modal
  'preview.kickerMobile': 'Preview — mobile 375px',
  'preview.kickerDesktop': 'Preview — desktop {width}px',
  'action.close': 'Close',

  // General toasts (editor-core.js)
  'toast.duplicated': 'Duplicated',
  'toast.fileUploadedOne': '1 file uploaded',
  'toast.fileUploadedMany': '{count} files uploaded',
  'toast.imageReplaced': 'Image replaced',
  'toast.imageAdded': 'Image added to canvas',
  'toast.htmlCopied': 'HTML copied to clipboard',
  'toast.templateLoaded': '{name} loaded',
  'toast.snippetDefaultLabel': 'Snippet',
  'toast.snippetInserted': '{name} inserted',
  'toast.snippetCopied': '{name} copied — select a text block to insert it',

  // Inline rich text toolbar (render/rte.js)
  'rte.textStyle': 'Text style',
  'rte.mergeTags': 'Merge Tags',
  'rte.noMergeTags': 'No merge tags available',
  'rte.textColor': 'Text color',
  'rte.highlightColor': 'Highlight color',
  'rte.removeHighlight': 'Remove highlight',
  'rte.clearFormatting': 'Clear formatting',

  // Screenshot export (export modal / element `screenshotPng()`)
  'action.downloadPng': 'Download PNG',
  'action.screenshot': 'Screenshot',
  'action.screenshotHint': 'Preview the full template as an image, then download it',
  'toast.pngSaved': 'Screenshot downloaded',
  'toast.pngFailed': 'Screenshot failed — an external image could not be loaded',
  'toast.pngCopied': 'Screenshot copied to clipboard',
  'toast.pngCopyFailed': 'This browser would not accept an image on the clipboard',

  // Story-style screenshot viewer (render/story.js)
  'story.kicker': 'Screenshot',
  'story.rendering': 'Rendering the screenshot',
  'story.renderingHint': 'Painting every block at 2× — this takes a moment on a long template.',
  'story.failed': 'Screenshot failed',
  'story.failedHint': 'An image in the template could not be loaded for capture.',
  'story.retry': 'Try again',
  'story.play': 'Play',
  'story.pause': 'Pause',
  'story.replay': 'Replay',
  'story.copy': 'Copy',
  'story.meta': '{w}×{h} · screen {i} of {n}',

  // Footer strip (core/footer.js). One string, so a translator localizes
  // "Powered by" while the product name and year travel with it; a host that
  // wants different wording sets `footer` rather than translating this.
  'footer.poweredBy': 'Powered by SELISE Blocks © 2026',
};

/** Every key the editor asks for. Exported so a translator can diff a custom table against it. */
export const MESSAGE_KEYS = Object.keys(EN).sort();
