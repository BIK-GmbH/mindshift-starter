from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.ai import router as ai_router
from app.api.auth import router as auth_router
from app.api.cards import router as cards_router
from app.api.chat import router as chat_router
from app.api.export import router as export_router
from app.api.files import router as files_router
from app.api.graph import router as graph_router
from app.api.graph_presets import router as graph_presets_router
from app.api.public import router as public_router
from app.api.health import router as health_router
from app.api.imports import router as import_router
from app.api.jobs import router as jobs_router
from app.api.og import router as og_router
from app.api.review import router as review_router
from app.api.search import router as search_router
from app.api.share import router as share_router
from app.api.tags import router as tags_router
from app.api.wiki import router as wiki_router
from app.core.config import get_settings

settings = get_settings()

app = FastAPI(title="Mindshift API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
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
app.include_router(cards_router, prefix="/api")
app.include_router(jobs_router, prefix="/api")
app.include_router(search_router, prefix="/api")
app.include_router(chat_router, prefix="/api")
app.include_router(review_router, prefix="/api")
app.include_router(tags_router, prefix="/api")
app.include_router(graph_router, prefix="/api")
app.include_router(graph_presets_router, prefix="/api")
app.include_router(ai_router, prefix="/api")
app.include_router(export_router, prefix="/api")
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
