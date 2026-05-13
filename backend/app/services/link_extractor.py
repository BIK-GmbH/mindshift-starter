"""URL extraction utility for ingested content.

We pull every http(s) URL out of a text blob, normalise it (strip
trailing punctuation, collapse trailing slashes, lowercase scheme +
host), dedupe, and tag each result with where it came from.

YouTube descriptions are the original use case — they're dense with
links the creator wants the viewer to follow (sponsors, GitHub
repos, related videos, papers). The transcript is the secondary
source: occasionally a speaker reads out a URL.

The output is shaped for direct JSON storage in
`Source.metadata_json["extracted_links"]` and the
`/api/cards/{id}/links` endpoint.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable
from urllib.parse import urlparse

# Captures http/https URLs that don't contain whitespace, quotes, or
# closing-paren — those are the typical Markdown / sentence boundaries.
URL_RE = re.compile(r"https?://[^\s<>\"\'`)\\\]]+")

# Trailing characters that are almost never part of the URL but often
# adjacent in prose. Stripped on the right of the match.
TRAILING_TRIM = ".,;:!?»»"


def _normalise(url: str) -> str | None:
    """Clean one match: strip trailing punctuation, drop trackers, parse.

    Returns the canonical form or None if the URL is unusable.
    """
    if not url:
        return None
    # Strip prose punctuation that the regex over-captures.
    while url and url[-1] in TRAILING_TRIM:
        url = url[:-1]
    # Drop common UTM / source tracking params to dedupe variants.
    try:
        parsed = urlparse(url)
        if not parsed.netloc:
            return None
        return f"{parsed.scheme.lower()}://{parsed.netloc.lower()}{parsed.path}{('?' + parsed.query) if parsed.query else ''}{('#' + parsed.fragment) if parsed.fragment else ''}"
    except Exception:
        return None


def _domain(url: str) -> str:
    try:
        return urlparse(url).netloc.lower()
    except Exception:
        return ""


@dataclass(slots=True)
class ExtractedLink:
    url: str
    domain: str
    context: str  # "description" | "transcript" | … (extensible)

    def as_dict(self) -> dict:
        return {"url": self.url, "domain": self.domain, "context": self.context}


def _extract_from(text: str | None, context: str) -> Iterable[ExtractedLink]:
    if not text:
        return ()
    out: list[ExtractedLink] = []
    seen: set[str] = set()
    for match in URL_RE.findall(text):
        canon = _normalise(match)
        if not canon or canon in seen:
            continue
        seen.add(canon)
        out.append(ExtractedLink(url=canon, domain=_domain(canon), context=context))
    return out


def extract_links(
    *,
    description: str | None = None,
    transcript: str | None = None,
    article_body: str | None = None,
) -> list[dict]:
    """Extract URLs from any subset of textual sources.

    Returns a deduplicated list ordered description → transcript →
    article. A URL appearing in two contexts keeps the FIRST context
    (description wins) — the UI groups by context and shouldn't
    surface the same link twice.
    """
    seen: set[str] = set()
    out: list[dict] = []

    def _push(items: Iterable[ExtractedLink]) -> None:
        for it in items:
            if it.url in seen:
                continue
            seen.add(it.url)
            out.append(it.as_dict())

    _push(_extract_from(description, "description"))
    _push(_extract_from(transcript, "transcript"))
    _push(_extract_from(article_body, "article"))
    return out
