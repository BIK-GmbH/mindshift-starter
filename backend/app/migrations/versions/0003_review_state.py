"""spaced-repetition fields on quiz_questions

Revision ID: 0003_review_state
Revises: 0002_embeddings_pgvector
Create Date: 2026-05-07

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003_review_state"
down_revision: Union[str, None] = "0002_embeddings_pgvector"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "quiz_questions",
        sa.Column("stage", sa.String(20), nullable=False, server_default="new"),
    )
    op.add_column(
        "quiz_questions",
        sa.Column("interval_days", sa.Float, nullable=False, server_default="0"),
    )
    op.add_column(
        "quiz_questions",
        sa.Column("lapses", sa.Integer, nullable=False, server_default="0"),
    )
    op.add_column(
        "quiz_questions",
        sa.Column("last_reviewed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "quiz_questions",
        sa.Column("next_due_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_quiz_questions_next_due_at",
        "quiz_questions",
        ["next_due_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_quiz_questions_next_due_at", table_name="quiz_questions")
    op.drop_column("quiz_questions", "next_due_at")
    op.drop_column("quiz_questions", "last_reviewed_at")
    op.drop_column("quiz_questions", "lapses")
    op.drop_column("quiz_questions", "interval_days")
    op.drop_column("quiz_questions", "stage")
