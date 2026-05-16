"""add web_citations_json to chat_messages

Revision ID: d25f43eb72a7
Revises: 5471666575c8
Create Date: 2026-05-16 16:50:25.091726

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd25f43eb72a7'
down_revision: Union[str, None] = '5471666575c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Backfill for a column that already exists on the SQLAlchemy model
    # (chat_messages.web_citations_json) but never had a migration
    # written for it. Local dev DBs created via create_all() carried it
    # silently; Prod, which only ever runs `alembic upgrade`, was
    # missing the column entirely — every /api/cards/{id}/chat POST
    # hit an UndefinedColumn and returned 500. `IF NOT EXISTS` keeps
    # this idempotent for any DB that already drifted into having it.
    op.execute(
        "ALTER TABLE chat_messages "
        "ADD COLUMN IF NOT EXISTS web_citations_json JSON"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE chat_messages DROP COLUMN IF EXISTS web_citations_json"
    )
