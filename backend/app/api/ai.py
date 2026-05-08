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
    action: Literal["expand", "shorten"]


class TransformResponse(BaseModel):
    text: str


PROMPTS: dict[str, str] = {
    "expand": (
        "You are an editor. Expand the user's text: add helpful detail, "
        "examples or clarifications, but keep the same voice, language, "
        "structure (markdown intact) and intent. Do not summarize or "
        "introduce facts unrelated to the original. Return only the "
        "rewritten text — no preamble, no quotes."
    ),
    "shorten": (
        "You are an editor. Tighten the user's text: cut filler, redundant "
        "phrasing and over-qualifications, while preserving every key "
        "fact, the original voice, language, and markdown formatting. "
        "Return only the rewritten text — no preamble, no quotes."
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

    from openai import OpenAI

    client = OpenAI(api_key=settings.openai_api_key)
    response = client.chat.completions.create(
        model=settings.openai_model,
        messages=[
            {"role": "system", "content": PROMPTS[payload.action]},
            {"role": "user", "content": payload.text},
        ],
    )
    out = (response.choices[0].message.content or "").strip()
    if not out:
        raise HTTPException(status_code=502, detail="AI returned empty response")
    return TransformResponse(text=out)
