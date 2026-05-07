"""Bulk import endpoints — browser bookmarks + markdown ZIPs.

Each accepted entry is dispatched as a normal card-ingestion background
task, so progress shows up in the existing library view.
"""

from __future__ import annotations

import io
import re
import zipfile
from html.parser import HTMLParser
from typing import Iterable

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.card import Card
from app.models.job import Job
from app.models.source import Source
from app.models.user import User
from app.services.ingestion import process_article_card, process_note_card

router = APIRouter(prefix="/import", tags=["import"])

MAX_BOOKMARKS = 500
MAX_MARKDOWN_FILES = 200
MAX_FILE_BYTES = 30 * 1024 * 1024


class ImportSummary(BaseModel):
    queued: int
    skipped: int
    detail: str | None = None


class _AnchorCollector(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.entries: list[tuple[str, str]] = []  # (url, title)
        self._href: str | None = None
        self._buf: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() == "a":
            href = next((v for k, v in attrs if k.lower() == "href"), None)
            self._href = href
            self._buf = []

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "a" and self._href:
            title = "".join(self._buf).strip()
            self.entries.append((self._href, title))
        if tag.lower() == "a":
            self._href = None
            self._buf = []

    def handle_data(self, data: str) -> None:
        if self._href is not None:
            self._buf.append(data)


def _parse_bookmarks_html(html: str) -> list[tuple[str, str]]:
    parser = _AnchorCollector()
    parser.feed(html)
    parser.close()
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for href, title in parser.entries:
        if not href.lower().startswith(("http://", "https://")):
            continue
        if href in seen:
            continue
        seen.add(href)
        out.append((href, title or href))
    return out


@router.post("/bookmarks", response_model=ImportSummary)
async def import_bookmarks(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ImportSummary:
    if not file.filename or not file.filename.lower().endswith((".html", ".htm")):
        raise HTTPException(status_code=400, detail="Bookmarks file must be .html")

    content = await file.read()
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="Bookmarks file too large")
    try:
        text = content.decode("utf-8", errors="replace")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Could not decode file: {exc}") from exc

    entries = _parse_bookmarks_html(text)
    if not entries:
        return ImportSummary(queued=0, skipped=0, detail="No links found in this bookmarks file")

    if len(entries) > MAX_BOOKMARKS:
        entries = entries[:MAX_BOOKMARKS]

    queued = 0
    for url, title in entries:
        source = Source(source_type="article", url=url, canonical_url=url)
        db.add(source)
        db.flush()
        card = Card(
            user_id=current_user.id,
            source_id=source.id,
            title=title or url,
            source_type="article",
            status="queued",
        )
        db.add(card)
        db.flush()
        job = Job(card_id=card.id, job_type="article_ingest", status="queued")
        db.add(job)
        db.commit()
        background_tasks.add_task(process_article_card, card.id, job.id, url)
        queued += 1

    return ImportSummary(queued=queued, skipped=max(0, len(entries) - queued))


def _iter_markdown_files(zip_bytes: bytes) -> Iterable[tuple[str, str]]:
    """Yield (path, body) for every .md file in a zip."""
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        for name in zf.namelist():
            if name.endswith("/") or not name.lower().endswith((".md", ".markdown")):
                continue
            try:
                raw = zf.read(name)
            except Exception:
                continue
            yield name, raw.decode("utf-8", errors="replace")


def _title_from_markdown(path: str, body: str) -> str:
    m = re.search(r"^#\s+(.+)$", body, flags=re.MULTILINE)
    if m:
        return m.group(1).strip()[:300]
    base = path.rsplit("/", 1)[-1]
    base = re.sub(r"\.(md|markdown)$", "", base, flags=re.IGNORECASE)
    return base[:300] or "Untitled note"


@router.post("/markdown", response_model=ImportSummary)
async def import_markdown(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ImportSummary:
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Markdown import expects a .zip of .md files")

    content = await file.read()
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="Archive too large")

    try:
        files = list(_iter_markdown_files(content))
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=400, detail=f"Bad zip: {exc}") from exc

    if not files:
        return ImportSummary(queued=0, skipped=0, detail="No .md files found in archive")

    if len(files) > MAX_MARKDOWN_FILES:
        files = files[:MAX_MARKDOWN_FILES]

    queued = 0
    for path, body in files:
        title = _title_from_markdown(path, body)
        source = Source(source_type="note", url=f"import://markdown/{path}", external_id=path)
        db.add(source)
        db.flush()
        card = Card(
            user_id=current_user.id,
            source_id=source.id,
            title=title,
            source_type="note",
            status="queued",
        )
        db.add(card)
        db.flush()
        job = Job(card_id=card.id, job_type="note_ingest", status="queued")
        db.add(job)
        db.commit()
        background_tasks.add_task(process_note_card, card.id, job.id, body, False)
        queued += 1

    return ImportSummary(queued=queued, skipped=max(0, len(files) - queued))
