"""Image-generation pipeline (cover art for cards, paths, podcasts,
social posts) and user-defined image-template resolution.

Originally lived in `services/podcast.py` together with the podcast
TTS pipeline because podcast covers were the first use case. Now used
by every image generator in the app, so the module was renamed to
reflect its real scope.

Public entry points:
  - generate_cover_image()        : OpenAI gpt-image-2 call, returns PNG bytes
  - suggest_cover_meta()          : LLM-generated style + teaser text
  - _extract_template_vars()      : detect {{VAR}} placeholders
  - extract_template_values()     : LLM-fill placeholders from card content
  - substitute_template_values()  : replace {{VAR}} with extracted values

The leading underscore on `_extract_template_vars` is preserved for
backwards compatibility with existing callers; new callers should treat
it as part of the public surface."""

from __future__ import annotations

import base64
import json
import re
from datetime import datetime
from typing import Optional

from app.core.config import get_settings


COVER_PROMPT_BASE = (
    "Podcast cover artwork for an episode titled '{title}'. "
    "Square aspect ratio, suitable as a thumbnail at 200×200 px and "
    "still readable. Editorial illustration with a sophisticated color "
    "palette, high-contrast composition, abstract / conceptual feel. "
    "No faces."
)
COVER_PROMPT_NO_TEXT = " No text, letters, words, or signage anywhere in the image."
COVER_PROMPT_WITH_TEXT = (
    " Render the following text on the cover in clean stylized typography, "
    'integrated tastefully into the design (large, legible): "{text}". '
    "No other text or letters anywhere."
)


COVER_SUGGEST_PROMPT = """You are an art director for a podcast. Given an
episode TITLE and SCRIPT, propose:

1. cover_style — a short visual brief (≤ 30 words, English, prose) describing
   what should be on the cover: subject, palette, art style, mood. Be
   concrete and evocative ("brutalist concrete tower wrapped in golden ivy,
   warm dusk palette, editorial illustration"). NO mentions of text/letters.

2. cover_text — a SHORT teaser headline (≤ 5 words, ALL CAPS, language matched
   to the script) that captures the episode's hook. Think magazine cover
   pull-quote, not the full title. Avoid the literal episode title verbatim
   — distill its punch.

Return strict JSON only:
{"cover_style": "...", "cover_text": "..."}"""


def suggest_cover_meta(title: str, narrative_text: str) -> dict[str, str]:
    """Ask gpt-5.4-mini for a cover style brief + short teaser text."""
    settings = get_settings()
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY not configured")

    from openai import OpenAI

    client = OpenAI(api_key=settings.openai_api_key)
    user_msg = f"TITLE: {title}\n\nSCRIPT:\n{narrative_text[:6000]}"
    response = client.chat.completions.create(
        model=settings.openai_model,
        messages=[
            {"role": "system", "content": COVER_SUGGEST_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        response_format={"type": "json_object"},
    )
    raw = response.choices[0].message.content or "{}"
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Cover suggest returned non-JSON: {raw[:200]}") from exc
    return {
        "cover_style": str(data.get("cover_style", "")).strip(),
        "cover_text": str(data.get("cover_text", "")).strip().upper()[:80],
    }


def _build_cover_prompt(
    *,
    title: str,
    summary_hint: str = "",
    style_hint: Optional[str] = None,
    cover_text: Optional[str] = None,
) -> str:
    """Compose the cover prompt from base + optional hints + text overlay."""
    parts = [COVER_PROMPT_BASE.format(title=title)]
    if summary_hint:
        parts.append(f"Topic context: {summary_hint[:300]}")
    if style_hint and style_hint.strip():
        parts.append(f"Visual direction: {style_hint.strip()[:400]}")
    if cover_text and cover_text.strip():
        parts.append(COVER_PROMPT_WITH_TEXT.format(text=cover_text.strip()[:80]))
    else:
        parts.append(COVER_PROMPT_NO_TEXT)
    return " ".join(parts)


_TEMPLATE_VAR_RE = re.compile(r"\{\{\s*([A-Z][A-Z0-9_]*)\s*\}\}")


def _extract_template_vars(template: str) -> list[str]:
    return list(dict.fromkeys(_TEMPLATE_VAR_RE.findall(template)))


_TEMPLATE_FILL_PROMPT = """You fill placeholder variables for a 1:1 social-media
image. The values you return will be rendered LITERALLY on the image, so
they must be short, punchy, and grounded in the supplied source content.

Rules:
- Detect the source language; respond in the SAME language.
- HEADLINE: 1–6 words, ALL CAPS, the punchiest framing of the topic.
- SUBTITLE: ≤ 8 words, sentence case, optional context line.
- NUMBER_n: a striking numeric claim from the source (percentage, count,
  score, dollar amount). Keep original form ("70%", "$1.2B", "62").
  If fewer than n numbers are in the source, return "" for the missing ones.
- LABEL_n: ≤ 6 words, the concrete thing NUMBER_n measures.
- SOURCES: comma-separated names of cited orgs / publications / channels
  in the source. Empty string if none.
- DATE: a short period label like "Q2 2026" or "May 2026". Default to
  the current month if nothing is stated in the source: {current_month}.
- Never invent stats. If you cannot fill a value honestly, return "".
- Return ONLY valid JSON with the requested keys."""


def extract_template_values(
    variables: list[str], *, title: str, body: str
) -> dict[str, str]:
    """Call gpt-5.4-mini to fill placeholder variables from source content.
    Returns a {VAR_NAME: value} dict. Empty dict on no API key / failure."""
    if not variables:
        return {}
    settings = get_settings()
    if not settings.openai_api_key:
        return {}

    from openai import OpenAI

    client = OpenAI(api_key=settings.openai_api_key)
    system = _TEMPLATE_FILL_PROMPT.format(
        current_month=datetime.now().strftime("%B %Y")
    )
    user_msg = (
        f"SOURCE TITLE:\n{title}\n\n"
        f"SOURCE BODY:\n{body[:4000]}\n\n"
        f"Return JSON with exactly these keys (empty string if unknown): "
        f"{variables}"
    )
    try:
        response = client.chat.completions.create(
            model=settings.openai_model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_msg},
            ],
            response_format={"type": "json_object"},
        )
        data = json.loads(response.choices[0].message.content or "{}")
    except Exception:
        return {}
    return {str(k): str(v) for k, v in data.items()}


def substitute_template_values(template: str, values: dict[str, str]) -> str:
    """Replace every `{{VAR}}` in `template` with values[VAR]. Unknown
    keys are left intact so the issue is visible rather than silent."""

    def _replace(match: re.Match[str]) -> str:
        var = match.group(1)
        if var not in values:
            return match.group(0)
        return str(values[var]).strip()

    return _TEMPLATE_VAR_RE.sub(_replace, template)


def _resolve_template_vars(
    template: str, *, title: str, body: str
) -> str:
    """Detect `{{VAR}}` placeholders, extract values, substitute. Returns
    the template unchanged when no placeholders exist or extraction
    fails — failures stay visible in the generated image."""
    variables = _extract_template_vars(template)
    if not variables:
        return template
    values = extract_template_values(variables, title=title, body=body)
    if not values:
        return template
    return substitute_template_values(template, values)


def generate_cover_image(
    title: str,
    summary_hint: str = "",
    custom_prompt: Optional[str] = None,
    *,
    style_hint: Optional[str] = None,
    cover_text: Optional[str] = None,
    template_content: Optional[str] = None,
) -> bytes:
    """Generate a square podcast cover via OpenAI gpt-image-2. Returns PNG bytes.

    `template_content` is the user-defined image-template body (from
    the image_templates table). When set, we prepend it to the built
    prompt so the user's house style steers every image generator —
    podcast covers, path covers, social-post images, all of them.
    Templates containing {{VARIABLE}} placeholders are first resolved
    via a gpt-5.4-mini extraction over (title, summary_hint).
    """
    settings = get_settings()
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY not configured")

    from openai import OpenAI

    client = OpenAI(api_key=settings.openai_api_key)

    built = custom_prompt or _build_cover_prompt(
        title=title,
        summary_hint=summary_hint,
        style_hint=style_hint,
        cover_text=cover_text,
    )

    if template_content and template_content.strip():
        resolved = _resolve_template_vars(
            template_content.strip(), title=title, body=summary_hint
        )
        if _extract_template_vars(template_content):
            # Variable-driven template: the resolved template IS the full
            # prompt (style + concrete content). Appending `built` would
            # confuse the model with a competing topic block.
            prompt = resolved
        else:
            # Style-only template: prepend it so the topic block fills
            # in the actual subject.
            prompt = f"{resolved}\n\n---\n\n{built}"
    else:
        prompt = built

    # gpt-image-2 returns base64 by default. 1024x1024 is the canonical
    # square podcast cover size.
    response = client.images.generate(
        model="gpt-image-2",
        prompt=prompt,
        size="1024x1024",
        n=1,
    )
    b64 = response.data[0].b64_json
    if not b64:
        raise RuntimeError("Cover image API returned no data")
    return base64.b64decode(b64)
