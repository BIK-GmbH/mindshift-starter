// One-shot mic-permission acquisition page.
//
// Opened as a regular browser tab by background.js whenever the
// offscreen recorder reports a missing mic permission. A full tab
// (not an iframe) is necessary because page-level CSP frame-src
// directives — YouTube being the worst offender — silently block
// chrome-extension:// iframes from loading at all. As a top-level
// tab the page has the omnibox UX surface for the getUserMedia
// prompt, and Chrome persists the resulting decision against the
// extension origin (chrome-extension://<id>).
//
// On success or denial we send the outcome to background and close
// our own tab.

(async () => {
  document.body.style.cssText =
    "font:14px/1.5 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;padding:24px;color:#1a1a1f;background:#fff;";
  document.body.innerHTML =
    '<p>Mikrofon-Zugriff für Mindshift wird angefordert.<br>Bitte oben auf <strong>Zulassen</strong> klicken — dieses Fenster schließt sich danach automatisch.</p>';

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
    await chrome.runtime.sendMessage({
      origin: "permission",
      type: "result",
      ...result,
    });
  } catch {
    /* extension may have unloaded — give up silently */
  }
  // Close our own tab. Requires chrome.tabs permission (we have it).
  try {
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id != null) {
      await chrome.tabs.remove(tab.id);
    } else {
      window.close();
    }
  } catch {
    window.close();
  }
})();
