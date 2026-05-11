"""User-scoped CRUD for image-prompt templates.

The template text is prepended to image-generation prompts (post
covers, podcast covers, path covers, …). Each user can mark exactly
one template as default; the API enforces this by clearing the
flag on siblings when a template is promoted.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.card import Card
from app.models.image_template import ImageTemplate
from app.models.user import User
from app.schemas.image_template import (
    ImageTemplateCreate,
    ImageTemplateOut,
    ImageTemplateUpdate,
)

router = APIRouter(prefix="/image-templates", tags=["image-templates"])


# Canonical placeholder vocabulary. The variable-extraction prompt in
# services/podcast.py knows how to fill exactly these — anything else
# is rendered as-is or returned empty. Surface this list to the UI so
# users see what's available while editing a template.
KNOWN_VARIABLES: list[dict[str, str]] = [
    {
        "name": "HEADLINE",
        "description": "1–6 words, ALL CAPS, the punchiest topic framing.",
    },
    {
        "name": "SUBTITLE",
        "description": "≤ 8 words, sentence case, optional supporting line.",
    },
    {
        "name": "NUMBER_1",
        "description": "Most striking numeric claim from the source (\"70%\", \"$1.2B\").",
    },
    {
        "name": "LABEL_1",
        "description": "≤ 6 words; what NUMBER_1 measures.",
    },
    {
        "name": "NUMBER_2",
        "description": "Second numeric claim. Empty string if none.",
    },
    {
        "name": "LABEL_2",
        "description": "≤ 6 words; what NUMBER_2 measures.",
    },
    {
        "name": "NUMBER_3",
        "description": "Third numeric claim. Empty string if none.",
    },
    {
        "name": "LABEL_3",
        "description": "≤ 6 words; what NUMBER_3 measures.",
    },
    {
        "name": "SOURCES",
        "description": "Comma-separated names of cited orgs / channels.",
    },
    {
        "name": "DATE",
        "description": 'Short period label like "Q2 2026" or "May 2026".',
    },
]


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


@router.get("/variables")
def list_known_variables() -> dict[str, list[dict[str, str]]]:
    """Catalog of placeholders the variable-extraction prompt knows how
    to fill. Frontend reads this to render the palette + flag unknown
    `{{X}}` strings in user templates."""
    return {"variables": KNOWN_VARIABLES}


class _PreviewRequest(BaseModel):
    content: str
    card_id: UUID | None = None


class _PreviewResponse(BaseModel):
    detected: list[str]
    unknown: list[str]
    extracted: dict[str, str]
    resolved: str
    card_title: str | None = None


@router.post("/preview", response_model=_PreviewResponse)
def preview_template(
    payload: _PreviewRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> _PreviewResponse:
    """Dry-run the variable-resolution pipeline so users can see exactly
    what would be substituted before they save a template. `card_id`
    picks a specific card for grounding; if omitted, we use the user's
    most recently completed card."""
    from app.services.image_generation import (
        _extract_template_vars,
        extract_template_values,
        substitute_template_values,
    )

    detected = _extract_template_vars(payload.content)
    known_names = {v["name"] for v in KNOWN_VARIABLES}
    unknown = [v for v in detected if v not in known_names]

    card: Card | None = None
    if payload.card_id is not None:
        card = db.execute(
            select(Card).where(
                Card.id == payload.card_id,
                Card.user_id == current_user.id,
            )
        ).scalar_one_or_none()
    if card is None:
        card = db.execute(
            select(Card)
            .where(Card.user_id == current_user.id, Card.status == "completed")
            .order_by(Card.created_at.desc())
            .limit(1)
        ).scalar_one_or_none()

    title = card.title if card else "Sample headline"
    body_parts: list[str] = []
    if card:
        for chunk in (card.concise_summary_md, card.detailed_summary_md, card.notes_md):
            if chunk:
                body_parts.append(chunk)
        if isinstance(card.key_takeaways_json, list):
            body_parts.extend(str(x) for x in card.key_takeaways_json if x)
    body = "\n\n".join(body_parts) or (
        "Mindshift turns videos, articles and PDFs into a personal "
        "knowledge graph. 70% retention boost, 3x faster review."
    )

    extracted = extract_template_values(detected, title=title, body=body)
    resolved = substitute_template_values(payload.content, extracted) if extracted else payload.content

    return _PreviewResponse(
        detected=detected,
        unknown=unknown,
        extracted=extracted,
        resolved=resolved,
        card_title=card.title if card else None,
    )


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
