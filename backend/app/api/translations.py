"""Card translations endpoints.

Translation generation is async (BackgroundTask). The endpoint inserts a
row in `status="processing"` and returns 202 immediately; the worker
fills in the translated fields and flips status to `"ready"` (or
`"failed"` with an error message). Frontend polls.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import SessionLocal, get_db
from app.models.card import Card
from app.models.card_translation import CardTranslation
from app.models.user import User
from app.schemas.translation import CardTranslationOut, TranslationCreate
from app.services.translation import translate_card_content

router = APIRouter(prefix="/cards", tags=["translations"])


def _to_out(tr: CardTranslation) -> CardTranslationOut:
    return CardTranslationOut(
        id=tr.id,
        card_id=tr.card_id,
        language=tr.language,
        title=tr.title,
        concise_summary_md=tr.concise_summary_md,
        detailed_summary_md=tr.detailed_summary_md,
        status=tr.status,
        error_message=tr.error_message,
        created_at=tr.created_at,
    )


def _load_owned_card(db: Session, card_id: UUID, user: User) -> Card:
    card = db.get(Card, card_id)
    if card is None or card.user_id != user.id:
        raise HTTPException(status_code=404, detail="Card not found")
    return card


def _run_translation_job(
    *,
    translation_id: UUID,
    target_language: str,
    title: str | None,
    concise: str | None,
    detailed: str | None,
) -> None:
    db = SessionLocal()
    try:
        tr = db.get(CardTranslation, translation_id)
        if tr is None:
            return
        try:
            out = translate_card_content(
                target_language=target_language,
                title=title,
                concise_summary_md=concise,
                detailed_summary_md=detailed,
            )
            tr.title = out.get("title")
            tr.concise_summary_md = out.get("concise_summary_md")
            tr.detailed_summary_md = out.get("detailed_summary_md")
            tr.status = "ready"
            tr.error_message = None
            db.commit()
        except Exception as exc:  # noqa: BLE001
            tr.status = "failed"
            tr.error_message = str(exc)[:500]
            db.commit()
    finally:
        db.close()


@router.get("/{card_id}/translations", response_model=list[CardTranslationOut])
def list_translations(
    card_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[CardTranslationOut]:
    _load_owned_card(db, card_id, current_user)
    rows = db.execute(
        select(CardTranslation)
        .where(CardTranslation.card_id == card_id)
        .order_by(CardTranslation.created_at.asc())
    ).scalars().all()
    return [_to_out(t) for t in rows]


@router.post(
    "/{card_id}/translations",
    response_model=CardTranslationOut,
    status_code=202,
)
def create_translation(
    card_id: UUID,
    payload: TranslationCreate,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CardTranslationOut:
    card = _load_owned_card(db, card_id, current_user)
    language = payload.language.strip()
    if not language:
        raise HTTPException(status_code=400, detail="language required")

    existing = db.execute(
        select(CardTranslation).where(
            CardTranslation.card_id == card_id,
            CardTranslation.language == language,
        )
    ).scalar_one_or_none()
    if existing is not None:
        # Re-run: mark processing, clear out the previous payload so the
        # frontend doesn't briefly show stale data.
        existing.status = "processing"
        existing.error_message = None
        existing.title = None
        existing.concise_summary_md = None
        existing.detailed_summary_md = None
        tr = existing
    else:
        tr = CardTranslation(
            card_id=card_id,
            language=language,
            status="processing",
        )
        db.add(tr)
    db.commit()
    db.refresh(tr)

    background_tasks.add_task(
        _run_translation_job,
        translation_id=tr.id,
        target_language=language,
        title=card.title,
        concise=card.concise_summary_md,
        detailed=card.detailed_summary_md,
    )
    return _to_out(tr)


@router.get(
    "/{card_id}/translations/{language}",
    response_model=CardTranslationOut,
)
def get_translation(
    card_id: UUID,
    language: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CardTranslationOut:
    _load_owned_card(db, card_id, current_user)
    tr = db.execute(
        select(CardTranslation).where(
            CardTranslation.card_id == card_id,
            CardTranslation.language == language,
        )
    ).scalar_one_or_none()
    if tr is None:
        raise HTTPException(status_code=404, detail="Translation not found")
    return _to_out(tr)


@router.delete(
    "/{card_id}/translations/{language}",
    status_code=204,
    response_class=Response,
)
def delete_translation(
    card_id: UUID,
    language: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    _load_owned_card(db, card_id, current_user)
    tr = db.execute(
        select(CardTranslation).where(
            CardTranslation.card_id == card_id,
            CardTranslation.language == language,
        )
    ).scalar_one_or_none()
    if tr is None:
        return Response(status_code=204)
    db.delete(tr)
    db.commit()
    return Response(status_code=204)
