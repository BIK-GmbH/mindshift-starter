"""add key_takeaways_json column to card_translations

Revision ID: 0019_translation_takeaways
Revises: 0018_card_translations
Create Date: 2026-05-08

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0019_translation_takeaways"
down_revision: Union[str, None] = "0018_card_translations"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "card_translations",
        sa.Column("key_takeaways_json", sa.JSON, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("card_translations", "key_takeaways_json")
