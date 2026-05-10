"""Highlight-overlay endpoints — phase 5 of the extension roadmap.

The content script writes here on user action ("highlight selection"),
and reads back on every page-load for restore-on-revisit. Card-scoped
endpoints sit under /api/cards/<id>/highlights for parity with the
notes / translations / connections endpoints.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.card import Card
from app.models.card_highlight import CardHighlight
from app.models.source import Source
from app.models.user import User
from app.schemas.highlight import HighlightCreate, HighlightOut, HighlightUpdate
from app.services.url_normalize import canonicalize_url

router = APIRouter(tags=["highlights"])


def _to_out(h: CardHighlight) -> HighlightOut:
    return HighlightOut.model_validate(h)


def _load_owned_card(db: Session, card_id: UUID, user: User) -> Card:
    card = db.get(Card, card_id)
    if card is None or card.user_id != user.id:
        raise HTTPException(status_code=404, detail="Card not found")
    return card


def _load_owned_highlight(
    db: Session, highlight_id: UUID, user: User
) -> CardHighlight:
    h = db.get(CardHighlight, highlight_id)
    if h is None or h.user_id != user.id:
        raise HTTPException(status_code=404, detail="Highlight not found")
    return h


@router.get("/cards/{card_id}/highlights", response_model=list[HighlightOut])
def list_highlights_for_card(
    card_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[HighlightOut]:
    _load_owned_card(db, card_id, current_user)
    rows = (
        db.execute(
            select(CardHighlight)
            .where(CardHighlight.card_id == card_id)
            .order_by(CardHighlight.created_at.asc())
        )
        .scalars()
        .all()
    )
    return [_to_out(h) for h in rows]


@router.post(
    "/cards/{card_id}/highlights",
    response_model=HighlightOut,
    status_code=status.HTTP_201_CREATED,
)
def create_highlight(
    card_id: UUID,
    payload: HighlightCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> HighlightOut:
    card = _load_owned_card(db, card_id, current_user)
    # Use the card's source URL as the anchor key so the restore-pass
    # finds it even when the user lands on the page from a different
    # tracking-laden URL.
    source = db.get(Source, card.source_id) if card.source_id else None
    source_url = canonicalize_url(source.url) if (source and source.url) else f"card://{card.id}"

    highlight = CardHighlight(
        user_id=current_user.id,
        card_id=card.id,
        source_url=source_url,
        anchor_text=payload.anchor_text,
        prefix=payload.prefix,
        suffix=payload.suffix,
        color=payload.color or "yellow",
        note=payload.note or "",
    )
    db.add(highlight)
    db.commit()
    db.refresh(highlight)
    return _to_out(highlight)


@router.patch("/highlights/{highlight_id}", response_model=HighlightOut)
def update_highlight(
    highlight_id: UUID,
    payload: HighlightUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> HighlightOut:
    h = _load_owned_highlight(db, highlight_id, current_user)
    if payload.color is not None:
        h.color = payload.color
    if payload.note is not None:
        h.note = payload.note
    db.commit()
    db.refresh(h)
    return _to_out(h)


@router.delete(
    "/highlights/{highlight_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_highlight(
    highlight_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    h = _load_owned_highlight(db, highlight_id, current_user)
    db.delete(h)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/highlights", response_model=list[HighlightOut])
def list_highlights_by_url(
    source_url: str = Query(..., min_length=1),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[HighlightOut]:
    """Used by the extension content script on page-load to fetch every
    highlight the user has on this URL — across any of their cards.
    Matches against canonicalised URL (strict) plus the raw URL for
    legacy rows.
    """
    raw = source_url.strip()
    canon = canonicalize_url(raw)
    rows = (
        db.execute(
            select(CardHighlight)
            .where(
                CardHighlight.user_id == current_user.id,
                or_(
                    CardHighlight.source_url == canon,
                    CardHighlight.source_url == raw,
                ),
            )
            .order_by(CardHighlight.created_at.asc())
        )
        .scalars()
        .all()
    )
    return [_to_out(h) for h in rows]
