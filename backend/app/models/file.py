"""Persisted user-uploaded files (PDFs today, avatars + audio later)."""

from uuid import UUID

from sqlalchemy import BigInteger, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid


class File(Base, TimestampMixin):
    __tablename__ = "files"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=new_uuid)
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    original_filename: Mapped[str] = mapped_column(String(500), nullable=False)
    content_type: Mapped[str] = mapped_column(String(120), nullable=False, default="application/octet-stream")
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    # Where the storage backend wrote the bytes. For `local` this is a
    # path relative to `STORAGE_PATH`. For S3 this would be the object key.
    storage_path: Mapped[str] = mapped_column(String(800), nullable=False, unique=True)
    # Used to dedupe re-uploads of the same content (per user).
    sha256: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # Lets the upload caller tag a file with what it's for, e.g. "pdf",
    # "avatar". Useful for cleanup and quota reporting later.
    purpose: Mapped[str] = mapped_column(String(40), nullable=False, default="generic", index=True)
