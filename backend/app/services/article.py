"""Article extraction from arbitrary web URLs."""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urljoin

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
    image_url: str | None


# Browser-like UA — many sites (Wikipedia, NYTimes, several CDNs) reject
# generic bot UAs outright with 403. We still identify ourselves by name
# at the end so server logs can attribute the traffic.
_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Mindshift/0.1"
)


# Match <meta property="og:image" content="…"> regardless of attribute order
# and quote style. Also catches twitter:image as a secondary signal.
_META_IMAGE_PATTERNS = [
    re.compile(
        r"""<meta[^>]+(?:property|name)\s*=\s*['"]og:image(?::secure_url)?['"][^>]*?content\s*=\s*['"]([^'"]+)['"]""",
        re.IGNORECASE,
    ),
    re.compile(
        r"""<meta[^>]+content\s*=\s*['"]([^'"]+)['"][^>]*?(?:property|name)\s*=\s*['"]og:image(?::secure_url)?['"]""",
        re.IGNORECASE,
    ),
    re.compile(
        r"""<meta[^>]+(?:property|name)\s*=\s*['"]twitter:image(?::src)?['"][^>]*?content\s*=\s*['"]([^'"]+)['"]""",
        re.IGNORECASE,
    ),
]


def _extract_lead_image(html: str, base_url: str) -> str | None:
    """Find a representative image URL from page meta tags.

    Strategy: og:image → twitter:image. We don't fall back to <img> tags
    inside the body because those are usually inline figures (or trackers)
    and pollute the thumbnail more than they help.
    """
    for pattern in _META_IMAGE_PATTERNS:
        match = pattern.search(html)
        if match:
            raw = match.group(1).strip()
            if raw:
                # Resolve protocol-relative & relative URLs against the page.
                return urljoin(base_url, raw)
    return None


def fetch_article(url: str, *, html_override: str | None = None) -> ArticleResult | None:
    """Fetch and extract main content from a web article. Returns None if no content.

    When `html_override` is supplied (e.g., HTML grabbed by the browser
    extension from a logged-in tab), use it directly and skip the
    anonymous httpx fetch — this is how we bypass login walls on
    LinkedIn / X / NYT / etc.
    """
    if html_override:
        html = html_override
        final_url = url
    else:
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

    # trafilatura sometimes populates "image" itself (from og:image); fall
    # back to a direct meta-tag scan when it doesn't.
    image_url = (data.get("image") or "").strip() or None
    if not image_url:
        image_url = _extract_lead_image(html, final_url)

    return ArticleResult(
        title=(data.get("title") or "").strip() or None,
        text=text,
        author=(data.get("author") or "").strip() or None,
        site_name=(data.get("sitename") or "").strip() or None,
        canonical_url=data.get("url") or final_url,
        language=data.get("language"),
        image_url=image_url,
    )
