"""YouTube ingestion helpers: video-id parsing, metadata fetch, transcript fetch.

Transcript fetch has four layers of resilience because YouTube IP-blocks
the `/api/timedtext` endpoint aggressively when many requests come from
one source (cloud IPs, VPNs, even ordinary home IPs after a burst):

1. youtube-transcript-api with an optional rotating residential proxy
   (Webshare via ENV) or a generic HTTP/SOCKS proxy.
2. yt-dlp fallback if the first hits IpBlocked/RequestBlocked.
   yt-dlp uses a different player-init code path and is sometimes
   not rate-limited when youtube-transcript-api is. Still hits the
   same `/api/timedtext` endpoint for the actual subtitle bytes
   though, so it doesn't help against a heavy block.
3. Supadata.ai (optional, when SUPADATA_API_KEY is set) — hosted
   transcript service that handles proxies internally. Last-resort
   because it costs API credits (1 credit per video; free tier ships
   with 100/month).
4. Raise TranscriptIpBlocked so the caller can surface a clear
   "YouTube hat unsere IP gesperrt — bitte in einer Stunde nochmal
   versuchen" rather than "no transcript".
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from urllib.parse import parse_qs, urlparse

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)

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


def _build_proxy_config():
    """Translate the ENV-driven proxy config into a youtube-transcript-api
    proxy_config object. Returns None when no proxy is configured."""
    s = get_settings()
    try:
        from youtube_transcript_api.proxies import (
            GenericProxyConfig,
            WebshareProxyConfig,
        )
    except ImportError:
        return None

    if s.youtube_proxy_username and s.youtube_proxy_password:
        countries = [
            c.strip().lower()
            for c in (s.youtube_proxy_countries or "").split(",")
            if c.strip()
        ]
        kwargs = {
            "proxy_username": s.youtube_proxy_username,
            "proxy_password": s.youtube_proxy_password,
        }
        if countries:
            kwargs["filter_ip_locations"] = countries
        return WebshareProxyConfig(**kwargs)
    if s.youtube_proxy_url:
        return GenericProxyConfig(
            http_url=s.youtube_proxy_url,
            https_url=s.youtube_proxy_url,
        )
    return None


def fetch_transcript(video_id: str, preferred_languages: list[str] | None = None) -> TranscriptResult | None:
    """Fetch a transcript with a resilient three-stage strategy.

    Order:
      1. youtube-transcript-api (with proxy when configured)
      2. yt-dlp fallback (different code path)
      3. Give up — return None for "no captions" / raise
         TranscriptIpBlocked for "everything got refused".
    """
    languages = preferred_languages or ["de", "en"]

    # Stage 1 — youtube-transcript-api.
    blocked = False
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        from youtube_transcript_api._errors import IpBlocked, RequestBlocked
    except ImportError:
        YouTubeTranscriptApi = None  # type: ignore[assignment]
        IpBlocked = RequestBlocked = Exception  # type: ignore[misc, assignment]

    if YouTubeTranscriptApi is not None:
        proxy = _build_proxy_config()
        kwargs = {"proxy_config": proxy} if proxy is not None else {}
        try:
            fetched = YouTubeTranscriptApi(**kwargs).fetch(video_id, languages=languages)
            snippets = list(fetched.snippets)
            text = " ".join(s.text.strip() for s in snippets if s.text)
            segments = [
                {"text": s.text, "start": s.start, "duration": s.duration}
                for s in snippets
            ]
            return TranscriptResult(
                language=fetched.language_code,
                text=text,
                segments=segments,
                provider="youtube-transcript-api",
            )
        except (IpBlocked, RequestBlocked) as exc:
            logger.warning(
                "youtube-transcript-api blocked for %s: %s — falling through to yt-dlp",
                video_id,
                str(exc).splitlines()[0] if str(exc) else "",
            )
            blocked = True
        except Exception as exc:
            # Lib-internal error that isn't an explicit block (e.g.
            # NoTranscriptFound). Still try yt-dlp as a second opinion
            # because the YouTube data layer sometimes returns "missing"
            # for captions that yt-dlp *can* see.
            logger.info(
                "youtube-transcript-api failed for %s (%s) — trying yt-dlp",
                video_id,
                exc.__class__.__name__,
            )

    # Stage 2 — yt-dlp fallback.
    fallback = _fetch_transcript_via_ytdlp(video_id, languages)
    if fallback is not None:
        return fallback

    # Stage 3 — Supadata.ai (hosted, paid per call).
    supadata = _fetch_transcript_via_supadata(video_id, languages)
    if supadata is not None:
        return supadata

    # Stage 4 — escalate.
    if blocked:
        raise TranscriptIpBlocked(
            "YouTube refused both transcript endpoints for this IP."
        )
    return None


def _fetch_transcript_via_ytdlp(
    video_id: str, languages: list[str]
) -> TranscriptResult | None:
    """Pull subtitles via yt-dlp's player-init path.

    yt-dlp queries `/youtubei/v1/player` to discover subtitle URLs and
    then GETs them. That player call is rarely rate-limited even when
    youtube-transcript-api's own probe is blocked, so it can succeed
    where the primary path fails. Returns None for "no captions" or
    any other failure (we let the caller decide whether to raise).
    """
    try:
        import yt_dlp
    except ImportError:
        return None

    url = f"https://www.youtube.com/watch?v={video_id}"
    s = get_settings()
    opts: dict = {
        "skip_download": True,
        "quiet": True,
        "no_warnings": True,
        # Don't write subtitle files; we parse the URL ourselves.
        "writesubtitles": False,
        "writeautomaticsub": False,
    }
    # Honor the same proxy when configured for the primary path.
    if s.youtube_proxy_url:
        opts["proxy"] = s.youtube_proxy_url

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as exc:
        logger.info("yt-dlp player fetch failed for %s: %s", video_id, exc)
        return None

    if not isinstance(info, dict):
        return None

    # Prefer manual subtitles over auto-captions; pick the first language
    # in the user's preference order that's available.
    manual = info.get("subtitles") or {}
    autos = info.get("automatic_captions") or {}
    chosen_lang = None
    chosen_tracks: list[dict] = []
    for lang in languages:
        if lang in manual:
            chosen_lang = lang
            chosen_tracks = manual[lang]
            break
        if lang in autos:
            chosen_lang = lang
            chosen_tracks = autos[lang]
            break
    if not chosen_tracks:
        return None

    # Look for json3 first (richest), fall back to srv3/srv1.
    track_url = None
    for ext_pref in ("json3", "srv3", "srv1", "vtt"):
        for t in chosen_tracks:
            if t.get("ext") == ext_pref and t.get("url"):
                track_url = t["url"]
                track_ext = ext_pref
                break
        if track_url:
            break
    if not track_url:
        return None

    proxy_arg = s.youtube_proxy_url or None
    try:
        with httpx.Client(
            timeout=20.0,
            follow_redirects=True,
            proxy=proxy_arg,
            headers={"User-Agent": "Mozilla/5.0"},
        ) as client:
            r = client.get(track_url)
            r.raise_for_status()
            body = r.content
    except Exception as exc:
        logger.info("yt-dlp subtitle fetch failed for %s: %s", video_id, exc)
        return None

    segments = _parse_ytdlp_subtitles(body, track_ext)
    if not segments:
        return None
    text = " ".join(seg["text"].strip() for seg in segments if seg.get("text"))
    return TranscriptResult(
        language=chosen_lang,
        text=text,
        segments=segments,
        provider="yt-dlp",
    )


def _parse_ytdlp_subtitles(body: bytes, ext: str) -> list[dict]:
    """Convert raw subtitle bytes to the same {text, start, duration}
    shape that youtube-transcript-api returns."""
    if ext == "json3":
        import json

        try:
            data = json.loads(body)
        except Exception:
            return []
        out: list[dict] = []
        for ev in data.get("events", []):
            segs = ev.get("segs") or []
            text = "".join(s.get("utf8", "") for s in segs)
            text = text.strip()
            if not text:
                continue
            start = (ev.get("tStartMs") or 0) / 1000.0
            duration = (ev.get("dDurationMs") or 0) / 1000.0
            out.append({"text": text, "start": start, "duration": duration})
        return out
    if ext in ("vtt",):
        # Minimal VTT parser — split on blank lines, parse timestamps.
        out = []
        text_buf: list[str] = []
        start = duration = 0.0
        for line in body.decode("utf-8", errors="ignore").splitlines():
            line = line.strip()
            if "-->" in line:
                left, _, right = line.partition("-->")
                start = _vtt_ts_to_seconds(left.strip())
                end = _vtt_ts_to_seconds(right.split()[0].strip())
                duration = max(0.0, end - start)
                continue
            if not line:
                if text_buf:
                    out.append(
                        {"text": " ".join(text_buf), "start": start, "duration": duration}
                    )
                    text_buf = []
                continue
            if line.startswith("WEBVTT") or line.startswith("NOTE"):
                continue
            text_buf.append(line)
        if text_buf:
            out.append({"text": " ".join(text_buf), "start": start, "duration": duration})
        return out
    return []


def _vtt_ts_to_seconds(ts: str) -> float:
    """Convert `HH:MM:SS.mmm` (or `MM:SS.mmm`) to seconds."""
    parts = ts.replace(",", ".").split(":")
    try:
        nums = [float(p) for p in parts]
    except ValueError:
        return 0.0
    if len(nums) == 3:
        h, m, s = nums
        return h * 3600 + m * 60 + s
    if len(nums) == 2:
        m, s = nums
        return m * 60 + s
    return nums[0] if nums else 0.0


def _fetch_transcript_via_supadata(
    video_id: str, languages: list[str]
) -> TranscriptResult | None:
    """Last-resort hosted transcript provider. Supadata wraps a managed
    pool of residential proxies + AI fallback for videos without
    captions, so it works on IPs where the direct fetch is blocked.

    Returns None when no SUPADATA_API_KEY is configured (caller treats
    that as "skip the stage").
    """
    s = get_settings()
    if not s.supadata_api_key:
        return None

    url = "https://api.supadata.ai/v1/transcript"
    params = {
        "url": f"https://www.youtube.com/watch?v={video_id}",
        "mode": "native",
        "text": "false",  # we want timestamped chunks, not plain text
    }
    headers = {"x-api-key": s.supadata_api_key}
    try:
        with httpx.Client(timeout=30.0) as client:
            r = client.get(url, params=params, headers=headers)
            r.raise_for_status()
            data = r.json()
    except Exception as exc:
        logger.warning("Supadata transcript fetch failed for %s: %s", video_id, exc)
        return None

    content = data.get("content")
    lang = data.get("lang")
    # When text=false, content is a list of {text, offset, duration};
    # offsets are in milliseconds.
    if isinstance(content, list):
        segments = [
            {
                "text": str(c.get("text") or ""),
                "start": float(c.get("offset") or 0) / 1000.0,
                "duration": float(c.get("duration") or 0) / 1000.0,
            }
            for c in content
            if (c.get("text") or "").strip()
        ]
        if not segments:
            return None
        text = " ".join(seg["text"].strip() for seg in segments)
    elif isinstance(content, str) and content.strip():
        # Defensive: if Supadata returns plain text despite text=false.
        segments = [{"text": content.strip(), "start": 0.0, "duration": 0.0}]
        text = content.strip()
    else:
        return None

    # Respect the caller's preferred-language order — if the returned
    # language isn't the user's first choice but is in the list, that's
    # still fine. If it's not in the list at all, we accept it anyway
    # because the alternative is "no transcript".
    return TranscriptResult(
        language=lang,
        text=text,
        segments=segments,
        provider="supadata",
    )
