from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


Platform = Literal["linkedin", "x", "bluesky"]
Tone = Literal["professional", "casual", "thought_leader", "story", "punchy"]


class SocialPostCreate(BaseModel):
    platform: Platform
    tone: Tone = "professional"
    language: str | None = Field(default=None, max_length=40)
    with_hashtags: bool = True
    with_cta: bool = True
    # Image generation is opt-in because gpt-image-2 takes ~30 s and
    # adds API cost; defaults off so a "Generate" click is fast + cheap.
    with_image: bool = False
    # Emoji on by default — they help LinkedIn / X posts scan; toggle
    # off for stricter / corporate voices.
    with_emoji: bool = True
    # Optional image-template override. None = use the user's default
    # template (if any). The caller passes a UUID from /api/image-templates.
    image_template_id: UUID | None = None


class SocialPostUpdate(BaseModel):
    """Inline-editor save: just the text + recomputed length.
    Hashtags / image stay untouched here — those are managed via the
    Generate flow."""

    text: str = Field(min_length=1)


RewriteAction = Literal["shorter", "longer", "sharper", "rephrase"]


class SocialPostRewriteRequest(BaseModel):
    action: RewriteAction
    selection: str = Field(min_length=1, max_length=8000)
    # Surrounding context so the model knows the wider voice / topic
    # of the post even when the user only highlighted a fragment.
    full_text: str | None = Field(default=None, max_length=20000)


class SocialPostRewriteResponse(BaseModel):
    text: str


class SocialPostOut(BaseModel):
    id: UUID
    card_id: UUID
    platform: str
    text: str
    hashtags: list[str] = []
    character_count: int
    image_url: str | None = None
    tone: str | None = None
    language: str | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class SocialPostImagePreviewRequest(BaseModel):
    """Body for the per-post image-preview endpoint. Empty body means
    'use the user's current default template' — handy when the user
    just clicks the preview button without typing anything."""

    template_content: str | None = None
    template_id: UUID | None = None


class SocialPostImagePreviewResponse(BaseModel):
    detected: list[str]
    unknown: list[str]
    extracted: dict[str, str]
    resolved: str
    template_id: UUID | None = None


class SocialPostImageGenerateRequest(BaseModel):
    """Generate a fresh image for the post. If `resolved_prompt` is set
    it goes straight to gpt-image-2 with no template work. Otherwise we
    resolve the chosen / default template just like the original POST
    flow does."""

    resolved_prompt: str | None = Field(default=None, max_length=20000)
    template_id: UUID | None = None


class SocialPostImageRefineRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=2000)


class SocialPostImageVersionOut(BaseModel):
    id: UUID
    file_id: UUID
    image_url: str
    prompt_used: str | None
    kind: str
    parent_version_id: UUID | None
    is_active: bool
    created_at: datetime
