"""Auto-bucketed learning sessions.

A session groups consecutive ReviewEvent rows for the same user when each
event happens within `SESSION_GAP_MINUTES` of the previous one. The bucket
boundary is computed at write time in `submit_answer` — no cron, no
recomputation. Sessions are append-only once created.
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, Integer
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, new_uuid


SESSION_GAP_MINUTES = 30


class LearningSession(Base):
    __tablename__ = "learning_sessions"
    __table_args__ = (
        Index("ix_learning_sessions_user_ended", "user_id", "ended_at"),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=new_uuid)
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    event_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    correct_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
