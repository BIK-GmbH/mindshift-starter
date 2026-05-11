// frontend/src/lib/insertAtCaret.ts
/**
 * Insert `text` at the textarea/input's current caret position (or at
 * the end of `current` if no ref is available). Returns the next value
 * and the new caret position. Caller is responsible for setting the new
 * value AND calling `el.setSelectionRange(caret, caret)` inside a
 * microtask so React has re-rendered first.
 */
export function insertAtCaret(
  el: HTMLTextAreaElement | HTMLInputElement | null,
  current: string,
  text: string,
): { next: string; caret: number } {
  if (!el) {
    const joined = current ? `${current} ${text}`.trim() : text;
    return { next: joined, caret: joined.length };
  }
  const start = el.selectionStart ?? current.length;
  const end = el.selectionEnd ?? current.length;
  const before = current.slice(0, start);
  const after = current.slice(end);
  const lead = before && !/[\s\n]$/.test(before) ? " " : "";
  const trail = after && !/^[\s\n]/.test(after) ? " " : "";
  const next = `${before}${lead}${text}${trail}${after}`;
  const caret = (before + lead + text).length;
  return { next, caret };
}
