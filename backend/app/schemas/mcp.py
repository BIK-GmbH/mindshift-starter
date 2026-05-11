from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

Transport = Literal["http", "sse"]
AuthType = Literal["none", "bearer", "header"]


class MCPServerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    url: str = Field(min_length=1, max_length=2048)
    transport: Transport = "http"
    auth_type: AuthType = "none"
    auth_secret: str | None = Field(default=None, max_length=2048)
    auth_header_name: str | None = Field(default=None, max_length=120)
    is_active: bool = True


class MCPServerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    url: str | None = Field(default=None, min_length=1, max_length=2048)
    transport: Transport | None = None
    auth_type: AuthType | None = None
    # Empty string clears the secret; None leaves it unchanged.
    auth_secret: str | None = Field(default=None, max_length=2048)
    auth_header_name: str | None = Field(default=None, max_length=120)
    is_active: bool | None = None


class MCPToolOut(BaseModel):
    id: UUID
    server_id: UUID
    name: str
    description: str | None = None
    input_schema: dict | None = None
    last_seen_at: datetime


class MCPServerOut(BaseModel):
    id: UUID
    name: str
    transport: str
    url: str
    auth_type: str
    # We never return the secret itself — just a flag so the UI can
    # show "configured" vs "set new" without leaking the token.
    has_auth_secret: bool = False
    auth_header_name: str | None = None
    is_active: bool
    last_connected_at: datetime | None = None
    last_error: str | None = None
    tools: list[MCPToolOut] = []
    created_at: datetime
    updated_at: datetime


class MCPTestResult(BaseModel):
    ok: bool
    tool_count: int = 0
    tools: list[MCPToolOut] = []
    error: str | None = None


class MCPCallToolRequest(BaseModel):
    server_id: UUID
    tool_name: str = Field(min_length=1)
    arguments: dict = Field(default_factory=dict)


class MCPCallToolResponse(BaseModel):
    ok: bool
    # Raw MCP `result` block (content array + isError flag). Frontend
    # extracts a human-readable summary from it.
    result: dict | None = None
    error: str | None = None
