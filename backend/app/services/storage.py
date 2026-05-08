"""File storage abstraction.

Single interface, multiple backends. Today we ship `local` (disk-backed),
which works both for dev and for any mounted volume — point
`STORAGE_PATH` at the volume mount and the same code runs in production
(e.g. Railway volumes mounted at `/data`). `s3` is reserved for a future
implementation; adding it is just another class with the same methods.

Files are content-addressed *per user* via SHA-256: identical content
re-uploaded by the same user reuses the existing path (saves bytes), but
two users uploading the same content get separate copies (avoids any
chance of leakage between accounts).
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.file import File


@dataclass(slots=True)
class SavedFile:
    """Result of a successful save — the persisted DB row."""

    file: File


class Storage(Protocol):
    """Protocol every backend implements."""

    def save(
        self,
        db: Session,
        *,
        user_id: UUID,
        content: bytes,
        original_filename: str,
        content_type: str,
        purpose: str = "generic",
    ) -> File: ...

    def read(self, file: File) -> bytes: ...

    def delete(self, db: Session, file: File) -> None: ...


class LocalStorage:
    """Filesystem-backed storage. Works for dev and any mounted volume."""

    def __init__(self, base_path: str | Path):
        self.base = Path(base_path).resolve()
        self.base.mkdir(parents=True, exist_ok=True)

    def _abs(self, relative_path: str) -> Path:
        # Refuse traversal outside `self.base` defensively.
        p = (self.base / relative_path).resolve()
        if self.base not in p.parents and p != self.base:
            raise ValueError(f"refusing to access {p} outside of storage root")
        return p

    def save(
        self,
        db: Session,
        *,
        user_id: UUID,
        content: bytes,
        original_filename: str,
        content_type: str,
        purpose: str = "generic",
    ) -> File:
        size_bytes = len(content)
        if size_bytes == 0:
            raise HTTPException(status_code=400, detail="Refusing to store empty file")

        # Per-user quota check. Sum of all that user's files in DB.
        settings = get_settings()
        used = (
            db.execute(
                select(func.coalesce(func.sum(File.size_bytes), 0)).where(File.user_id == user_id)
            ).scalar()
            or 0
        )
        if int(used) + size_bytes > settings.storage_max_bytes_per_user:
            raise HTTPException(
                status_code=413,
                detail=f"Storage quota exceeded ({settings.storage_max_bytes_per_user // (1024 * 1024)} MiB).",
            )

        sha = hashlib.sha256(content).hexdigest()
        # Per-user directory + 2-char fan-out so a single dir doesn't
        # grow to 100k entries. Subdir per `purpose` keeps avatars,
        # PDFs, etc. tidy.
        rel = f"{user_id}/{purpose}/{sha[:2]}/{sha}"

        # Dedupe: if this user already saved the same content for the
        # same purpose, return the existing row.
        existing = db.execute(
            select(File).where(
                File.user_id == user_id,
                File.sha256 == sha,
                File.purpose == purpose,
            )
        ).scalar_one_or_none()
        if existing is not None:
            return existing

        abs_path = self._abs(rel)
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        # Write atomically so crashes can't leave a half-written file
        # under the canonical name.
        tmp = abs_path.with_suffix(abs_path.suffix + ".tmp")
        with open(tmp, "wb") as f:
            f.write(content)
        os.replace(tmp, abs_path)

        record = File(
            user_id=user_id,
            original_filename=original_filename[:500] or "file",
            content_type=content_type[:120] or "application/octet-stream",
            size_bytes=size_bytes,
            storage_path=rel,
            sha256=sha,
            purpose=purpose[:40] or "generic",
        )
        db.add(record)
        db.flush()
        return record

    def read(self, file: File) -> bytes:
        path = self._abs(file.storage_path)
        if not path.exists():
            raise HTTPException(status_code=410, detail="File no longer in storage")
        with open(path, "rb") as f:
            return f.read()

    def delete(self, db: Session, file: File) -> None:
        path = self._abs(file.storage_path)
        try:
            path.unlink(missing_ok=True)
            # Best-effort cleanup of empty parent dirs.
            cur = path.parent
            for _ in range(3):
                if cur == self.base:
                    break
                try:
                    cur.rmdir()
                except OSError:
                    break
                cur = cur.parent
        finally:
            db.delete(file)


_storage: Storage | None = None


def get_storage() -> Storage:
    """Singleton accessor — instantiates the configured backend."""
    global _storage
    if _storage is None:
        settings = get_settings()
        if settings.storage_backend == "local":
            _storage = LocalStorage(settings.storage_path)
        else:
            raise NotImplementedError(
                f"Storage backend {settings.storage_backend!r} is not implemented yet"
            )
    return _storage
