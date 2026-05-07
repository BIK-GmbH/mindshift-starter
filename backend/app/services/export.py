"""Card → Markdown export."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.card import Card
from app.models.quiz import QuizQuestion
from app.models.source import Source
from app.models.tag import CardTag, Tag


def card_to_markdown(db: Session, card: Card) -> str:
    """Render a card as a self-contained Markdown document."""
    source = db.get(Source, card.source_id) if card.source_id else None
    tags = db.execute(
        select(Tag.name)
        .join(CardTag, CardTag.tag_id == Tag.id)
        .where(CardTag.card_id == card.id)
        .order_by(Tag.name)
    ).scalars().all()
    quiz = db.execute(
        select(QuizQuestion)
        .where(QuizQuestion.card_id == card.id)
        .order_by(QuizQuestion.created_at)
    ).scalars().all()

    parts: list[str] = []
    parts.append(f"# {card.title}\n")

    meta_lines: list[str] = []
    meta_lines.append(f"- **Source type:** {card.source_type}")
    if source and source.url:
        url = source.canonical_url or source.url
        if url.startswith("http"):
            meta_lines.append(f"- **Source URL:** [{url}]({url})")
        else:
            meta_lines.append(f"- **Source:** {url}")
    meta_lines.append(f"- **Created:** {_fmt_date(card.created_at)}")
    meta_lines.append(f"- **Updated:** {_fmt_date(card.updated_at)}")
    if tags:
        meta_lines.append(f"- **Tags:** {', '.join(tags)}")
    parts.append("\n".join(meta_lines) + "\n")

    if card.concise_summary_md:
        parts.append("## TL;DR\n\n" + card.concise_summary_md.strip() + "\n")

    if card.key_takeaways_json:
        parts.append("## Key takeaways\n")
        parts.append("\n".join(f"- {t}" for t in card.key_takeaways_json) + "\n")

    if card.detailed_summary_md:
        parts.append("## Summary\n\n" + card.detailed_summary_md.strip() + "\n")

    if card.notes_md and card.notes_md.strip():
        parts.append("## Notes\n\n" + card.notes_md.strip() + "\n")

    if quiz:
        parts.append("## Quiz\n")
        for i, q in enumerate(quiz, start=1):
            parts.append(f"**{i}. {q.question}**\n")
            parts.append(f"> {q.answer}\n")

    parts.append("---\n*Exported from Mindshift on " + _fmt_date(datetime.now(tz=timezone.utc)) + "*\n")
    return "\n".join(parts)


def _fmt_date(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M UTC")
