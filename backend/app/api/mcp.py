"""User-scoped MCP server registry + tool invocation.

Endpoints:

  GET    /api/mcp/servers                — list the caller's servers + cached tools
  POST   /api/mcp/servers                — register a new server
  PATCH  /api/mcp/servers/{id}           — edit (name, url, auth, …)
  DELETE /api/mcp/servers/{id}           — remove (cascades to tools)
  POST   /api/mcp/servers/{id}/test      — ping the server + refresh cached tools
  POST   /api/mcp/call                   — invoke a tool by (server, tool_name, args)
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.secrets import decrypt, encrypt
from app.db.session import get_db
from app.models.mcp import MCPServer, MCPTool
from app.models.user import User
from app.schemas.mcp import (
    MCPCallToolRequest,
    MCPCallToolResponse,
    MCPServerCreate,
    MCPServerOut,
    MCPServerUpdate,
    MCPTestResult,
    MCPToolOut,
)
from app.services.mcp_client import MCPError, call_tool, list_tools

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/mcp", tags=["mcp"])


def _server_to_out(server: MCPServer, tools: list[MCPTool]) -> MCPServerOut:
    return MCPServerOut(
        id=server.id,
        name=server.name,
        transport=server.transport,
        url=server.url,
        auth_type=server.auth_type,
        has_auth_secret=bool(server.auth_secret_encrypted),
        auth_header_name=server.auth_header_name,
        is_active=server.is_active,
        last_connected_at=server.last_connected_at,
        last_error=server.last_error,
        tools=[
            MCPToolOut(
                id=t.id,
                server_id=t.server_id,
                name=t.name,
                description=t.description,
                input_schema=t.input_schema_json,
                last_seen_at=t.last_seen_at,
            )
            for t in tools
        ],
        created_at=server.created_at,
        updated_at=server.updated_at,
    )


def _load_server(db: Session, server_id: UUID, user_id: UUID) -> MCPServer:
    server = db.get(MCPServer, server_id)
    if server is None or server.user_id != user_id:
        raise HTTPException(status_code=404, detail="MCP server not found")
    return server


def _tools_for(db: Session, server_id: UUID) -> list[MCPTool]:
    return list(
        db.execute(
            select(MCPTool).where(MCPTool.server_id == server_id).order_by(MCPTool.name)
        ).scalars()
    )


@router.get("/servers", response_model=list[MCPServerOut])
def list_servers(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[MCPServerOut]:
    rows = (
        db.execute(
            select(MCPServer)
            .where(MCPServer.user_id == current_user.id)
            .order_by(MCPServer.created_at.desc())
        )
        .scalars()
        .all()
    )
    return [_server_to_out(s, _tools_for(db, s.id)) for s in rows]


@router.post("/servers", response_model=MCPServerOut, status_code=status.HTTP_201_CREATED)
def create_server(
    payload: MCPServerCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MCPServerOut:
    existing = db.execute(
        select(MCPServer).where(
            MCPServer.user_id == current_user.id,
            MCPServer.name == payload.name.strip(),
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="A server with that name already exists")

    server = MCPServer(
        user_id=current_user.id,
        name=payload.name.strip(),
        url=payload.url.strip(),
        transport=payload.transport,
        auth_type=payload.auth_type,
        auth_header_name=(payload.auth_header_name or "").strip() or None,
        auth_secret_encrypted=encrypt(payload.auth_secret or "")
        if payload.auth_secret
        else None,
        is_active=payload.is_active,
    )
    db.add(server)
    db.commit()
    db.refresh(server)
    return _server_to_out(server, [])


@router.patch("/servers/{server_id}", response_model=MCPServerOut)
def update_server(
    server_id: UUID,
    payload: MCPServerUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MCPServerOut:
    server = _load_server(db, server_id, current_user.id)

    if payload.name is not None:
        server.name = payload.name.strip()
    if payload.url is not None:
        server.url = payload.url.strip()
    if payload.transport is not None:
        server.transport = payload.transport
    if payload.auth_type is not None:
        server.auth_type = payload.auth_type
    if payload.auth_header_name is not None:
        server.auth_header_name = payload.auth_header_name.strip() or None
    if payload.auth_secret is not None:
        # Explicit empty string = clear the secret.
        server.auth_secret_encrypted = (
            encrypt(payload.auth_secret) if payload.auth_secret else None
        )
    if payload.is_active is not None:
        server.is_active = payload.is_active

    db.commit()
    db.refresh(server)
    return _server_to_out(server, _tools_for(db, server.id))


@router.delete("/servers/{server_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_server(
    server_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    server = _load_server(db, server_id, current_user.id)
    db.delete(server)
    db.commit()


@router.post("/servers/{server_id}/test", response_model=MCPTestResult)
def test_server(
    server_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MCPTestResult:
    """Connect to the MCP server, refresh the cached tool list."""
    server = _load_server(db, server_id, current_user.id)
    auth_secret = (
        decrypt(server.auth_secret_encrypted) if server.auth_secret_encrypted else ""
    )
    try:
        tools = list_tools(
            url=server.url,
            auth_type=server.auth_type,
            auth_secret=auth_secret,
            auth_header_name=server.auth_header_name,
        )
    except MCPError as exc:
        server.last_error = str(exc)[:1000]
        server.last_connected_at = None
        db.commit()
        return MCPTestResult(ok=False, error=str(exc))

    # Refresh cache: delete old rows, insert new. This is a small set
    # (<50 tools per server in practice), so a full replace is simpler
    # than a diff.
    db.execute(MCPTool.__table__.delete().where(MCPTool.server_id == server.id))
    db.flush()
    now = datetime.now(tz=timezone.utc)
    for t in tools:
        db.add(
            MCPTool(
                server_id=server.id,
                name=t.name,
                description=t.description,
                input_schema_json=t.input_schema,
                last_seen_at=now,
            )
        )
    server.last_connected_at = now
    server.last_error = None
    db.commit()

    refreshed = _tools_for(db, server.id)
    return MCPTestResult(
        ok=True,
        tool_count=len(refreshed),
        tools=[
            MCPToolOut(
                id=t.id,
                server_id=t.server_id,
                name=t.name,
                description=t.description,
                input_schema=t.input_schema_json,
                last_seen_at=t.last_seen_at,
            )
            for t in refreshed
        ],
    )


@router.post("/call", response_model=MCPCallToolResponse)
def invoke_tool(
    payload: MCPCallToolRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MCPCallToolResponse:
    """Invoke a tool on one of the caller's MCP servers."""
    server = _load_server(db, payload.server_id, current_user.id)
    if not server.is_active:
        raise HTTPException(status_code=400, detail="Server is paused")
    auth_secret = (
        decrypt(server.auth_secret_encrypted) if server.auth_secret_encrypted else ""
    )
    try:
        result = call_tool(
            url=server.url,
            tool_name=payload.tool_name,
            arguments=payload.arguments,
            auth_type=server.auth_type,
            auth_secret=auth_secret,
            auth_header_name=server.auth_header_name,
        )
        return MCPCallToolResponse(ok=True, result=result)
    except MCPError as exc:
        return MCPCallToolResponse(ok=False, error=str(exc))
