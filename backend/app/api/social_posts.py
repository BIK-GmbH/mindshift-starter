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

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import SessionLocal, get_db
from app.models.card import Card
from app.models.card_social_post import CardSocialPost
from app.models.card_social_post_image_version import CardSocialPostImageVersion
from app.models.file import File
from app.models.user import User
from app.schemas.social_post import (
    SocialPostCreate,
    SocialPostImageGenerateRequest,
    SocialPostImagePreviewRequest,
    SocialPostImagePreviewResponse,
    SocialPostImageRefineRequest,
    SocialPostImageVersionOut,
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
    db.flush()
    if image_file_id is not None:
        _record_version(
            db,
            post=post,
            file_id=image_file_id,
            prompt_used=None,  # Original template-based generation
            kind="generate",
            parent_version_id=None,
            status="ready",
        )
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


def _resolve_card_body(card: Card) -> str:
    """Concat the parts of a card the image-template extractor benefits
    from: summaries + key takeaways + notes. Capped downstream."""
    parts: list[str] = []
    for chunk in (card.concise_summary_md, card.detailed_summary_md, card.notes_md):
        if chunk:
            parts.append(chunk)
    if isinstance(card.key_takeaways_json, list):
        parts.extend(str(x) for x in card.key_takeaways_json if x)
    return "\n\n".join(parts)


def _ensure_post(db: Session, card_id: UUID, post_id: UUID, user_id: UUID) -> tuple[Card, CardSocialPost]:
    card = _ensure_card(db, card_id, user_id)
    post = db.get(CardSocialPost, post_id)
    if post is None or post.card_id != card_id:
        raise HTTPException(status_code=404, detail="Post not found")
    return card, post


def _record_version(
    db: Session,
    *,
    post: CardSocialPost,
    file_id: UUID | None,
    prompt_used: str | None,
    kind: str,
    parent_version_id: UUID | None,
    status: str = "ready",
) -> CardSocialPostImageVersion:
    version = CardSocialPostImageVersion(
        post_id=post.id,
        file_id=file_id,
        prompt_used=(prompt_used or "")[:4000] or None,
        kind=kind,
        parent_version_id=parent_version_id,
        status=status,
    )
    db.add(version)
    db.flush()
    return version


def _user_id_for_post(db: Session, post: CardSocialPost) -> UUID:
    card = db.get(Card, post.card_id)
    if card is None:
        raise RuntimeError("post without card")
    return card.user_id


def _run_image_job(
    version_id: UUID,
    *,
    user_id: UUID,
    card_id: UUID,
    post_id: UUID,
    platform: str,
    prompt_override: str | None,
    template_content: str | None,
    refine_prompt: str | None,
    source_file_path: str | None,
) -> None:
    """Background task body. Opens its own DB session — the request
    session is closed by the time FastAPI hands the task off. Reads
    the source file from disk (path passed in) for the refine case
    because the file row may have moved between request + background
    work. Updates the version row + post.image_file_id on completion."""
    from app.services.social_post import refine_post_image as _refine_image_bytes
    from app.services.social_post import generate_post_image as _generate_image_bytes

    db = SessionLocal()
    try:
        version = db.get(CardSocialPostImageVersion, version_id)
        if version is None:
            return
        post = db.get(CardSocialPost, post_id)
        card = db.get(Card, card_id)
        if post is None or card is None:
            return
        try:
            if refine_prompt is not None:
                if source_file_path is None:
                    raise RuntimeError("refine job missing source file path")
                from pathlib import Path

                src_bytes = Path(source_file_path).read_bytes()
                png = _refine_image_bytes(image_bytes=src_bytes, prompt=refine_prompt)
            else:
                png = _generate_image_bytes(
                    title=card.title,
                    post_text=post.text,
                    template_content=template_content,
                    prompt_override=prompt_override,
                )
            file_row = get_storage().save(
                db,
                user_id=user_id,
                content=png,
                original_filename=f"social-{card_id}-{platform}.png",
                content_type="image/png",
                purpose="social_post_image",
            )
            version.file_id = file_row.id
            version.status = "ready"
            post.image_file_id = file_row.id
            db.commit()
        except Exception as exc:  # noqa: BLE001
            logger.warning("post image job %s failed: %s", version_id, exc)
            version.status = "failed"
            version.error_message = str(exc)[:4000]
            db.commit()
    finally:
        db.close()


def _active_version_id(db: Session, post: CardSocialPost) -> UUID | None:
    """Find the version row whose file_id matches the post's current
    image. We do NOT carry an explicit pointer on the post — the post
    points at a file_id, the versions reference the same files, the
    most-recent version with that file_id wins."""
    if post.image_file_id is None:
        return None
    row = db.execute(
        select(CardSocialPostImageVersion)
        .where(
            CardSocialPostImageVersion.post_id == post.id,
            CardSocialPostImageVersion.file_id == post.image_file_id,
        )
        .order_by(CardSocialPostImageVersion.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    return row.id if row else None


@router.post(
    "/{card_id}/social-posts/{post_id}/image/preview",
    response_model=SocialPostImagePreviewResponse,
)
def preview_post_image(
    card_id: UUID,
    post_id: UUID,
    payload: SocialPostImagePreviewRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SocialPostImagePreviewResponse:
    """Dry-run the variable-resolution pipeline for this post so the
    Pre-Gen modal can show editable variable values + the resolved
    prompt before paying for a gpt-image-2 call."""
    from app.api.image_templates import (
        KNOWN_VARIABLES,
        resolve_template_content,
    )
    from app.services.podcast import (
        _extract_template_vars,
        extract_template_values,
        substitute_template_values,
    )

    card, post = _ensure_post(db, card_id, post_id, current_user.id)

    template_content = payload.template_content
    if template_content is None:
        template_content = resolve_template_content(
            db, current_user.id, template_id=payload.template_id
        )
    if not template_content:
        return SocialPostImagePreviewResponse(
            detected=[], unknown=[], extracted={}, resolved="",
            template_id=payload.template_id,
        )

    detected = _extract_template_vars(template_content)
    known_names = {v["name"] for v in KNOWN_VARIABLES}
    unknown = [v for v in detected if v not in known_names]

    body = _resolve_card_body(card) or post.text
    extracted = extract_template_values(detected, title=card.title, body=body)
    resolved = (
        substitute_template_values(template_content, extracted)
        if extracted
        else template_content
    )

    return SocialPostImagePreviewResponse(
        detected=detected,
        unknown=unknown,
        extracted=extracted,
        resolved=resolved,
        template_id=payload.template_id,
    )


@router.post(
    "/{card_id}/social-posts/{post_id}/image/generate",
    response_model=SocialPostImageVersionOut,
    status_code=status.HTTP_202_ACCEPTED,
)
def generate_post_image_endpoint(
    card_id: UUID,
    post_id: UUID,
    payload: SocialPostImageGenerateRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SocialPostImageVersionOut:
    """Kick off a fresh image generation. Returns immediately with a
    `processing` version row; the gpt-image-2 call runs in a
    BackgroundTask and flips the row to `ready` (or `failed`) when
    done. The frontend polls /image/versions to surface status changes."""
    from app.api.image_templates import resolve_template_content

    _card, post = _ensure_post(db, card_id, post_id, current_user.id)

    template_content: str | None = None
    if not payload.resolved_prompt:
        template_content = resolve_template_content(
            db, current_user.id, template_id=payload.template_id
        )

    version = _record_version(
        db,
        post=post,
        file_id=None,
        prompt_used=payload.resolved_prompt,
        kind="generate",
        parent_version_id=None,
        status="processing",
    )
    db.commit()
    db.refresh(version)

    background_tasks.add_task(
        _run_image_job,
        version.id,
        user_id=current_user.id,
        card_id=post.card_id,
        post_id=post.id,
        platform=post.platform,
        prompt_override=payload.resolved_prompt,
        template_content=template_content,
        refine_prompt=None,
        source_file_path=None,
    )
    return _version_to_out(version, post.image_file_id)


@router.post(
    "/{card_id}/social-posts/{post_id}/image/refine",
    response_model=SocialPostImageVersionOut,
    status_code=status.HTTP_202_ACCEPTED,
)
def refine_post_image_endpoint(
    card_id: UUID,
    post_id: UUID,
    payload: SocialPostImageRefineRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SocialPostImageVersionOut:
    """Kick off a refine — same async pattern as generate. We resolve
    the source file's *storage path* here so the BackgroundTask can
    read the bytes without holding the request DB session open."""
    _card, post = _ensure_post(db, card_id, post_id, current_user.id)
    if post.image_file_id is None:
        raise HTTPException(status_code=400, detail="Post has no image to refine")
    src_file = db.get(File, post.image_file_id)
    if src_file is None or src_file.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Image file missing")

    from pathlib import Path
    from app.core.config import get_settings as _gs

    settings_obj = _gs()
    source_path = str(Path(settings_obj.storage_path).resolve() / src_file.storage_path)

    parent_version_id = _active_version_id(db, post)
    version = _record_version(
        db,
        post=post,
        file_id=None,
        prompt_used=payload.prompt,
        kind="refine",
        parent_version_id=parent_version_id,
        status="processing",
    )
    db.commit()
    db.refresh(version)

    background_tasks.add_task(
        _run_image_job,
        version.id,
        user_id=current_user.id,
        card_id=post.card_id,
        post_id=post.id,
        platform=post.platform,
        prompt_override=None,
        template_content=None,
        refine_prompt=payload.prompt,
        source_file_path=source_path,
    )
    return _version_to_out(version, post.image_file_id)


def _version_to_out(
    version: CardSocialPostImageVersion, active_file_id: UUID | None
) -> SocialPostImageVersionOut:
    return SocialPostImageVersionOut(
        id=version.id,
        file_id=version.file_id,
        image_url=f"/api/files/{version.file_id}" if version.file_id else None,
        prompt_used=version.prompt_used,
        kind=version.kind,
        status=version.status,
        error_message=version.error_message,
        parent_version_id=version.parent_version_id,
        is_active=version.file_id is not None and version.file_id == active_file_id,
        created_at=version.created_at,
    )


@router.get(
    "/{card_id}/social-posts/{post_id}/image/versions",
    response_model=list[SocialPostImageVersionOut],
)
def list_post_image_versions(
    card_id: UUID,
    post_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[SocialPostImageVersionOut]:
    _card, post = _ensure_post(db, card_id, post_id, current_user.id)
    rows = (
        db.execute(
            select(CardSocialPostImageVersion)
            .where(CardSocialPostImageVersion.post_id == post.id)
            .order_by(CardSocialPostImageVersion.created_at.desc())
        )
        .scalars()
        .all()
    )
    active = post.image_file_id
    return [_version_to_out(r, active) for r in rows]


@router.post(
    "/{card_id}/social-posts/{post_id}/image/versions/{version_id}/activate",
    response_model=SocialPostOut,
)
def activate_post_image_version(
    card_id: UUID,
    post_id: UUID,
    version_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SocialPostOut:
    """Flip the post's active image to a prior version — the underlying
    file stays in storage so the switch is instant + reversible."""
    _card, post = _ensure_post(db, card_id, post_id, current_user.id)
    version = db.get(CardSocialPostImageVersion, version_id)
    if version is None or version.post_id != post.id:
        raise HTTPException(status_code=404, detail="Version not found")
    post.image_file_id = version.file_id
    db.commit()
    db.refresh(post)
    return _to_out(post)
