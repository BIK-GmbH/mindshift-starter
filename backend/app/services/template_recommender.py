"""Pick the best image-template for a card.

Given a card (title + summary/notes) and the user's list of image
templates, ask gpt-5.4-mini to score which template best fits the
content shape (split comparison? anatomy with 5 components? stats with
numbers?). Returns the chosen template id plus a one-line reasoning
the UI can surface as a hint.

Pattern A from the design discussion: lazy compute on each Posts-tab
open, no persistence. Cost is one cheap LLM call per click; if that
ever becomes a problem, add a `recommended_image_template_id` column
to `cards` and cache.
"""

from __future__ import annotations

import json
from typing import Iterable

from app.core.config import get_settings
from app.models.card import Card
from app.models.image_template import ImageTemplate


_DESCRIPTION_HEAD_CHARS = 200


def _template_blurb(t: ImageTemplate) -> str:
    """One-line hint about the template for the recommender prompt.
    Pulls from the template content's first paragraph so we don't
    hardcode anything by name."""
    head = (t.content or "").strip().split("\n\n", 1)[0]
    head = head[:_DESCRIPTION_HEAD_CHARS].strip().replace("\n", " ")
    return f'- id="{t.id}"  name="{t.name}"  shape="{head}"'


_RECOMMENDER_PROMPT = """You pick the best image-template for a social-media
post. The user wrote notes on a topic; we will generate a 1:1 square image
to accompany the post. Each template renders a specific layout — a
side-by-side comparison, an anatomy diagram, a vintage newspaper page, etc.

Pick the ONE template whose layout best matches the structure of the
source content. Decide on signal, not on tone:

- If the content explicitly contrasts two states (before/after, old/new,
  manual/automated), prefer a SPLIT or BEFORE/AFTER template.
- If it lists 3 distinct news items, prefer a NEWS RECAP template.
- If it describes 4–6 components of a system, prefer an ANATOMY template.
- If it argues that X is becoming Y, prefer a MORPH template.
- If it announces a single big event, prefer a NEWSPAPER template.
- If it maps an ecosystem of tools/players, prefer a LANDSCAPE MAP template.
- If it leads with hard numbers, prefer a STATS-style template.
- Otherwise pick the user's default-looking template (often the broadest
  one in the list).

Return strict JSON ONLY, no preamble:
{"template_id": "<uuid from the list>", "reasoning": "<one short sentence>"}

If the list of templates is empty, return:
{"template_id": null, "reasoning": "no templates configured"}"""


def recommend_image_template(
    card: Card, templates: Iterable[ImageTemplate]
) -> dict[str, str | None]:
    """Return `{template_id, template_name, reasoning}`. On any failure
    (no API key, LLM error, invalid JSON) falls back to the user's default
    template, or the first template, with a generic reasoning. Never
    raises — the UI should always get something to render."""
    templates_list = [t for t in templates]
    if not templates_list:
        return {"template_id": None, "template_name": None, "reasoning": ""}

    # Fallback pick: default template if set, else the first one.
    fallback = next((t for t in templates_list if t.is_default), templates_list[0])

    settings = get_settings()
    if not settings.openai_api_key:
        return {
            "template_id": str(fallback.id),
            "template_name": fallback.name,
            "reasoning": "default (OpenAI not configured)",
        }

    body_parts: list[str] = []
    for chunk in (card.concise_summary_md, card.detailed_summary_md, card.notes_md):
        if chunk:
            body_parts.append(chunk)
    if isinstance(card.key_takeaways_json, list):
        body_parts.extend(str(x) for x in card.key_takeaways_json if x)
    body = "\n\n".join(body_parts)[:4000]

    blurbs = "\n".join(_template_blurb(t) for t in templates_list)
    user_msg = (
        f"CARD TITLE:\n{card.title}\n\n"
        f"CARD BODY:\n{body}\n\n"
        f"AVAILABLE TEMPLATES:\n{blurbs}"
    )

    try:
        from openai import OpenAI

        client = OpenAI(api_key=settings.openai_api_key)
        response = client.chat.completions.create(
            model=settings.openai_model,
            messages=[
                {"role": "system", "content": _RECOMMENDER_PROMPT},
                {"role": "user", "content": user_msg},
            ],
            response_format={"type": "json_object"},
        )
        data = json.loads(response.choices[0].message.content or "{}")
    except Exception:
        return {
            "template_id": str(fallback.id),
            "template_name": fallback.name,
            "reasoning": "default (recommender unavailable)",
        }

    raw_id = data.get("template_id")
    reasoning = str(data.get("reasoning") or "").strip()
    chosen = next((t for t in templates_list if str(t.id) == str(raw_id)), None)
    if chosen is None:
        return {
            "template_id": str(fallback.id),
            "template_name": fallback.name,
            "reasoning": reasoning or "default (LLM returned unknown id)",
        }
    return {
        "template_id": str(chosen.id),
        "template_name": chosen.name,
        "reasoning": reasoning,
    }
