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

export function useVoiceRecording({
  onTranscribed,
  onError,
  endpoint = "/api/transcribe",
  getAuthToken = () => localStorage.getItem("mindshift.token"),
}: UseVoiceRecordingOptions) {
  const [state, setState] = useState<VoiceState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTsRef = useRef<number>(0);
  const tickerRef = useRef<number | null>(null);

  const onTranscribedRef = useRef(onTranscribed);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onTranscribedRef.current = onTranscribed;
    onErrorRef.current = onError;
  }, [onTranscribed, onError]);

  const cleanupStream = useCallback(() => {
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

  const cancel = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try {
        recorderRef.current.stop();
      } catch {
        /* ignore */
      }
    }
    cleanupStream();
    setState("idle");
    setElapsedMs(0);
  }, [cleanupStream]);

  const handleError = useCallback(
    (message: string) => {
      cleanupStream();
      setState("error");
      setElapsedMs(0);
      onErrorRef.current?.(message);
      window.setTimeout(() => {
        setState((s) => (s === "error" ? "idle" : s));
      }, 4000);
    },
    [cleanupStream],
  );

  const start = useCallback(async () => {
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
          ? e.name === "NotAllowedError"
            ? "Microphone access denied."
            : `${e.name}: ${e.message || "(no message)"}`
          : "Microphone access failed.";
      handleError(msg);
    }
  }, [cleanupStream, handleError, endpoint, getAuthToken]);

  const stop = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
  }, []);

  useEffect(() => () => cleanupStream(), [cleanupStream]);

  return { state, supported: SUPPORTED, elapsedMs, cancel, start, stop };
}
