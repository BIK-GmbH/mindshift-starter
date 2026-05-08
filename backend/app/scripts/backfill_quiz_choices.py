"""Idempotent backfill of multiple-choice distractors for existing quiz questions.

Generates 3 plausible-but-wrong choices per question via OpenAI and writes them
to `quiz_questions.choices_json`. Skips questions that already have choices.

Run from the backend/ directory after sourcing the project .env:

    set -a; source ../.env; set +a
    .venv/bin/python -m app.scripts.backfill_quiz_choices

Or with --dry-run to see what would change without calling the API:

    .venv/bin/python -m app.scripts.backfill_quiz_choices --dry-run
"""

from __future__ import annotations

import argparse
import json
import sys

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.card import Card
from app.models.quiz import QuizQuestion


DISTRACTOR_PROMPT = """You write multiple-choice distractors.

Given a quiz QUESTION and its correct ANSWER (and optional CONTEXT for the
topic), produce exactly 3 plausible but WRONG alternative answers.

Rules:
- Each distractor must be clearly wrong, but believable to someone who
  half-remembers the topic.
- Match the style, length and granularity of the correct answer.
- Do NOT repeat the correct answer or paraphrase it.
- Do NOT include letter prefixes (A/B/C), numbering, or explanations.
- Same language as the question and answer.

Return strict JSON: {"choices": ["distractor 1", "distractor 2", "distractor 3"]}
"""


def _generate_choices(client, model: str, question: str, answer: str, context: str) -> list[str]:
    user_msg = (
        f"QUESTION: {question}\n"
        f"ANSWER: {answer}\n"
        f"CONTEXT: {context[:1500]}"
    )
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": DISTRACTOR_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        response_format={"type": "json_object"},
    )
    content = response.choices[0].message.content or "{}"
    data = json.loads(content)
    raw = data.get("choices") or []

    seen: set[str] = {answer.strip().lower()}
    cleaned: list[str] = []
    for c in raw:
        if not isinstance(c, str):
            continue
        s = c.strip()
        if not s or s.lower() in seen:
            continue
        seen.add(s.lower())
        cleaned.append(s)
        if len(cleaned) == 3:
            break
    return cleaned


def _card_context(db: Session, card_id) -> str:
    card = db.execute(select(Card).where(Card.id == card_id)).scalar_one_or_none()
    if card is None:
        return ""
    return (card.concise_summary_md or card.title or "").strip()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Backfill MC choices for quiz questions.")
    parser.add_argument("--dry-run", action="store_true", help="Print plan without writing.")
    parser.add_argument("--limit", type=int, default=None, help="Cap number of questions.")
    args = parser.parse_args(argv)

    settings = get_settings()
    if not args.dry_run and not settings.openai_api_key:
        print("OPENAI_API_KEY not configured", file=sys.stderr)
        return 1

    client = None
    if not args.dry_run:
        from openai import OpenAI

        client = OpenAI(api_key=settings.openai_api_key)

    db = SessionLocal()
    processed = 0
    skipped = 0
    failed = 0

    try:
        questions = db.execute(
            select(QuizQuestion)
            .where(QuizQuestion.choices_json.is_(None))
            .order_by(QuizQuestion.created_at.asc())
        ).scalars().all()
        if args.limit is not None:
            questions = questions[: args.limit]

        print(f"Found {len(questions)} questions without choices.")

        for q in questions:
            preview = q.question[:60].replace("\n", " ")
            if args.dry_run:
                print(f"  + (dry-run) {preview}")
                processed += 1
                continue

            context = _card_context(db, q.card_id)
            try:
                choices = _generate_choices(
                    client,
                    settings.openai_model,
                    q.question,
                    q.answer,
                    context,
                )
            except Exception as exc:  # noqa: BLE001
                print(f"    ! generation failed for {q.id}: {exc}", file=sys.stderr)
                failed += 1
                continue

            if len(choices) < 3:
                print(f"    ! got only {len(choices)} valid choices for {q.id}, skipping", file=sys.stderr)
                skipped += 1
                continue

            q.choices_json = choices
            db.add(q)
            db.commit()
            print(f"  + {preview}")
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
