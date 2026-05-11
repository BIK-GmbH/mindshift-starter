"""User-scoped CRUD for image-prompt templates.

The template text is prepended to image-generation prompts (post
covers, podcast covers, path covers, …). Each user can mark exactly
one template as default; the API enforces this by clearing the
flag on siblings when a template is promoted.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.image_template import ImageTemplate
from app.models.user import User
from app.schemas.image_template import (
    ImageTemplateCreate,
    ImageTemplateOut,
    ImageTemplateUpdate,
)

router = APIRouter(prefix="/image-templates", tags=["image-templates"])


def _ensure_owned(db: Session, template_id: UUID, user_id: UUID) -> ImageTemplate:
    template = db.get(ImageTemplate, template_id)
    if template is None or template.user_id != user_id:
        raise HTTPException(status_code=404, detail="Template not found")
    return template


def _clear_default(db: Session, user_id: UUID, except_id: UUID | None = None) -> None:
    """Reset is_default on every other template owned by `user_id`.
    Called before flipping a fresh row's flag so we keep the invariant
    of at-most-one default per user."""
    stmt = update(ImageTemplate).where(ImageTemplate.user_id == user_id)
    if except_id is not None:
        stmt = stmt.where(ImageTemplate.id != except_id)
    db.execute(stmt.values(is_default=False))


@router.get("", response_model=list[ImageTemplateOut])
def list_templates(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ImageTemplateOut]:
    rows = (
        db.execute(
            select(ImageTemplate)
            .where(ImageTemplate.user_id == current_user.id)
            .order_by(ImageTemplate.is_default.desc(), ImageTemplate.name)
        )
        .scalars()
        .all()
    )
    return [ImageTemplateOut.model_validate(r) for r in rows]


@router.post("", response_model=ImageTemplateOut, status_code=status.HTTP_201_CREATED)
def create_template(
    payload: ImageTemplateCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ImageTemplateOut:
    clash = db.execute(
        select(ImageTemplate).where(
            ImageTemplate.user_id == current_user.id,
            ImageTemplate.name == payload.name.strip(),
        )
    ).scalar_one_or_none()
    if clash is not None:
        raise HTTPException(status_code=409, detail="A template with that name already exists")
    template = ImageTemplate(
        user_id=current_user.id,
        name=payload.name.strip(),
        content=payload.content,
        is_default=payload.is_default,
    )
    db.add(template)
    db.flush()
    if payload.is_default:
        _clear_default(db, current_user.id, except_id=template.id)
    db.commit()
    db.refresh(template)
    return ImageTemplateOut.model_validate(template)


@router.patch("/{template_id}", response_model=ImageTemplateOut)
def update_template(
    template_id: UUID,
    payload: ImageTemplateUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ImageTemplateOut:
    template = _ensure_owned(db, template_id, current_user.id)
    if payload.name is not None:
        template.name = payload.name.strip()
    if payload.content is not None:
        template.content = payload.content
    if payload.is_default is not None:
        if payload.is_default:
            _clear_default(db, current_user.id, except_id=template.id)
        template.is_default = payload.is_default
    db.commit()
    db.refresh(template)
    return ImageTemplateOut.model_validate(template)


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(
    template_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    template = _ensure_owned(db, template_id, current_user.id)
    db.delete(template)
    db.commit()


def resolve_template_content(
    db: Session, user_id: UUID, *, template_id: UUID | None = None
) -> str | None:
    """Helper used by image-generation endpoints to fetch the template
    text the user wants prepended to a prompt. Falls back to the user's
    default template when no template_id is given. Returns None when the
    user has nothing configured."""
    if template_id is not None:
        row = db.execute(
            select(ImageTemplate).where(
                ImageTemplate.id == template_id,
                ImageTemplate.user_id == user_id,
            )
        ).scalar_one_or_none()
        return row.content if row else None
    row = db.execute(
        select(ImageTemplate).where(
            ImageTemplate.user_id == user_id,
            ImageTemplate.is_default.is_(True),
        )
    ).scalar_one_or_none()
    return row.content if row else None
