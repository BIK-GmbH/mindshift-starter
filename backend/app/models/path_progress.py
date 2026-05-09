"""Per-user progress through a learning path.

One row per (user, path). Updated whenever the player navigates to a
new step; on reaching the last step, `completed_at` is stamped and the
path's `completion_count` is incremented (idempotent — re-completing
the same path doesn't double-count).
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid


class PathProgress(Base, TimestampMixin):
    __tablename__ = "path_progress"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=new_uuid)
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    path_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("paths.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Highest step the user has reached so far (0-based). When the player
    # navigates to step N, we max(current_position, N) so revisiting an
    # earlier card doesn't move the bookmark backwards.
    current_position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default="now()"
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (UniqueConstraint("user_id", "path_id", name="uq_path_progress_user_path"),)
