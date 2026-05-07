"""Re-run AI tagging on already-completed cards.

Useful after introducing the hierarchical tag prompt — old cards that
were tagged with the flat-tag prompt can pick up parent/child slugs and
adopt your existing top-level hierarchy.

Run from the `backend/` directory after sourcing the project `.env`:

    set -a; source ../.env; set +a
    .venv/bin/python -m app.scripts.retag_existing --user-email chris@example.com

Flags:
    --user-email   Restrict to a single user (recommended)
    --limit N      Cap number of cards
    --dry-run      Print the plan without writing or calling OpenAI
    --replace      Drop existing card_tags before attaching new ones
                   (default: merge new tags into existing set)
"""

from __future__ import annotations

import argparse
import sys

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.card import Card
from app.models.tag import CardTag
from app.models.transcript import Transcript
from app.models.user import User
from app.services.ingestion import _attach_tags, _existing_top_level_tag_names
from app.services.openai_summarizer import summarize_transcript


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Re-tag completed cards using the current hierarchical-tag prompt."
    )
    parser.add_argument("--user-email", type=str, default=None)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--replace", action="store_true")
    args = parser.parse_args(argv)

    db = SessionLocal()
    processed = 0
    skipped = 0
    failed = 0
    try:
        stmt = select(Card).where(Card.status == "completed")
        if args.user_email:
            user = db.execute(
                select(User).where(User.email == args.user_email)
            ).scalar_one_or_none()
            if user is None:
                print(f"User '{args.user_email}' not found.", file=sys.stderr)
                return 1
            stmt = stmt.where(Card.user_id == user.id)

        cards = db.execute(stmt).scalars().all()
        if args.limit is not None:
            cards = cards[: args.limit]
        print(f"Found {len(cards)} candidate card(s)")

        for card in cards:
            transcript = db.execute(
                select(Transcript).where(Transcript.card_id == card.id)
            ).scalar_one_or_none()
            text = (transcript.text if transcript else None) or card.detailed_summary_md or ""
            if not text.strip():
                skipped += 1
                print(f"  · skip {card.id} ({card.title!r}) — no text")
                continue

            try:
                if args.dry_run:
                    print(f"  · would re-tag {card.id} ({card.title!r})")
                    processed += 1
                    continue

                existing_top = _existing_top_level_tag_names(db, card.user_id)
                summary = summarize_transcript(card.title, text, existing_top_tags=existing_top)
                new_tag_paths = summary.tags or []

                if args.replace:
                    db.query(CardTag).filter(CardTag.card_id == card.id).delete()
                    db.flush()

                _attach_tags(db, card, new_tag_paths)
                db.commit()
                processed += 1
                print(
                    f"  · re-tagged {card.id} ({card.title!r}) → "
                    f"{', '.join(new_tag_paths) or '∅'}"
                )
            except Exception as exc:  # noqa: BLE001
                failed += 1
                db.rollback()
                print(f"  ! failed {card.id} ({card.title!r}): {exc}", file=sys.stderr)
    finally:
        db.close()

    print(
        f"\nDone — processed={processed} skipped={skipped} failed={failed} "
        f"({'dry-run' if args.dry_run else 'committed'})"
    )
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
