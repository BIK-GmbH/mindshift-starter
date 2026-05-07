"""Card share endpoints — owners create/revoke tokens, public reads them."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.card import Card
from app.models.share import CardShare, make_share_token
from app.models.user import User
from app.schemas.card import CardOut

router = APIRouter(tags=["share"])


class ShareOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    token: str
    card_id: UUID


class PublicCard(BaseModel):
    """Subset of CardOut that is safe to expose without auth."""

    id: UUID
    title: str
    source_type: str
    thumbnail_url: str | None = None
    concise_summary_md: str | None = None
    detailed_summary_md: str | None = None
    key_takeaways_json: list | None = None
    notes_md: str | None = None


@router.post("/cards/{card_id}/share", response_model=ShareOut)
def create_or_get_share(
    card_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ShareOut:
    card = db.get(Card, card_id)
    if card is None or card.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Card not found")

    existing = db.execute(select(CardShare).where(CardShare.card_id == card_id)).scalar_one_or_none()
    if existing:
        return ShareOut(token=existing.token, card_id=card_id)

    share = CardShare(card_id=card_id, token=make_share_token())
    db.add(share)
    db.commit()
    db.refresh(share)
    return ShareOut(token=share.token, card_id=card_id)


@router.delete("/cards/{card_id}/share", status_code=204)
def revoke_share(
    card_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    card = db.get(Card, card_id)
    if card is None or card.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Card not found")
    db.execute(
        select(CardShare).where(CardShare.card_id == card_id)
    )
    share = db.execute(select(CardShare).where(CardShare.card_id == card_id)).scalar_one_or_none()
    if share is None:
        return
    db.delete(share)
    db.commit()


@router.get("/cards/{card_id}/share", response_model=ShareOut | None)
def get_share_status(
    card_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ShareOut | None:
    card = db.get(Card, card_id)
    if card is None or card.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Card not found")
    share = db.execute(select(CardShare).where(CardShare.card_id == card_id)).scalar_one_or_none()
    if share is None:
        return None
    return ShareOut(token=share.token, card_id=card_id)


@router.get("/public/share/{token}", response_model=PublicCard)
def public_card(
    token: str,
    db: Session = Depends(get_db),
) -> PublicCard:
    share = db.execute(select(CardShare).where(CardShare.token == token)).scalar_one_or_none()
    if share is None:
        raise HTTPException(status_code=404, detail="Share link not found or revoked")
    card = db.get(Card, share.card_id)
    if card is None:
        raise HTTPException(status_code=404, detail="Card no longer exists")
    return PublicCard.model_validate(CardOut.model_validate(card).model_dump())
