"""YouTube-Vorschläge — per-card + global Discover.

Both surfaces share the same service (`services.youtube_suggest`) and
cache table; only the scope key changes. The router intentionally does
NOT proxy "save this video to Mindshift" — clients reuse the existing
`POST /api/cards/from-youtube` for that, which already does all the
heavy lifting (transcript, summary, embeddings, tags).
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import get_settings
from app.db.session import get_db
from app.models.card import Card
from app.models.user import User
from app.schemas.youtube import (
    CardSuggestionsOut,
    DiscoverOut,
    DiscoverThemeOut,
    YouTubeSuggestionOut,
)
from app.services.youtube_suggest import (
    discover_for_user,
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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DiscoverOut:
    settings = get_settings()
    api_enabled = bool(settings.youtube_api_key.strip())
    if not api_enabled:
        return DiscoverOut(api_enabled=False, themes=[])

    bundles = discover_for_user(db, current_user.id, force_refresh=refresh)
    return DiscoverOut(
        api_enabled=True,
        themes=[
            DiscoverThemeOut(
                slug=b["slug"],
                label=b["label"],
                query=b["query"],
                card_count=b["card_count"],
                from_cache=b["from_cache"],
                results=[YouTubeSuggestionOut(**r) for r in b["results"]],
            )
            for b in bundles
        ],
    )
