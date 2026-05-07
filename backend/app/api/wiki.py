"""Wikipedia live-search proxy.

Server-side so we can avoid CORS pain in the browser and centralise the
User-Agent that Wikipedia recommends for tooling.
"""

from __future__ import annotations

from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.api.deps import get_current_user
from app.models.user import User

router = APIRouter(prefix="/wiki", tags=["wiki"])

_WIKI_BASE = "https://en.wikipedia.org/w/api.php"
_DE_WIKI_BASE = "https://de.wikipedia.org/w/api.php"
_USER_AGENT = "Mindshift/0.1 (+https://github.com/BIK-GmbH/mindshift-starter)"


class WikiHit(BaseModel):
    title: str
    description: str
    url: str


@router.get("/search", response_model=list[WikiHit])
async def wiki_search(
    q: str = Query(min_length=1, max_length=200),
    lang: str = Query(default="en", pattern="^(en|de)$"),
    limit: int = Query(default=8, ge=1, le=20),
    _: User = Depends(get_current_user),
) -> list[WikiHit]:
    base = _DE_WIKI_BASE if lang == "de" else _WIKI_BASE
    params = {
        "action": "opensearch",
        "search": q,
        "limit": str(limit),
        "namespace": "0",
        "format": "json",
    }
    url = f"{base}?{urlencode(params)}"

    async with httpx.AsyncClient(timeout=8.0, headers={"User-Agent": _USER_AGENT}) as client:
        try:
            resp = await client.get(url)
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"Wikipedia search failed: {exc}") from exc

    data = resp.json()
    # opensearch returns: [query, [titles…], [descriptions…], [urls…]]
    if not isinstance(data, list) or len(data) < 4:
        return []
    titles, descriptions, urls = data[1], data[2], data[3]
    out: list[WikiHit] = []
    for title, desc, item_url in zip(titles, descriptions, urls, strict=False):
        out.append(WikiHit(title=str(title), description=str(desc or ""), url=str(item_url)))
    return out
