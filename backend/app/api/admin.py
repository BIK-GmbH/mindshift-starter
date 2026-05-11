"""Admin-only user management.

The whole router sits behind `require_admin`, which 403s any caller
whose token is for a non-admin account. Endpoints:

  GET    /api/admin/users             — list every user + stats
  POST   /api/admin/users             — create a fresh user
  PATCH  /api/admin/users/{id}        — edit (email, display_name,
                                         is_admin, public_profile, password)
  DELETE /api/admin/users/{id}        — cascade-delete user + on-disk files

Cascade delete is mostly handled by DB-level ON DELETE CASCADE on every
foreign key that references `users.id`. The only thing the DB can't do
is reach into the storage volume and remove the user's blob files —
we wipe `<storage_path>/<user_id>/...` explicitly before issuing the
DELETE.
"""

from __future__ import annotations

import logging
import shutil
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import get_settings
from app.core.security import hash_password
from app.db.session import get_db
from app.models.card import Card
from app.models.file import File
from app.models.user import User
from app.schemas.auth import AdminUserCreate, AdminUserRow, AdminUserUpdate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """Dependency: 403 if the caller isn't an admin."""
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")
    return current_user


def _row_for(db: Session, user: User) -> AdminUserRow:
    card_count = int(
        db.execute(select(func.count(Card.id)).where(Card.user_id == user.id)).scalar() or 0
    )
    storage_bytes = int(
        db.execute(
            select(func.coalesce(func.sum(File.size_bytes), 0)).where(File.user_id == user.id)
        ).scalar()
        or 0
    )
    return AdminUserRow(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        username=user.username,
        bio=user.bio,
        avatar_file_id=user.avatar_file_id,
        public_profile=user.public_profile,
        is_admin=user.is_admin,
        card_count=card_count,
        storage_bytes=storage_bytes,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


@router.get("/users", response_model=list[AdminUserRow])
def list_users(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[AdminUserRow]:
    rows = (
        db.execute(select(User).order_by(User.created_at.desc())).scalars().all()
    )
    return [_row_for(db, u) for u in rows]


@router.post("/users", response_model=AdminUserRow, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: AdminUserCreate,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminUserRow:
    existing = db.execute(
        select(User).where(User.email == payload.email.lower())
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="Email already in use")
    user = User(
        email=payload.email.lower(),
        password_hash=hash_password(payload.password),
        display_name=(payload.display_name or "").strip() or None,
        is_admin=payload.is_admin,
        public_profile=payload.public_profile,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _row_for(db, user)


@router.patch("/users/{user_id}", response_model=AdminUserRow)
def update_user(
    user_id: UUID,
    payload: AdminUserUpdate,
    current_admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminUserRow:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    if payload.email is not None and payload.email.lower() != user.email:
        clash = db.execute(
            select(User).where(User.email == payload.email.lower(), User.id != user.id)
        ).scalar_one_or_none()
        if clash is not None:
            raise HTTPException(status_code=409, detail="Email already in use")
        user.email = payload.email.lower()

    if payload.display_name is not None:
        user.display_name = payload.display_name.strip() or None

    if payload.public_profile is not None:
        user.public_profile = payload.public_profile

    if payload.is_admin is not None:
        # Safety: an admin can't strip their own admin flag — locking
        # yourself out of the surface that contains the un-lock toggle
        # is a foot-gun. They can ask another admin to do it instead.
        if user.id == current_admin.id and not payload.is_admin:
            raise HTTPException(
                status_code=400,
                detail="You cannot remove your own admin flag — ask another admin.",
            )
        user.is_admin = payload.is_admin

    if payload.password:
        user.password_hash = hash_password(payload.password)

    db.commit()
    db.refresh(user)
    return _row_for(db, user)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: UUID,
    current_admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if user_id == current_admin.id:
        raise HTTPException(
            status_code=400,
            detail="You can't delete your own account from the admin panel.",
        )
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    # 1. Wipe the user's blob storage tree. Per-user fan-out under
    #    <storage_path>/<user_id>/<purpose>/... makes this a single rmtree.
    settings = get_settings()
    user_dir = Path(settings.storage_path) / str(user.id)
    if user_dir.exists():
        try:
            shutil.rmtree(user_dir)
        except OSError as exc:
            # Don't bail on disk-cleanup failure — the DB cascade is the
            # source of truth and the orphaned blobs can be GC'd later.
            logger.warning("delete_user: failed to remove %s: %s", user_dir, exc)

    # 2. DB delete — every FK to users.id has ON DELETE CASCADE, so cards,
    #    files, tags, paths, podcasts, sessions, etc. all go in one shot.
    db.delete(user)
    db.commit()
