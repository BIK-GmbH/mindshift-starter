// extension/lib/insertAtCaret.js
/** Caret-aware text insert for plain <textarea>. Returns { next, caret }.
 *  Caller is responsible for setting the new value and calling
 *  setSelectionRange(caret, caret) inside a microtask so the DOM has
 *  caught up. Plain JS port of frontend/src/lib/insertAtCaret.ts. */
export function insertAtCaret(el, current, text) {
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
