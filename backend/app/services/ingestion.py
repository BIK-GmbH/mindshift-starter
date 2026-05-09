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
from app.services.github import build_summary_block, fetch_repo
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


def process_note_card(card_id: UUID, job_id: UUID, body: str, summarize: bool) -> None:
    """Persist a user-authored note as a card.

    The note body becomes the transcript text. Summary + tags + entities are
    optional — caller decides via the `summarize` flag.
    """
    with _job_context(card_id, job_id) as ctx:
        if ctx is None:
            return
        db, card, job = ctx

        text = (body or "").strip()
        if not text:
            # An empty note is fine — title alone is the content.
            text = card.title

        db.add(
            Transcript(
                card_id=card.id,
                language=None,
                text=text,
                segments_json=None,
                provider="note",
            )
        )
        db.commit()

        if summarize:
            _summarize_and_attach(db, card, text)
        else:
            # Persist a tiny "summary" so the UI still shows the note body
            # in the summary tab without an OpenAI round-trip.
            card.concise_summary_md = text[:1000] + ("…" if len(text) > 1000 else "")
            card.detailed_summary_md = text
            _attach_embeddings(db, card, text, card.concise_summary_md)
            db.commit()
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
        if article.image_url:
            card.thumbnail_url = article.image_url
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


def process_github_card(card_id: UUID, job_id: UUID, url: str) -> None:
    """Fetch a GitHub repo's metadata + README and run the summarization pipeline."""
    with _job_context(card_id, job_id) as ctx:
        if ctx is None:
            return
        db, card, job = ctx

        repo = fetch_repo(url)
        if repo is None:
            _mark_failed(
                db,
                card,
                job,
                "Could not fetch GitHub repository (private, deleted, or rate-limited).",
            )
            return

        # Title prefers description; falls back to "owner/repo".
        card.title = repo.description or repo.full_name
        card.thumbnail_url = repo.thumbnail_url

        # Persist structured metadata on the source row so the frontend
        # can show stars/forks/topics without re-fetching.
        if card.source_id:
            from app.models.source import Source

            src = db.get(Source, card.source_id)
            if src is not None:
                src.metadata_json = {
                    "owner": repo.owner,
                    "repo": repo.repo,
                    "full_name": repo.full_name,
                    "description": repo.description,
                    "homepage": repo.homepage,
                    "default_branch": repo.default_branch,
                    "language": repo.language,
                    "languages": repo.languages,
                    "topics": repo.topics,
                    "stars": repo.stars,
                    "forks": repo.forks,
                    "license": repo.license_name,
                }
        db.commit()

        text = build_summary_block(repo)
        db.add(
            Transcript(
                card_id=card.id,
                language="en",
                text=text,
                segments_json=None,
                provider="github-api",
            )
        )
        db.commit()

        _summarize_and_attach(db, card, text)
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
    existing_top_tags = _existing_top_level_tag_names(db, card.user_id)
    summary = summarize_transcript(card.title, text, existing_top_tags=existing_top_tags)
    card.concise_summary_md = summary.concise_summary_md
    card.detailed_summary_md = summary.detailed_summary_md
    card.key_takeaways_json = summary.key_takeaways
    _attach_tags(db, card, summary.tags)
    _attach_entities(db, card, summary.entities)
    _attach_quiz(db, card, summary.quiz_questions)
    _attach_embeddings(db, card, text, summary.concise_summary_md)


def _existing_top_level_tag_names(db: Session, user_id: UUID, limit: int = 30) -> list[str]:
    """The user's most-used top-level tags. Used as context for the OpenAI prompt."""
    from sqlalchemy import func

    rows = db.execute(
        select(Tag.name, func.count(CardTag.card_id).label("c"))
        .outerjoin(CardTag, CardTag.tag_id == Tag.id)
        .where(Tag.user_id == user_id, Tag.parent_id.is_(None))
        .group_by(Tag.id, Tag.name)
        .order_by(func.count(CardTag.card_id).desc(), Tag.name)
        .limit(limit)
    ).all()
    return [name for name, _ in rows]


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
    """Attach AI-suggested tags to a card.

    Supports hierarchical paths via `/`, e.g. `finance/investment` creates
    `finance` (parent) + `investment` (child of finance), and the card is
    attached to the leaf (`investment`).

    Existing tags are reused. If an existing leaf tag has no parent yet,
    we adopt the AI's suggested parent — but we never overwrite a
    user-set parent.
    """
    for raw in tag_names:
        # Slash-path: "finance/investment" → ["finance", "investment"]
        parts = [
            _slugify_tag(p)
            for p in str(raw).split("/")
            if _slugify_tag(p)
        ]
        if not parts:
            continue

        parent_id: UUID | None = None
        leaf_tag: Tag | None = None
        for part in parts:
            existing = db.execute(
                select(Tag).where(Tag.user_id == card.user_id, Tag.name == part)
            ).scalar_one_or_none()
            if existing is None:
                tag = Tag(user_id=card.user_id, name=part, parent_id=parent_id)
                db.add(tag)
                db.flush()
                leaf_tag = tag
                parent_id = tag.id
                continue

            # Re-use existing tag. Adopt the AI's suggested parent only if
            # the user hasn't manually placed it somewhere already.
            if existing.parent_id is None and parent_id is not None and parent_id != existing.id:
                existing.parent_id = parent_id
                db.flush()
            leaf_tag = existing
            parent_id = existing.id

        if leaf_tag is not None:
            db.merge(CardTag(card_id=card.id, tag_id=leaf_tag.id))


def _slugify_tag(s: str) -> str:
    """Normalise a tag fragment: lowercase, trim, no internal whitespace."""
    return s.strip().lower().replace(" ", "-")


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
        # Normalise the choices array: keep up to 3 unique non-empty
        # strings, drop anything matching the answer (case-insensitive).
        raw_choices = q.get("choices") or []
        seen: set[str] = {answer.lower()}
        choices: list[str] = []
        for c in raw_choices:
            if not isinstance(c, str):
                continue
            cs = c.strip()
            key = cs.lower()
            if not cs or key in seen:
                continue
            seen.add(key)
            choices.append(cs)
            if len(choices) >= 3:
                break
        db.add(
            QuizQuestion(
                card_id=card.id,
                question=question,
                answer=answer,
                question_type=(q.get("question_type") or "open").strip().lower(),
                difficulty=(q.get("difficulty") or None),
                choices_json=choices or None,
            )
        )
