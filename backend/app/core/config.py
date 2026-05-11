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

    # YouTube transcript proxy (optional). Two mutually exclusive shapes:
    #   - Webshare residential pool: set both username + password. The
    #     youtube-transcript-api lib wires up its own rotating residential
    #     proxy under the hood.
    #   - Generic HTTP/SOCKS proxy: a single URL like
    #     "http://user:pass@host:port" routes all transcript fetches.
    # When neither is set, fetches go direct (and may hit YouTube IP-blocks
    # on cloud / VPN exit IPs — that's why this knob exists).
    youtube_proxy_username: str = Field(default="", alias="YOUTUBE_PROXY_USERNAME")
    youtube_proxy_password: str = Field(default="", alias="YOUTUBE_PROXY_PASSWORD")
    youtube_proxy_url: str = Field(default="", alias="YOUTUBE_PROXY_URL")
    # Restrict Webshare rotation to specific countries (comma-separated
    # 2-letter codes, e.g. "de,us"). Empty = no restriction.
    youtube_proxy_countries: str = Field(default="", alias="YOUTUBE_PROXY_COUNTRIES")

    # Supadata.ai — third-party transcript provider used as a last-resort
    # fallback when both youtube-transcript-api and yt-dlp are blocked.
    # Get a key at https://supadata.ai (100 credits/month free, no card).
    supadata_api_key: str = Field(default="", alias="SUPADATA_API_KEY")

    # Symmetric Fernet key (urlsafe-base64, 32 bytes) for encrypting
    # MCP-server auth tokens at rest. Generate with
    # `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`.
    # Missing in dev falls back to a JWT_SECRET-derived key (warning logged).
    mcp_encryption_key: str = Field(default="", alias="MCP_ENCRYPTION_KEY")

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
