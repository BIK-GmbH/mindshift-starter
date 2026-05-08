"""learning sessions (auto-bucketed) + session_id on review_events

Revision ID: 0012_learning_sessions
Revises: 0011_graph_presets
Create Date: 2026-05-08

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0012_learning_sessions"
down_revision: Union[str, None] = "0011_graph_presets"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "learning_sessions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("event_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("correct_count", sa.Integer, nullable=False, server_default="0"),
    )
    op.create_index("ix_learning_sessions_user_id", "learning_sessions", ["user_id"])
    op.create_index(
        "ix_learning_sessions_user_ended",
        "learning_sessions",
        ["user_id", "ended_at"],
    )

    op.add_column(
        "review_events",
        sa.Column(
            "session_id",
            UUID(as_uuid=True),
            sa.ForeignKey("learning_sessions.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_review_events_session_id", "review_events", ["session_id"])


def downgrade() -> None:
    op.drop_index("ix_review_events_session_id", table_name="review_events")
    op.drop_column("review_events", "session_id")
    op.drop_index("ix_learning_sessions_user_ended", table_name="learning_sessions")
    op.drop_index("ix_learning_sessions_user_id", table_name="learning_sessions")
    op.drop_table("learning_sessions")
