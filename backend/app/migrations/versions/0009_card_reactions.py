"""card reactions (anonymous, ip-rate-limited)

Revision ID: 0009_card_reactions
Revises: 0008_profile_and_tag_public
Create Date: 2026-05-08

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0009_card_reactions"
down_revision: Union[str, None] = "0008_profile_and_tag_public"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "card_reactions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "card_id",
            UUID(as_uuid=True),
            sa.ForeignKey("cards.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("ip_hash", sa.String(64), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("card_id", "ip_hash", "kind", name="uq_card_reactions_unique"),
    )
    op.create_index("ix_card_reactions_card_id", "card_reactions", ["card_id"])
    op.create_index("ix_card_reactions_ip_hash", "card_reactions", ["ip_hash"])


def downgrade() -> None:
    op.drop_index("ix_card_reactions_ip_hash", table_name="card_reactions")
    op.drop_index("ix_card_reactions_card_id", table_name="card_reactions")
    op.drop_table("card_reactions")
