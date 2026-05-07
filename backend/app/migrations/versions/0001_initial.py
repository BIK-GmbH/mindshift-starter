"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-05-07

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSON, UUID

revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(320), nullable=False, unique=True, index=True),
        sa.Column("display_name", sa.String(120), nullable=True),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "sources",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("source_type", sa.String(40), nullable=False, index=True),
        sa.Column("url", sa.String(2048), nullable=False),
        sa.Column("canonical_url", sa.String(2048), nullable=True),
        sa.Column("external_id", sa.String(255), nullable=True, index=True),
        sa.Column("metadata_json", JSON, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "cards",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("source_id", UUID(as_uuid=True), sa.ForeignKey("sources.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("source_type", sa.String(40), nullable=False, index=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="queued", index=True),
        sa.Column("thumbnail_url", sa.String(2048), nullable=True),
        sa.Column("concise_summary_md", sa.Text, nullable=True),
        sa.Column("detailed_summary_md", sa.Text, nullable=True),
        sa.Column("key_takeaways_json", JSON, nullable=True),
        sa.Column("notes_md", sa.Text, nullable=True),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "transcripts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("card_id", UUID(as_uuid=True), sa.ForeignKey("cards.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("language", sa.String(10), nullable=True),
        sa.Column("text", sa.Text, nullable=False),
        sa.Column("segments_json", JSON, nullable=True),
        sa.Column("provider", sa.String(50), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "tags",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("color", sa.String(20), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "name", name="uq_tags_user_name"),
    )

    op.create_table(
        "card_tags",
        sa.Column("card_id", UUID(as_uuid=True), sa.ForeignKey("cards.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("tag_id", UUID(as_uuid=True), sa.ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
    )

    op.create_table(
        "entities",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False, index=True),
        sa.Column("entity_type", sa.String(80), nullable=True),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "card_entities",
        sa.Column("card_id", UUID(as_uuid=True), sa.ForeignKey("cards.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("entity_id", UUID(as_uuid=True), sa.ForeignKey("entities.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("relevance_score", sa.Float, nullable=True),
    )

    op.create_table(
        "card_relations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("from_card_id", UUID(as_uuid=True), sa.ForeignKey("cards.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("to_card_id", UUID(as_uuid=True), sa.ForeignKey("cards.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("relation_type", sa.String(40), nullable=False),
        sa.Column("confidence", sa.Float, nullable=True),
        sa.Column("created_by", sa.String(40), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "quiz_questions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("card_id", UUID(as_uuid=True), sa.ForeignKey("cards.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("question", sa.Text, nullable=False),
        sa.Column("answer", sa.Text, nullable=False),
        sa.Column("question_type", sa.String(40), nullable=False, server_default="open"),
        sa.Column("difficulty", sa.String(20), nullable=True),
        sa.Column("source_excerpt", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "review_events",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("question_id", UUID(as_uuid=True), sa.ForeignKey("quiz_questions.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("rating", sa.String(20), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("next_due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("stage", sa.String(20), nullable=True),
        sa.Column("interval_days", sa.Integer, nullable=True),
    )

    op.create_table(
        "jobs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("card_id", UUID(as_uuid=True), sa.ForeignKey("cards.id", ondelete="CASCADE"), nullable=True, index=True),
        sa.Column("job_type", sa.String(40), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="queued", index=True),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("jobs")
    op.drop_table("review_events")
    op.drop_table("quiz_questions")
    op.drop_table("card_relations")
    op.drop_table("card_entities")
    op.drop_table("entities")
    op.drop_table("card_tags")
    op.drop_table("tags")
    op.drop_table("transcripts")
    op.drop_table("cards")
    op.drop_table("sources")
    op.drop_table("users")
