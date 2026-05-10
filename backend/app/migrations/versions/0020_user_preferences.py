"""add preferences_json column to users

Revision ID: 0020_user_preferences
Revises: 61e67a85908c
Create Date: 2026-05-10

Phase 3 of the browser-extension roadmap introduces a per-user
preferences blob — first consumer is the side-panel's "default
translation language". Stored as JSONB so future preferences (UI
density, default summary depth, …) can land without another
migration each time. The Pydantic schema enforces an allowlist of
recognised keys, so the JSONB doesn't degenerate into a free-for-all.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0020_user_preferences"
down_revision: Union[str, None] = "61e67a85908c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "preferences_json",
            JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "preferences_json")
