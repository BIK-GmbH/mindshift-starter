"""Saved social-media post drafts per card.

The Posts tab on a card lets the user generate LinkedIn / X / etc.
drafts from the card's title + summary + key takeaways. Each draft is
saved here so the user can come back without re-burning OpenAI credits
and so we keep a short history of variations they've tried.

Image bytes (when the user asked for one) live in the `files` table;
this row just holds the file_id reference.
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    ARRAY,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, new_uuid


class CardSocialPost(Base):
    __tablename__ = "card_social_posts"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=new_uuid)
    card_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    # Free-form so we can add more platforms (bluesky, mastodon, threads)
    # without a migration. Validated at the Pydantic boundary.
    platform: Mapped[str] = mapped_column(String(24), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    # Hashtags returned alongside the text — surfaced as a separate
    # chips row in the UI so they can be copied independently.
    hashtags: Mapped[list[str] | None] = mapped_column(ARRAY(String), nullable=True)
    character_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Optional cover image (gpt-image-2 generated) — file_id references
    # the standard files table; image bytes flow through the public
    # /api/files/{id}/data endpoint authenticated against the user.
    image_file_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("files.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Unguessable share token for the post's image. When set, the bytes
    # are reachable WITHOUT auth at /api/public/post-images/{token}.png
    # so external systems (e.g. Reepl's MCP server pulling mediaUrls)
    # can fetch the image during a publish. Auto-generated the first
    # time an image is attached to the post.
    image_share_token: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True, unique=True, index=True, default=None
    )
    # Generation parameters echoed back so the UI can show them next to
    # each saved draft (and so a "Variation" click can start from the
    # same tone). All optional.
    tone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    language: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
