"""Social-media post drafts per card.

Endpoints (all auth-gated, scoped to cards the caller owns):

  GET    /api/cards/{id}/social-posts             — list saved drafts
  POST   /api/cards/{id}/social-posts             — generate a new draft
  DELETE /api/cards/{id}/social-posts/{post_id}   — remove a draft

Image generation is synchronous and optional. The OpenAI call for the
text is fast (≤5 s); when `with_image=true` the request can take 30–40 s
because gpt-image-2 is added — we accept that latency and let the
frontend show a spinner. Long-running orchestration is overkill here
(unlike podcast episodes which can be 60+ s).
"""

from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.card import Card
from app.models.card_social_post import CardSocialPost
from app.models.file import File
from app.models.user import User
from app.schemas.social_post import (
    SocialPostCreate,
    SocialPostOut,
    SocialPostRewriteRequest,
    SocialPostRewriteResponse,
    SocialPostUpdate,
)
from app.services.social_post import (
    generate_post,
    generate_post_image,
    rewrite_selection,
)
from app.services.storage import get_storage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/cards", tags=["social-posts"])


def _ensure_card(db: Session, card_id: UUID, user_id: UUID) -> Card:
    card = db.get(Card, card_id)
    if card is None or card.user_id != user_id:
        raise HTTPException(status_code=404, detail="Card not found")
    return card


def _to_out(post: CardSocialPost) -> SocialPostOut:
    image_url = (
        f"/api/files/{post.image_file_id}" if post.image_file_id else None
    )
    return SocialPostOut(
        id=post.id,
        card_id=post.card_id,
        platform=post.platform,
        text=post.text,
        hashtags=list(post.hashtags or []),
        character_count=post.character_count,
        image_url=image_url,
        tone=post.tone,
        language=post.language,
        created_at=post.created_at,
    )


@router.get("/{card_id}/social-posts", response_model=list[SocialPostOut])
def list_social_posts(
    card_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[SocialPostOut]:
    _ensure_card(db, card_id, current_user.id)
    rows = (
        db.execute(
            select(CardSocialPost)
            .where(CardSocialPost.card_id == card_id)
            .order_by(CardSocialPost.created_at.desc())
            .limit(20)
        )
        .scalars()
        .all()
    )
    return [_to_out(p) for p in rows]


@router.post(
    "/{card_id}/social-posts",
    response_model=SocialPostOut,
    status_code=status.HTTP_201_CREATED,
)
def create_social_post(
    card_id: UUID,
    payload: SocialPostCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SocialPostOut:
    card = _ensure_card(db, card_id, current_user.id)
    if card.status != "completed":
        raise HTTPException(
            status_code=400,
            detail="Card must be fully ingested before generating a post.",
        )

    try:
        text, hashtags = generate_post(
            title=card.title,
            concise=card.concise_summary_md,
            detailed=card.detailed_summary_md,
            key_takeaways=card.key_takeaways_json or None,
            platform=payload.platform,
            tone=payload.tone,
            language=payload.language,
            with_hashtags=payload.with_hashtags,
            with_cta=payload.with_cta,
            with_emoji=payload.with_emoji,
        )
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    image_file_id: UUID | None = None
    if payload.with_image:
        # Resolve the image template the user wants applied — explicit
        # template_id wins, else the user's default, else None (raw
        # gpt-image-2 prompt).
        from app.api.image_templates import resolve_template_content

        template_content = resolve_template_content(
            db, current_user.id, template_id=payload.image_template_id
        )
        try:
            png = generate_post_image(
                title=card.title,
                post_text=text,
                template_content=template_content,
            )
        except Exception as exc:  # noqa: BLE001 — image is optional
            logger.warning("social-post image generation failed for %s: %s", card_id, exc)
            png = None
        if png:
            storage = get_storage()
            file_row = storage.save(
                db,
                user_id=current_user.id,
                content=png,
                original_filename=f"social-{card_id}-{payload.platform}.png",
                content_type="image/png",
                purpose="social_post_image",
            )
            image_file_id = file_row.id

    post = CardSocialPost(
        card_id=card.id,
        platform=payload.platform,
        text=text,
        hashtags=hashtags or None,
        character_count=len(text),
        image_file_id=image_file_id,
        tone=payload.tone,
        language=payload.language,
    )
    db.add(post)
    db.commit()
    db.refresh(post)
    return _to_out(post)


@router.patch("/{card_id}/social-posts/{post_id}", response_model=SocialPostOut)
def update_social_post(
    card_id: UUID,
    post_id: UUID,
    payload: SocialPostUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SocialPostOut:
    _ensure_card(db, card_id, current_user.id)
    post = db.get(CardSocialPost, post_id)
    if post is None or post.card_id != card_id:
        raise HTTPException(status_code=404, detail="Post not found")
    post.text = payload.text
    post.character_count = len(payload.text)
    db.commit()
    db.refresh(post)
    return _to_out(post)


@router.post(
    "/{card_id}/social-posts/{post_id}/rewrite",
    response_model=SocialPostRewriteResponse,
)
def rewrite_social_post(
    card_id: UUID,
    post_id: UUID,
    payload: SocialPostRewriteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SocialPostRewriteResponse:
    """Run an AI rewrite on a fragment of the post (the user's
    selection). Returns just the replacement text — the frontend
    splices it back into the editor at the original selection range."""
    _ensure_card(db, card_id, current_user.id)
    post = db.get(CardSocialPost, post_id)
    if post is None or post.card_id != card_id:
        raise HTTPException(status_code=404, detail="Post not found")
    try:
        rewritten = rewrite_selection(
            action=payload.action,
            selection=payload.selection,
            full_text=payload.full_text or post.text,
        )
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return SocialPostRewriteResponse(text=rewritten)


@router.delete(
    "/{card_id}/social-posts/{post_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_social_post(
    card_id: UUID,
    post_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ensure_card(db, card_id, current_user.id)
    post = db.get(CardSocialPost, post_id)
    if post is None or post.card_id != card_id:
        raise HTTPException(status_code=404, detail="Post not found")
    # Free the cover blob if we generated one. The file row will go
    # too via cascade-on-delete only if no other reference exists —
    # we set image_file_id NULL first and let the storage cleanup pass
    # remove orphaned blobs.
    if post.image_file_id:
        file_row = db.get(File, post.image_file_id)
        if file_row and file_row.user_id == current_user.id:
            get_storage().delete(db, file_row)
    db.delete(post)
    db.commit()
