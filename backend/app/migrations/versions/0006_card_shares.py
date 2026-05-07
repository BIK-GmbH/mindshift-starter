"""card share tokens

Revision ID: 0006_card_shares
Revises: 0005_chat_sessions
Create Date: 2026-05-08

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0006_card_shares"
down_revision: Union[str, None] = "0005_chat_sessions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "card_shares",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "card_id",
            UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("token", sa.String(48), nullable=False, unique=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_card_shares_card_id", "card_shares", ["card_id"])
    op.create_index("ix_card_shares_token", "card_shares", ["token"])


def downgrade() -> None:
    op.drop_index("ix_card_shares_token", table_name="card_shares")
    op.drop_index("ix_card_shares_card_id", table_name="card_shares")
    op.drop_table("card_shares")
