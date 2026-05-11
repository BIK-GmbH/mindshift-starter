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


# Prepended to every gpt-image-2 prompt the service emits. Centralises
# the rules that gpt-image-2 reliably honours but every template would
# otherwise repeat (and inevitably drift on):
#
#   - the "render text verbatim" lock — single highest-leverage line
#     against duplicate / smeared on-image typography (OpenAI cookbook,
#     fal.ai prompting guide, both confirmed 2026-05);
#   - colour-drift defence via hex enforcement;
#   - typography rule that descriptive font language ("heavy geometric
#     sans-serif") outperforms naming brands ("Inter") because the
#     model substitutes shapes, not names — naming triggers
#     trademark-avoidance and weight inconsistency;
#   - negative list as an enumerated tail (vague negatives are ignored
#     by the model; itemised ones land).
#
# Templates keep their own layout-specific instructions; the preamble
# only carries non-negotiable rendering rules that apply to all of
# them. If you need a template to break a rule (e.g. the Vintage
# Newspaper template *wants* a serif), that's still doable — the
# template's explicit override beats the preamble's general guidance.
GLOBAL_BRAND_PREAMBLE = """RENDERING CONSTRAINTS (always apply):
- Render every quoted string VERBATIM. No duplicate text, no substitutions, no paraphrasing.
- Strict adherence to specified hex codes — no colour drift.
- Default typography is heavy geometric sans-serif, tight tracking. Do NOT name specific font families; describe weight, width, and tracking instead.
- No human faces, no portraits, no people unless the template explicitly composes a scene with people.
- No third-party logos, no brand marks, no trademarks.
- No watermark, no signature, no border frame, no Lorem Ipsum.
- No stock-photo clichés, no AI-art gradient overlays, no decorative scribble.
- No vague style tags ("cinematic", "8k", "trending", "masterpiece"). Describe visual facts only.
"""


def _with_global_preamble(prompt: str) -> str:
    """Prepend the global preamble to a prompt with a clear separator
    so the model treats the two blocks as ordered context, not a single
    run-on instruction."""
    return f"{GLOBAL_BRAND_PREAMBLE}\n---\n\n{prompt}"


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


# Canonical placeholder vocabulary. Each entry's `description` doubles
# as the LLM rule for that variable AND the palette hint surfaced in the
# UI via the /image-templates/variables endpoint. Adding a new
# placeholder here is enough to make it both fillable and visible.
KNOWN_VARIABLES: list[dict[str, str]] = [
    # --- General-purpose (used by most templates) ---
    {
        "name": "HEADLINE",
        "description": (
            "4–9 words, sentence case (capitalise the first word + proper "
            'nouns only — NO all-caps). Open with a verb of momentum '
            "(builds, kills, breaks, wins, shifts) or a statement-with-"
            'tension ("Spec is the new code"). Avoid questions on the '
            "image — questions belong in the caption."
        ),
    },
    {
        "name": "SUBTITLE",
        "description": "≤ 8 words, sentence case, optional supporting line.",
    },
    {
        "name": "SOURCES",
        "description": (
            "Comma-separated names of cited orgs / publications / channels "
            'in the source (e.g. "CNBC, Reuters"). Empty string if none.'
        ),
    },
    {
        "name": "DATE",
        "description": (
            'Short period label like "Q2 2026" or "May 2026". Default to '
            "the current month if nothing is stated in the source."
        ),
    },
    # --- Stats template ---
    {
        "name": "NUMBER_1",
        "description": (
            "Most striking numeric claim from the source (percentage, count, "
            'score, dollar amount). Keep original form ("70%", "$1.2B", "62"). '
            'Empty string if none.'
        ),
    },
    {"name": "LABEL_1", "description": "≤ 6 words, the concrete thing NUMBER_1 measures."},
    {"name": "NUMBER_2", "description": "Second striking numeric claim. Same rules as NUMBER_1."},
    {"name": "LABEL_2", "description": "≤ 6 words, the concrete thing NUMBER_2 measures."},
    {"name": "NUMBER_3", "description": "Third striking numeric claim. Same rules as NUMBER_1."},
    {"name": "LABEL_3", "description": "≤ 6 words, the concrete thing NUMBER_3 measures."},
    # --- Before / After Split ---
    {"name": "BEFORE_LABEL", "description": '≤ 4 words, ALL CAPS, the name of the "before" state.'},
    {
        "name": "BEFORE_DESCRIPTION",
        "description": '≤ 8 words, sentence case, what the "before" state feels like.',
    },
    {"name": "AFTER_LABEL", "description": '≤ 4 words, ALL CAPS, the name of the "after" state.'},
    {
        "name": "AFTER_DESCRIPTION",
        "description": '≤ 8 words, sentence case, what the "after" state feels like.',
    },
    # --- News Recap Cover ---
    {
        "name": "DATE_RANGE",
        "description": 'Week / period label, ALL CAPS (e.g. "WEEK 19 · MAY 2026").',
    },
    {
        "name": "STORY_1_ICON",
        "description": (
            "Single lowercase word naming a simple line-icon for story 1 "
            '(e.g. "chip", "rocket", "gavel"). No emoji.'
        ),
    },
    {"name": "STORY_1_HEADLINE", "description": "≤ 8 words, the story-1 headline."},
    {"name": "STORY_2_ICON", "description": 'Line-icon word for story 2 (same rules as STORY_1_ICON).'},
    {"name": "STORY_2_HEADLINE", "description": "≤ 8 words, the story-2 headline."},
    {"name": "STORY_3_ICON", "description": 'Line-icon word for story 3 (same rules as STORY_1_ICON).'},
    {"name": "STORY_3_HEADLINE", "description": "≤ 8 words, the story-3 headline."},
    # --- Concept Morph ---
    {
        "name": "LEFT_OBJECT",
        "description": (
            "A concrete physical object as a metaphor for the source's "
            '"before" state (e.g. "a paper backlog card with handwritten notes").'
        ),
    },
    {
        "name": "RIGHT_OBJECT",
        "description": (
            "A concrete physical object as a metaphor for the source's "
            '"after" state (e.g. "a glowing cube of running code").'
        ),
    },
    # --- Anatomy Diagram ---
    {
        "name": "SUBJECT",
        "description": (
            "Short noun phrase naming the thing being dissected "
            '(e.g. "an agentic workflow").'
        ),
    },
    {"name": "COMPONENT_1_NAME", "description": "1–3 words, ALL CAPS, name of component 1."},
    {"name": "COMPONENT_1_DESC", "description": "≤ 8 words, sentence case, what component 1 does."},
    {"name": "COMPONENT_2_NAME", "description": "1–3 words, ALL CAPS, name of component 2."},
    {"name": "COMPONENT_2_DESC", "description": "≤ 8 words, sentence case, what component 2 does."},
    {"name": "COMPONENT_3_NAME", "description": "1–3 words, ALL CAPS, name of component 3."},
    {"name": "COMPONENT_3_DESC", "description": "≤ 8 words, sentence case, what component 3 does."},
    {"name": "COMPONENT_4_NAME", "description": "1–3 words, ALL CAPS, name of component 4."},
    {"name": "COMPONENT_4_DESC", "description": "≤ 8 words, sentence case, what component 4 does."},
    {"name": "COMPONENT_5_NAME", "description": "1–3 words, ALL CAPS, name of component 5."},
    {"name": "COMPONENT_5_DESC", "description": "≤ 8 words, sentence case, what component 5 does."},
    # --- Vintage Newspaper Page ---
    {
        "name": "NEWSPAPER_NAME",
        "description": 'Fictional newspaper masthead, ALL CAPS (e.g. "THE DIGITAL HERALD").',
    },
    {"name": "EDITION", "description": 'Edition label, ALL CAPS (e.g. "MORNING EDITION").'},
    {"name": "KICKER", "description": "≤ 5 words, italicised pre-line above the main headline."},
    {
        "name": "MAIN_HEADLINE",
        "description": "≤ 8 words, ALL CAPS, plakative news-style headline.",
    },
    {
        "name": "SUBHEAD",
        "description": "≤ 15 words, sentence case, subhead expanding the headline.",
    },
    # --- Landscape Map ---
    {
        "name": "DOMAIN",
        "description": (
            "Short noun phrase naming the ecosystem being mapped "
            '(e.g. "AI agent tools 2026").'
        ),
    },
    {"name": "CLUSTER_1_NAME", "description": "1–3 words, ALL CAPS, name of region 1."},
    {
        "name": "CLUSTER_1_ITEMS",
        "description": (
            "3–6 concrete items (tools, products, names) inside region 1, "
            'separated by " · " (space dot space).'
        ),
    },
    {"name": "CLUSTER_2_NAME", "description": "1–3 words, ALL CAPS, name of region 2."},
    {"name": "CLUSTER_2_ITEMS", "description": "3–6 items inside region 2, same separator rule."},
    {"name": "CLUSTER_3_NAME", "description": "1–3 words, ALL CAPS, name of region 3."},
    {"name": "CLUSTER_3_ITEMS", "description": "3–6 items inside region 3, same separator rule."},
    {"name": "CLUSTER_4_NAME", "description": "1–3 words, ALL CAPS, name of region 4."},
    {"name": "CLUSTER_4_ITEMS", "description": "3–6 items inside region 4, same separator rule."},
    {"name": "CLUSTER_5_NAME", "description": "1–3 words, ALL CAPS, name of region 5."},
    {"name": "CLUSTER_5_ITEMS", "description": "3–6 items inside region 5, same separator rule."},
]

_KNOWN_VARIABLES_BY_NAME: dict[str, dict[str, str]] = {
    v["name"]: v for v in KNOWN_VARIABLES
}


def _render_variable_rules(variables: list[str]) -> str:
    """Render the LLM rule block from KNOWN_VARIABLES for the subset of
    variables actually present in the template. Variables unknown to
    KNOWN_VARIABLES are still listed so the LLM tries to fill them, but
    with a generic fallback rule."""
    lines: list[str] = []
    for var in variables:
        entry = _KNOWN_VARIABLES_BY_NAME.get(var)
        if entry is not None:
            lines.append(f"- {var}: {entry['description']}")
        else:
            lines.append(
                f"- {var}: Fill from the source content; keep it short and "
                "literally renderable as text on the image."
            )
    return "\n".join(lines)


_TEMPLATE_FILL_PROMPT_BASE = """You fill placeholder variables for a 1:1 social-media
image. The values you return will be rendered LITERALLY on the image, so
they must be short, punchy, and grounded in the supplied source content.

Global rules:
- Detect the source language; respond in the SAME language.
- Never invent stats. If you cannot fill a value honestly, return "".
- For any DATE-like variable, default to {current_month} if nothing is stated.
- Return ONLY valid JSON with the requested keys.

Per-variable rules (only the keys requested below apply):
{variable_rules}"""


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
    system = _TEMPLATE_FILL_PROMPT_BASE.format(
        current_month=datetime.now().strftime("%B %Y"),
        variable_rules=_render_variable_rules(variables),
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

    # Prepend the global rendering preamble (verbatim text lock, hex
    # enforcement, negative list). Doing it here means every template
    # path — variable-driven, style-only, or no template — gets the
    # same baseline rules without each template having to repeat them.
    prompt = _with_global_preamble(prompt)

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
