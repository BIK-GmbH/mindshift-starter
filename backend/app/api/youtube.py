"""YouTube-Vorschläge — per-card + global Discover.

Both surfaces share the same service (`services.youtube_suggest`) and
cache table; only the scope key changes. The router intentionally does
NOT proxy "save this video to Mindshift" — clients reuse the existing
`POST /api/cards/from-youtube` for that, which already does all the
heavy lifting (transcript, summary, embeddings, tags).
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import get_settings
from app.db.session import get_db
from app.models.card import Card
from app.models.user import User
from app.schemas.youtube import (
    CardSuggestionsOut,
    CustomSearchOut,
    DiscoverOut,
    DiscoverThemeOut,
    YouTubeSuggestionOut,
)
from app.services.youtube_suggest import (
    discover_for_user,
    search_custom,
    suggest_for_card,
)

router = APIRouter(prefix="/youtube", tags=["youtube"])


@router.get("/suggest/card/{card_id}", response_model=CardSuggestionsOut)
def get_card_suggestions(
    card_id: UUID,
    refresh: bool = Query(default=False),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CardSuggestionsOut:
    card = db.get(Card, card_id)
    if card is None or card.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Card not found")

    settings = get_settings()
    api_enabled = bool(settings.youtube_api_key.strip())
    if not api_enabled:
        return CardSuggestionsOut(query="", results=[], from_cache=False, api_enabled=False)

    query, results, from_cache = suggest_for_card(
        db, current_user.id, card, force_refresh=refresh
    )
    return CardSuggestionsOut(
        query=query,
        results=[YouTubeSuggestionOut(**r) for r in results],
        from_cache=from_cache,
        api_enabled=True,
    )


@router.get("/discover", response_model=DiscoverOut)
def get_discover(
    refresh: bool = Query(default=False),
    freshness: str = Query(default="month"),
    accept_language: str | None = Header(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DiscoverOut:
    settings = get_settings()
    api_enabled = bool(settings.youtube_api_key.strip())
    if not api_enabled:
        return DiscoverOut(api_enabled=False, themes=[], freshness=freshness)

    # Two-letter language code passed to YouTube's `relevanceLanguage`
    # — derived from the browser's Accept-Language header so German
    # users get DE-leaning results without an explicit preference.
    ui_lang = _pick_ui_lang(accept_language)
    bundles = discover_for_user(
        db,
        current_user.id,
        force_refresh=refresh,
        ui_lang=ui_lang,
        freshness=freshness,
    )
    # All bundles share the same effective freshness — pick from the
    # first, fall back to the request value if there are no themes.
    effective_freshness = bundles[0]["freshness"] if bundles else freshness
    return DiscoverOut(
        api_enabled=True,
        freshness=effective_freshness,
        themes=[
            DiscoverThemeOut(
                slug=b["slug"],
                label=b["label"],
                query=b["query"],
                queries=b.get("queries", []),
                card_count=b["card_count"],
                from_cache=b["from_cache"],
                results=[YouTubeSuggestionOut(**r) for r in b["results"]],
            )
            for b in bundles
        ],
    )


@router.get("/search", response_model=CustomSearchOut)
def get_custom_search(
    q: str = Query(min_length=1, max_length=200),
    freshness: str = Query(default="month"),
    refresh: bool = Query(default=False),
    accept_language: str | None = Header(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CustomSearchOut:
    settings = get_settings()
    api_enabled = bool(settings.youtube_api_key.strip())
    if not api_enabled:
        return CustomSearchOut(
            query=q,
            freshness=freshness,
            from_cache=False,
            api_enabled=False,
            results=[],
        )
    ui_lang = _pick_ui_lang(accept_language)
    results, from_cache = search_custom(
        db,
        current_user.id,
        q,
        freshness=freshness,
        ui_lang=ui_lang,
        force_refresh=refresh,
    )
    return CustomSearchOut(
        query=q,
        freshness=freshness,
        from_cache=from_cache,
        api_enabled=True,
        results=[YouTubeSuggestionOut(**r) for r in results],
    )


def _pick_ui_lang(accept_language: str | None) -> str:
    if not accept_language:
        return "en"
    first = accept_language.split(",")[0].strip().lower()
    short = first.split("-")[0]
    return short[:2] or "en"
