import { Loader2, Mic } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useVoiceRecording } from "../lib/useVoiceRecording";

interface VoiceRecordButtonProps {
  onTranscribed: (text: string) => void;
  disabled?: boolean;
  className?: string;
  /** Show the status hint line beside/below the button. Default true. */
  showStatusLine?: boolean;
  /** Extra className for the status hint container. */
  statusClassName?: string;
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function VoiceRecordButton({
  onTranscribed,
  disabled = false,
  className,
  showStatusLine = true,
  statusClassName,
}: VoiceRecordButtonProps) {
  const { t } = useTranslation();
  const [lastError, setLastError] = useState<string | null>(null);
  const voice = useVoiceRecording({
    onTranscribed,
    onError: (msg) => {
      setLastError(msg);
      // surface the raw error in the console so we can see DOMException names
      console.warn("[mindshift voice] error:", msg);
    },
  });

  if (!voice.supported) return null;

  const onClick = () => {
    if (voice.state === "recording") void voice.stop();
    else if (voice.state === "idle" || voice.state === "error") void voice.start();
    else voice.cancel();
  };

  const isBusy = voice.state === "transcribing" || voice.state === "requesting";

  const title =
    voice.state === "recording"
      ? t("voice.stop", { defaultValue: "Stop recording" })
      : voice.state === "transcribing"
        ? t("voice.transcribing", { defaultValue: "Transcribing…" })
        : voice.state === "requesting"
          ? t("voice.requesting", { defaultValue: "Requesting mic access…" })
          : voice.state === "error"
            ? t("voice.errorGeneric", { defaultValue: "Voice recording failed. Try again." })
            : t("voice.record", { defaultValue: "Record voice" });

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled && voice.state !== "recording"}
        title={title}
        aria-label={title}
        className={[
          "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md transition-colors",
          voice.state === "recording"
            ? "bg-red-500/20 text-red-400 ring-1 ring-red-500/40"
            : voice.state === "error"
              ? "text-red-400 hover:bg-red-500/10"
              : isBusy
                ? "text-violet-300"
                : "text-ink-400 hover:bg-ink-800 hover:text-ink-100",
          "disabled:cursor-not-allowed disabled:opacity-30",
          className ?? "",
        ].join(" ")}
      >
        {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
      </button>
      {showStatusLine && voice.state !== "idle" && (
        <span
          className={[
            "inline-flex items-center gap-1.5 text-[11px] text-ink-400",
            statusClassName ?? "",
          ].join(" ")}
          aria-live="polite"
        >
          {voice.state === "recording" && (
            <>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
              <span className="font-mono tabular-nums">{formatElapsed(voice.elapsedMs)}</span>
            </>
          )}
          {voice.state === "transcribing" && (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              {t("voice.transcribing", { defaultValue: "Transcribing…" })}
            </>
          )}
          {voice.state === "error" && (
            <span className="text-red-400">
              {lastError ?? t("voice.errorGeneric", { defaultValue: "Voice recording failed. Try again." })}
            </span>
          )}
        </span>
      )}
    </div>
  );
}
