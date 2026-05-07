from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.card import Card
from app.models.tag import CardTag, Tag
from app.models.user import User

router = APIRouter(prefix="/tags", tags=["tags"])


class TagWithCount(BaseModel):
    name: str
    count: int


@router.get("", response_model=list[TagWithCount])
def list_tags(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[TagWithCount]:
    rows = db.execute(
        select(Tag.name, func.count(CardTag.card_id).label("count"))
        .join(CardTag, CardTag.tag_id == Tag.id)
        .join(Card, Card.id == CardTag.card_id)
        .where(Tag.user_id == current_user.id, Card.user_id == current_user.id)
        .group_by(Tag.name)
        .order_by(func.count(CardTag.card_id).desc(), Tag.name)
    ).all()
    return [TagWithCount(name=name, count=count) for name, count in rows]
