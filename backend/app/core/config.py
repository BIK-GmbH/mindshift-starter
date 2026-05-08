from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    environment: str = Field(default="development", alias="ENVIRONMENT")
    database_url: str = Field(
        default="postgresql+psycopg://mindshift:mindshift@localhost:5433/mindshift",
        alias="DATABASE_URL",
    )
    frontend_origin: str = Field(default="http://localhost:5173", alias="FRONTEND_ORIGIN")

    jwt_secret: str = Field(default="change-me-in-production", alias="JWT_SECRET")
    jwt_algorithm: str = Field(default="HS256", alias="JWT_ALGORITHM")
    jwt_expires_minutes: int = Field(default=60 * 24 * 7, alias="JWT_EXPIRES_MINUTES")

    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")
    openai_model: str = Field(default="gpt-5.4-mini", alias="OPENAI_MODEL")

    gemini_api_key: str = Field(default="", alias="GEMINI_API_KEY")
    gemini_tts_model: str = Field(
        default="gemini-3.1-flash-tts-preview", alias="GEMINI_TTS_MODEL"
    )

    # File storage. `local` writes under `storage_path` (great for dev and
    # Railway volume mounts). `s3` is reserved for a future implementation.
    storage_backend: str = Field(default="local", alias="STORAGE_BACKEND")
    storage_path: str = Field(default="./.runtime/storage", alias="STORAGE_PATH")
    # Soft cap to keep one user from filling the volume. Bytes.
    storage_max_bytes_per_user: int = Field(
        default=2 * 1024 * 1024 * 1024,  # 2 GiB
        alias="STORAGE_MAX_BYTES_PER_USER",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
