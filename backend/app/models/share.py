"""Public read-only share tokens for cards."""

from secrets import token_urlsafe
from uuid import UUID

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid


def make_share_token() -> str:
    """24-char URL-safe token (≈ 144 bits)."""
    return token_urlsafe(18)


class CardShare(Base, TimestampMixin):
    __tablename__ = "card_shares"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=new_uuid)
    card_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
        unique=True,
    )
    token: Mapped[str] = mapped_column(String(48), nullable=False, unique=True, default=make_share_token)
