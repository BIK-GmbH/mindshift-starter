"""Idempotent backfill of embeddings for completed cards.

Run from the backend/ directory after sourcing the project .env:

    set -a; source ../.env; set +a
    .venv/bin/python -m app.scripts.backfill_embeddings

Or with --dry-run to see what would change:

    .venv/bin/python -m app.scripts.backfill_embeddings --dry-run
"""

from __future__ import annotations

import argparse
import sys

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.card import Card
from app.models.embedding import Embedding
from app.models.transcript import Transcript
from app.services.embeddings import chunk_text, embed_texts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Backfill embeddings for completed cards.")
    parser.add_argument("--dry-run", action="store_true", help="Print plan without writing.")
    parser.add_argument("--limit", type=int, default=None, help="Cap number of cards to process.")
    args = parser.parse_args(argv)

    db = SessionLocal()
    processed = 0
    skipped = 0
    failed = 0

    try:
        cards = db.execute(select(Card).where(Card.status == "completed")).scalars().all()
        if args.limit is not None:
            cards = cards[: args.limit]

        print(f"Found {len(cards)} completed cards.")

        for card in cards:
            existing = db.execute(
                select(Embedding.id).where(Embedding.card_id == card.id).limit(1)
            ).first()
            if existing:
                skipped += 1
                continue

            transcript = db.execute(
                select(Transcript)
                .where(Transcript.card_id == card.id)
                .order_by(Transcript.created_at.desc())
            ).scalar_one_or_none()
            if transcript is None or not transcript.text:
                print(f"  - skip (no transcript): {card.title[:60]}")
                skipped += 1
                continue

            chunks = chunk_text(transcript.text)
            payloads: list[tuple[str, int, str]] = [
                ("transcript", c.index, c.text) for c in chunks
            ]
            if card.concise_summary_md and card.concise_summary_md.strip():
                payloads.append(("summary", 0, card.concise_summary_md.strip()))

            if not payloads:
                skipped += 1
                continue

            print(
                f"  + {'(dry-run) ' if args.dry_run else ''}"
                f"{len(payloads)} chunks: {card.title[:60]}"
            )

            if args.dry_run:
                continue

            try:
                vectors = embed_texts([p[2] for p in payloads])
            except Exception as exc:  # noqa: BLE001
                print(f"    ! embedding failed: {exc}", file=sys.stderr)
                failed += 1
                continue

            for (chunk_type, chunk_index, chunk_text_value), vec in zip(
                payloads, vectors, strict=True
            ):
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
            processed += 1

        print(
            f"\nDone — processed: {processed}, skipped: {skipped}, failed: {failed}"
            + (" (dry-run)" if args.dry_run else "")
        )
        return 0 if failed == 0 else 1
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
