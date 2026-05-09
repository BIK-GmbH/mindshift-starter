import {
  Headphones,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError, api, tokenStorage, type CardAudioOut } from "../lib/api";

interface Props {
  cardId: string;
}

type Phase = "idle" | "loading" | "ready" | "generating" | "error";

const POLL_MS = 4000;

/**
 * Podcast section in card detail. Generation is opt-in (clicking the
 * Generate button) — the Gemini TTS call costs real money and takes
 * ~30–60 s, so we never trigger it implicitly. Once generated, the
 * audio + narrative text are persisted server-side and re-loaded on
 * subsequent visits.
 */
export default function CardPodcastPlayer({ cardId }: Props) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>("idle");
  const [audio, setAudio] = useState<CardAudioOut | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const blobUrlRef = useRef<string | null>(null);

  // Fetch + auto-poll while the backend is still synthesizing.
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      try {
        const meta = await api.getCardAudio(cardId);
        if (cancelled) return;
        setAudio(meta);
        if (meta.status === "ready") {
          await loadBlob(cardId);
          if (!cancelled) setPhase("ready");
        } else if (meta.status === "failed") {
          setError(meta.error_message ?? "Generation failed");
          setPhase("error");
        } else {
          // processing — keep polling
          setPhase("generating");
          timer = window.setTimeout(tick, POLL_MS);
        }
      } catch (err) {
        if (cancelled) return;
        // 404 = no audio row yet → show the friendly "not generated"
        // idle state, not the red error banner. Match by status, not by
        // the message string (which is the backend detail like
        // "Audio not found", never literally "404").
        if (err instanceof ApiError && err.status === 404) {
          setPhase("idle");
        } else {
          setError((err as Error).message);
          setPhase("error");
        }
      }
    };

    setPhase("loading");
    setError(null);
    void tick();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId]);

  // Revoke object URL on unmount.
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  const loadBlob = async (id: string) => {
    // The audio endpoint requires the auth header, so we fetch as a blob
    // and turn it into an object URL for the <audio> element.
    const token = tokenStorage.get();
    const url = api.cardAudioStreamUrl(id);
    const resp = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!resp.ok) throw new Error(`Audio fetch failed (${resp.status})`);
    const blob = await resp.blob();
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    const next = URL.createObjectURL(blob);
    blobUrlRef.current = next;
    setBlobUrl(next);
  };

  const generate = async () => {
    setPhase("generating");
    setError(null);
    try {
      // Backend returns 202 immediately with status=processing.
      // The poll loop in the mount-effect picks up the work — but we
      // need to re-arm it because that effect already ran. Force a
      // re-fetch on the next tick.
      const meta = await api.generateCardAudio(cardId);
      setAudio(meta);
      // Kick polling: schedule a fetch via the same logic (we copy it
      // here rather than refactoring the effect).
      const poll = async () => {
        try {
          const m = await api.getCardAudio(cardId);
          setAudio(m);
          if (m.status === "ready") {
            await loadBlob(cardId);
            setPhase("ready");
          } else if (m.status === "failed") {
            setError(m.error_message ?? "Generation failed");
            setPhase("error");
          } else {
            window.setTimeout(poll, POLL_MS);
          }
        } catch (err) {
          setError((err as Error).message);
          setPhase("error");
        }
      };
      window.setTimeout(poll, POLL_MS);
    } catch (err) {
      setError((err as Error).message || "Generation failed");
      setPhase("error");
    }
  };

  const remove = async () => {
    if (!window.confirm(t("podcast.confirmDelete", { defaultValue: "Delete generated podcast?" }) ?? "")) {
      return;
    }
    try {
      await api.deleteCardAudio(cardId);
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
      setBlobUrl(null);
      setAudio(null);
      setShowTranscript(false);
      setPhase("idle");
    } catch (err) {
      setError((err as Error).message || "Delete failed");
    }
  };

  return (
    <section className="surface-soft rounded-xl border border-ink-800 bg-ink-800/40 p-4">
      <header className="mb-3 flex items-center gap-2">
        <Headphones className="h-4 w-4 text-ink-300" />
        <h3 className="text-sm font-semibold text-ink-100">
          {t("podcast.heading", { defaultValue: "Podcast" })}
        </h3>
        {phase === "ready" && audio && (
          <span className="text-[10px] uppercase tracking-wider text-ink-500">
            {audio.voice} · {new Date(audio.created_at).toLocaleDateString()}
          </span>
        )}
      </header>

      {phase === "loading" && (
        <div className="flex items-center gap-2 text-xs text-ink-400">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t("common.loading")}
        </div>
      )}

      {phase === "idle" && (
        <div className="space-y-2">
          <p className="text-[12px] leading-relaxed text-ink-300">
            {t("podcast.idleHint", {
              defaultValue:
                "Listen to a narrated version of this card. Generation runs once and takes ~30 seconds — uses your Gemini quota.",
            })}
          </p>
          <button
            type="button"
            onClick={generate}
            className="inline-flex items-center gap-1.5 rounded-md bg-ink-100 px-3 py-1.5 text-xs font-medium text-ink-900 transition hover:bg-ink-200"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {t("podcast.generate", { defaultValue: "Generate podcast" })}
          </button>
        </div>
      )}

      {phase === "generating" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-ink-300">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t("podcast.generating", {
              defaultValue: "Writing narration and synthesizing voice…",
            })}
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-ink-800">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-emerald-400/70" />
          </div>
        </div>
      )}

      {phase === "ready" && blobUrl && (
        <div className="space-y-3">
          <audio
            controls
            src={blobUrl}
            className="w-full"
            preload="metadata"
          >
            <track kind="captions" />
          </audio>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowTranscript((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md border border-ink-700 px-2 py-1 text-[11px] text-ink-300 transition hover:bg-ink-800"
            >
              {showTranscript
                ? t("podcast.hideTranscript", { defaultValue: "Hide transcript" })
                : t("podcast.showTranscript", { defaultValue: "Show transcript" })}
            </button>
            <button
              type="button"
              onClick={generate}
              className="inline-flex items-center gap-1 rounded-md border border-ink-700 px-2 py-1 text-[11px] text-ink-300 transition hover:bg-ink-800"
              title={t("podcast.regenerateTitle", { defaultValue: "Regenerate (replaces current audio)" }) ?? ""}
            >
              <RefreshCw className="h-3 w-3" />
              {t("podcast.regenerate", { defaultValue: "Regenerate" })}
            </button>
            <button
              type="button"
              onClick={remove}
              className="ml-auto inline-flex items-center gap-1 rounded-md border border-ink-700 px-2 py-1 text-[11px] text-ink-300 transition hover:bg-red-500/10 hover:text-red-300"
            >
              <Trash2 className="h-3 w-3" />
              {t("common.delete")}
            </button>
          </div>
          {showTranscript && audio && (
            <div className="rounded-md bg-ink-900/40 p-3 text-[12px] leading-relaxed text-ink-300">
              {audio.narrative_text}
            </div>
          )}
        </div>
      )}

      {phase === "error" && (
        <div className="space-y-2">
          <p className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
          <button
            type="button"
            onClick={generate}
            className="inline-flex items-center gap-1 rounded-md border border-ink-700 px-2 py-1 text-[11px] text-ink-300 transition hover:bg-ink-800"
          >
            <RefreshCw className="h-3 w-3" />
            {t("common.retry")}
          </button>
        </div>
      )}
    </section>
  );
}
