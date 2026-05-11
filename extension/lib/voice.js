// extension/lib/voice.js
/** Vanilla JS port of frontend/src/lib/useVoiceRecording.ts.
 *  Factory pattern instead of React hook — caller wires callbacks. */

const SUPPORTED =
  typeof window !== "undefined" &&
  typeof window.MediaRecorder !== "undefined" &&
  !!navigator.mediaDevices?.getUserMedia;

export function createVoiceRecorder({
  endpoint = "/api/transcribe",
  getAuthToken = () => null,
  onTranscribed,
  onError,
  onStateChange,
}) {
  let state = "idle";
  let recorder = null;
  let stream = null;
  let chunks = [];

  const setState = (next) => {
    state = next;
    onStateChange?.(state);
  };

  const cleanupStream = () => {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    recorder = null;
    chunks = [];
  };

  const handleError = (message) => {
    cleanupStream();
    setState("error");
    onError?.(message);
    window.setTimeout(() => {
      if (state === "error") setState("idle");
    }, 3000);
  };

  const start = async () => {
    if (!SUPPORTED) {
      handleError("Voice not available in this browser.");
      return;
    }
    if (recorder) return;
    setState("requesting");
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";
      recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      chunks = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = async () => {
        const recordedMime = recorder?.mimeType || "audio/webm";
        const blob = new Blob(chunks, { type: recordedMime });
        cleanupStream();
        if (blob.size === 0) {
          handleError("No audio captured.");
          return;
        }
        setState("transcribing");
        try {
          const ext = recordedMime.includes("mp4")
            ? "mp4"
            : recordedMime.includes("ogg")
            ? "ogg"
            : "webm";
          const fd = new FormData();
          fd.append("audio", blob, `recording.${ext}`);
          const token = getAuthToken();
          const res = await fetch(endpoint, {
            method: "POST",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: fd,
          });
          if (!res.ok) {
            let detail = `HTTP ${res.status}`;
            try {
              detail = (await res.json()).detail || detail;
            } catch {}
            handleError(detail);
            return;
          }
          const data = await res.json();
          const text = (data.text || "").trim();
          if (!text) {
            handleError("No speech detected — try again.");
            return;
          }
          setState("idle");
          onTranscribed?.(text);
        } catch (e) {
          handleError(e instanceof Error ? e.message : "Transcribe failed.");
        }
      };

      recorder.start();
      setState("recording");
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.name === "NotAllowedError"
            ? "Microphone access denied."
            : e.message
          : "Mic access failed.";
      handleError(msg);
    }
  };

  const stop = () => {
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {}
    }
  };

  const cancel = () => {
    stop();
    cleanupStream();
    setState("idle");
  };

  return {
    start,
    stop,
    cancel,
    isSupported: SUPPORTED,
    getState: () => state,
  };
}
