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
    openai_model: str = Field(default="gpt-4o-mini", alias="OPENAI_MODEL")


@lru_cache
def get_settings() -> Settings:
    return Settings()
