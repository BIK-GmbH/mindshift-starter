"""add image_share_token to card_social_posts

Revision ID: b7c91d4f3201
Revises: 651c7fda0495
Create Date: 2026-05-11 17:50:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "b7c91d4f3201"
down_revision: Union[str, None] = "651c7fda0495"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "card_social_posts",
        sa.Column(
            "image_share_token",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.create_unique_constraint(
        "uq_card_social_posts_image_share_token",
        "card_social_posts",
        ["image_share_token"],
    )
    op.create_index(
        "ix_card_social_posts_image_share_token",
        "card_social_posts",
        ["image_share_token"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_card_social_posts_image_share_token",
        table_name="card_social_posts",
    )
    op.drop_constraint(
        "uq_card_social_posts_image_share_token",
        "card_social_posts",
        type_="unique",
    )
    op.drop_column("card_social_posts", "image_share_token")
