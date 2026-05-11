"""Social-media post generator.

Generates LinkedIn / X / Bluesky drafts from a card's summary + key
takeaways. Each platform has its own system prompt tuned to the
expected length, hook style, and emoji budget.

Optional gpt-image-2 cover image is generated in the same call when
the user asked for one — we re-use the podcast cover helper which
already handles the OpenAI image API + saves through the storage
layer.
"""

from __future__ import annotations

import json
import logging
from typing import Literal

from app.core.config import get_settings

logger = logging.getLogger(__name__)

Platform = Literal["linkedin", "x", "bluesky"]
Tone = Literal["professional", "casual", "thought_leader", "story", "punchy"]


_PLATFORM_GUIDE = {
    "linkedin": (
        "LinkedIn post. Aim for 800–1500 characters. Structure: a hook "
        "line that earns the click (no clickbait), a short body with "
        "concrete claims, and a CTA / question at the end when "
        "requested. Sparing emoji at the start of bullet points only. "
        "Don't address 'LinkedIn' or 'the audience' explicitly."
    ),
    "x": (
        "X (Twitter) post. Aim for 600–1200 characters — the account is "
        "assumed to be X Premium so longer posts are OK; do NOT add "
        "thread numbers or 1/n style. Structure: punchy hook in the "
        "first line, then 3–5 short paragraphs with line breaks "
        "between. Emoji used sparingly at the start of bullets / "
        "section breaks. No hashtag spam — at most 3 high-quality "
        "hashtags, returned as a separate field."
    ),
    "bluesky": (
        "Bluesky post. Hard limit 300 characters per post. Write ONE "
        "tight post — no threads, no 'continued' markers. Conversational "
        "tone, no hashtags."
    ),
}

_TONE_GUIDE = {
    "professional": "Crisp, neutral, business-appropriate. No slang, no exclamation marks.",
    "casual": "Friendly + conversational. First-person voice when it fits.",
    "thought_leader": "Confident, opinion-forward. Make a non-obvious claim and back it up.",
    "story": "Open with a brief narrative hook before getting to the takeaway.",
    "punchy": "Short sentences. Strong verbs. Maximum density.",
}


def _build_system_prompt(
    platform: Platform,
    tone: Tone,
    *,
    with_hashtags: bool,
    with_cta: bool,
    with_emoji: bool,
    language: str | None,
) -> str:
    platform_guide = _PLATFORM_GUIDE[platform]
    tone_guide = _TONE_GUIDE.get(tone, _TONE_GUIDE["professional"])
    lang_clause = (
        f"Write in {language}."
        if language
        else "Match the language of the source content."
    )
    hashtags_clause = (
        "Return 2–4 relevant hashtags in `hashtags`."
        if with_hashtags
        else "Return an empty `hashtags` array."
    )
    cta_clause = (
        "End with a soft CTA — a question, a follow-up prompt, or "
        "an invitation to share thoughts."
        if with_cta
        else "Don't add a sign-off or CTA."
    )
    emoji_clause = (
        "Light, well-placed emoji are welcome — 0–3 across the whole "
        "post, never at the end of every line."
        if with_emoji
        else "Do NOT use ANY emoji or pictographic symbols. Plain text only."
    )

    return (
        "You write polished social-media posts from short knowledge "
        "summaries. Return ONLY valid JSON in this shape:\n"
        '  {"text": "<final post body>", "hashtags": ["a", "b"]}\n\n'
        f"## Platform\n{platform_guide}\n\n"
        f"## Tone\n{tone_guide}\n\n"
        f"## Language\n{lang_clause}\n\n"
        f"## Hashtags\n{hashtags_clause}\n\n"
        f"## CTA\n{cta_clause}\n\n"
        f"## Emoji\n{emoji_clause}\n\n"
        "Other rules:\n"
        " - Don't quote the source verbatim — paraphrase the key idea.\n"
        " - Avoid generic AI-tells: no 'In conclusion', no 'In today's "
        "fast-paced world', no 'Let's dive in'.\n"
        " - Skip the title — the body should hook on its own.\n"
        " - Don't fabricate numbers or names that aren't in the input.\n"
    )


def _build_user_prompt(
    *,
    title: str,
    concise: str | None,
    detailed: str | None,
    key_takeaways: list[str] | None,
) -> str:
    parts = [f"# Source\n\nTitle: {title}"]
    if concise:
        parts.append(f"\nConcise summary:\n{concise}")
    if key_takeaways:
        parts.append("\nKey takeaways:\n" + "\n".join(f"- {k}" for k in key_takeaways))
    if detailed:
        # Detailed can be long; keep the user-prompt under control.
        snippet = detailed.strip()
        if len(snippet) > 4000:
            snippet = snippet[:4000] + " …(truncated)"
        parts.append(f"\nDetailed notes:\n{snippet}")
    return "\n".join(parts)


def generate_post(
    *,
    title: str,
    concise: str | None,
    detailed: str | None,
    key_takeaways: list[str] | None,
    platform: Platform,
    tone: Tone = "professional",
    language: str | None = None,
    with_hashtags: bool = True,
    with_cta: bool = True,
    with_emoji: bool = True,
) -> tuple[str, list[str]]:
    """Call OpenAI and return (text, hashtags).

    Raises ValueError if the model returns something that isn't valid
    JSON in the expected shape — caller surfaces that as a 502.
    """
    from openai import OpenAI

    settings = get_settings()
    if not settings.openai_api_key:
        raise ValueError("OpenAI is not configured")
    client = OpenAI(api_key=settings.openai_api_key)

    system = _build_system_prompt(
        platform,
        tone,
        with_hashtags=with_hashtags,
        with_cta=with_cta,
        with_emoji=with_emoji,
        language=language,
    )
    user = _build_user_prompt(
        title=title,
        concise=concise,
        detailed=detailed,
        key_takeaways=key_takeaways,
    )

    response = client.chat.completions.create(
        model=settings.openai_model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        response_format={"type": "json_object"},
    )
    content = response.choices[0].message.content or "{}"
    try:
        data = json.loads(content)
    except json.JSONDecodeError as exc:
        logger.exception("social-post returned invalid JSON: %s", content[:300])
        raise ValueError("Invalid response from summarizer") from exc

    text = (data.get("text") or "").strip()
    if not text:
        raise ValueError("Empty post text from summarizer")
    hashtags = [
        str(h).strip().lstrip("#") for h in (data.get("hashtags") or []) if str(h).strip()
    ]
    return text, hashtags


_REWRITE_INSTRUCTIONS = {
    "shorter": (
        "Rewrite the selection to be roughly 30 % shorter while preserving "
        "every concrete claim. Cut filler words, redundant clauses and "
        "throat-clearing. Keep the same voice and language."
    ),
    "longer": (
        "Expand the selection by roughly 30 %. Add one concrete example, "
        "consequence or detail that already follows from the surrounding "
        "context — never invent new facts. Match the existing voice + "
        "language."
    ),
    "sharper": (
        "Tighten the selection: replace vague language with specific verbs "
        "and nouns, drop adverbs and hedges (\"really\", \"very\", \"perhaps\"), "
        "and lead with the strongest claim. Same length, same language, "
        "much more punch."
    ),
    "rephrase": (
        "Restate the selection so it says the same thing in fresh words. "
        "Keep the meaning, the length, and the language; change the phrasing "
        "+ sentence structure."
    ),
}


def rewrite_selection(
    *, action: str, selection: str, full_text: str | None = None
) -> str:
    """Run a focused rewrite on a selection of post text. Returns just
    the replacement text (no commentary, no surrounding quotes)."""
    from openai import OpenAI

    instruction = _REWRITE_INSTRUCTIONS.get(action)
    if instruction is None:
        raise ValueError(f"Unknown rewrite action: {action}")

    settings = get_settings()
    if not settings.openai_api_key:
        raise ValueError("OpenAI is not configured")
    client = OpenAI(api_key=settings.openai_api_key)

    system = (
        "You rewrite small fragments of social-media posts. "
        "Return ONLY the rewritten fragment — no quotes, no preamble, "
        "no closing remark, no markdown. Preserve the surrounding "
        "post's language (German stays German). Never add hashtags. "
        "Never wrap the output in quotation marks.\n\n"
        f"Specific instruction: {instruction}"
    )
    user = "SELECTION:\n" + selection.strip()
    if full_text:
        user += "\n\n---\n\nSURROUNDING POST (for context only — do not return it):\n" + full_text.strip()

    response = client.chat.completions.create(
        model=settings.openai_model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    text = (response.choices[0].message.content or "").strip()
    # Some models still wrap output in quotes despite the instruction —
    # strip outer pairs defensively.
    while len(text) >= 2 and text[0] == text[-1] and text[0] in ('"', "'", "„", "“"):
        text = text[1:-1].strip()
    if not text:
        raise ValueError("Empty rewrite result")
    return text


def generate_post_image(
    *,
    title: str,
    post_text: str,
    template_content: str | None = None,
    prompt_override: str | None = None,
) -> bytes:
    """Generate a cover image (PNG bytes) for the post via gpt-image-2.

    Re-uses the same OpenAI image helper the podcast cover-art pipeline
    uses so we don't duplicate the call logic. `template_content`
    forwards the user's image-template (from the image_templates table)
    so the look is consistent with their other Mindshift covers.

    `prompt_override`, when set, replaces the entire prompt pipeline —
    no template prepend, no variable resolution, the override goes
    straight to gpt-image-2. The Pre-Gen modal uses this to commit a
    user-edited resolved prompt.
    """
    from app.services.podcast import generate_cover_image

    if prompt_override and prompt_override.strip():
        return generate_cover_image(
            title=title,
            custom_prompt=prompt_override.strip(),
            # Skip template resolution — the override IS the final prompt.
            template_content=None,
        )

    snippet = post_text.strip()
    if len(snippet) > 3500:
        snippet = snippet[:3500] + " …"
    return generate_cover_image(
        title=title,
        summary_hint=snippet,
        template_content=template_content,
    )


def refine_post_image(*, image_bytes: bytes, prompt: str) -> bytes:
    """Edit an existing image with a natural-language refinement prompt
    via gpt-image-2's images.edit endpoint. Returns the new PNG bytes."""
    from io import BytesIO

    settings = get_settings()
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY not configured")

    from openai import OpenAI

    client = OpenAI(api_key=settings.openai_api_key)
    # SDK accepts a single file-like, bytes, or (filename, bytes) tuple
    # for `image` — a list is reserved for multi-image edits. Pass a
    # tuple so the MIME type is detected from the .png filename.
    response = client.images.edit(
        model="gpt-image-2",
        image=("current.png", BytesIO(image_bytes), "image/png"),
        prompt=prompt.strip(),
        size="1024x1024",
    )
    b64 = response.data[0].b64_json
    if not b64:
        raise RuntimeError("images.edit returned no data")
    import base64 as _b64

    return _b64.b64decode(b64)
