# Voice-to-Text Dictation — Design Spec

**Date:** 2026-05-11
**Status:** User-approved scope (variant "a" from in-chat brainstorm — Hook + Backend + all 6 integration sites in one shot, no rate limit).

---

## 1. Context & problem

Mindshift has six text-input surfaces where users compose substantive content: the chat composer (`ChatPanel`), the rich-text notes editor (`RichTextEditor` used in NotesTab + AddYouTubeModal + PodcastsPage), the path-edit page (description + per-step lesson note), the post-generator textarea (`PostsTab`), the highlight editor (`HighlightsTab`), and the podcast narrative textarea (`PodcastsPage`).

Today the only input mode is typing. Adding voice dictation reduces friction in three real scenarios: long-form notes on mobile, chat queries while doing something else, and lesson-note authoring (Path-Editor) — all of which involve spoken thought-streams that are slower to type than to speak.

## 2. Goals

- A reusable Mic button + status overlay that drops into any input field.
- Push-to-talk UX: click mic to start, click again to stop, transcribed text appears at the caret position.
- Works for plain `<textarea>` (5 callsites) AND the TipTap-based `RichTextEditor` (one component → many callsites via reuse).
- Server-side transcription via OpenAI `gpt-4o-mini-transcribe` (cheap + fast).
- Auth-gated (no anonymous transcription — costs money per call).
- Falls back gracefully when MediaRecorder isn't supported (no button rendered).

## 3. Non-goals

- **No rate limit** in this phase (user explicit). If usage grows, add later.
- **No streaming transcription.** Push-to-talk → one HTTP request per recording. Good enough for the 5–60-second dictations we expect.
- **No multilingual auto-detection UI.** OpenAI auto-detects; we don't expose a language picker.
- **No voice-controlled commands** ("delete that sentence", "new paragraph"). Pure dictation only.
- **No persisting audio.** Blob is uploaded, transcribed, discarded.
- **No anonymous use.** JWT required.

## 4. Architecture

```
Browser MediaRecorder (audio/webm;codecs=opus, audio/webm, audio/mp4 fallback)
   ↓ multipart/form-data POST
Backend /api/transcribe (Auth-gated, 25 MB size cap)
   ↓ file-like + filename (extension drives OpenAI format detection)
OpenAI gpt-4o-mini-transcribe
   ↓ { text }
Frontend insertAtCaret(text)
```

Three units:
1. **Backend endpoint** (`/api/transcribe`) — FastAPI, JWT-gated, multipart parse, 25 MB cap, OpenAI client call.
2. **Frontend hook** (`useVoiceRecording`) — encapsulates state machine, MediaRecorder lifecycle, upload, cleanup.
3. **Frontend component** (`VoiceRecordButton`) — drop-in button + status overlay. Plus a TipTap adapter for `RichTextEditor`.

## 5. Backend changes

### 5.1 New endpoint
`POST /api/transcribe` (new router file `backend/app/api/transcribe.py`):

```python
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
import io, os

router = APIRouter(prefix="/transcribe", tags=["transcribe"])

MAX_BYTES = 25 * 1024 * 1024  # OpenAI hard limit

@router.post("")
async def transcribe(
    audio: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
) -> dict:
    # Chunk-wise read + size guard
    chunks, total = [], 0
    while True:
        chunk = await audio.read(64 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_BYTES:
            raise HTTPException(413, f"Audio too large: max {MAX_BYTES // (1024*1024)} MB.")
        chunks.append(chunk)
    audio_bytes = b"".join(chunks)
    if not audio_bytes:
        raise HTTPException(400, "Empty audio file.")

    from openai import OpenAI
    if not settings.openai_api_key:
        raise HTTPException(503, "Transcription unavailable: OPENAI_API_KEY not configured.")
    client = OpenAI(api_key=settings.openai_api_key)
    fname = audio.filename or "recording.webm"
    file_obj = io.BytesIO(audio_bytes)
    file_obj.name = fname
    try:
        result = client.audio.transcriptions.create(
            model="gpt-4o-mini-transcribe",
            file=(fname, file_obj, audio.content_type or "audio/webm"),
            response_format="json",
        )
        text = (result.text or "").strip()
    except Exception as exc:
        raise HTTPException(502, f"Transcription failed: {type(exc).__name__}") from exc
    return {"text": text, "audio_bytes": total}
```

Register in `main.py` alongside other routers.

### 5.2 Test
One pytest case using a tiny WAV blob + mocked OpenAI client:

```python
def test_transcribe_returns_text(client, authenticated_user, mocker):
    mocker.patch("openai.OpenAI", autospec=True, return_value=mocker.MagicMock(
        audio=mocker.MagicMock(transcriptions=mocker.MagicMock(create=mocker.MagicMock(
            return_value=mocker.MagicMock(text="hello world"),
        ))),
    ))
    audio_bytes = b"RIFF" + b"\x00" * 1024  # minimal fake WAV
    r = client.post(
        "/api/transcribe",
        files={"audio": ("test.webm", audio_bytes, "audio/webm")},
        headers={"Authorization": f"Bearer {authenticated_user.token}"},
    )
    assert r.status_code == 200
    assert r.json()["text"] == "hello world"
```

(Adapt to whatever fixture pattern existing tests use — `mocker` from `pytest-mock` may not be installed; if not, use `unittest.mock.patch` decorator.)

### 5.3 What is NOT changed
- No new tables.
- No migrations.
- No new env vars beyond the existing `OPENAI_API_KEY`.

## 6. Frontend changes

### 6.1 New hook `frontend/src/lib/useVoiceRecording.ts`

Generic hook from the user briefing, adapted for Mindshift:
- Endpoint default: `/api/transcribe`
- Token resolver default: `localStorage.getItem("mindshift.token")`
- States: `idle | requesting | recording | transcribing | error`
- Returns: `{ state, supported, elapsedMs, start, stop, cancel }`

Exact code in plan task 1.

### 6.2 New component `frontend/src/components/VoiceRecordButton.tsx`

Drop-in mic button + status hint. Wraps `useVoiceRecording`. Receives `onTranscribed: (text: string) => void` callback. Renders the lucide-react `Mic`/`Loader2` icon with state-based styling. Optional `aria-live="polite"` status line under the button (or beside it) for >2s recordings.

Props:
```ts
interface VoiceRecordButtonProps {
  onTranscribed: (text: string) => void;
  disabled?: boolean;
  className?: string;
  /** Show status hint line below button. Default true. */
  showStatusLine?: boolean;
}
```

### 6.3 Caret-aware insert helper

A small utility `frontend/src/lib/insertAtCaret.ts` for plain `<textarea>` callsites:

```ts
export function insertAtCaret(
  textarea: HTMLTextAreaElement | null,
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

### 6.4 Plain-textarea integration (5 sites)

For each plain-textarea callsite, render `<VoiceRecordButton onTranscribed={(text) => { ... insertAtCaret + setSelectionRange ... }} />` next to the textarea. The five sites:

| File | Textarea purpose | Notes |
|---|---|---|
| `components/ChatPanel.tsx` | Chat composer | Button inside the composer toolbar |
| `pages/PathEditPage.tsx` (2 places) | Path description + per-step lesson note | Two buttons, two state hooks |
| `components/cardTabs/HighlightsTab.tsx` | Highlight text edit | Button in the edit-form |
| `components/cardTabs/PostsTab.tsx` | LinkedIn post draft | Button near the post-edit textarea |
| `pages/PodcastsPage.tsx` | Podcast narrative script | Button in the script-edit panel |

### 6.5 TipTap integration in `RichTextEditor`

`RichTextEditor.tsx` has a TipTap editor instance internally. Add a Mic button to its existing toolbar that calls:

```ts
voice.onTranscribed = (text: string) => {
  editor.commands.focus();
  editor.commands.insertContent(text);
};
```

When `editor` is null (not yet mounted), the button is disabled. When `voice.state !== "idle"`, the button shows its recording/transcribing state same as plain version.

Because `RichTextEditor` is used in ~4 places (NotesTab, AddYouTubeModal, PodcastsPage, etc.), one change in this component lights up all four downstream callsites automatically.

### 6.6 i18n keys (en + de)

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
}
```

## 7. Edge cases

- **MediaRecorder unsupported** (old Safari, iOS <14.3) → `supported=false`, button doesn't render.
- **Mic permission denied** → state goes to `error`, returns to `idle` after 3 s, user can retry.
- **Recording cut short (no audio)** → blob is empty → user-facing "Keine Audio-Daten" → returns to idle.
- **Network failure during upload** → state goes to `error`, idle after 3 s.
- **OPENAI_API_KEY missing on server** → 503 → error-state with "Voice recording failed".
- **PathEditPage with two textareas** → each has its own `VoiceRecordButton` with its own state — recordings don't interfere.
- **Two textareas simultaneously recording** → impossible UX-wise (each button toggles its own state), but defensively the hook only allows one MediaRecorder per instance, and each component has its own hook instance.
- **Tab close mid-recording** → cleanup useEffect stops the MediaStream tracks.
- **TipTap focus jumps mid-recording** → the button stays in `recording` state; on stop, insertContent inserts at wherever the editor caret currently is.

## 8. Testing

### Backend
- pytest covering: 200 happy path (mocked OpenAI), 401 unauthenticated, 413 too-large payload, 400 empty audio, 503 no API key.

### Frontend
- Type-check clean (`npx tsc -b --noEmit`).
- Browser-automation smoke (Playwright MCP or similar) verifying the Mic button **renders** in each of the 6 callsites. The full speak-into-mic flow requires a human and is parked for the user's own smoke walk.

## 9. Cost & scaling note

OpenAI `gpt-4o-mini-transcribe` is ~$0.003/minute. A 30-second dictation costs $0.0015. 1000 dictations/day across all users = ~$45/month. Acceptable for current scale. If costs spike, the no-rate-limit decision should be revisited.

## 10. Open questions

None at the time of writing. Proceed to implementation plan.
