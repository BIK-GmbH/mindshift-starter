"""OpenAI-backed summarization & quiz generation."""

from __future__ import annotations

import json
from dataclasses import dataclass

from app.core.config import get_settings

SUMMARY_PROMPT_TEMPLATE = """You are an expert knowledge curator. Given a piece of source content
(a video transcript, an article, or a document), produce a structured JSON object
describing it. Preserve the dominant language of the content for the summary fields.
Use neutral phrasing — refer to "the content" or "the source", not "the video" unless you
are certain the source is a video. Return ONLY valid JSON matching this schema:

{{
  "concise_summary_md": "2-3 sentence summary in markdown",
  "detailed_summary_md": "structured markdown summary with section headings",
  "key_takeaways": ["bullet 1", "bullet 2", "..."],
  "tags": ["tag-slug" or "Parent/Child", ...],
  "entities": [{{"name": "Concept", "entity_type": "concept|person|product|company|other", "description": "short description"}}],
  "quiz_questions": [{{"question": "...", "answer": "...", "choices": ["plausible distractor 1", "plausible distractor 2", "plausible distractor 3"], "question_type": "open|short|multiple-choice", "difficulty": "easy|medium|hard"}}]
}}

## Tag rules

- Tags are lowercase kebab-case slugs (e.g. `neural-networks`, `spaced-repetition`).
- **Hierarchy is encouraged.** Use a forward slash to nest a tag under a parent
  category, e.g. `finance/investment` or `ai/transformers`. Don't go deeper than two
  levels.
- **Reuse the user's existing top-level categories where they fit naturally.** Existing
  top-level tags in their library: {existing_top_tags}.
- Don't invent a parent just for one card — only nest when the parent makes sense as a
  reusable category. Standalone slugs without a slash are fine.

Aim for 5-8 takeaways, 3-8 tags, 5-12 entities, and 5-8 quiz questions.

## Quiz rules

- For each quiz question include a `choices` array of **exactly 3 plausible
  but wrong** distractors so the question can be reviewed as multiple-choice.
- Distractors should be the same kind of thing as `answer` (same length and
  shape) so they're not trivially identifiable. Don't make any of them the
  same as `answer`.
"""


@dataclass(slots=True)
class SummaryResult:
    concise_summary_md: str
    detailed_summary_md: str
    key_takeaways: list[str]
    tags: list[str]
    entities: list[dict]
    quiz_questions: list[dict]
    raw: dict


def summarize_transcript(
    title: str,
    transcript_text: str,
    *,
    existing_top_tags: list[str] | None = None,
) -> SummaryResult:
    """Call OpenAI to produce the structured summary payload.

    `existing_top_tags` is a small (≤30) list of the user's existing top-level
    tag names. They get fed into the system prompt so the AI prefers reusing
    them as parents when nesting hierarchical tags.
    """
    from openai import OpenAI  # local import — keeps import-time cost low

    settings = get_settings()
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY not configured")

    client = OpenAI(api_key=settings.openai_api_key)

    truncated = transcript_text[:60_000]
    user_prompt = f"Title: {title}\n\nTranscript:\n{truncated}"

    formatted_existing = (
        ", ".join(sorted(existing_top_tags)[:30]) if existing_top_tags else "(none yet)"
    )
    system_prompt = SUMMARY_PROMPT_TEMPLATE.format(existing_top_tags=formatted_existing)

    response = client.chat.completions.create(
        model=settings.openai_model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        response_format={"type": "json_object"},
    )

    content = response.choices[0].message.content or "{}"
    data = json.loads(content)

    return SummaryResult(
        concise_summary_md=str(data.get("concise_summary_md", "")).strip(),
        detailed_summary_md=str(data.get("detailed_summary_md", "")).strip(),
        key_takeaways=list(data.get("key_takeaways", [])),
        tags=[str(t).strip().lower() for t in data.get("tags", []) if t],
        entities=list(data.get("entities", [])),
        quiz_questions=list(data.get("quiz_questions", [])),
        raw=data,
    )
