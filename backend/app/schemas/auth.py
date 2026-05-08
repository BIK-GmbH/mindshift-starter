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


class PublicProfileTagOut(BaseModel):
    name: str
    slug: str  # path slug — for nested tags this is e.g. "finance/investment"
    card_count: int


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


PublicProfileOut.model_rebuild()
PublicTagDetail.model_rebuild()
