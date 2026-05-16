"""add onboarding_dismissed_at to users

Revision ID: 5471666575c8
Revises: 112a16b2363b
Create Date: 2026-05-16 14:00:58.634804

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5471666575c8'
down_revision: Union[str, None] = '112a16b2363b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # NULL = user hasn't dismissed the onboarding modal yet, so it
    # auto-opens on next sign-in. NOW() once the user clicks the
    # don't-show-again checkbox. Existing rows default to NULL so the
    # backfill matches the "every user sees it once" decision.
    op.add_column(
        "users",
        sa.Column("onboarding_dismissed_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "onboarding_dismissed_at")
