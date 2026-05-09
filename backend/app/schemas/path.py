from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class PathCardItem(BaseModel):
    """A card embedded inside a path response — minimal, like CardListItem."""
    card_id: UUID
    position: int
    lesson_md: str | None = None
    title: str
    source_type: str
    status: str
    thumbnail_url: str | None = None
    concise_summary_md: str | None = None


class PathListItem(BaseModel):
    id: UUID
    title: str
    slug: str
    description_md: str | None = None
    cover_url: str | None = None
    is_public: bool
    card_count: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class PathDetail(PathListItem):
    cards: list[PathCardItem] = Field(default_factory=list)


class PathCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    description_md: str | None = Field(default=None)


class PathUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    description_md: str | None = None
    cover_url: str | None = Field(default=None, max_length=2048)
    is_public: bool | None = None
    # Optional: regenerate the slug from the (possibly new) title. Off by
    # default so renaming doesn't break shared URLs.
    regenerate_slug: bool = False


class AddCardsRequest(BaseModel):
    card_ids: list[UUID] = Field(min_length=1)


class ReorderRequest(BaseModel):
    """Full ordered list of card_ids — the new positions are inferred
    from the array index. Atomic: the whole reorder either succeeds or
    nothing changes."""
    card_ids: list[UUID]


class UpdateLessonRequest(BaseModel):
    lesson_md: str | None = None


class PublicPathOut(BaseModel):
    """Public read-only view — username + slug pair instead of the
    owner's UUID."""
    title: str
    slug: str
    description_md: str | None
    cover_url: str | None
    author_username: str
    cards: list[PathCardItem]
    created_at: datetime
