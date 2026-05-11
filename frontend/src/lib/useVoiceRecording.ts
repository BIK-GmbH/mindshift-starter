// frontend/src/lib/useVoiceRecording.ts
import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceState =
  | "idle"
  | "requesting"
  | "recording"
  | "transcribing"
  | "error";

interface UseVoiceRecordingOptions {
  onTranscribed: (text: string) => void;
  onError?: (message: string) => void;
  endpoint?: string;
  getAuthToken?: () => string | null;
}

const SUPPORTED =
  typeof window !== "undefined" &&
  typeof window.MediaRecorder !== "undefined" &&
  !!navigator.mediaDevices?.getUserMedia;

// We live inside the Chrome side panel's iframe when we have a parent
// frame AND the parent loaded us with `?sp=1`. In that case
// getUserMedia would fail with "Permission dismissed" (Chrome can't
// anchor the prompt to a side panel), so we route audio capture
// through background.js → offscreen document and receive the blob
// back via postMessage.
function detectSidepanelEmbed(): boolean {
  if (typeof window === "undefined") return false;
  if (window.parent === window) return false;
  try {
    return new URLSearchParams(window.location.search).get("sp") === "1";
  } catch {
    return false;
  }
}

export function useVoiceRecording({
  onTranscribed,
  onError,
  endpoint = "/api/transcribe",
  getAuthToken = () => localStorage.getItem("mindshift.token"),
}: UseVoiceRecordingOptions) {
  const [state, setState] = useState<VoiceState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Local-recording refs (used in the non-sidepanel path).
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTsRef = useRef<number>(0);
  const tickerRef = useRef<number | null>(null);

  const sidepanelMode = useRef(detectSidepanelEmbed());

  const onTranscribedRef = useRef(onTranscribed);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onTranscribedRef.current = onTranscribed;
    onErrorRef.current = onError;
  }, [onTranscribed, onError]);

  const cleanupLocalStream = useCallback(() => {
    if (tickerRef.current) {
      window.clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  const handleError = useCallback(
    (message: string) => {
      cleanupLocalStream();
      setState("error");
      setElapsedMs(0);
      onErrorRef.current?.(message);
      window.setTimeout(() => {
        setState((s) => (s === "error" ? "idle" : s));
      }, 4000);
    },
    [cleanupLocalStream],
  );

  // -----------------------------------------------------------------
  // Shared: transcription upload (used by both local + sidepanel paths)
  // -----------------------------------------------------------------
  const uploadAndTranscribe = useCallback(
    async (blob: Blob) => {
      if (blob.size === 0) {
        handleError("No audio captured.");
        return;
      }
      setState("transcribing");
      const ext = blob.type.includes("mp4")
        ? "mp4"
        : blob.type.includes("ogg")
          ? "ogg"
          : "webm";
      const fd = new FormData();
      fd.append("audio", blob, `recording.${ext}`);
      const token = getAuthToken();
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: fd,
        });
        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try {
            detail = (await res.json()).detail || detail;
          } catch {
            /* ignore */
          }
          handleError(detail);
          return;
        }
        const data = (await res.json()) as { text: string };
        const text = (data.text || "").trim();
        if (!text) {
          handleError("No speech detected — try again.");
          return;
        }
        setState("idle");
        setElapsedMs(0);
        onTranscribedRef.current(text);
      } catch (e) {
        handleError(e instanceof Error ? e.message : "Transcription failed.");
      }
    },
    [endpoint, getAuthToken, handleError],
  );

  // -----------------------------------------------------------------
  // Sidepanel path: control + state are remote, audio comes via postMessage
  // -----------------------------------------------------------------
  useEffect(() => {
    if (!sidepanelMode.current) return;
    const handler = async (event: MessageEvent) => {
      const data = event.data as
        | { origin?: string; type?: string; state?: VoiceState; message?: string; buffer?: ArrayBuffer; mime?: string }
        | null;
      if (!data || data.origin !== "background") return;

      if (data.type === "voice:state") {
        const next = data.state;
        setStatusMessage(data.message ?? null);
        if (next !== "requesting") clearRequestingTimer();
        if (next === "recording") {
          startTsRef.current = Date.now();
          setElapsedMs(0);
          if (tickerRef.current) window.clearInterval(tickerRef.current);
          tickerRef.current = window.setInterval(() => {
            setElapsedMs(Date.now() - startTsRef.current);
          }, 100);
          setState("recording");
        } else if (next === "requesting") {
          setState("requesting");
        } else if (next === "idle") {
          if (tickerRef.current) {
            window.clearInterval(tickerRef.current);
            tickerRef.current = null;
          }
          setState("idle");
          setElapsedMs(0);
        } else if (next === "error") {
          if (tickerRef.current) {
            window.clearInterval(tickerRef.current);
            tickerRef.current = null;
          }
          handleError(data.message || "Voice recording failed.");
        }
        return;
      }

      if (data.type === "voice:blob") {
        if (tickerRef.current) {
          window.clearInterval(tickerRef.current);
          tickerRef.current = null;
        }
        if (!data.buffer) {
          handleError("Empty audio buffer.");
          return;
        }
        const blob = new Blob([data.buffer], { type: data.mime || "audio/webm" });
        await uploadAndTranscribe(blob);
        return;
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [handleError, uploadAndTranscribe]);

  // -----------------------------------------------------------------
  // start / stop / cancel — branches by mode
  // -----------------------------------------------------------------
  const requestingTimerRef = useRef<number | null>(null);
  const clearRequestingTimer = useCallback(() => {
    if (requestingTimerRef.current !== null) {
      window.clearTimeout(requestingTimerRef.current);
      requestingTimerRef.current = null;
    }
  }, []);

  const startSidepanel = useCallback(() => {
    if (state === "recording" || state === "requesting") return;
    window.parent.postMessage({ type: "mindshift:voice:start" }, "*");
    setState("requesting");
    setStatusMessage(null);
    clearRequestingTimer();
    requestingTimerRef.current = window.setTimeout(() => {
      setState((s) => {
        if (s !== "requesting") return s;
        onErrorRef.current?.(
          "Voice recording timed out — no response from extension background.",
        );
        return "error";
      });
    }, 25_000);
  }, [state, clearRequestingTimer]);

  const stopSidepanel = useCallback(() => {
    window.parent.postMessage({ type: "mindshift:voice:stop" }, "*");
  }, []);

  const cancelSidepanel = useCallback(() => {
    window.parent.postMessage({ type: "mindshift:voice:cancel" }, "*");
    if (tickerRef.current) {
      window.clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
    clearRequestingTimer();
    setState("idle");
    setElapsedMs(0);
    setStatusMessage(null);
  }, [clearRequestingTimer]);

  const startLocal = useCallback(async () => {
    if (!SUPPORTED) {
      handleError("Voice recording not available in this browser.");
      return;
    }
    if (recorderRef.current) return;
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const recordedMime = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: recordedMime });
        cleanupLocalStream();
        await uploadAndTranscribe(blob);
      };

      recorder.start();
      startTsRef.current = Date.now();
      setElapsedMs(0);
      tickerRef.current = window.setInterval(() => {
        setElapsedMs(Date.now() - startTsRef.current);
      }, 100);
      setState("recording");
    } catch (e) {
      const msg =
        e instanceof Error
          ? `${e.name}: ${e.message || "(no message)"}`
          : "Microphone access failed.";
      handleError(msg);
    }
  }, [cleanupLocalStream, handleError, uploadAndTranscribe]);

  const stopLocal = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
  }, []);

  const cancelLocal = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try {
        recorderRef.current.stop();
      } catch {
        /* ignore */
      }
    }
    cleanupLocalStream();
    setState("idle");
    setElapsedMs(0);
  }, [cleanupLocalStream]);

  useEffect(() => () => cleanupLocalStream(), [cleanupLocalStream]);

  const start = sidepanelMode.current ? startSidepanel : startLocal;
  const stop = sidepanelMode.current ? stopSidepanel : stopLocal;
  const cancel = sidepanelMode.current ? cancelSidepanel : cancelLocal;
  // In sidepanel mode we always claim "supported" — the actual check
  // (MediaRecorder + getUserMedia) happens in the offscreen document.
  const supported = sidepanelMode.current ? true : SUPPORTED;

  return { state, supported, elapsedMs, cancel, start, stop, statusMessage };
}
