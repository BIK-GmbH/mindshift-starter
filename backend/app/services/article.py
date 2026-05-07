"""Article extraction from arbitrary web URLs."""

from __future__ import annotations

from dataclasses import dataclass

import httpx
import trafilatura


@dataclass(slots=True)
class ArticleResult:
    title: str | None
    text: str
    author: str | None
    site_name: str | None
    canonical_url: str | None
    language: str | None


_USER_AGENT = "Mindshift/0.1 (+https://mindshift.local)"


def fetch_article(url: str) -> ArticleResult | None:
    """Fetch and extract main content from a web article. Returns None if no content."""
    try:
        with httpx.Client(timeout=20.0, follow_redirects=True, headers={"User-Agent": _USER_AGENT}) as client:
            response = client.get(url)
            response.raise_for_status()
            html = response.text
            final_url = str(response.url)
    except (httpx.HTTPError, ValueError):
        return None

    extracted = trafilatura.extract(
        html,
        url=final_url,
        with_metadata=True,
        include_comments=False,
        favor_recall=True,
        output_format="json",
    )
    if not extracted:
        return None

    import json

    try:
        data = json.loads(extracted)
    except json.JSONDecodeError:
        return None

    text = (data.get("text") or "").strip()
    if not text:
        return None

    return ArticleResult(
        title=(data.get("title") or "").strip() or None,
        text=text,
        author=(data.get("author") or "").strip() or None,
        site_name=(data.get("sitename") or "").strip() or None,
        canonical_url=data.get("url") or final_url,
        language=data.get("language"),
    )
