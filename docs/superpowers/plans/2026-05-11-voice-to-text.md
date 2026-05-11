# Voice-to-Text Dictation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mic button in 6 text-input fields that captures audio, sends it to `/api/transcribe`, and inserts the transcribed text at the caret position.

**Architecture:** One reusable `VoiceRecordButton` (wraps `useVoiceRecording` hook) drops into each plain `<textarea>` site. TipTap-based `RichTextEditor` gets the button inside its own toolbar with an `editor.commands.insertContent()` adapter. Backend has a single new endpoint `/api/transcribe` that proxies to OpenAI `gpt-4o-mini-transcribe`. No new tables, no migrations, no rate limit (user-explicit), no anonymous use.

**Tech Stack:** FastAPI + OpenAI SDK (backend); React 18 + TypeScript + react-i18next + lucide-react + TipTap (frontend). No new frontend deps (uses native `MediaRecorder` + `fetch`). No new backend deps (OpenAI SDK already present).

**Spec reference:** `docs/superpowers/specs/2026-05-11-voice-to-text-design.md`.

**Branch:** `feat/voice-to-text` (already on it).

**Test gate:** Backend pytest + frontend `npx tsc -b --noEmit` + autonomous browser-render smoke. Speak-into-mic flow is parked for human smoke.

---

## File map

| Path | Action | Responsibility |
|---|---|---|
| `backend/app/api/transcribe.py` | create | New `/transcribe` endpoint |
| `backend/app/main.py` | modify | Register the transcribe router |
| `backend/tests/test_transcribe.py` | create | pytest for the endpoint |
| `frontend/src/lib/useVoiceRecording.ts` | create | MediaRecorder hook |
| `frontend/src/lib/insertAtCaret.ts` | create | Caret-aware text insert helper |
| `frontend/src/components/VoiceRecordButton.tsx` | create | Reusable button + status overlay |
| `frontend/src/components/ChatPanel.tsx` | modify | Wire into chat composer |
| `frontend/src/pages/PathEditPage.tsx` | modify | Wire into description + per-step lesson note (2 spots) |
| `frontend/src/components/cardTabs/HighlightsTab.tsx` | modify | Wire into highlight-edit textarea |
| `frontend/src/components/cardTabs/PostsTab.tsx` | modify | Wire into post-edit textarea |
| `frontend/src/pages/PodcastsPage.tsx` | modify | Wire into narrative-text textarea |
| `frontend/src/components/RichTextEditor.tsx` | modify | TipTap integration (one place → ~4 callsites benefit) |
| `frontend/src/locales/en.json` | modify | Add `voice.*` namespace |
| `frontend/src/locales/de.json` | modify | German equivalents |

---

## Task 1: Backend — `/api/transcribe` endpoint + tests

**Files:**
- Create: `backend/app/api/transcribe.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_transcribe.py`

- [ ] **Step 1: Create the endpoint**

```python
# backend/app/api/transcribe.py
"""Voice-to-text transcription via OpenAI.

Auth-gated, 25 MB cap, no rate limit yet. The audio blob is uploaded
chunk-by-chunk to avoid loading huge payloads into memory; if the body
exceeds MAX_BYTES we 413 mid-stream.
"""
from __future__ import annotations

import io

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models.user import User

router = APIRouter(prefix="/transcribe", tags=["transcribe"])

MAX_BYTES = 25 * 1024 * 1024  # OpenAI hard limit
READ_CHUNK = 64 * 1024


@router.post("")
async def transcribe(
    audio: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Stream upload, cap at 25 MB, call OpenAI, return the transcript."""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await audio.read(READ_CHUNK)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"Audio too large: max {MAX_BYTES // (1024 * 1024)} MB.",
            )
        chunks.append(chunk)
    audio_bytes = b"".join(chunks)
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file.")

    if not settings.openai_api_key:
        raise HTTPException(
            status_code=503,
            detail="Transcription unavailable: OPENAI_API_KEY not configured.",
        )

    from openai import OpenAI  # local import keeps cold-start light

    client = OpenAI(api_key=settings.openai_api_key)
    fname = audio.filename or "recording.webm"
    file_obj = io.BytesIO(audio_bytes)
    file_obj.name = fname  # OpenAI infers format from filename
    try:
        result = client.audio.transcriptions.create(
            model="gpt-4o-mini-transcribe",
            file=(fname, file_obj, audio.content_type or "audio/webm"),
            response_format="json",
        )
        text = (result.text or "").strip()
    except Exception as exc:  # OpenAI SDK raises various subtypes; collapse to 502
        raise HTTPException(
            status_code=502,
            detail=f"Transcription failed: {type(exc).__name__}",
        ) from exc
    return {"text": text, "audio_bytes": total}
```

- [ ] **Step 2: Register the router in `main.py`**

In `backend/app/main.py`, find the existing `app.include_router(...)` block and add a line for the transcribe router. Mirror the existing pattern (the path prefix is `/api` on most routers — verify and follow).

```python
from app.api import transcribe  # add to imports
...
app.include_router(transcribe.router, prefix="/api")
```

- [ ] **Step 3: Add a test**

```python
# backend/tests/test_transcribe.py
"""Tests for /api/transcribe."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_transcribe_requires_auth(client):
    r = client.post(
        "/api/transcribe",
        files={"audio": ("test.webm", b"fake-audio-bytes", "audio/webm")},
    )
    assert r.status_code in (401, 403)


def test_transcribe_rejects_empty_audio(client, authed_user):
    r = client.post(
        "/api/transcribe",
        files={"audio": ("test.webm", b"", "audio/webm")},
        headers={"Authorization": f"Bearer {authed_user.token}"},
    )
    assert r.status_code == 400


def test_transcribe_too_large(client, authed_user):
    huge = b"x" * (26 * 1024 * 1024)
    r = client.post(
        "/api/transcribe",
        files={"audio": ("test.webm", huge, "audio/webm")},
        headers={"Authorization": f"Bearer {authed_user.token}"},
    )
    assert r.status_code == 413


@patch("openai.OpenAI")
def test_transcribe_happy_path(mock_openai_cls, client, authed_user):
    mock_client = MagicMock()
    mock_client.audio.transcriptions.create.return_value = MagicMock(text="hello world")
    mock_openai_cls.return_value = mock_client
    r = client.post(
        "/api/transcribe",
        files={"audio": ("test.webm", b"some-audio-bytes" * 100, "audio/webm")},
        headers={"Authorization": f"Bearer {authed_user.token}"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["text"] == "hello world"
    assert body["audio_bytes"] > 0
```

This test needs an `authed_user` fixture. Check `backend/tests/conftest.py` — if a fixture that creates a user + returns a JWT-style auth token exists, reuse it. If not, add this skeleton to conftest:

```python
@pytest.fixture
def authed_user(db: Session):
    """Create a user and return an object with a `.token` attribute usable
    as a Bearer credential. Implementation depends on the project's auth
    helpers — use the existing JWT issuer."""
    from app.core.security import create_access_token  # adapt to actual helper
    user = _make_user(db, public_profile=False)
    token = create_access_token(subject=str(user.id))
    user.token = token  # type: ignore[attr-defined]
    return user
```

If the helper has a different name, find it via `grep -rn "def create_access_token\|encode_jwt\|issue_token" backend/app/core/`.

- [ ] **Step 4: Run tests**

```bash
cd /Users/chris/Dropbox/git_reps_v4/mindshift/backend
.venv/bin/pytest tests/test_transcribe.py -v 2>&1 | tail -20
```

Expected: 4/4 pass. If `authed_user` fixture creation fails, fix the fixture before the implementer commits.

- [ ] **Step 5: Commit**

```bash
cd /Users/chris/Dropbox/git_reps_v4/mindshift
git add backend/app/api/transcribe.py backend/app/main.py backend/tests/test_transcribe.py
# Add conftest.py only if you modified it:
# git add backend/tests/conftest.py
git commit -m "feat(api): voice-to-text transcribe endpoint"
```

---

## Task 2: Frontend hook + caret helper

**Files:**
- Create: `frontend/src/lib/useVoiceRecording.ts`
- Create: `frontend/src/lib/insertAtCaret.ts`

- [ ] **Step 1: Create the hook**

```ts
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
      }, 3000);
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
            : e.message
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
```

- [ ] **Step 2: Create the caret helper**

```ts
// frontend/src/lib/insertAtCaret.ts
/**
 * Insert `text` at the textarea's current caret position (or at the
 * end of `current` if no textarea ref is available). Returns the next
 * value and the new caret position. Caller is responsible for setting
 * the new value AND calling `textarea.setSelectionRange(caret, caret)`
 * inside a microtask so React has re-rendered first.
 */
export function insertAtCaret(
  textarea: HTMLTextAreaElement | HTMLInputElement | null,
  current: string,
  text: string,
): { next: string; caret: number } {
  if (!textarea) {
    const joined = current ? `${current} ${text}`.trim() : text;
    return { next: joined, caret: joined.length };
  }
  const start = textarea.selectionStart ?? current.length;
  const end = textarea.selectionEnd ?? current.length;
  const before = current.slice(0, start);
  const after = current.slice(end);
  const lead = before && !/[\s\n]$/.test(before) ? " " : "";
  const trail = after && !/^[\s\n]/.test(after) ? " " : "";
  const next = `${before}${lead}${text}${trail}${after}`;
  const caret = (before + lead + text).length;
  return { next, caret };
}
```

- [ ] **Step 3: Type-check + commit**

```bash
cd /Users/chris/Dropbox/git_reps_v4/mindshift/frontend && npx tsc -b --noEmit; echo exit=$?
cd /Users/chris/Dropbox/git_reps_v4/mindshift
git add frontend/src/lib/useVoiceRecording.ts frontend/src/lib/insertAtCaret.ts
git commit -m "feat(voice): useVoiceRecording hook + insertAtCaret helper"
```

Expected: `exit=0`.

---

## Task 3: `VoiceRecordButton` reusable component + i18n keys

**Files:**
- Create: `frontend/src/components/VoiceRecordButton.tsx`
- Modify: `frontend/src/locales/en.json`
- Modify: `frontend/src/locales/de.json`

- [ ] **Step 1: Add i18n keys**

To `frontend/src/locales/en.json` (top-level, next to `pdf`, `paths`, etc.):

```json
"voice": {
  "record": "Record voice",
  "stop": "Stop recording",
  "recording": "Recording — click to stop",
  "transcribing": "Transcribing…",
  "requesting": "Requesting mic access…",
  "errorGeneric": "Voice recording failed. Try again.",
  "errorPermission": "Microphone access denied.",
  "errorUnsupported": "Voice recording not available in this browser.",
  "errorTooLarge": "Recording too long (max 25 MB).",
  "errorNoSpeech": "No speech detected — try again."
},
```

To `frontend/src/locales/de.json`:

```json
"voice": {
  "record": "Sprachaufnahme",
  "stop": "Aufnahme stoppen",
  "recording": "Nimmt auf — klick zum Stoppen",
  "transcribing": "Transkribiere…",
  "requesting": "Mikro-Zugriff…",
  "errorGeneric": "Sprachaufnahme fehlgeschlagen. Bitte erneut versuchen.",
  "errorPermission": "Mikro-Zugriff verweigert.",
  "errorUnsupported": "Sprachaufnahme in diesem Browser nicht verfügbar.",
  "errorTooLarge": "Aufnahme zu lang (max 25 MB).",
  "errorNoSpeech": "Keine Sprache erkannt — bitte erneut versuchen."
},
```

Validate:
```bash
python3 -c "
import json
en = json.load(open('frontend/src/locales/en.json'))['voice']
de = json.load(open('frontend/src/locales/de.json'))['voice']
ks = ['record','stop','recording','transcribing','requesting','errorGeneric','errorPermission','errorUnsupported','errorTooLarge','errorNoSpeech']
print('en missing:', [k for k in ks if k not in en])
print('de missing:', [k for k in ks if k not in de])
"
```

Expected: both empty.

- [ ] **Step 2: Create the button component**

```tsx
// frontend/src/components/VoiceRecordButton.tsx
import { Loader2, Mic } from "lucide-react";
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
  const voice = useVoiceRecording({ onTranscribed });

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
              {t("voice.errorGeneric", { defaultValue: "Voice recording failed. Try again." })}
            </span>
          )}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Type-check + JSON validation + commit**

```bash
cd /Users/chris/Dropbox/git_reps_v4/mindshift/frontend && npx tsc -b --noEmit; echo exit=$?
cd /Users/chris/Dropbox/git_reps_v4/mindshift
git add frontend/src/components/VoiceRecordButton.tsx frontend/src/locales/en.json frontend/src/locales/de.json
git commit -m "feat(voice): VoiceRecordButton component + i18n"
```

---

## Task 4: Plain-textarea integrations (5 callsites)

**Files:**
- Modify: `frontend/src/components/ChatPanel.tsx`
- Modify: `frontend/src/pages/PathEditPage.tsx`
- Modify: `frontend/src/components/cardTabs/HighlightsTab.tsx`
- Modify: `frontend/src/components/cardTabs/PostsTab.tsx`
- Modify: `frontend/src/pages/PodcastsPage.tsx`

The pattern is identical per callsite:

1. Add a `useRef<HTMLTextAreaElement>(null)` for the textarea (if not already there — most files already have it).
2. Render `<VoiceRecordButton onTranscribed={...} />` near the textarea (inside its toolbar / footer / wherever feels natural).
3. The `onTranscribed` callback:
   ```ts
   const onTranscribed = useCallback((text: string) => {
     const ta = textareaRef.current;
     const { next, caret } = insertAtCaret(ta, value, text);
     setValue(next);
     setTimeout(() => {
       if (ta) {
         ta.setSelectionRange(caret, caret);
         ta.focus();
       }
     }, 0);
   }, [value]);
   ```
   Replace `value` / `setValue` with the file's actual state hooks.

- [ ] **Step 1: ChatPanel.tsx**

Read the file. Find the textarea (line ~175). Locate its surrounding state hook (`useState` for input value). Add the import, ref, callback, and button:

```tsx
import { useRef, useCallback, useEffect, useState } from "react";
import VoiceRecordButton from "./VoiceRecordButton";
import { insertAtCaret } from "../lib/insertAtCaret";

// inside the component, alongside existing state:
const textareaRef = useRef<HTMLTextAreaElement>(null);

const onVoice = useCallback((text: string) => {
  const ta = textareaRef.current;
  const { next, caret } = insertAtCaret(ta, input, text);
  setInput(next);
  setTimeout(() => {
    if (ta) {
      ta.setSelectionRange(caret, caret);
      ta.focus();
    }
  }, 0);
}, [input]);
```

(Replace `input` / `setInput` with the actual state names used in `ChatPanel`.)

Attach the ref to the textarea: `<textarea ref={textareaRef} ... />`.

Render `<VoiceRecordButton onTranscribed={onVoice} showStatusLine={false} />` in the composer's button row (next to the existing Send button). The status hint is hidden because the chat composer has limited vertical space — error feedback comes from the button color.

- [ ] **Step 2: PathEditPage.tsx (two textareas)**

Two integrations on the same page: description (line ~565) and per-step lesson note (line ~589). Each has its own ref + callback. Use distinct names: `descRef` + `onVoiceDesc`, `lessonRef` + `onVoiceLesson`.

Render each `VoiceRecordButton` next to its textarea label.

- [ ] **Step 3: HighlightsTab.tsx**

One textarea at line ~194 (highlight-edit form). Same pattern.

- [ ] **Step 4: PostsTab.tsx**

One textarea at line ~633 (post-edit). Same pattern.

- [ ] **Step 5: PodcastsPage.tsx**

One textarea at line ~1625 (narrative script). Same pattern. (Skip the RichTextEditor on this page — that's handled by Task 5.)

- [ ] **Step 6: Type-check + commit**

```bash
cd /Users/chris/Dropbox/git_reps_v4/mindshift/frontend && npx tsc -b --noEmit; echo exit=$?
cd /Users/chris/Dropbox/git_reps_v4/mindshift
git add frontend/src/components/ChatPanel.tsx frontend/src/pages/PathEditPage.tsx frontend/src/components/cardTabs/HighlightsTab.tsx frontend/src/components/cardTabs/PostsTab.tsx frontend/src/pages/PodcastsPage.tsx
git commit -m "feat(voice): wire VoiceRecordButton into 5 plain-textarea sites"
```

Expected: `exit=0`. If any callsite's state hook is named differently than what the plan assumes, adapt — the pattern is uniform but variable names vary.

---

## Task 5: TipTap integration in `RichTextEditor`

**Files:**
- Modify: `frontend/src/components/RichTextEditor.tsx`

- [ ] **Step 1: Read the file to understand its structure**

Locate the existing toolbar JSX (the row of formatting buttons — Bold / Italic / etc.) and the `useEditor()` hook setup. The toolbar is likely a `<div className="...flex...">` containing `<button>` elements wired to `editor.commands.toggleBold()`-style calls.

- [ ] **Step 2: Add the Voice button to the toolbar**

```tsx
import VoiceRecordButton from "./VoiceRecordButton";

// inside the component, after the editor is constructed:
const onVoice = useCallback((text: string) => {
  if (!editor) return;
  editor.commands.focus();
  editor.commands.insertContent(text);
}, [editor]);
```

Then in the toolbar JSX, add a button. The exact spot depends on the file's existing structure — choose a place that fits the visual grouping (e.g., at the right end of the toolbar after the link button, or in a small "input tools" subgroup).

```tsx
<VoiceRecordButton onTranscribed={onVoice} disabled={!editor} showStatusLine={false} />
```

We pass `showStatusLine={false}` because the rich-text editor's toolbar is dense; recording feedback comes purely from the mic button's red background + pulse.

- [ ] **Step 3: Type-check + commit**

```bash
cd /Users/chris/Dropbox/git_reps_v4/mindshift/frontend && npx tsc -b --noEmit; echo exit=$?
cd /Users/chris/Dropbox/git_reps_v4/mindshift
git add frontend/src/components/RichTextEditor.tsx
git commit -m "feat(voice): TipTap integration via editor.commands.insertContent"
```

Expected: `exit=0`. Since `RichTextEditor` is used in NotesTab, AddYouTubeModal, PodcastsPage, and possibly more, this single change activates the Mic button across all those callsites for free.

---

## Task 6: Autonomous browser smoke

**Files:** none.

The goal of this task: verify the Mic button **renders** in each callsite, the backend endpoint responds correctly, and there are no runtime errors when clicking. The full "speak into mic and verify text appears" requires a human; this task does what it can autonomously.

- [ ] **Step 1: Restart the stack**

```bash
cd /Users/chris/Dropbox/git_reps_v4/mindshift
./scripts/stop.sh && ./scripts/start.sh
sleep 8
```

Tail backend log to confirm boot: `tail -n 30 .runtime/logs/backend.log`. The new `/transcribe` route should be visible in the route list at startup.

- [ ] **Step 2: Backend smoke via curl**

Get a JWT for the seeded user (`chris@example.com` / `testpass1234`):

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:8001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"chris@example.com","password":"testpass1234"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')
echo "TOKEN_LEN=${#TOKEN}"
```

Then hit the endpoint with an empty file to verify the size guard:

```bash
echo -n "" > /tmp/empty.webm
curl -s -X POST http://127.0.0.1:8001/api/transcribe \
  -H "Authorization: Bearer $TOKEN" \
  -F "audio=@/tmp/empty.webm;type=audio/webm" \
  -w "\nHTTP %{http_code}\n"
```

Expected: HTTP 400, body `{"detail":"Empty audio file."}`.

- [ ] **Step 3: Frontend render smoke via browser tools**

Using whatever browser-automation MCP / skill the controller has access to (firecrawl-interact, Playwright MCP, browser_* tools), navigate to:

1. `http://localhost:5173/` — log in as `chris@example.com` / `testpass1234`. Verify successful login.
2. Open any card with notes. Switch to the Notes tab. Verify the RichTextEditor toolbar shows a Mic button.
3. Open the ChatPage. Verify the chat composer shows a Mic button near the Send button.
4. Open a Path in the editor (e.g. `/paths/<id>`). Verify the description textarea and at least one step's lesson-note textarea show Mic buttons.
5. Open the Highlights tab on a card. Click "Add highlight" or edit one. Verify the edit-textarea shows a Mic button.
6. Open the Posts tab on a card. Verify the post-edit textarea shows a Mic button.
7. Open the Podcasts page. Verify the narrative-script textarea shows a Mic button.
8. For one of these (recommend RichTextEditor), click the Mic button. The browser will prompt for mic permission. **DENY** the permission. Verify the button transitions to error state (red color, 3-second auto-recovery to idle).

If any of these checks fail, REPORT the failure (don't fix in this task — file the bug and let the controller decide).

- [ ] **Step 4: Final type-check**

```bash
cd /Users/chris/Dropbox/git_reps_v4/mindshift/frontend && npx tsc -b --noEmit; echo exit=$?
cd /Users/chris/Dropbox/git_reps_v4/mindshift/backend && .venv/bin/pytest tests/test_transcribe.py -v 2>&1 | tail -10
```

Both should be clean. No commit in this task — verification only.

---

## Self-review

**Spec coverage:**
- §5.1 backend endpoint → Task 1.
- §5.2 backend tests → Task 1.
- §6.1 useVoiceRecording hook → Task 2.
- §6.2 VoiceRecordButton → Task 3.
- §6.3 insertAtCaret helper → Task 2.
- §6.4 plain-textarea integration × 5 → Task 4.
- §6.5 TipTap integration → Task 5.
- §6.6 i18n keys → Task 3.
- §8 testing → Tasks 1 + 6.

**Placeholder scan:** Each task has complete code. The plan-task assumptions about variable names (`input`/`setInput` in ChatPanel, etc.) require the implementer to read the actual file and adapt; the spec says this explicitly.

**Type consistency:** `VoiceState` defined in Task 2, used in Task 3. `VoiceRecordButtonProps` in Task 3, called from Task 4 + Task 5. `insertAtCaret` signature in Task 2, called from Task 4.

---

## Done criteria

- All 6 tasks ticked.
- Backend pytest 4/4 green.
- Frontend `npx tsc -b --noEmit` exit 0.
- All 6 callsites render the Mic button (verified via Task 6 browser smoke).
- Backend endpoint correctly rejects empty audio and 413s oversized payloads.
- Branch ready to fast-forward main.
