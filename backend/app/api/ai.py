"""Lightweight AI text-transform endpoint used by the rich-text editor.

Two actions today: `expand` (flesh out, add detail, keep voice) and
`shorten` (tighten, drop filler, keep facts). Both go through the chat
completion API with a deliberately bounded system prompt — we don't want
the model to rewrite intent, only re-shape length.
"""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import get_settings
from app.db.session import get_db
from app.models.user import User

router = APIRouter(prefix="/ai", tags=["ai"])


class TransformRequest(BaseModel):
    text: str = Field(min_length=1)
    action: Literal["expand", "shorten", "custom"]
    # Required when action == "custom" — the user's free-form instruction.
    instruction: str | None = None


class TransformResponse(BaseModel):
    text: str


BASE_RULES = (
    "You are a precise markdown editor. Detect the language of TEXT and "
    "respond in the SAME language. Preserve markdown formatting (headings, "
    "lists, bold, italics, links, code). Output ONLY the rewritten text — "
    "no preamble like 'Here is the rewritten text:', no surrounding quotes, "
    "no commentary."
)

PROMPTS: dict[str, str] = {
    "expand": (
        BASE_RULES
        + "\n\nTask: EXPAND the text. Add concrete detail, useful examples "
        "or clarifications, while keeping the original voice and intent. "
        "Do NOT add facts that contradict or go beyond what is reasonable "
        "from the input. Aim for ~1.5–2× the original length."
    ),
    "shorten": (
        BASE_RULES
        + "\n\nTask: SHORTEN the text. Cut filler, redundant phrasing and "
        "over-qualifications. Preserve every key fact and the original "
        "voice. Aim for ~50–70% of the original length."
    ),
}


@router.post("/transform", response_model=TransformResponse)
def transform_text(
    payload: TransformRequest,
    _user: User = Depends(get_current_user),
    _db: Session = Depends(get_db),
) -> TransformResponse:
    settings = get_settings()
    if not settings.openai_api_key:
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY not configured")

    if payload.action == "custom":
        if not payload.instruction or not payload.instruction.strip():
            raise HTTPException(
                status_code=400, detail="instruction is required for custom action"
            )
        system = (
            BASE_RULES
            + "\n\nTask: Apply the user's INSTRUCTION exactly to TEXT. "
            "Translate only if explicitly asked.\n\n"
            f"INSTRUCTION: {payload.instruction.strip()}"
        )
    else:
        system = PROMPTS[payload.action]

    from openai import OpenAI

    client = OpenAI(api_key=settings.openai_api_key)
    response = client.chat.completions.create(
        model=settings.openai_model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": f"TEXT:\n{payload.text}"},
        ],
    )
    out = (response.choices[0].message.content or "").strip()
    # Strip leading/trailing triple-quotes the model occasionally adds.
    out = out.strip('"').strip("'").strip()
    if not out:
        raise HTTPException(status_code=502, detail="AI returned empty response")
    return TransformResponse(text=out)
