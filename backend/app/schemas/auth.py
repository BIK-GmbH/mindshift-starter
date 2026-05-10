from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str | None = Field(default=None, max_length=120)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: UUID
    email: EmailStr
    display_name: str | None = None
    username: str | None = None
    bio: str | None = None
    avatar_file_id: UUID | None = None
    public_profile: bool = False

    class Config:
        from_attributes = True


class ProfileUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=120)
    # Username is restricted to a URL-safe slug. None unsets it (and
    # therefore disables the public profile too).
    username: str | None = Field(default=None, min_length=3, max_length=32, pattern=r"^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$")
    bio: str | None = Field(default=None, max_length=400)
    public_profile: bool | None = None


class PublicProfileOut(BaseModel):
    """The subset of user data we serve on `/u/:username` without auth."""

    username: str
    display_name: str | None = None
    bio: str | None = None
    avatar_file_id: UUID | None = None
    tags: list["PublicProfileTagOut"] = Field(default_factory=list)
    paths: list["PublicProfilePathOut"] = Field(default_factory=list)
    playlists: list["PublicProfilePlaylistOut"] = Field(default_factory=list)


class PublicProfileTagOut(BaseModel):
    name: str
    slug: str  # path slug — for nested tags this is e.g. "finance/investment"
    card_count: int


class PublicProfilePathOut(BaseModel):
    """Public path summary as listed on a user's profile."""

    id: UUID
    title: str
    slug: str
    description_md: str | None = None
    cover_url: str | None = None
    card_count: int


class PublicProfilePlaylistOut(BaseModel):
    """Public podcast playlist summary as listed on a user's profile."""

    id: UUID
    name: str
    description: str | None = None
    card_count: int
    episode_count: int
    cover_url: str | None = None  # latest episode's cover, when available


class PublicEpisodeBrief(BaseModel):
    """Episode summary for the public playlist page — just enough to
    render a player card without exposing private file ids."""

    id: UUID
    title: str
    voice: str
    audio_url: str
    cover_url: str | None = None
    narrative_text: str
    created_at: datetime


class PublicPlaylistDetail(BaseModel):
    """Public playlist with its `ready` episodes."""

    id: UUID
    name: str
    description: str | None = None
    author_username: str
    author_display_name: str | None = None
    episodes: list[PublicEpisodeBrief] = Field(default_factory=list)


class PublicTagDetail(BaseModel):
    """Returned by `/u/:username/<tag-slug>` — a tag plus the cards under it."""

    name: str
    slug: str
    card_count: int
    cards: list["PublicCardSummary"] = Field(default_factory=list)


class PublicCardSummary(BaseModel):
    id: UUID
    title: str
    source_type: str
    thumbnail_url: str | None = None
    concise_summary_md: str | None = None
    # Original source URL (YouTube watch link, article URL, …) so the
    # public viewer can embed / link out instead of just showing a flat
    # thumbnail.
    source_url: str | None = None
    # YouTube video id when source_type == "youtube" — used to build an
    # iframe embed without re-parsing the URL on the client.
    external_id: str | None = None


PublicProfileOut.model_rebuild()
PublicTagDetail.model_rebuild()
