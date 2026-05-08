"""Auth-free public profile + tag endpoints.

Each user can mark single tags as `is_public`. The user themselves needs
a `username` and `public_profile=true` to be reachable.

URL shape:
- `GET /api/public/users/{username}` — profile + list of public tags.
- `GET /api/public/users/{username}/tags/{slug}` — tag with all cards
  (recursive through sub-tags). `slug` may be a multi-segment path like
  `finance/investment` for nested tags.
- `GET /api/public/users/{username}/cards/{card_id}` — single card
  detail, but only if it is reachable via at least one public tag of
  this user.
- `GET /api/public/avatars/{file_id}` — avatar bytes (only files whose
  purpose is "avatar" can be fetched here).
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.card import Card
from app.models.file import File
from app.models.tag import CardTag, Tag
from app.models.user import User
from app.schemas.auth import (
    PublicCardSummary,
    PublicProfileOut,
    PublicProfileTagOut,
    PublicTagDetail,
)
from app.schemas.card import CardOut
from app.services.storage import get_storage

router = APIRouter(prefix="/public", tags=["public"])


def _load_public_user(db: Session, username: str) -> User:
    user = db.execute(
        select(User).where(User.username == username.lower(), User.public_profile.is_(True))
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    return user


def _walk_public_subtree(db: Session, user_id: UUID, root_tag: Tag) -> set[UUID]:
    """Return ids of `root_tag` plus every descendant tag belonging to
    `user_id`. Public-ness is anchored at `root_tag` — children inherit
    visibility automatically.
    """
    all_user_tags = db.execute(select(Tag).where(Tag.user_id == user_id)).scalars().all()
    children: dict[UUID | None, list[Tag]] = {}
    for t in all_user_tags:
        children.setdefault(t.parent_id, []).append(t)
    visited: set[UUID] = {root_tag.id}
    stack: list[Tag] = [root_tag]
    while stack:
        current = stack.pop()
        for child in children.get(current.id, []):
            if child.id not in visited:
                visited.add(child.id)
                stack.append(child)
    return visited


def _slug_path(db: Session, user_id: UUID, tag: Tag) -> str:
    """Build `parent/child/leaf` style slug from a tag up to the root.
    Tag names are already lowercase + dash-separated, so they double
    as URL-safe slugs.
    """
    parts: list[str] = [tag.name]
    cursor = db.get(Tag, tag.parent_id) if tag.parent_id else None
    safety = 0
    while cursor is not None and safety < 50:
        if cursor.user_id != user_id:
            break
        parts.append(cursor.name)
        cursor = db.get(Tag, cursor.parent_id) if cursor.parent_id else None
        safety += 1
    return "/".join(reversed(parts))


@router.get("/users/{username}", response_model=PublicProfileOut)
def get_public_profile(
    username: str,
    db: Session = Depends(get_db),
) -> PublicProfileOut:
    user = _load_public_user(db, username)

    # Public tags. We surface only the user's *top-level* public tags
    # (or public tags whose parent is private — those become entry
    # points). Sub-tags of a public tag inherit visibility but we don't
    # list them on the profile to avoid clutter.
    public_tags = db.execute(
        select(Tag).where(Tag.user_id == user.id, Tag.is_public.is_(True)).order_by(Tag.name)
    ).scalars().all()

    if not public_tags:
        return PublicProfileOut(
            username=user.username or "",
            display_name=user.display_name,
            bio=user.bio,
            avatar_file_id=user.avatar_file_id,
            tags=[],
        )

    # Card counts per public tag tree.
    out_tags: list[PublicProfileTagOut] = []
    public_set = {t.id for t in public_tags}
    for t in public_tags:
        # Hide tags that live inside another public tag — they're
        # already reachable via the parent's profile entry.
        if t.parent_id and t.parent_id in public_set:
            continue
        subtree_ids = _walk_public_subtree(db, user.id, t)
        count = db.execute(
            select(func.count(func.distinct(CardTag.card_id))).where(CardTag.tag_id.in_(subtree_ids))
        ).scalar_one()
        out_tags.append(
            PublicProfileTagOut(
                name=t.name,
                slug=_slug_path(db, user.id, t),
                card_count=int(count or 0),
            )
        )

    out_tags.sort(key=lambda x: (-x.card_count, x.name))
    return PublicProfileOut(
        username=user.username or "",
        display_name=user.display_name,
        bio=user.bio,
        avatar_file_id=user.avatar_file_id,
        tags=out_tags,
    )


def _resolve_tag_by_slug(db: Session, user_id: UUID, slug_path: str) -> Tag:
    """Resolve `parent/child/leaf` to the matching Tag, anchored at a
    public top-level tag.
    """
    parts = [p for p in slug_path.split("/") if p]
    if not parts:
        raise HTTPException(status_code=404, detail="Tag not found")

    cursor: Tag | None = None
    for i, part in enumerate(parts):
        stmt = select(Tag).where(Tag.user_id == user_id, Tag.name == part)
        if cursor is None:
            # Top of the path must be a public tag (or a tag whose
            # ancestor is public, but we only allow direct entry at a
            # public tag for clarity).
            stmt = stmt.where(Tag.parent_id.is_(None), Tag.is_public.is_(True))
        else:
            stmt = stmt.where(Tag.parent_id == cursor.id)
        cursor = db.execute(stmt).scalar_one_or_none()
        if cursor is None:
            # Fallback: a top-level public tag may have an ancestor we
            # couldn't follow because the user keeps their root private
            # but exposes a sub-tag. Allow exposing a non-root public
            # tag directly when no parent matched.
            if i == 0:
                cursor = db.execute(
                    select(Tag).where(
                        Tag.user_id == user_id,
                        Tag.name == part,
                        Tag.is_public.is_(True),
                    )
                ).scalar_one_or_none()
            if cursor is None:
                raise HTTPException(status_code=404, detail="Tag not found")
    assert cursor is not None
    return cursor


@router.get("/users/{username}/tags/{slug:path}", response_model=PublicTagDetail)
def get_public_tag(
    username: str,
    slug: str,
    db: Session = Depends(get_db),
) -> PublicTagDetail:
    user = _load_public_user(db, username)
    tag = _resolve_tag_by_slug(db, user.id, slug)

    subtree_ids = _walk_public_subtree(db, user.id, tag)
    # Use distinct() instead of group_by — Card has eager-joined Source
    # which would otherwise need to be in the GROUP BY too.
    cards = db.execute(
        select(Card)
        .where(
            Card.user_id == user.id,
            Card.status == "completed",
            Card.id.in_(select(CardTag.card_id).where(CardTag.tag_id.in_(subtree_ids))),
        )
        .order_by(Card.created_at.desc())
    ).scalars().all()

    return PublicTagDetail(
        name=tag.name,
        slug=_slug_path(db, user.id, tag),
        card_count=len(cards),
        cards=[
            PublicCardSummary(
                id=c.id,
                title=c.title,
                source_type=c.source_type,
                thumbnail_url=c.thumbnail_url,
                concise_summary_md=c.concise_summary_md,
            )
            for c in cards
        ],
    )


@router.get("/users/{username}/cards/{card_id}")
def get_public_card(
    username: str,
    card_id: UUID,
    db: Session = Depends(get_db),
) -> dict:
    user = _load_public_user(db, username)
    card = db.get(Card, card_id)
    if card is None or card.user_id != user.id:
        raise HTTPException(status_code=404, detail="Card not found")

    # Walk every public top-level tag's subtree; the card must be in at
    # least one to be visible.
    public_roots = db.execute(
        select(Tag).where(Tag.user_id == user.id, Tag.is_public.is_(True))
    ).scalars().all()
    visible_tag_ids: set[UUID] = set()
    for root in public_roots:
        visible_tag_ids |= _walk_public_subtree(db, user.id, root)
    if not visible_tag_ids:
        raise HTTPException(status_code=404, detail="Card not found")

    is_visible = db.execute(
        select(CardTag).where(
            CardTag.card_id == card.id, CardTag.tag_id.in_(visible_tag_ids)
        )
    ).first()
    if is_visible is None:
        raise HTTPException(status_code=404, detail="Card not found")

    out = CardOut.model_validate(card).model_dump()
    # Trim sensitive-ish fields.
    return {
        "id": out["id"],
        "title": out["title"],
        "source_type": out["source_type"],
        "thumbnail_url": out["thumbnail_url"],
        "concise_summary_md": out["concise_summary_md"],
        "detailed_summary_md": out["detailed_summary_md"],
        "key_takeaways_json": out["key_takeaways_json"],
        "notes_md": out["notes_md"],
    }


@router.get("/avatars/{file_id}")
def get_public_avatar(file_id: UUID, db: Session = Depends(get_db)) -> Response:
    """Public avatar fetch. Only files marked with purpose=avatar can be
    served through this path — everything else is 404.
    """
    file = db.get(File, file_id)
    if file is None or file.purpose != "avatar":
        raise HTTPException(status_code=404, detail="Avatar not found")
    blob = get_storage().read(file)
    return Response(
        content=blob,
        media_type=file.content_type or "application/octet-stream",
        headers={"Cache-Control": "public, max-age=86400"},
    )
