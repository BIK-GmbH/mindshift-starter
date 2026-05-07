"""Aggregate model imports so Alembic and tests pick up all metadata."""

from app.models.card import Card  # noqa: F401
from app.models.embedding import Embedding  # noqa: F401
from app.models.entity import CardEntity, Entity  # noqa: F401
from app.models.job import Job  # noqa: F401
from app.models.quiz import QuizQuestion, ReviewEvent  # noqa: F401
from app.models.relation import CardRelation  # noqa: F401
from app.models.source import Source  # noqa: F401
from app.models.tag import CardTag, Tag  # noqa: F401
from app.models.transcript import Transcript  # noqa: F401
from app.models.user import User  # noqa: F401


def register_models() -> None:
    """Side-effect free helper used by Alembic env.py."""
    return None
