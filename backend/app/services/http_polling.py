"""Conditional HTTP GET helper shared between RSS feeds and YouTube channels.

Both pollers want the same shape: send `If-None-Match` + `If-Modified-Since`,
treat 304 as "no work", apply a hard size cap, and return the body + the
fresh etag/last-modified for the caller to persist. Extracting this
pattern keeps both subsystems honest without coupling their parsers.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import httpx

_USER_AGENT = (
    "Mozilla/5.0 (compatible; Mindshift/0.1; +https://mindshift.local)"
)
_DEFAULT_TIMEOUT = 20.0
_DEFAULT_MAX_BYTES = 5 * 1024 * 1024  # 5 MiB — feed/channel pages are tiny


@dataclass
class ConditionalFetchResult:
    """Outcome of a `conditional_fetch` call.

    - `status='not_modified'`: 304 response. `body` is None.
    - `status='ok'`: 200 response with body bytes + fresh validators.
    - `status='error'`: anything else. `error` carries a one-line summary.
    """

    status: Literal["not_modified", "ok", "error"]
    body: bytes | None = None
    etag: str | None = None
    last_modified: str | None = None
    error: str | None = None


def conditional_fetch(
    url: str,
    *,
    etag: str | None = None,
    last_modified: str | None = None,
    timeout: float = _DEFAULT_TIMEOUT,
    max_bytes: int = _DEFAULT_MAX_BYTES,
    accept: str = "application/atom+xml, application/rss+xml, application/xml;q=0.9, */*;q=0.8",
    user_agent: str = _USER_AGENT,
) -> ConditionalFetchResult:
    headers = {"User-Agent": user_agent, "Accept": accept}
    if etag:
        headers["If-None-Match"] = etag
    if last_modified:
        headers["If-Modified-Since"] = last_modified

    try:
        with httpx.Client(timeout=timeout, follow_redirects=True, headers=headers) as client:
            response = client.get(url)
    except httpx.HTTPError as exc:
        return ConditionalFetchResult(status="error", error=str(exc)[:500])

    if response.status_code == 304:
        return ConditionalFetchResult(status="not_modified")

    if response.status_code >= 400:
        return ConditionalFetchResult(
            status="error", error=f"HTTP {response.status_code}"
        )

    declared_len = int(response.headers.get("content-length") or 0)
    if declared_len > max_bytes:
        return ConditionalFetchResult(
            status="error", error="Response exceeds size limit"
        )

    body = response.content
    if len(body) > max_bytes:
        return ConditionalFetchResult(
            status="error", error="Response exceeds size limit"
        )

    return ConditionalFetchResult(
        status="ok",
        body=body,
        etag=response.headers.get("etag"),
        last_modified=response.headers.get("last-modified"),
    )
