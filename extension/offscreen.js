// Offscreen document that owns the mic recording lifecycle.
//
// Side panels and extension popups have no UX surface for the
// getUserMedia permission prompt, so the in-iframe VoiceRecordButton
// fails with NotAllowedError("Permission dismissed") even when the
// localhost origin is allowed in settings (Chrome treats the
// chrome-extension top-level + localhost iframe as a fresh permission
// pair). Offscreen documents run at the extension origin and CAN use
// getUserMedia — provided the user has already granted the mic
// permission to the extension origin, which is handled by the
// permission.html iframe injected into a regular tab via the content
// script (see background.js > startPermissionFlow).
//
// Protocol — all messages routed via chrome.runtime, filtered by
//   target === "offscreen" (incoming) or origin === "offscreen" (outgoing).
//   Incoming:  { target: "offscreen", type: "start" | "stop" | "cancel" }
//   Outgoing:  { origin: "offscreen", type: "state",       state }
//              { origin: "offscreen", type: "blob",        buffer, mime }
//              { origin: "offscreen", type: "error",       message, name }
//              { origin: "offscreen", type: "permission-needed", name, message }

let recorder = null;
let stream = null;
let chunks = [];

function postState(state) {
  void chrome.runtime.sendMessage({ origin: "offscreen", type: "state", state });
}

function postError(name, message) {
  void chrome.runtime.sendMessage({
    origin: "offscreen",
    type: "error",
    name: name || "Error",
    message: message || "(no message)",
  });
}

function cleanup() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  recorder = null;
  chunks = [];
}

async function start() {
  if (recorder) return; // already recording
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    const name = err?.name || "Error";
    const message = err?.message || "(no message)";
    cleanup();
    if (name === "NotAllowedError") {
      // Permission still missing — tell background to run the
      // content-script-injected permission iframe trick. Background
      // will retry start() after the user grants.
      void chrome.runtime.sendMessage({
        origin: "offscreen",
        type: "permission-needed",
        name,
        message,
      });
    } else {
      postError(name, message);
    }
    return;
  }

  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : "";
  try {
    recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  } catch (err) {
    cleanup();
    postError(err?.name || "Error", err?.message || "MediaRecorder failed");
    return;
  }

  chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  recorder.onstop = async () => {
    const recordedMime = recorder?.mimeType || "audio/webm";
    const blob = new Blob(chunks, { type: recordedMime });
    cleanup();
    if (blob.size === 0) {
      postError("EmptyRecording", "No audio captured.");
      return;
    }
    try {
      const buffer = await blob.arrayBuffer();
      void chrome.runtime.sendMessage({
        origin: "offscreen",
        type: "blob",
        buffer,
        mime: recordedMime,
      });
    } catch (err) {
      postError(err?.name || "Error", err?.message || "Could not read blob.");
    }
  };

  try {
    recorder.start();
    postState("recording");
  } catch (err) {
    cleanup();
    postError(err?.name || "Error", err?.message || "Recorder start failed");
  }
}

function stop() {
  if (!recorder || recorder.state === "inactive") return;
  try {
    recorder.stop();
  } catch (err) {
    postError(err?.name || "Error", err?.message || "Recorder stop failed");
  }
}

function cancel() {
  if (recorder && recorder.state !== "inactive") {
    try {
      recorder.stop();
    } catch {
      /* ignore */
    }
  }
  cleanup();
  postState("idle");
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.target !== "offscreen") return;
  if (msg.type === "start") void start();
  else if (msg.type === "stop") stop();
  else if (msg.type === "cancel") cancel();
});

// Tell background we're alive — background may have been waiting.
void chrome.runtime.sendMessage({ origin: "offscreen", type: "ready" });
