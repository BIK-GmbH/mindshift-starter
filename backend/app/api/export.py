"""Knowledge-base export.

Streams a ZIP of one Markdown file per card, organised in folders that
mirror the user's tag hierarchy. Cards with multiple tags land under
their alphabetically-first tag's path; untagged cards land under
`_untagged/`.
"""

from __future__ import annotations

import io
import re
import zipfile
from datetime import datetime
from typing import Iterable

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.card import Card
from app.models.tag import CardTag, Tag
from app.models.transcript import Transcript
from app.models.user import User

router = APIRouter(prefix="/export", tags=["export"])


def _sanitize(name: str, max_length: int = 80) -> str:
    """Strip everything that's not safe in a file or folder name."""
    cleaned = re.sub(r"[\s\/\\<>:\"|?*]+", "-", name).strip("-_. ")
    cleaned = re.sub(r"-+", "-", cleaned) or "untitled"
    return cleaned[:max_length]


def _tag_path(tag: Tag, by_id: dict) -> str:
    """Build a slash-joined path from root → tag, sanitising each segment."""
    parts: list[str] = []
    cur: Tag | None = tag
    seen: set[str] = set()
    while cur is not None and str(cur.id) not in seen:
        seen.add(str(cur.id))
        parts.append(_sanitize(cur.name))
        cur = by_id.get(cur.parent_id) if cur.parent_id else None
    return "/".join(reversed(parts))


def _markdown_for_card(card: Card, transcript_text: str | None, tag_paths: list[str]) -> str:
    lines: list[str] = []
    lines.append(f"# {card.title}")
    lines.append("")
    lines.append(f"- Source: **{card.source_type}**")
    lines.append(f"- Status: {card.status}")
    if card.created_at:
        lines.append(f"- Created: {card.created_at.isoformat()}")
    if tag_paths:
        lines.append(f"- Tags: {', '.join('#' + p for p in tag_paths)}")
    lines.append("")
    if card.concise_summary_md:
        lines.append("## TL;DR")
        lines.append("")
        lines.append(card.concise_summary_md.strip())
        lines.append("")
    if card.key_takeaways_json:
        lines.append("## Key Takeaways")
        lines.append("")
        for item in card.key_takeaways_json:
            text = item if isinstance(item, str) else (item.get("text") if isinstance(item, dict) else None)
            if text:
                lines.append(f"- {text}")
        lines.append("")
    if card.detailed_summary_md:
        lines.append("## Summary")
        lines.append("")
        lines.append(card.detailed_summary_md.strip())
        lines.append("")
    if card.notes_md:
        lines.append("## Notes")
        lines.append("")
        lines.append(card.notes_md.strip())
        lines.append("")
    if transcript_text:
        lines.append("## Transcript")
        lines.append("")
        lines.append(transcript_text.strip())
        lines.append("")
    return "\n".join(lines)


def _build_zip_bytes(
    cards: Iterable[Card],
    transcript_by_card: dict,
    tags_by_card: dict,
    by_id: dict,
) -> bytes:
    buf = io.BytesIO()
    seen_paths: set[str] = set()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for card in cards:
            tags_for_card: list[Tag] = tags_by_card.get(card.id, [])
            tag_paths_full = [_tag_path(t, by_id) for t in tags_for_card]
            primary_folder = (
                sorted(tag_paths_full)[0] if tag_paths_full else "_untagged"
            )

            slug = _sanitize(card.title)
            base = f"{primary_folder}/{slug}.md"
            # de-duplicate filenames that collide after sanitisation
            path = base
            i = 2
            while path in seen_paths:
                path = f"{primary_folder}/{slug}-{i}.md"
                i += 1
            seen_paths.add(path)

            md = _markdown_for_card(
                card,
                transcript_by_card.get(card.id),
                tag_paths_full,
            )
            zf.writestr(path, md.encode("utf-8"))

        # Index file
        index_lines = ["# Mindshift export", ""]
        index_lines.append(f"Exported: {datetime.utcnow().isoformat()}Z")
        index_lines.append("")
        index_lines.append(f"Total cards: {len(seen_paths)}")
        zf.writestr("README.md", "\n".join(index_lines).encode("utf-8"))
    return buf.getvalue()


@router.get("/markdown")
def export_markdown(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    cards = db.execute(
        select(Card)
        .where(Card.user_id == current_user.id, Card.status == "completed")
        .order_by(Card.created_at.desc())
    ).scalars().all()

    # transcripts (one per card)
    transcript_by_card: dict = {}
    if cards:
        rows = db.execute(
            select(Transcript).where(Transcript.card_id.in_([c.id for c in cards]))
        ).scalars().all()
        transcript_by_card = {r.card_id: r.text for r in rows}

    # tag tree + per-card tag list
    tags = db.execute(
        select(Tag).where(Tag.user_id == current_user.id)
    ).scalars().all()
    by_id = {t.id: t for t in tags}

    tags_by_card: dict = {}
    if cards:
        rows = db.execute(
            select(CardTag).where(CardTag.card_id.in_([c.id for c in cards]))
        ).scalars().all()
        for ct in rows:
            tag = by_id.get(ct.tag_id)
            if tag is None:
                continue
            tags_by_card.setdefault(ct.card_id, []).append(tag)

    blob = _build_zip_bytes(cards, transcript_by_card, tags_by_card, by_id)
    filename = f"mindshift-export-{datetime.utcnow().date().isoformat()}.zip"
    return StreamingResponse(
        io.BytesIO(blob),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
