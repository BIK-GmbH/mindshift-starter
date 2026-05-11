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

## Timestamp markers — REQUIRED when the source is annotated

If the user prompt's transcript contains `[t=NN]` markers (NN is
seconds-from-start), you **MUST** weave at least 4–8 of those exact
markers into the JSON output. Distribute them across:

- the `concise_summary_md` (at least 1, ideally 2)
- the `detailed_summary_md` (3–5, one per section heading or major
  paragraph)
- the `key_takeaways` (at least half of the bullets should carry a
  marker)

Rules:

- Copy the `[t=NN]` token literally — same brackets, no spaces inside,
  no parens or other wrappers. The reader's UI parses it as a regex.
- Place the marker right at the end of the sentence it anchors,
  immediately before the period. Example: `Algorithms detect fraud by
  spotting outliers [t=85].`
- Only use values that actually appear in the transcript — never
  invent timestamps. If the transcript is short, fewer markers are
  fine, but always at least one in the concise summary.
- When the transcript has NO `[t=NN]` markers at all, omit them
  entirely. (This applies to articles, PDFs and other non-time-based
  sources.)
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
    segments: list[dict] | None = None,
) -> SummaryResult:
    """Call OpenAI to produce the structured summary payload.

    `existing_top_tags` is a small (≤30) list of the user's existing top-level
    tag names. They get fed into the system prompt so the AI prefers reusing
    them as parents when nesting hierarchical tags.

    `segments` is the optional time-aligned transcript (YouTube etc.). When
    provided, we re-build the prompt's transcript with periodic `[t=NN]`
    timestamp markers so the model can reference them in the summary.
    Format: every ~5th segment gets a marker (denser would bloat the
    prompt without helping the model decide which moment matters most).
    """
    from openai import OpenAI  # local import — keeps import-time cost low

    settings = get_settings()
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY not configured")

    client = OpenAI(api_key=settings.openai_api_key)

    if segments:
        annotated = _annotate_transcript_with_timestamps(segments)
        truncated = annotated[:60_000]
    else:
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


def _annotate_transcript_with_timestamps(segments: list[dict]) -> str:
    """Render segments as text with `[t=NN]` markers sprinkled in.

    We don't tag every segment — that would bloat the prompt and make
    the model think the markers are mandatory on every line. One
    marker every ~5 segments is enough for the model to anchor claims
    to specific moments while keeping the input tight.
    """
    lines: list[str] = []
    for i, seg in enumerate(segments):
        text = (seg.get("text") or "").strip()
        if not text:
            continue
        if i % 5 == 0:
            start = int(seg.get("start") or 0)
            lines.append(f"[t={start}] {text}")
        else:
            lines.append(text)
    return " ".join(lines)

