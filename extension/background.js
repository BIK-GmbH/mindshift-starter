/* Mindshift extension service worker.
 *
 * The toolbar icon opens the popup (default action). The side panel is
 * a separate UI surface — the popup links into it via the runtime
 * messaging below. We also enable the side panel for every tab so the
 * user can pin it from Chrome's UI without per-page configuration.
 */

if (chrome.sidePanel?.setPanelBehavior) {
  // Available in Chrome 116+. Keeps the side panel open across tab
  // switches so the user can compare what they're reading with their
  // saved card.
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .catch(() => {
      /* older Chrome — silently ignore */
    });
}

/** Open the side panel for a specific tab. Called from popup.js via
 *  chrome.runtime.sendMessage so the popup can offer an "Open side
 *  panel" affordance without needing the sidePanel permission itself. */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "openSidePanel") return;
  const tabId = msg.tabId ?? sender?.tab?.id;
  if (tabId == null || !chrome.sidePanel?.open) {
    sendResponse({ ok: false, error: "Side panel API unavailable" });
    return;
  }
  chrome.sidePanel
    .open({ tabId })
    .then(() => sendResponse({ ok: true }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
  // Return true to indicate the response will be sent asynchronously.
  return true;
});
