"""Auth-protected file download.

The bytes never travel through Postgres — we stream them straight from
the storage backend. Ownership is enforced server-side: the requesting
user must own the file row.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.file import File
from app.models.user import User
from app.services.storage import get_storage

router = APIRouter(prefix="/files", tags=["files"])


@router.get("/{file_id}")
def download_file(
    file_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    file = db.get(File, file_id)
    if file is None or file.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="File not found")

    blob = get_storage().read(file)

    safe_name = (file.original_filename or "file").replace('"', "")
    return Response(
        content=blob,
        media_type=file.content_type or "application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name}"',
            "Content-Length": str(len(blob)),
        },
    )
