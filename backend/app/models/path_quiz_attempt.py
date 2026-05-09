"""Persisted records of path-quiz runs.

Each row is a single completed quiz session — score and total at the
moment of completion. We deliberately do NOT mirror per-question state
here; the existing card-level review flow handles spaced-repetition.
This table answers "how am I doing on this path over time": best
score, attempt count, last attempt.
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid


class PathQuizAttempt(Base, TimestampMixin):
    __tablename__ = "path_quiz_attempts"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=new_uuid)
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    path_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("paths.id", ondelete="CASCADE"), nullable=False, index=True
    )
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    total: Mapped[int] = mapped_column(Integer, nullable=False)
    # Wall-clock seconds the user spent on the quiz, measured client-side.
    # Useful for "are you getting faster?" without a full event stream.
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="now()"
    )
