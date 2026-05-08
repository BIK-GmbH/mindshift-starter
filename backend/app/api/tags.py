from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.card import Card
from app.models.tag import CardTag, Tag
from app.models.user import User

router = APIRouter(prefix="/tags", tags=["tags"])


class TagOut(BaseModel):
    id: UUID
    name: str
    parent_id: UUID | None = None
    count: int = 0
    is_public: bool = False


class CreateTagRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    parent_id: UUID | None = None


class UpdateTagRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    parent_id: UUID | None = None
    is_public: bool | None = None


class UntaggedCount(BaseModel):
    count: int


class TagCardOut(BaseModel):
    id: UUID
    title: str
    source_type: str
    status: str
    thumbnail_url: str | None = None


class TagWithCardsOut(BaseModel):
    id: UUID
    name: str
    parent_id: UUID | None = None
    count: int
    is_public: bool = False
    cards: list[TagCardOut] = []


class TreeResponse(BaseModel):
    tags: list[TagWithCardsOut]
    untagged: list[TagCardOut]


@router.get("", response_model=list[TagOut])
def list_tags(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[TagOut]:
    """Return all of the user's tags with usage counts.

    Includes tags with zero cards so manually-created hierarchy nodes show up.
    """
    counts_subq = (
        select(CardTag.tag_id, func.count(CardTag.card_id).label("c"))
        .join(Card, Card.id == CardTag.card_id)
        .where(Card.user_id == current_user.id)
        .group_by(CardTag.tag_id)
        .subquery()
    )

    rows = db.execute(
        select(Tag, counts_subq.c.c)
        .outerjoin(counts_subq, counts_subq.c.tag_id == Tag.id)
        .where(Tag.user_id == current_user.id)
        .order_by(Tag.name)
    ).all()
    return [
        TagOut(id=t.id, name=t.name, parent_id=t.parent_id, count=int(c or 0), is_public=t.is_public)
        for t, c in rows
    ]


@router.get("/tree", response_model=TreeResponse)
def tag_tree(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TreeResponse:
    """Return all tags + the cards directly tagged under each, plus the untagged list.

    Used by the Library sidebar to render a Recall-style tree where cards appear as
    leaves underneath their tags.
    """
    tags = db.execute(
        select(Tag).where(Tag.user_id == current_user.id).order_by(Tag.name)
    ).scalars().all()

    # Build {tag_id: [cards]} in one query.
    cards_per_tag: dict[UUID, list[TagCardOut]] = {}
    rows = db.execute(
        select(CardTag.tag_id, Card)
        .join(Card, Card.id == CardTag.card_id)
        .where(Card.user_id == current_user.id)
        .order_by(CardTag.tag_id, Card.title)
    ).all()
    for tag_id, card in rows:
        cards_per_tag.setdefault(tag_id, []).append(
            TagCardOut(
                id=card.id,
                title=card.title,
                source_type=card.source_type,
                status=card.status,
                thumbnail_url=card.thumbnail_url,
            )
        )

    tag_outs = [
        TagWithCardsOut(
            id=t.id,
            name=t.name,
            parent_id=t.parent_id,
            count=len(cards_per_tag.get(t.id, [])),
            is_public=t.is_public,
            cards=cards_per_tag.get(t.id, []),
        )
        for t in tags
    ]

    untagged_cards = db.execute(
        select(Card)
        .where(Card.user_id == current_user.id)
        .where(~Card.id.in_(select(CardTag.card_id)))
        .order_by(Card.created_at.desc())
        .limit(200)
    ).scalars().all()

    return TreeResponse(
        tags=tag_outs,
        untagged=[
            TagCardOut(
                id=c.id,
                title=c.title,
                source_type=c.source_type,
                status=c.status,
                thumbnail_url=c.thumbnail_url,
            )
            for c in untagged_cards
        ],
    )


@router.get("/untagged-count", response_model=UntaggedCount)
def untagged_count(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UntaggedCount:
    """How many of the user's cards have no tag at all."""
    untagged_query = (
        select(func.count(Card.id))
        .where(Card.user_id == current_user.id)
        .where(~Card.id.in_(select(CardTag.card_id)))
    )
    n = db.execute(untagged_query).scalar_one()
    return UntaggedCount(count=int(n or 0))


@router.post("", response_model=TagOut, status_code=status.HTTP_201_CREATED)
def create_tag(
    payload: CreateTagRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TagOut:
    name = payload.name.strip().lower()
    existing = db.execute(
        select(Tag).where(Tag.user_id == current_user.id, Tag.name == name)
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="Tag already exists")

    parent_id = payload.parent_id
    if parent_id is not None:
        parent = db.get(Tag, parent_id)
        if parent is None or parent.user_id != current_user.id:
            raise HTTPException(status_code=400, detail="Invalid parent tag")

    tag = Tag(user_id=current_user.id, name=name, parent_id=parent_id)
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return TagOut(id=tag.id, name=tag.name, parent_id=tag.parent_id, count=0, is_public=tag.is_public)


@router.patch("/{tag_id}", response_model=TagOut)
def update_tag(
    tag_id: UUID,
    payload: UpdateTagRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TagOut:
    tag = db.get(Tag, tag_id)
    if tag is None or tag.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Tag not found")

    if payload.name is not None:
        new_name = payload.name.strip().lower()
        if new_name != tag.name:
            collision = db.execute(
                select(Tag).where(
                    Tag.user_id == current_user.id,
                    Tag.name == new_name,
                    Tag.id != tag.id,
                )
            ).scalar_one_or_none()
            if collision is not None:
                raise HTTPException(status_code=409, detail="Name already in use")
            tag.name = new_name

    if "parent_id" in payload.model_fields_set:
        new_parent_id = payload.parent_id
        if new_parent_id is None:
            tag.parent_id = None
        else:
            if new_parent_id == tag.id:
                raise HTTPException(status_code=400, detail="Tag cannot be its own parent")
            parent = db.get(Tag, new_parent_id)
            if parent is None or parent.user_id != current_user.id:
                raise HTTPException(status_code=400, detail="Invalid parent tag")
            cursor: Tag | None = parent
            while cursor is not None:
                if cursor.id == tag.id:
                    raise HTTPException(status_code=400, detail="Cycle detected")
                cursor = db.get(Tag, cursor.parent_id) if cursor.parent_id else None
            tag.parent_id = new_parent_id

    if "is_public" in payload.model_fields_set and payload.is_public is not None:
        tag.is_public = payload.is_public

    db.commit()
    db.refresh(tag)

    count = db.execute(
        select(func.count(CardTag.card_id)).where(CardTag.tag_id == tag.id)
    ).scalar_one()
    return TagOut(
        id=tag.id,
        name=tag.name,
        parent_id=tag.parent_id,
        count=int(count or 0),
        is_public=tag.is_public,
    )


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tag(
    tag_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    tag = db.get(Tag, tag_id)
    if tag is None or tag.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Tag not found")
    db.delete(tag)
    db.commit()


class AssignTagRequest(BaseModel):
    card_id: UUID
    tag_id: UUID


@router.post("/{tag_id}/assign", status_code=status.HTTP_204_NO_CONTENT)
def assign_card_to_tag(
    tag_id: UUID,
    payload: AssignTagRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Add a tag to a card. Idempotent — repeated calls are no-ops.

    Used by drag-and-drop: dropping a card on a tag should attach that tag.
    """
    if payload.tag_id != tag_id:
        raise HTTPException(status_code=400, detail="Path / body tag_id mismatch")
    tag = db.get(Tag, tag_id)
    if tag is None or tag.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Tag not found")
    card = db.get(Card, payload.card_id)
    if card is None or card.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Card not found")
    db.merge(CardTag(card_id=card.id, tag_id=tag.id))
    db.commit()


@router.delete("/{tag_id}/assign/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
def unassign_card_from_tag(
    tag_id: UUID,
    card_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Remove a tag from a card. No-op if not assigned."""
    tag = db.get(Tag, tag_id)
    if tag is None or tag.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Tag not found")
    card = db.get(Card, card_id)
    if card is None or card.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Card not found")
    db.execute(
        select(CardTag).where(CardTag.card_id == card.id, CardTag.tag_id == tag.id)
    ).all()
    from sqlalchemy import delete

    db.execute(
        delete(CardTag).where(CardTag.card_id == card.id, CardTag.tag_id == tag.id)
    )
    db.commit()
