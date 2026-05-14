/**
 * Lightweight client-side event bus on top of window's CustomEvent.
 *
 * Used for cross-component "data changed" notifications where prop
 * drilling would be ugly — typically when a deeply-nested component
 * mutates server state and unrelated panels need to refresh.
 *
 * Example: deleting a card in CardDetailContent fires
 * `emit("card-deleted", { cardId })`. The LibraryPage card list and
 * the TagsTree both subscribe and re-fetch.
 *
 * No singleton state, no library — `window` is the broker. Listeners
 * unsubscribe automatically when the component returning the cleanup
 * function unmounts.
 */

export type DataEventName =
  | "card-deleted"
  | "card-created"
  | "card-notes-updated"
  | "tag-changed"
  | "feed-changed"
  | "path-changed";

export interface DataEventDetail {
  "card-deleted": { cardId: string };
  "card-created": { cardId: string };
  /** Server-side notes_md was just rewritten — typically because the
   *  user exported chat messages into the notes via ExportChatModal.
   *  Anyone showing this card's notes (the CardDetailContent NotesTab,
   *  or a list with a 'has notes' indicator) should refresh. */
  "card-notes-updated": { cardId: string; notesMd: string };
  "tag-changed": { tagId?: string };
  "feed-changed": { feedId?: string };
  "path-changed": { pathId?: string };
}

/** Fire an event. Detail is required and typed per event. */
export function emit<K extends DataEventName>(name: K, detail: DataEventDetail[K]): void {
  window.dispatchEvent(new CustomEvent(`mindshift:${name}`, { detail }));
}

/**
 * Subscribe to an event. Returns an unsubscribe function — call it from
 * a useEffect cleanup so listeners aren't double-registered on remount.
 */
export function on<K extends DataEventName>(
  name: K,
  handler: (detail: DataEventDetail[K]) => void,
): () => void {
  const eventName = `mindshift:${name}`;
  const wrapped = (e: Event) => handler((e as CustomEvent<DataEventDetail[K]>).detail);
  window.addEventListener(eventName, wrapped);
  return () => window.removeEventListener(eventName, wrapped);
}
