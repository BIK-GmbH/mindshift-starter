"""MCP (Model Context Protocol) server registry — per-user.

The user configures third-party MCP servers in Settings; each server's
tools are then discoverable from Mindshift features (e.g. the Posts
tab's "Publish via …" dropdown). Auth secrets are encrypted at rest
with a Fernet key from `MCP_ENCRYPTION_KEY`.

A second table caches the tools the server advertises so the UI can
show them without re-querying on every render. Tools refresh on the
manual "Test connection" button or via a scheduled refresh.
"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    JSON,
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, new_uuid


class MCPServer(Base):
    __tablename__ = "mcp_servers"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_mcp_servers_user_name"),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=new_uuid)
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # "http" = single POST endpoint, "sse" = streaming Server-Sent-Events.
    # stdio (local process) is deliberately not supported here.
    transport: Mapped[str] = mapped_column(String(20), nullable=False, default="http")
    url: Mapped[str] = mapped_column(String(2048), nullable=False)
    # "none" | "bearer" | "header" (custom header name in auth_header_name)
    auth_type: Mapped[str] = mapped_column(String(20), nullable=False, default="none")
    # Fernet-encrypted secret (bearer token / header value). NULL when
    # auth_type = "none".
    auth_secret_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Custom header name when auth_type = "header" (e.g. "X-API-Key").
    auth_header_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)
    last_connected_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class MCPTool(Base):
    __tablename__ = "mcp_tools"
    __table_args__ = (
        UniqueConstraint("server_id", "name", name="uq_mcp_tools_server_name"),
    )

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=new_uuid)
    server_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("mcp_servers.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    input_schema_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
