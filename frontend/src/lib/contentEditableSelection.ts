/**
 * Char-offset helpers for plain-text contentEditable divs. We treat the
 * editor's `innerText` as the source of truth — Range.toString() yields
 * the same rendered string the user sees, so offsets line up exactly
 * with the value we keep in React state.
 */

export interface CharRange {
  start: number;
  end: number;
}

/** Return start/end char offsets of the current Selection within
 *  `editor`, or `null` if the selection is collapsed or outside. */
export function getSelectionOffsets(editor: HTMLElement): CharRange | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return null;
  if (range.collapsed) return null;

  const pre = document.createRange();
  pre.selectNodeContents(editor);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  const end = start + range.toString().length;
  return { start, end };
}

/** Caret offset (single position) within `editor`. Returns the end of
 *  the editor's content when the caret is outside. */
export function getCaretOffset(editor: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return editor.innerText.length;
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.startContainer)) return editor.innerText.length;
  const pre = document.createRange();
  pre.selectNodeContents(editor);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}

/** Position the caret at `offset` within `editor`. When `endOffset` is
 *  given, the resulting selection spans `[offset, endOffset]`. Walks the
 *  text nodes (and treats <br>'s as one character) so it matches the
 *  innerText-based offsets returned by getSelectionOffsets. */
export function setCaret(
  editor: HTMLElement,
  offset: number,
  endOffset?: number,
): void {
  const sel = window.getSelection();
  if (!sel) return;

  const find = (
    target: number,
  ): { node: Node; nodeOffset: number } => {
    let remaining = target;
    const walker = document.createTreeWalker(
      editor,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    );
    let node: Node | null;
    let lastTextNode: Node | null = null;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) {
        const len = node.textContent?.length ?? 0;
        if (remaining <= len) {
          return { node, nodeOffset: remaining };
        }
        remaining -= len;
        lastTextNode = node;
      } else if ((node as Element).tagName === "BR") {
        if (remaining === 0) {
          return lastTextNode
            ? {
                node: lastTextNode,
                nodeOffset: lastTextNode.textContent?.length ?? 0,
              }
            : { node: editor, nodeOffset: 0 };
        }
        remaining -= 1;
      }
    }
    if (lastTextNode) {
      return {
        node: lastTextNode,
        nodeOffset: lastTextNode.textContent?.length ?? 0,
      };
    }
    return { node: editor, nodeOffset: 0 };
  };

  const range = document.createRange();
  const start = find(offset);
  range.setStart(start.node, start.nodeOffset);
  if (endOffset !== undefined && endOffset !== offset) {
    const end = find(endOffset);
    range.setEnd(end.node, end.nodeOffset);
  } else {
    range.collapse(true);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Insert `insert` at the current caret position inside `editor`. The
 *  caller passes the current text state to avoid relying on innerText
 *  (which can subtly diverge after browser-inserted markup). Returns
 *  the next full text and the caret offset after the inserted span. */
export function insertAtCaretCE(
  editor: HTMLElement,
  current: string,
  insert: string,
): { next: string; offset: number } {
  const caret = getCaretOffset(editor);
  const next = current.slice(0, caret) + insert + current.slice(caret);
  return { next, offset: caret + insert.length };
}
