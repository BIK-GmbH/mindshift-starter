from uuid import UUID

from sqlalchemy import Float, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid


class CardRelation(Base, TimestampMixin):
    __tablename__ = "card_relations"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=new_uuid)
    from_card_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("cards.id", ondelete="CASCADE"), index=True, nullable=False
    )
    to_card_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("cards.id", ondelete="CASCADE"), index=True, nullable=False
    )
    relation_type: Mapped[str] = mapped_column(String(40), nullable=False)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(40), nullable=True)
