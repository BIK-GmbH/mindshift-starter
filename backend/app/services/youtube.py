"""YouTube ingestion helpers: video-id parsing, metadata fetch, transcript fetch."""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import parse_qs, urlparse

import httpx

YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}
SHORT_HOSTS = {"youtu.be"}

_VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


def extract_video_id(url: str) -> str | None:
    """Return YouTube video ID for common URL shapes, or None."""
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()

    if host in SHORT_HOSTS:
        candidate = parsed.path.lstrip("/").split("/")[0]
        return candidate if _VIDEO_ID_RE.match(candidate) else None

    if host in YOUTUBE_HOSTS:
        if parsed.path == "/watch":
            qs = parse_qs(parsed.query)
            candidate = (qs.get("v") or [""])[0]
            return candidate if _VIDEO_ID_RE.match(candidate) else None
        for prefix in ("/embed/", "/v/", "/shorts/"):
            if parsed.path.startswith(prefix):
                candidate = parsed.path[len(prefix):].split("/")[0]
                return candidate if _VIDEO_ID_RE.match(candidate) else None

    return None


@dataclass(slots=True)
class YouTubeMetadata:
    video_id: str
    title: str
    channel: str | None
    thumbnail_url: str | None
    duration_seconds: int | None
    published_at: str | None
    raw: dict


def fetch_metadata(video_id: str) -> YouTubeMetadata:
    """Fetch metadata via YouTube's public oEmbed endpoint (no API key required)."""
    url = "https://www.youtube.com/oembed"
    params = {"url": f"https://www.youtube.com/watch?v={video_id}", "format": "json"}
    with httpx.Client(timeout=15.0, follow_redirects=True) as client:
        response = client.get(url, params=params)
        response.raise_for_status()
        data = response.json()

    return YouTubeMetadata(
        video_id=video_id,
        title=data.get("title") or f"YouTube {video_id}",
        channel=data.get("author_name"),
        thumbnail_url=data.get("thumbnail_url"),
        duration_seconds=None,
        published_at=None,
        raw=data,
    )


@dataclass(slots=True)
class TranscriptResult:
    language: str | None
    text: str
    segments: list[dict]
    provider: str


class TranscriptIpBlocked(Exception):
    """YouTube is temporarily refusing transcript requests from this IP.

    Distinct from "no captions on this video" so the UI can show a
    different message and the caller can retry later.
    """


def fetch_transcript(video_id: str, preferred_languages: list[str] | None = None) -> TranscriptResult | None:
    """Fetch a transcript via youtube-transcript-api (v1.x).

    Returns None when the video genuinely has no captions.
    Raises TranscriptIpBlocked when YouTube blocks us — the caller
    should surface a clear "try again later" message rather than
    misreporting it as "no transcript".
    """
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        from youtube_transcript_api._errors import IpBlocked, RequestBlocked
    except ImportError:
        return None

    languages = preferred_languages or ["de", "en"]
    try:
        fetched = YouTubeTranscriptApi().fetch(video_id, languages=languages)
    except (IpBlocked, RequestBlocked) as exc:
        raise TranscriptIpBlocked(str(exc)) from exc
    except Exception:
        return None

    snippets = list(fetched.snippets)
    text = " ".join(s.text.strip() for s in snippets if s.text)
    segments = [{"text": s.text, "start": s.start, "duration": s.duration} for s in snippets]
    return TranscriptResult(
        language=fetched.language_code,
        text=text,
        segments=segments,
        provider="youtube-transcript-api",
    )
