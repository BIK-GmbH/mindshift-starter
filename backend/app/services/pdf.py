"""PDF text extraction."""

from __future__ import annotations

import io
from dataclasses import dataclass

from pypdf import PdfReader


@dataclass(slots=True)
class PdfExtractResult:
    title: str | None
    text: str
    page_count: int


def extract_pdf(content: bytes, fallback_title: str) -> PdfExtractResult:
    reader = PdfReader(io.BytesIO(content))
    pages = [(page.extract_text() or "").strip() for page in reader.pages]
    text = "\n\n".join(p for p in pages if p)

    title: str | None = None
    if reader.metadata and reader.metadata.title:
        title = str(reader.metadata.title).strip() or None

    return PdfExtractResult(
        title=title or fallback_title,
        text=text,
        page_count=len(reader.pages),
    )
