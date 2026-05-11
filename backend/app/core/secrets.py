"""Symmetric encryption for at-rest secrets (MCP auth tokens, etc).

Backed by Fernet (AES-128 + HMAC-SHA-256). The key comes from
`MCP_ENCRYPTION_KEY` — a urlsafe-base64-encoded 32-byte value. Generate
once with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
and add to .env.

If the env var is missing in development we fall back to a stable
dev-key DERIVED from the JWT_SECRET so the app still boots and round-
trips, but the actual cipher-text is NOT portable across machines —
production deployments MUST set MCP_ENCRYPTION_KEY explicitly.
"""

from __future__ import annotations

import base64
import hashlib
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import get_settings


@lru_cache
def _cipher() -> Fernet:
    settings = get_settings()
    raw = (settings.mcp_encryption_key or "").strip()
    if raw:
        # Caller provided a real key. Fernet requires a urlsafe-base64
        # 32-byte string; we just hand it through and let Fernet validate.
        try:
            return Fernet(raw.encode())
        except (ValueError, TypeError) as exc:
            raise RuntimeError(
                "MCP_ENCRYPTION_KEY is set but isn't a valid Fernet key. "
                "Generate one with "
                "`python -c \"from cryptography.fernet import Fernet; "
                "print(Fernet.generate_key().decode())\"`."
            ) from exc

    # Dev fallback — derive a Fernet key from JWT_SECRET so encrypt /
    # decrypt round-trips work on the same machine. Print a one-line
    # warning so production never silently relies on this path.
    digest = hashlib.sha256(settings.jwt_secret.encode()).digest()
    derived = base64.urlsafe_b64encode(digest)
    import logging

    logging.getLogger(__name__).warning(
        "MCP_ENCRYPTION_KEY missing — using a JWT_SECRET-derived dev key. "
        "Set MCP_ENCRYPTION_KEY in production."
    )
    return Fernet(derived)


def encrypt(plain: str) -> str:
    """Encrypt a plain-text secret. Returns the encrypted token as a
    urlsafe-base64 string ready to store in a Text column."""
    if not plain:
        return ""
    return _cipher().encrypt(plain.encode()).decode()


def decrypt(token: str) -> str:
    """Decrypt a token written by `encrypt`. Returns "" when the token
    is empty or fails to decrypt — never raises, so a key rotation
    doesn't crash the whole API."""
    if not token:
        return ""
    try:
        return _cipher().decrypt(token.encode()).decode()
    except InvalidToken:
        return ""
