"""quiz_questions choices_json (multiple-choice distractors)

Revision ID: 0010_quiz_choices
Revises: 0009_card_reactions
Create Date: 2026-05-08

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0010_quiz_choices"
down_revision: Union[str, None] = "0009_card_reactions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "quiz_questions",
        sa.Column("choices_json", sa.JSON, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("quiz_questions", "choices_json")
