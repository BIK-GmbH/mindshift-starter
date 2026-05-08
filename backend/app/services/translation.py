"""Translate a card's title + summaries into another language.

Single gpt-5.4-mini call with strict JSON output. Markdown is preserved
(headings, lists, links, bold). Source language is auto-detected by
the model.
"""

from __future__ import annotations

import json

from app.core.config import get_settings


SYSTEM_PROMPT = """You translate a knowledge-card into the target language.
You receive JSON with title, concise_summary_md and detailed_summary_md.
Translate every field into the requested language. Preserve markdown
formatting exactly (headings, lists, links, bold, code, blockquotes).
Don't add or remove facts. Don't translate proper nouns or technical
terms that have no native equivalent — keep them as-is.

Return strict JSON only, no preamble:
{"title": "...", "concise_summary_md": "...", "detailed_summary_md": "..."}"""


def translate_card_content(
    *,
    target_language: str,
    title: str | None,
    concise_summary_md: str | None,
    detailed_summary_md: str | None,
) -> dict[str, str | None]:
    settings = get_settings()
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY not configured")

    from openai import OpenAI

    client = OpenAI(api_key=settings.openai_api_key)
    payload = {
        "target_language": target_language,
        "title": title or "",
        "concise_summary_md": concise_summary_md or "",
        "detailed_summary_md": detailed_summary_md or "",
    }
    user_msg = json.dumps(payload, ensure_ascii=False)

    response = client.chat.completions.create(
        model=settings.openai_model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        response_format={"type": "json_object"},
    )
    raw = response.choices[0].message.content or "{}"
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Translation returned non-JSON: {raw[:200]}") from exc

    return {
        "title": (data.get("title") or "").strip() or None,
        "concise_summary_md": (data.get("concise_summary_md") or "").strip() or None,
        "detailed_summary_md": (data.get("detailed_summary_md") or "").strip() or None,
    }
