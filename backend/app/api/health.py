from fastapi import APIRouter, Depends

from app.core.config import Settings, get_settings

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/info")
def info(settings: Settings = Depends(get_settings)) -> dict[str, str]:
    """Public configuration the browser extension and other clients need
    to deep-link back into the web app. `web_url` mirrors the backend's
    FRONTEND_ORIGIN setting so deployments don't need to configure two
    URLs in two places."""
    return {
        "web_url": settings.frontend_origin,
        "api_version": "0.1.0",
    }
