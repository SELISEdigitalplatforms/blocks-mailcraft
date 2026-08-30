/**
 * The original relies on React's reconciliation to keep a focused `<input>`'s
 * DOM node alive across a per-keystroke re-render (Design-tab fields, the
 * campaign title, AI brief/goal/tone, search boxes, the code textarea all
 * commit on every `input` event, not just on blur). This renderer has no
 * VDOM -- it rebuilds DOM from scratch -- so without this, typing a single
 * character into any of those fields would lose focus immediately after.
 *
 * The fix: every such input (and every RTE-edited block: text, heading, box,
 * html) carries a stable `data-focus-key`. Before a rebuild, capture the
 * focused element's key + selection range; after, find the new element with
 * the same key and restore focus and the caret position, so the net effect
 * matches React's outcome even though the DOM node identity changed.
 *
 * Contenteditable blocks need this just as much as plain inputs: focusing
 * one sets `core.state.editing`, and `EditorCore.mountKeyboard`'s
 * `selectionchange` listener refreshes the toolbar's active states on every
 * caret move. Without
 * caret-position restoration here, that would blow away and recreate the
 * focused div each time, so the very first keystroke would silently drop
 * focus and the RTE toolbar would appear to do nothing.
 */
export function withFocusPreserved(root, rebuild) {
  const active = root.activeElement;
  const key = active && active.dataset ? active.dataset.focusKey : null;
  let selStart = null; let selEnd = null; let scrollTop = null; let editable = false;
  // A range slider mid-drag is the one focus-preservation case where
  // restoring focus on a rebuilt node isn't enough: dragging its thumb is a
  // native, implicit mouse capture tied to that exact element, and replacing
  // the element (as every other rebuilt input does here) silently drops that
  // capture -- the thumb stops tracking the mouse and the slider feels like
  // it's snapping/jumping instead of gliding. So this one case skips
  // rebuilding the node entirely: the live element is pulled out before
  // `rebuild()` and spliced back into the freshly-built tree afterward.
  const rangeNode = key && active.tagName === 'INPUT' && active.type === 'range' ? active : null;
  if (rangeNode) {
    // nothing to capture -- the node itself is preserved below, after rebuild()
  } else if (key && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
    try { selStart = active.selectionStart; selEnd = active.selectionEnd; } catch { /* some input types don't support selection */ }
    scrollTop = active.scrollTop;
  } else if (key && active.isContentEditable) {
    editable = true;
    const sel = shadowSelection(root);
    if (sel && sel.rangeCount && active.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      selStart = textOffset(active, range.startContainer, range.startOffset);
      selEnd = textOffset(active, range.endContainer, range.endOffset);
    }
    scrollTop = active.scrollTop;
  }

  rebuild();

  if (!key) return;
  const next = root.querySelector(`[data-focus-key="${cssEscape(key)}"]`);
  if (!next) return;
  if (rangeNode) {
    for (const attr of ['min', 'max', 'step']) {
      const v = next.getAttribute(attr);
      if (v === null) rangeNode.removeAttribute(attr); else rangeNode.setAttribute(attr, v);
    }
    next.replaceWith(rangeNode);
    return;
  }
  if (editable) {
    // Set the Range *before* focusing: focusing a contenteditable establishes
    // its own default collapsed selection as a side effect, and doing that
    // after we've placed the real caret fires a second, out-of-order
    // `selectionchange` notification for that now-stale default -- which
    // arrives *after* the one for our real restore, so it looks like a fresh,
    // later selection change and clobbers the correct caret right back to
    // collapsed. Setting the range first means `.focus()` adopts the
    // selection that's already there instead of replacing it.
    if (selStart != null) {
      try {
        const range = document.createRange();
        setPointAtOffset(range, next, selStart, true);
        setPointAtOffset(range, next, selEnd, false);
        const sel = shadowSelection(root);
        sel.removeAllRanges();
        sel.addRange(range);
      } catch { /* ignore -- element structure changed under the caret */ }
    }
    // `preventScroll` matters a lot here: this `.focus()` fires on every
    // re-render of a block mid-edit (every keystroke), not just once. Without
    // it, the browser's default focus-scroll-into-view runs every time --
    // harmless on a short template, but on a long one it yanks the canvas
    // back toward the focused block on every keystroke, fighting whatever
    // scroll position the user actually had.
    next.focus({ preventScroll: true });
  } else {
    next.focus({ preventScroll: true });
    if (selStart != null) {
      try { next.setSelectionRange(selStart, selEnd); } catch { /* ignore */ }
    }
  }
  if (scrollTop != null) next.scrollTop = scrollTop;
}

/**
 * `document.getSelection()`/`window.getSelection()` is redacted to the host
 * document when the real selection lives inside an open shadow root -- in
 * Chrome its `anchorNode` reports as `<body>` rather than the actual text
 * node being edited, even though the visible caret and `execCommand` both
 * still operate on the real position. Reading through that redacted object
 * (as this file needs to, to compute/restore a caret offset) silently gives
 * back garbage -- not an error, just always "position 0" -- which is what
 * made every re-render-while-typing reset the caret to the start and type
 * new characters in reverse. `ShadowRoot.getSelection()` (Chromium-only; no
 * standard equivalent yet) reports the real node/offset.
 */
function shadowSelection(root) {
  return typeof root.getSelection === 'function' ? root.getSelection() : window.getSelection();
}

/** Character offset of (node, offset) counting only text within `root`, walking in document order. */
export function textOffset(root, node, offset) {
  if (node.nodeType !== Node.TEXT_NODE) {
    // A range boundary can land on an element (e.g. offset counts child nodes) --
    // resolve it to the text position right before its `offset`-th child.
    let n = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let cur; let target = node.childNodes[offset];
    if (!target) { while (walker.nextNode()) n += walker.currentNode.nodeValue.length; return n; }
    while ((cur = walker.nextNode())) { if (cur === target || target.contains(cur)) return n; n += cur.nodeValue.length; }
    return n;
  }
  let n = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let cur;
  while ((cur = walker.nextNode())) {
    if (cur === node) return n + offset;
    n += cur.nodeValue.length;
  }
  return n;
}

/** Sets the start or end point of `range` to the text-offset position inside `root`. */
function setPointAtOffset(range, root, targetOffset, isStart) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n = 0; let cur; let last = null;
  while ((cur = walker.nextNode())) {
    last = cur;
    const len = cur.nodeValue.length;
    if (n + len >= targetOffset) {
      const point = targetOffset - n;
      if (isStart) range.setStart(cur, point); else range.setEnd(cur, point);
      return;
    }
    n += len;
  }
  if (last) { if (isStart) range.setStart(last, last.nodeValue.length); else range.setEnd(last, last.nodeValue.length); }
  else { if (isStart) range.setStart(root, 0); else range.setEnd(root, 0); }
}

function cssEscape(s) {
  return String(s).replace(/["\\]/g, '\\$&');
}
