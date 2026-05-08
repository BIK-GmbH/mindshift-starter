"""Card → Podcast pipeline.

Two stages:

1. Re-write the card's existing summary into a *narrative* — short, spoken,
   story-flow prose with natural pauses. The raw bullet-point summaries
   sound stilted when read aloud, so we let gpt-5.4-mini reshape them.
2. Synthesize speech via Gemini 3.1 Flash TTS preview. The model emits
   24 kHz/16-bit/mono PCM as base64; we wrap it in a WAV container so
   the browser can play it natively without ffmpeg.
"""

from __future__ import annotations

import base64
import io
import json
import wave
from dataclasses import dataclass
from typing import Optional

import httpx

from app.core.config import get_settings


GEMINI_TTS_ENDPOINT = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "{model}:generateContent"
)

# Default voice. Kore is "firm/clear narrator" — good middle-ground for
# explanatory podcast content. Users can override via the API later.
DEFAULT_VOICE = "Kore"

NARRATIVE_PROMPT = """You are a podcast narrator. Rewrite the user's notes into
a short narrated segment (60–120 seconds spoken, ~150–280 words) for an
educated listener.

Rules:
- Detect the input language and respond in the SAME language.
- Story-flow prose, not bullet points. Connect ideas with natural transitions
  ("Stell dir vor…", "Interessant ist dabei…", "Was viele übersehen…").
- Keep every load-bearing fact from the source. Don't invent specifics.
- One smooth paragraph or two. No headings, no markdown, no asterisks.
- Open with a hook (one sentence). Close with a takeaway (one sentence).
- Optionally include subtle delivery cues in [brackets] at the START of
  short clauses, e.g. "[reflective] " or "[curious] " — at most 3 in the
  whole text. The TTS engine reads these as expression hints.
- Output ONLY the narration text. No preamble, no quotes."""


@dataclass
class PodcastResult:
    narrative_text: str
    audio_wav_bytes: bytes
    voice: str


def _generate_narrative(title: str, source_text: str) -> str:
    """Reshape the card summary into spoken-narrative prose via gpt-5.4-mini."""
    settings = get_settings()
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY not configured")

    from openai import OpenAI

    client = OpenAI(api_key=settings.openai_api_key)
    user_prompt = f"TITLE: {title}\n\nSOURCE NOTES:\n{source_text[:8000]}"
    response = client.chat.completions.create(
        model=settings.openai_model,
        messages=[
            {"role": "system", "content": NARRATIVE_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
    )
    out = (response.choices[0].message.content or "").strip()
    if not out:
        raise RuntimeError("Narrative generation returned empty content")
    return out


def _pcm_to_wav(pcm_bytes: bytes, sample_rate: int = 24000) -> bytes:
    """Wrap raw 16-bit/mono PCM in a WAV container."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm_bytes)
    return buf.getvalue()


def _synthesize_speech(text: str, voice: str = DEFAULT_VOICE) -> bytes:
    """Call Gemini TTS, return WAV bytes."""
    settings = get_settings()
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY not configured")

    url = GEMINI_TTS_ENDPOINT.format(model=settings.gemini_tts_model)
    payload = {
        "contents": [{"parts": [{"text": text}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {
                    "prebuiltVoiceConfig": {"voiceName": voice},
                },
            },
        },
    }

    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": settings.gemini_api_key,
    }

    with httpx.Client(timeout=httpx.Timeout(120.0)) as client:
        resp = client.post(url, headers=headers, json=payload)
        if resp.status_code >= 400:
            raise RuntimeError(
                f"Gemini TTS error {resp.status_code}: {resp.text[:300]}"
            )
        data = resp.json()

    try:
        b64_audio = data["candidates"][0]["content"]["parts"][0]["inlineData"]["data"]
    except (KeyError, IndexError) as exc:
        raise RuntimeError(
            f"Unexpected Gemini TTS response shape: {json.dumps(data)[:300]}"
        ) from exc

    pcm = base64.b64decode(b64_audio)
    return _pcm_to_wav(pcm, sample_rate=24000)


def generate_card_podcast(
    *,
    title: str,
    source_text: str,
    voice: Optional[str] = None,
) -> PodcastResult:
    """End-to-end: rewrite → synthesize. Returns narrative + WAV bytes."""
    narrative = _generate_narrative(title, source_text)
    chosen_voice = voice or DEFAULT_VOICE
    wav = _synthesize_speech(narrative, voice=chosen_voice)
    return PodcastResult(narrative_text=narrative, audio_wav_bytes=wav, voice=chosen_voice)
