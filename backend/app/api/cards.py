from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.card import Card
from app.models.job import Job
from app.models.quiz import QuizQuestion
from app.models.source import Source
from app.models.transcript import Transcript
from app.models.user import User
from app.schemas.card import (
    CardListItem,
    CardOut,
    CardUpdate,
    FromNoteRequest,
    FromUrlRequest,
    FromYouTubeRequest,
    IngestionResponse,
    JobOut,
    NotesUpdate,
    QuizQuestionOut,
)
from app.schemas.graph import ConnectionOut, ReasonOut
from app.services.connections import get_connections
from app.services.export import card_to_markdown
from app.services.github import parse_repo_url as parse_github_url
from app.services.ingestion import (
    process_article_card,
    process_github_card,
    process_note_card,
    process_pdf_card,
    process_youtube_card,
)
from app.services.storage import get_storage
from app.services.youtube import extract_video_id

MAX_PDF_BYTES = 25 * 1024 * 1024

router = APIRouter(prefix="/cards", tags=["cards"])


@router.post("/from-youtube", response_model=IngestionResponse, status_code=status.HTTP_201_CREATED)
def create_card_from_youtube(
    payload: FromYouTubeRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> IngestionResponse:
    url = str(payload.url)
    video_id = extract_video_id(url)
    if video_id is None:
        raise HTTPException(status_code=400, detail="Could not parse YouTube video ID from URL")

    source = Source(
        source_type="youtube",
        url=url,
        canonical_url=f"https://www.youtube.com/watch?v={video_id}",
        external_id=video_id,
    )
    db.add(source)
    db.flush()

    card = Card(
        user_id=current_user.id,
        source_id=source.id,
        title=f"YouTube {video_id}",
        source_type="youtube",
        status="queued",
    )
    db.add(card)
    db.flush()

    job = Job(card_id=card.id, job_type="youtube_ingest", status="queued")
    db.add(job)
    db.commit()
    db.refresh(card)
    db.refresh(job)

    background_tasks.add_task(process_youtube_card, card.id, job.id, video_id)

    return IngestionResponse(card=CardOut.model_validate(card), job=JobOut.model_validate(job))


@router.post("/from-url", response_model=IngestionResponse, status_code=status.HTTP_201_CREATED)
def create_card_from_url(
    payload: FromUrlRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> IngestionResponse:
    url = str(payload.url)

    # Auto-route well-known URL shapes to their dedicated importers so
    # the caller (web share-target, browser extension, third-party
    # scripts) doesn't need to pick a type. Order matters: YouTube and
    # GitHub URLs would otherwise fall through to the article pipeline
    # and produce a useless "scrape the watch page" result.
    if extract_video_id(url) is not None:
        return create_card_from_youtube(payload, background_tasks, current_user, db)
    if parse_github_url(url):
        return _create_github_card(url, background_tasks, current_user, db)

    source = Source(source_type="article", url=url, canonical_url=url)
    db.add(source)
    db.flush()

    card = Card(
        user_id=current_user.id,
        source_id=source.id,
        title=url,
        source_type="article",
        status="queued",
    )
    db.add(card)
    db.flush()

    job = Job(card_id=card.id, job_type="article_ingest", status="queued")
    db.add(job)
    db.commit()
    db.refresh(card)
    db.refresh(job)

    background_tasks.add_task(process_article_card, card.id, job.id, url)
    return IngestionResponse(card=CardOut.model_validate(card), job=JobOut.model_validate(job))


@router.post("/from-github", response_model=IngestionResponse, status_code=status.HTTP_201_CREATED)
def create_card_from_github(
    payload: FromUrlRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> IngestionResponse:
    url = str(payload.url)
    if not parse_github_url(url):
        raise HTTPException(status_code=400, detail="Not a valid GitHub repository URL.")
    return _create_github_card(url, background_tasks, current_user, db)


def _create_github_card(
    url: str,
    background_tasks: BackgroundTasks,
    current_user: User,
    db: Session,
) -> IngestionResponse:
    parsed = parse_github_url(url)
    assert parsed is not None  # caller guarantees this
    owner, repo = parsed
    full = f"{owner}/{repo}"
    canonical = f"https://github.com/{full}"

    source = Source(
        source_type="github",
        url=url,
        canonical_url=canonical,
        external_id=full,
    )
    db.add(source)
    db.flush()

    card = Card(
        user_id=current_user.id,
        source_id=source.id,
        # Placeholder until ingestion sets a proper title; using the
        # full_name keeps the queued card identifiable in the library.
        title=full,
        source_type="github",
        status="queued",
    )
    db.add(card)
    db.flush()

    job = Job(card_id=card.id, job_type="github_ingest", status="queued")
    db.add(job)
    db.commit()
    db.refresh(card)
    db.refresh(job)

    background_tasks.add_task(process_github_card, card.id, job.id, url)
    return IngestionResponse(card=CardOut.model_validate(card), job=JobOut.model_validate(job))


@router.post("/from-pdf", response_model=IngestionResponse, status_code=status.HTTP_201_CREATED)
async def create_card_from_pdf(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> IngestionResponse:
    if file.content_type not in {"application/pdf", "application/x-pdf"}:
        raise HTTPException(status_code=400, detail="File must be a PDF")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(content) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="PDF exceeds 25 MB limit")

    filename = file.filename or "document.pdf"

    # Persist the original first, so re-processing and "Download
    # original" stay possible. The dedupe in storage means the same PDF
    # uploaded twice doesn't double the disk usage.
    storage = get_storage()
    saved = storage.save(
        db,
        user_id=current_user.id,
        content=content,
        original_filename=filename,
        content_type=file.content_type or "application/pdf",
        purpose="pdf",
    )

    source = Source(
        source_type="pdf",
        url=f"upload://{filename}",
        external_id=filename,
        metadata_json={"size_bytes": len(content), "content_type": file.content_type},
    )
    db.add(source)
    db.flush()

    card = Card(
        user_id=current_user.id,
        source_id=source.id,
        title=(title or filename).strip() or filename,
        source_type="pdf",
        status="queued",
        original_file_id=saved.id,
    )
    db.add(card)
    db.flush()

    job = Job(card_id=card.id, job_type="pdf_ingest", status="queued")
    db.add(job)
    db.commit()
    db.refresh(card)
    db.refresh(job)

    background_tasks.add_task(process_pdf_card, card.id, job.id, content, filename)
    return IngestionResponse(card=CardOut.model_validate(card), job=JobOut.model_validate(job))


@router.post("/from-note", response_model=IngestionResponse, status_code=status.HTTP_201_CREATED)
def create_card_from_note(
    payload: FromNoteRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> IngestionResponse:
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")

    source = Source(source_type="note", url=f"note://{current_user.id}/{title}", external_id=None)
    db.add(source)
    db.flush()

    card = Card(
        user_id=current_user.id,
        source_id=source.id,
        title=title,
        source_type="note",
        status="queued",
    )
    db.add(card)
    db.flush()

    job = Job(card_id=card.id, job_type="note_ingest", status="queued")
    db.add(job)
    db.commit()
    db.refresh(card)
    db.refresh(job)

    background_tasks.add_task(process_note_card, card.id, job.id, payload.body, payload.summarize)
    return IngestionResponse(card=CardOut.model_validate(card), job=JobOut.model_validate(job))


@router.get("", response_model=list[CardListItem])
def list_cards(
    q: str | None = Query(default=None, description="Keyword search over title/summary/notes"),
    status_filter: str | None = Query(default=None, alias="status"),
    tag: str | None = Query(default=None),
    untagged: bool = Query(default=False),
    source_type: str | None = Query(default=None),
    sort: str = Query(default="newest", pattern="^(newest|oldest|title)$"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Card]:
    from app.models.tag import CardTag, Tag

    stmt = select(Card).where(Card.user_id == current_user.id)
    if status_filter:
        stmt = stmt.where(Card.status == status_filter)
    if source_type:
        stmt = stmt.where(Card.source_type == source_type)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                Card.title.ilike(like),
                Card.concise_summary_md.ilike(like),
                Card.detailed_summary_md.ilike(like),
                Card.notes_md.ilike(like),
            )
        )
    if tag:
        stmt = stmt.join(CardTag, CardTag.card_id == Card.id).join(Tag, Tag.id == CardTag.tag_id).where(
            Tag.name == tag.lower()
        )
    if untagged:
        stmt = stmt.where(~Card.id.in_(select(CardTag.card_id)))

    order = {
        "newest": Card.created_at.desc(),
        "oldest": Card.created_at.asc(),
        "title": Card.title.asc(),
    }[sort]
    stmt = stmt.order_by(order)
    return list(db.execute(stmt).scalars().all())


def _public_state_for_card(db: Session, card: Card) -> tuple[bool, list[str]]:
    """Names of public tags that make this card publicly reachable.

    Walks each public tag tree and checks whether the card sits in it.
    Returns (is_public, [public_tag_path]).
    """
    from app.api.public import _walk_public_subtree, _slug_path
    from app.models.tag import CardTag, Tag

    roots = db.execute(
        select(Tag).where(Tag.user_id == card.user_id, Tag.is_public.is_(True))
    ).scalars().all()
    if not roots:
        return False, []

    card_tag_ids = set(
        db.execute(
            select(CardTag.tag_id).where(CardTag.card_id == card.id)
        ).scalars().all()
    )
    if not card_tag_ids:
        return False, []

    paths: list[str] = []
    for root in roots:
        subtree = _walk_public_subtree(db, card.user_id, root)
        if card_tag_ids & subtree:
            paths.append(_slug_path(db, card.user_id, root))
    return bool(paths), sorted(paths)


def _card_response(db: Session, card: Card) -> CardOut:
    is_public, paths = _public_state_for_card(db, card)
    out = CardOut.model_validate(card)
    out.is_public = is_public
    out.public_via_tags = paths
    # Resolve tag names attached to this card.
    from app.models.tag import CardTag, Tag

    tag_rows = (
        db.execute(
            select(Tag.name)
            .join(CardTag, CardTag.tag_id == Tag.id)
            .where(CardTag.card_id == card.id)
            .order_by(Tag.name.asc())
        )
        .scalars()
        .all()
    )
    out.tags = list(tag_rows)
    # Source — needed by the front-end to embed YouTube / link out.
    if card.source_id:
        from app.models.source import Source

        s = db.get(Source, card.source_id)
        if s is not None:
            out.source_url = s.canonical_url or s.url
            out.external_id = s.external_id
            out.source_metadata = s.metadata_json
    return out


@router.get("/{card_id}", response_model=CardOut)
def get_card(
    card_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CardOut:
    card = _get_owned_card(db, card_id, current_user.id)
    return _card_response(db, card)


@router.patch("/{card_id}", response_model=CardOut)
def update_card(
    card_id: UUID,
    payload: CardUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CardOut:
    card = _get_owned_card(db, card_id, current_user.id)
    if payload.title is not None:
        card.title = payload.title
    if payload.notes_md is not None:
        card.notes_md = payload.notes_md
    db.commit()
    db.refresh(card)
    return _card_response(db, card)


@router.patch("/{card_id}/notes", response_model=CardOut)
def update_notes(
    card_id: UUID,
    payload: NotesUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CardOut:
    card = _get_owned_card(db, card_id, current_user.id)
    card.notes_md = payload.notes_md
    db.commit()
    db.refresh(card)
    return _card_response(db, card)


@router.delete("/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_card(
    card_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    card = _get_owned_card(db, card_id, current_user.id)

    # If this card owned an original upload that nothing else references,
    # drop the bytes from storage too. Other rows can still reference the
    # same File via dedupe — we only delete when no card points at it.
    file_id = card.original_file_id
    db.delete(card)
    db.flush()
    if file_id is not None:
        from app.models.file import File as FileModel
        from app.services.storage import get_storage

        still_referenced = db.execute(
            select(Card.id).where(Card.original_file_id == file_id)
        ).first()
        if still_referenced is None:
            file_record = db.get(FileModel, file_id)
            if file_record is not None:
                get_storage().delete(db, file_record)
    db.commit()


@router.post("/{card_id}/regenerate", response_model=IngestionResponse)
def regenerate_card(
    card_id: UUID,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> IngestionResponse:
    """Re-run the ingestion pipeline for an existing card (typically a failed one).

    PDF cards re-ingest from the persisted original file (only available
    for cards uploaded after storage was introduced in phase 27).
    """
    card = _get_owned_card(db, card_id, current_user.id)
    source = db.get(Source, card.source_id) if card.source_id else None

    card.status = "queued"
    card.error_message = None
    job = Job(card_id=card.id, job_type=f"{card.source_type}_reingest", status="queued")
    db.add(job)
    db.commit()
    db.refresh(card)
    db.refresh(job)

    if card.source_type == "pdf":
        if card.original_file_id is None:
            raise HTTPException(
                status_code=400,
                detail="This PDF was uploaded before storage was added — please upload it again.",
            )
        from app.models.file import File as FileModel
        from app.services.storage import get_storage

        file_record = db.get(FileModel, card.original_file_id)
        if file_record is None:
            raise HTTPException(status_code=410, detail="Original PDF is no longer in storage")
        pdf_bytes = get_storage().read(file_record)
        background_tasks.add_task(
            process_pdf_card, card.id, job.id, pdf_bytes, file_record.original_filename
        )
    elif source is None or not source.url:
        raise HTTPException(status_code=400, detail="Card has no original source URL")
    elif card.source_type == "youtube":
        external_id = source.external_id or extract_video_id(source.url)
        if not external_id:
            raise HTTPException(status_code=400, detail="Could not parse YouTube video ID")
        background_tasks.add_task(process_youtube_card, card.id, job.id, external_id)
    elif card.source_type == "article":
        background_tasks.add_task(process_article_card, card.id, job.id, source.url)
    elif card.source_type == "github":
        background_tasks.add_task(process_github_card, card.id, job.id, source.url)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown source type: {card.source_type}")

    return IngestionResponse(card=CardOut.model_validate(card), job=JobOut.model_validate(job))


@router.get("/{card_id}/transcript")
def get_transcript(
    card_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    card = _get_owned_card(db, card_id, current_user.id)
    transcript = db.execute(
        select(Transcript).where(Transcript.card_id == card.id).order_by(Transcript.created_at.desc())
    ).scalar_one_or_none()
    if transcript is None:
        raise HTTPException(status_code=404, detail="No transcript available")
    return {
        "card_id": str(card.id),
        "language": transcript.language,
        "provider": transcript.provider,
        "text": transcript.text,
    }


@router.get("/{card_id}/export.md")
def export_card_markdown(
    card_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    card = _get_owned_card(db, card_id, current_user.id)
    body = card_to_markdown(db, card)
    safe_title = "".join(c if c.isalnum() or c in "-_ " else "_" for c in card.title)[:80].strip() or "card"
    filename = f"{safe_title}.md"
    return Response(
        content=body,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{card_id}/connections", response_model=list[ConnectionOut])
def card_connections(
    card_id: UUID,
    limit: int = Query(default=10, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ConnectionOut]:
    _get_owned_card(db, card_id, current_user.id)
    connections = get_connections(db, current_user.id, card_id, limit=limit)
    return [
        ConnectionOut(
            card_id=c.card_id,
            title=c.title,
            source_type=c.source_type,
            thumbnail_url=c.thumbnail_url,
            tags=c.tags,
            score=c.score,
            reasons=[ReasonOut(kind=r.kind, label=r.label, weight=r.weight) for r in c.reasons],
        )
        for c in connections
    ]


@router.get("/{card_id}/quiz", response_model=list[QuizQuestionOut])
def list_quiz_questions(
    card_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[QuizQuestion]:
    card = _get_owned_card(db, card_id, current_user.id)
    return list(
        db.execute(
            select(QuizQuestion)
            .where(QuizQuestion.card_id == card.id)
            .order_by(QuizQuestion.created_at.asc())
        ).scalars().all()
    )


def _get_owned_card(db: Session, card_id: UUID, user_id: UUID) -> Card:
    card = db.get(Card, card_id)
    if card is None or card.user_id != user_id:
        raise HTTPException(status_code=404, detail="Card not found")
    return card
