from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_uuid


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=new_uuid)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    # Public-profile fields. When `public_profile` is true and `username`
    # is set, the profile becomes accessible at `/u/<username>`.
    username: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    avatar_file_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("files.id", ondelete="SET NULL"), nullable=True
    )
    public_profile: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Site-wide admin flag. Admins can list/create/edit/delete other users
    # through the /api/admin/users endpoints. There's no public sign-up
    # for admin — set it explicitly via SQL or via another admin.
    is_admin: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )

    # Per-user preferences blob. Allowlist of keys is enforced at the
    # Pydantic boundary in `app/schemas/preferences.py` so the JSONB
    # doesn't drift into a free-for-all.
    preferences_json: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )

    # Welcome / extension-install tour. NULL = the modal auto-opens on
    # the user's next session; once they click "don't show again" we
    # write NOW() and the modal stays quiet unless explicitly reopened.
    onboarding_dismissed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
