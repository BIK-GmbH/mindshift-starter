"""Minimal MCP (Model Context Protocol) client.

Talks JSON-RPC 2.0 over plain HTTP POST (Streamable-HTTP transport) or
SSE. The official `mcp` Python SDK pulls a newer starlette than our
FastAPI version allows, so we implement just the two methods we need:

  - initialize  — handshake + capability negotiation
  - tools/list  — list available tools
  - tools/call  — invoke a tool

This is enough for the Posts-tab "Publish via …" flow and the Settings
"Test connection" button. If we later need resources, prompts, or
samplings we can add them here without re-architecting.
"""

from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_PROTOCOL_VERSION = "2025-06-18"  # current MCP spec revision
_CLIENT_INFO = {"name": "mindshift", "version": "0.1.0"}


class MCPError(Exception):
    """Wrap a JSON-RPC error or transport failure with a friendly message
    for the API layer to forward to the user."""


@dataclass(slots=True)
class MCPTool:
    name: str
    description: str | None
    input_schema: dict | None


def _build_headers(*, auth_type: str, auth_secret: str, auth_header_name: str | None) -> dict[str, str]:
    """Translate the stored auth config into HTTP headers for the
    upstream MCP server."""
    headers = {
        # MCP servers respond differently depending on Accept — most
        # support both application/json (single response) and
        # text/event-stream (SSE streaming). Quote both so the server
        # can pick either.
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
    }
    if auth_type == "bearer" and auth_secret:
        headers["Authorization"] = f"Bearer {auth_secret}"
    elif auth_type == "header" and auth_secret and auth_header_name:
        headers[auth_header_name] = auth_secret
    return headers


def _next_id() -> str:
    return uuid.uuid4().hex


def _parse_sse_response(body: bytes) -> dict:
    """Some MCP servers respond to a single POST with an SSE stream of
    one event; pull the first JSON payload out and return it. Falls
    back to plain-JSON parsing when there's no `data:` prefix."""
    text = body.decode("utf-8", errors="replace")
    for line in text.splitlines():
        if line.startswith("data:"):
            payload = line.removeprefix("data:").strip()
            if payload:
                return json.loads(payload)
    return json.loads(text)


def _rpc(
    *,
    url: str,
    method: str,
    params: dict | None = None,
    headers: dict[str, str],
    timeout: float = 20.0,
) -> dict:
    """Single JSON-RPC request to an MCP HTTP endpoint. Raises
    MCPError on transport or protocol failure."""
    payload: dict[str, Any] = {
        "jsonrpc": "2.0",
        "id": _next_id(),
        "method": method,
    }
    if params is not None:
        payload["params"] = params

    try:
        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            resp = client.post(url, json=payload, headers=headers)
    except httpx.HTTPError as exc:
        raise MCPError(f"Couldn't reach MCP server: {exc}") from exc

    if resp.status_code in (401, 403):
        raise MCPError("Authentication rejected by the MCP server.")
    if resp.status_code >= 500:
        raise MCPError(f"MCP server error (HTTP {resp.status_code}).")
    if resp.status_code >= 400:
        raise MCPError(f"MCP server refused the request (HTTP {resp.status_code}).")

    body = resp.content
    if not body:
        raise MCPError("Empty response from MCP server.")
    try:
        data = _parse_sse_response(body)
    except json.JSONDecodeError as exc:
        raise MCPError(f"MCP server returned non-JSON: {exc}") from exc

    if isinstance(data, dict) and "error" in data:
        err = data["error"]
        msg = (
            err.get("message") if isinstance(err, dict) else None
        ) or str(err)
        raise MCPError(f"MCP error: {msg}")
    if not isinstance(data, dict) or "result" not in data:
        raise MCPError("Malformed JSON-RPC response (no `result`).")
    return data["result"]


def _initialize(url: str, headers: dict[str, str]) -> None:
    """MCP handshake. Most servers require this before tools/list works.
    Failure is non-fatal — some hosted MCP servers skip the dance and
    accept tools/list straight away — but we try anyway and ignore
    "method not found" errors."""
    try:
        _rpc(
            url=url,
            method="initialize",
            params={
                "protocolVersion": _PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": _CLIENT_INFO,
            },
            headers=headers,
            timeout=10.0,
        )
    except MCPError as exc:
        # Soft-fail: most servers accept tools/list without init, and
        # the test-connection button will surface a clearer error below
        # if the next call fails too.
        logger.info("MCP initialize call returned %s — continuing anyway", exc)


def list_tools(
    *,
    url: str,
    auth_type: str = "none",
    auth_secret: str = "",
    auth_header_name: str | None = None,
) -> list[MCPTool]:
    """Connect to `url`, run the handshake, return discovered tools."""
    headers = _build_headers(
        auth_type=auth_type,
        auth_secret=auth_secret,
        auth_header_name=auth_header_name,
    )
    _initialize(url, headers)
    result = _rpc(url=url, method="tools/list", params={}, headers=headers)
    raw_tools = result.get("tools") or []
    out: list[MCPTool] = []
    for t in raw_tools:
        if not isinstance(t, dict):
            continue
        out.append(
            MCPTool(
                name=str(t.get("name") or ""),
                description=t.get("description"),
                input_schema=t.get("inputSchema") or t.get("input_schema"),
            )
        )
    return [t for t in out if t.name]


def call_tool(
    *,
    url: str,
    tool_name: str,
    arguments: dict,
    auth_type: str = "none",
    auth_secret: str = "",
    auth_header_name: str | None = None,
    timeout: float = 60.0,
) -> dict:
    """Invoke a tool by name. Returns the raw `result` block from the
    JSON-RPC response — typically `{ "content": [...], "isError": bool }`."""
    headers = _build_headers(
        auth_type=auth_type,
        auth_secret=auth_secret,
        auth_header_name=auth_header_name,
    )
    _initialize(url, headers)
    return _rpc(
        url=url,
        method="tools/call",
        params={"name": tool_name, "arguments": arguments},
        headers=headers,
        timeout=timeout,
    )
