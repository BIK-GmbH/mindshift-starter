from __future__ import annotations

from pydantic import BaseModel


class YouTubeSuggestionOut(BaseModel):
    video_id: str
    title: str
    channel: str
    description: str
    thumbnail_url: str
    published_at: str
    duration_iso: str | None
    already_saved_card_id: str | None


class CardSuggestionsOut(BaseModel):
    query: str
    results: list[YouTubeSuggestionOut]
    from_cache: bool
    api_enabled: bool


class DiscoverThemeOut(BaseModel):
    slug: str
    label: str
    query: str
    queries: list[str] = []
    card_count: int
    from_cache: bool
    results: list[YouTubeSuggestionOut]


class DiscoverOut(BaseModel):
    api_enabled: bool
    themes: list[DiscoverThemeOut]
    freshness: str = "month"


class CustomSearchOut(BaseModel):
    query: str
    freshness: str
    from_cache: bool
    api_enabled: bool
    results: list[YouTubeSuggestionOut]
