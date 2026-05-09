"""Learning-path business logic — kept out of the API layer so the
public read-side and the owner CRUD-side can share the same helpers.

Slug strategy: the title is normalised to lowercase ASCII with
hyphens; a numeric suffix is appended on collision so renaming a path
never breaks an existing public URL (we only regenerate the slug on
explicit request).
"""

from __future__ import annotations

import re
import unicodedata
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.path import Path, PathCard


_SLUG_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_SLUG_TRIM = re.compile(r"^-+|-+$")


def slugify(value: str, fallback: str = "path") -> str:
    """ASCII-folded, hyphen-separated lowercase slug. Empty or all-symbol
    titles fall back to the provided default so we always return something
    URL-safe."""
    normalised = unicodedata.normalize("NFKD", value or "")
    ascii_only = "".join(c for c in normalised if not unicodedata.combining(c))
    lowered = ascii_only.lower()
    cleaned = _SLUG_NON_ALNUM.sub("-", lowered)
    cleaned = _SLUG_TRIM.sub("", cleaned)
    return cleaned[:120] or fallback


def unique_slug_for(db: Session, user_id: UUID, base: str, existing_path_id: UUID | None = None) -> str:
    """Return `base` if it's free for this user, else `base-2`, `base-3`, …
    Pass `existing_path_id` so renaming a path to a slug it already owns
    is a no-op rather than a collision."""
    candidate = base
    n = 1
    while True:
        stmt = select(Path.id).where(Path.user_id == user_id, Path.slug == candidate)
        if existing_path_id is not None:
            stmt = stmt.where(Path.id != existing_path_id)
        if db.execute(stmt).scalar_one_or_none() is None:
            return candidate
        n += 1
        candidate = f"{base}-{n}"


def renumber_positions(db: Session, path_id: UUID) -> None:
    """Compact a path's card positions to 0, 1, 2, …. Called whenever an
    insert / move / delete leaves gaps so reads can rely on a dense
    sequence."""
    rows = (
        db.execute(
            select(PathCard).where(PathCard.path_id == path_id).order_by(PathCard.position)
        )
        .scalars()
        .all()
    )
    for i, row in enumerate(rows):
        if row.position != i:
            row.position = i


def next_position(db: Session, path_id: UUID) -> int:
    """Position to assign to a freshly-added card — one past the current max."""
    current = db.execute(
        select(func.coalesce(func.max(PathCard.position), -1)).where(PathCard.path_id == path_id)
    ).scalar_one()
    return int(current) + 1
