from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.admin import router as admin_router
from app.api.ai import router as ai_router
from app.api.audio import router as audio_router
from app.api.auth import router as auth_router
from app.api.cards import router as cards_router
from app.api.chat import router as chat_router
from app.api.export import router as export_router
from app.api.feeds import router as feeds_router
from app.api.files import router as files_router
from app.api.graph import router as graph_router
from app.api.graph_presets import router as graph_presets_router
from app.api.public import router as public_router
from app.api.health import router as health_router
from app.api.image_templates import router as image_templates_router
from app.api.imports import router as import_router
from app.api.jobs import router as jobs_router
from app.api.mcp import router as mcp_router
from app.api.og import router as og_router
from app.api.paths import public_router as paths_public_router
from app.api.paths import router as paths_router
from app.api.podcasts import public_router as podcasts_public_router
from app.api.podcasts import router as podcasts_router
from app.api.review import router as review_router
from app.api.search import router as search_router
from app.api.share import router as share_router
from app.api.social_posts import router as social_posts_router
from app.api.tags import router as tags_router
from app.api.highlights import router as highlights_router
from app.api.transcribe import router as transcribe_router
from app.api.translations import router as translations_router
from app.api.wiki import router as wiki_router
from app.core.config import get_settings
from app.services.feed_scheduler import start_scheduler, stop_scheduler
from app.services.recovery import reap_stuck_processing

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # On startup: any async generation rows still in `processing` from
    # before the restart are orphans (the BackgroundTask owning them is
    # gone). Flip them to `failed` so the user can retry from the UI.
    counts = reap_stuck_processing()
    total = sum(counts.values())
    if total:
        print(
            f"[startup] reaped stuck processing rows: {counts} "
            f"(total {total})"
        )
    # Start the periodic RSS feed poller.
    start_scheduler()
    try:
        yield
    finally:
        stop_scheduler()


app = FastAPI(title="Mindshift API", version="0.1.0", lifespan=lifespan)

_allowed_origins = {settings.frontend_origin}
# Local dev convenience: the frontend now talks directly to the backend
# (skipping the Vite proxy) — both http://localhost:5173 and
# http://127.0.0.1:5173 are valid origins depending on what the user
# typed in the address bar, so accept both.
if settings.environment != "production":
    _allowed_origins.update({"http://localhost:5173", "http://127.0.0.1:5173"})

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(_allowed_origins),
    # Browser extensions surface as `chrome-extension://<id>` and
    # `moz-extension://<id>` origins — allow any extension origin so the
    # popup can call the API without bouncing every install through CORS
    # config.
    allow_origin_regex=r"^(chrome-extension|moz-extension|safari-web-extension)://.*$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router, prefix="/api")
app.include_router(auth_router, prefix="/api")
app.include_router(admin_router, prefix="/api")
app.include_router(cards_router, prefix="/api")
app.include_router(jobs_router, prefix="/api")
app.include_router(search_router, prefix="/api")
app.include_router(chat_router, prefix="/api")
app.include_router(review_router, prefix="/api")
app.include_router(tags_router, prefix="/api")
app.include_router(transcribe_router, prefix="/api")
app.include_router(translations_router, prefix="/api")
app.include_router(highlights_router, prefix="/api")
app.include_router(graph_router, prefix="/api")
app.include_router(graph_presets_router, prefix="/api")
app.include_router(ai_router, prefix="/api")
app.include_router(audio_router, prefix="/api")
app.include_router(podcasts_router, prefix="/api")
app.include_router(social_posts_router, prefix="/api")
app.include_router(mcp_router, prefix="/api")
app.include_router(image_templates_router, prefix="/api")
app.include_router(podcasts_public_router, prefix="/api")
app.include_router(paths_router, prefix="/api")
app.include_router(paths_public_router, prefix="/api")
app.include_router(export_router, prefix="/api")
app.include_router(feeds_router, prefix="/api")
app.include_router(wiki_router, prefix="/api")
app.include_router(import_router, prefix="/api")
app.include_router(share_router, prefix="/api")
app.include_router(files_router, prefix="/api")
app.include_router(public_router, prefix="/api")
# OG / Twitter card pages — note: NO /api prefix. These render HTML
# directly at /og/u/... so social-bot UAs can be routed there with a
# simple proxy rule (see docs/DEPLOYMENT.md).
app.include_router(og_router)


@app.get("/")
def root() -> dict[str, str]:
    return {"name": "Mindshift API", "version": "0.1.0"}
