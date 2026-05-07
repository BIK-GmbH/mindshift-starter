"""Background ingestion pipelines for cards (YouTube, PDF, articles)."""

from __future__ import annotations

import logging
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.card import Card
from app.models.embedding import Embedding
from app.models.entity import CardEntity, Entity
from app.models.job import Job
from app.models.quiz import QuizQuestion
from app.models.tag import CardTag, Tag
from app.models.transcript import Transcript
from app.services.article import fetch_article
from app.services.embeddings import chunk_text, embed_texts
from app.services.openai_summarizer import summarize_transcript
from app.services.pdf import extract_pdf
from app.services.youtube import fetch_metadata, fetch_transcript

logger = logging.getLogger(__name__)


def process_youtube_card(card_id: UUID, job_id: UUID, video_id: str) -> None:
    """Run the full ingestion pipeline for a freshly created YouTube card."""
    with _job_context(card_id, job_id) as ctx:
        if ctx is None:
            return
        db, card, job = ctx

        metadata = fetch_metadata(video_id)
        card.title = metadata.title
        card.thumbnail_url = metadata.thumbnail_url
        db.commit()

        transcript_result = fetch_transcript(video_id)
        if transcript_result is None:
            _mark_failed(db, card, job, "No transcript/captions available for this video.")
            return

        db.add(
            Transcript(
                card_id=card.id,
                language=transcript_result.language,
                text=transcript_result.text,
                segments_json=transcript_result.segments,
                provider=transcript_result.provider,
            )
        )
        db.commit()

        _summarize_and_attach(db, card, transcript_result.text)
        _mark_completed(db, card, job)


def process_pdf_card(card_id: UUID, job_id: UUID, pdf_bytes: bytes, filename: str) -> None:
    """Extract a PDF and run the same summarization pipeline."""
    with _job_context(card_id, job_id) as ctx:
        if ctx is None:
            return
        db, card, job = ctx

        result = extract_pdf(pdf_bytes, fallback_title=filename)
        if not result.text:
            _mark_failed(db, card, job, "Could not extract any text from this PDF.")
            return

        card.title = result.title or filename
        db.commit()

        db.add(
            Transcript(
                card_id=card.id,
                language=None,
                text=result.text,
                segments_json=None,
                provider="pypdf",
            )
        )
        db.commit()

        _summarize_and_attach(db, card, result.text)
        _mark_completed(db, card, job)


def process_article_card(card_id: UUID, job_id: UUID, url: str) -> None:
    """Fetch a web article and run the summarization pipeline."""
    with _job_context(card_id, job_id) as ctx:
        if ctx is None:
            return
        db, card, job = ctx

        article = fetch_article(url)
        if article is None:
            _mark_failed(db, card, job, "Could not extract article content from this URL.")
            return

        if article.title:
            card.title = article.title
        db.commit()

        db.add(
            Transcript(
                card_id=card.id,
                language=article.language,
                text=article.text,
                segments_json=None,
                provider="trafilatura",
            )
        )
        db.commit()

        _summarize_and_attach(db, card, article.text)
        _mark_completed(db, card, job)


# --- Helpers --------------------------------------------------------------


from contextlib import contextmanager  # noqa: E402  (kept near helpers for locality)


@contextmanager
def _job_context(card_id: UUID, job_id: UUID):
    """Yield (db, card, job) marked as processing; on exception mark failed; always close."""
    db: Session = SessionLocal()
    try:
        card = db.get(Card, card_id)
        job = db.get(Job, job_id)
        if card is None or job is None:
            logger.warning("Ingestion target missing (card=%s, job=%s)", card_id, job_id)
            yield None
            return

        card.status = "processing"
        job.status = "processing"
        db.commit()

        try:
            yield db, card, job
        except Exception as exc:  # noqa: BLE001
            logger.exception("Ingestion failed for card %s", card_id)
            _mark_failed(db, card, job, str(exc)[:2000])
    finally:
        db.close()


def _summarize_and_attach(db: Session, card: Card, text: str) -> None:
    summary = summarize_transcript(card.title, text)
    card.concise_summary_md = summary.concise_summary_md
    card.detailed_summary_md = summary.detailed_summary_md
    card.key_takeaways_json = summary.key_takeaways
    _attach_tags(db, card, summary.tags)
    _attach_entities(db, card, summary.entities)
    _attach_quiz(db, card, summary.quiz_questions)
    _attach_embeddings(db, card, text, summary.concise_summary_md)


def _attach_embeddings(db: Session, card: Card, source_text: str, concise_summary: str | None) -> None:
    chunks = chunk_text(source_text)
    payloads: list[tuple[str, int, str]] = [("transcript", c.index, c.text) for c in chunks]
    if concise_summary and concise_summary.strip():
        payloads.append(("summary", 0, concise_summary.strip()))
    if not payloads:
        return

    try:
        vectors = embed_texts([p[2] for p in payloads])
    except Exception:
        logger.exception("Embedding generation failed for card %s", card.id)
        return

    for (chunk_type, chunk_index, chunk_text_value), vec in zip(payloads, vectors, strict=True):
        db.add(
            Embedding(
                card_id=card.id,
                chunk_type=chunk_type,
                chunk_index=chunk_index,
                chunk_text=chunk_text_value,
                embedding=vec,
            )
        )
    db.commit()


def _mark_completed(db: Session, card: Card, job: Job) -> None:
    card.status = "completed"
    card.error_message = None
    job.status = "completed"
    job.error_message = None
    db.commit()


def _mark_failed(db: Session, card: Card, job: Job, message: str) -> None:
    card.status = "failed"
    card.error_message = message
    job.status = "failed"
    job.error_message = message
    db.commit()


def _attach_tags(db: Session, card: Card, tag_names: list[str]) -> None:
    for raw in tag_names:
        name = raw.strip().lower()
        if not name:
            continue
        existing = db.execute(
            select(Tag).where(Tag.user_id == card.user_id, Tag.name == name)
        ).scalar_one_or_none()
        tag = existing or Tag(user_id=card.user_id, name=name)
        if existing is None:
            db.add(tag)
            db.flush()
        db.merge(CardTag(card_id=card.id, tag_id=tag.id))


def _attach_entities(db: Session, card: Card, entities: list[dict]) -> None:
    for ent in entities:
        name = (ent.get("name") or "").strip()
        if not name:
            continue
        entity_type = (ent.get("entity_type") or "concept").strip().lower()
        existing = db.execute(
            select(Entity).where(Entity.name == name, Entity.entity_type == entity_type)
        ).scalar_one_or_none()
        entity = existing or Entity(
            name=name,
            entity_type=entity_type,
            description=(ent.get("description") or None),
        )
        if existing is None:
            db.add(entity)
            db.flush()
        db.merge(
            CardEntity(
                card_id=card.id,
                entity_id=entity.id,
                relevance_score=float(ent.get("relevance_score") or 0.5),
            )
        )


def _attach_quiz(db: Session, card: Card, quiz_questions: list[dict]) -> None:
    for q in quiz_questions:
        question = (q.get("question") or "").strip()
        answer = (q.get("answer") or "").strip()
        if not question or not answer:
            continue
        db.add(
            QuizQuestion(
                card_id=card.id,
                question=question,
                answer=answer,
                question_type=(q.get("question_type") or "open").strip().lower(),
                difficulty=(q.get("difficulty") or None),
            )
        )
