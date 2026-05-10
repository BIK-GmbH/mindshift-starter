"""URL canonicalisation — single source of truth for what counts as
"the same page" anywhere in the backend.

Mirrors `extension/lib/url.js` exactly. Tests in
`backend/tests/test_url_normalize.py` keep both implementations in
lockstep — same input must produce the same output on both sides or
dedup will silently miss matches across the JS/Python boundary.
"""

from __future__ import annotations

from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode

# Tracking params that carry no semantic content; safe to drop. Every
# `utm_*` key is dropped via prefix match, so they don't appear here.
_TRACKING_PARAMS: frozenset[str] = frozenset(
    {
        "gclid",
        "fbclid",
        "msclkid",
        "mc_eid",
        "mc_cid",
        "ref",
        "ref_src",
        "ref_url",
        "igshid",
        "s",  # twitter share id
        "__s",
        "_hsenc",
        "_hsmi",
        "vero_id",
        "vero_conv",
        "yclid",
        "oly_anon_id",
        "oly_enc_id",
        "spm",
    }
)

_YT_HOSTS: frozenset[str] = frozenset(
    {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}
)


def _extract_youtube_id(parsed) -> str | None:
    host = parsed.hostname.lower() if parsed.hostname else ""
    if host == "youtu.be":
        seg = parsed.path.lstrip("/").split("/")[0]
        return seg or None
    if host in _YT_HOSTS:
        if parsed.path == "/watch":
            qs = dict(parse_qsl(parsed.query, keep_blank_values=False))
            return qs.get("v")
        # /shorts/<id> or /embed/<id>
        parts = parsed.path.split("/")
        if len(parts) >= 3 and parts[1] in ("shorts", "embed"):
            seg = parts[2].split("?")[0].split("#")[0]
            return seg or None
    return None


def canonicalize_url(input_url: str) -> str:
    """Canonicalise a URL.

    Returns the input untouched if it is not a parseable absolute URL.
    Callers may pass `note://` pseudo-URLs and other non-http strings
    that we don't want to mangle.
    """
    if not isinstance(input_url, str) or not input_url:
        return input_url
    try:
        parsed = urlparse(input_url)
    except Exception:  # noqa: BLE001 — defensive for truly malformed input
        return input_url
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return input_url

    # YouTube short-circuit: collapse every supported shape to the
    # canonical watch URL. Drop everything except a `t=`/`start=`
    # timestamp — those carry meaning.
    yt_id = _extract_youtube_id(parsed)
    if yt_id:
        params = [("v", yt_id)]
        qs = dict(parse_qsl(parsed.query, keep_blank_values=False))
        t = qs.get("t") or qs.get("start")
        if t:
            params.append(("t", t))
        return f"https://www.youtube.com/watch?{urlencode(params)}"

    scheme = parsed.scheme.lower()
    host = (parsed.hostname or "").lower()
    port = parsed.port

    # Drop default ports.
    netloc = host
    if port is not None:
        if not (
            (scheme == "http" and port == 80)
            or (scheme == "https" and port == 443)
        ):
            netloc = f"{host}:{port}"

    # Strip tracking params.
    keep: list[tuple[str, str]] = []
    for k, v in parse_qsl(parsed.query, keep_blank_values=True):
        kl = k.lower()
        if kl.startswith("utm_"):
            continue
        if kl in _TRACKING_PARAMS:
            continue
        keep.append((k, v))
    query = urlencode(keep)

    # Drop empty fragments.
    fragment = parsed.fragment or ""

    # Drop a single trailing slash on the root path only.
    path = parsed.path
    if path == "/" and not query and not fragment:
        path = ""

    return urlunparse((scheme, netloc, path, parsed.params, query, fragment))
