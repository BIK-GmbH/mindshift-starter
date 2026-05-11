// One-shot mic-permission acquisition page.
//
// Loaded by extension/content/highlight.js as an invisible iframe into
// the active web page. Because the host page is a regular tab, Chrome
// has the omnibox-anchored UX surface to show the getUserMedia prompt.
// Once the user clicks Allow, the permission is persisted for the
// extension's origin and the offscreen document can record on demand.
//
// We tell background the outcome via chrome.runtime.sendMessage and
// signal the parent (content script) via window.postMessage so it can
// remove the iframe.

(async () => {
  let result;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    result = { ok: true };
  } catch (err) {
    result = {
      ok: false,
      name: err?.name || "Error",
      message: err?.message || "(no message)",
    };
  }
  try {
    chrome.runtime.sendMessage({
      origin: "permission",
      type: "result",
      ...result,
    });
  } catch {
    /* extension may have unloaded — give up silently */
  }
  try {
    window.parent.postMessage({ type: "mindshift:permission:done" }, "*");
  } catch {
    /* parent may be cross-origin; sending to "*" still works */
  }
})();
