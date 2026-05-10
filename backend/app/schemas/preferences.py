"""Per-user preferences schema.

The DB column is a JSONB blob, but we never let raw JSON through to
the persistence layer. Every read parses through `UserPreferences`,
every write goes through `UserPreferencesUpdate.merge_into()` so we
have one place to add new keys + their validation rules.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.models.user import User


class UserPreferences(BaseModel):
    """Read shape: every preference present, with default values for
    keys the user hasn't set yet.

    Adding a new preference: bump this schema with the default,
    update `from_user`, update `UserPreferencesUpdate`, ship it.
    No DB migration needed (JSONB).
    """

    default_translation_language: str | None = Field(
        default=None,
        description=(
            "When set, the side-panel embed automatically translates "
            "every newly-opened card to this language. Free-form so "
            "any natural-language name works ('Deutsch', 'Türkçe', "
            "'Bahasa Indonesia'). null = no auto-translate."
        ),
        max_length=64,
    )

    @classmethod
    def from_user(cls, user: User) -> "UserPreferences":
        raw = user.preferences_json or {}
        return cls(
            default_translation_language=_clean_str(
                raw.get("default_translation_language")
            ),
        )


class UserPreferencesUpdate(BaseModel):
    """Patch shape: every field optional. Sending `null` for a field
    explicitly clears that preference."""

    default_translation_language: str | None = Field(default=None, max_length=64)
    # Sentinel keys: when the field is *present in the JSON request*,
    # we apply it (even if the value is null = clear). When it is
    # *missing entirely*, we leave the existing value alone. We use
    # Pydantic's `model_fields_set` to distinguish.

    def merge_into(self, user: User) -> None:
        existing = dict(user.preferences_json or {})
        if "default_translation_language" in self.model_fields_set:
            v = _clean_str(self.default_translation_language)
            if v is None:
                existing.pop("default_translation_language", None)
            else:
                existing["default_translation_language"] = v
        # Re-assign the whole dict so SQLAlchemy notices the change —
        # in-place mutation of a JSONB doesn't trigger dirty tracking.
        user.preferences_json = existing


def _clean_str(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    s = value.strip()
    return s or None
