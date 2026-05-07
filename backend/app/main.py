from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.cards import router as cards_router
from app.api.chat import router as chat_router
from app.api.health import router as health_router
from app.api.jobs import router as jobs_router
from app.api.review import router as review_router
from app.api.search import router as search_router
from app.core.config import get_settings

settings = get_settings()

app = FastAPI(title="Mindshift API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
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


@app.get("/")
def root() -> dict[str, str]:
    return {"name": "Mindshift API", "version": "0.1.0"}
