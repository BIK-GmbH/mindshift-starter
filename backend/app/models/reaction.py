"""Anonymous reactions on public cards.

Identity is `sha256(ip + JWT_SECRET)` — never stored as a raw IP, never
linkable across instances. Three reaction kinds today: like, insightful,
mind-blown. Add new kinds by adjusting the validator in `api/reactions.py`.
"""

from uuid import UUID

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from datetime import datetime

from sqlalchemy import DateTime, func

from app.db.base import Base, new_uuid


class CardReaction(Base):
    __tablename__ = "card_reactions"
    __table_args__ = (
        UniqueConstraint("card_id", "ip_hash", "kind", name="uq_card_reactions_unique"),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=new_uuid)
    card_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("cards.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    ip_hash: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
