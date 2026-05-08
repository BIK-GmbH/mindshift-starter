"""Crawler-friendly Open Graph + Twitter Card pages for public profiles.

Why this isn't just `<meta>` tags in the SPA: Twitter, WhatsApp,
Telegram, LinkedIn, Slack all fetch the URL with their own bot UA and
do **not** execute JavaScript. They see Mindshift's empty `<div id="root">`
and render no preview.

Deployment: route any request whose User-Agent identifies as a social
bot to these `/og/u/...` URLs. A minimal nginx snippet is in
`docs/DEPLOYMENT.md`.

A real browser hitting `/og/u/<…>` directly still works — the page
includes a `<meta http-equiv="refresh">` back to the SPA.
"""

from __future__ import annotations

import html
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.public import _resolve_tag_by_slug
from app.db.session import get_db
from app.models.user import User

router = APIRouter(prefix="/og", tags=["og"])


def _abs_url(request: Request, path: str) -> str:
    return f"{request.url.scheme}://{request.url.netloc}{path}"


def _esc(s: str | None) -> str:
    return html.escape((s or "")[:300], quote=True)


def _render(meta: dict[str, str], canonical: str) -> str:
    """Return a tiny self-contained HTML page that crawlers love."""
    tags = "\n    ".join(
        f'<meta property="{k}" content="{_esc(v)}">' if k.startswith("og:") else f'<meta name="{k}" content="{_esc(v)}">'
        for k, v in meta.items()
    )
    title = _esc(meta.get("og:title") or meta.get("twitter:title") or "Mindshift")
    desc = _esc(meta.get("og:description") or meta.get("twitter:description") or "")
    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{title}</title>
    <meta http-equiv="refresh" content="0; url={_esc(canonical)}">
    <link rel="canonical" href="{_esc(canonical)}">
    {tags}
  </head>
  <body style="font-family:system-ui,sans-serif;color:#111;background:#fff;padding:2rem;">
    <h1 style="margin:0 0 .5rem;">{title}</h1>
    <p style="color:#444">{desc}</p>
    <p><a href="{_esc(canonical)}">Open in Mindshift →</a></p>
  </body>
</html>"""


def _avatar_url(request: Request, file_id: UUID | None) -> str | None:
    if file_id is None:
        return None
    return _abs_url(request, f"/api/public/avatars/{file_id}")


@router.get("/u/{username}", response_class=Response)
def og_profile(
    username: str,
    request: Request,
    db: Session = Depends(get_db),
) -> Response:
    user = db.execute(
        select(User).where(User.username == username.lower(), User.public_profile.is_(True))
    ).scalar_one_or_none()
    canonical = _abs_url(request, f"/u/{username}")
    if user is None:
        return Response(
            content=_render(
                {"og:title": "Profile not found", "og:type": "website", "og:url": canonical},
                canonical,
            ),
            media_type="text/html",
            status_code=404,
        )

    title = user.display_name or user.username or "Mindshift profile"
    desc = user.bio or f"@{user.username}'s public knowledge base on Mindshift."
    image = _avatar_url(request, user.avatar_file_id) or ""
    meta = {
        "og:title": title,
        "og:description": desc,
        "og:type": "profile",
        "og:url": canonical,
        "og:site_name": "Mindshift",
        "twitter:card": "summary_large_image" if image else "summary",
        "twitter:title": title,
        "twitter:description": desc,
    }
    if image:
        meta["og:image"] = image
        meta["twitter:image"] = image
    return Response(content=_render(meta, canonical), media_type="text/html")


@router.get("/u/{username}/{slug:path}", response_class=Response)
def og_tag(
    username: str,
    slug: str,
    request: Request,
    db: Session = Depends(get_db),
) -> Response:
    canonical = _abs_url(request, f"/u/{username}/{slug}")
    user = db.execute(
        select(User).where(User.username == username.lower(), User.public_profile.is_(True))
    ).scalar_one_or_none()
    if user is None:
        return Response(
            content=_render(
                {"og:title": "Profile not found", "og:type": "website", "og:url": canonical},
                canonical,
            ),
            media_type="text/html",
            status_code=404,
        )
    try:
        tag = _resolve_tag_by_slug(db, user.id, slug)
    except Exception:
        return Response(
            content=_render(
                {"og:title": "Tag not found", "og:type": "website", "og:url": canonical},
                canonical,
            ),
            media_type="text/html",
            status_code=404,
        )

    title = f"#{tag.name} — @{user.username}"
    desc = (
        user.bio
        or f"Public collection #{tag.name} curated by @{user.username} on Mindshift."
    )
    image = _avatar_url(request, user.avatar_file_id) or ""
    meta = {
        "og:title": title,
        "og:description": desc,
        "og:type": "article",
        "og:url": canonical,
        "og:site_name": "Mindshift",
        "twitter:card": "summary_large_image" if image else "summary",
        "twitter:title": title,
        "twitter:description": desc,
    }
    if image:
        meta["og:image"] = image
        meta["twitter:image"] = image
    return Response(content=_render(meta, canonical), media_type="text/html")
