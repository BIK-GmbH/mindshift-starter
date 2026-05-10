"""Aggregate model imports so Alembic and tests pick up all metadata."""

from app.models.card import Card  # noqa: F401
from app.models.card_audio import CardAudio  # noqa: F401
from app.models.card_highlight import CardHighlight  # noqa: F401
from app.models.card_translation import CardTranslation  # noqa: F401
from app.models.chat import ChatMessage, ChatSession  # noqa: F401
from app.models.embedding import Embedding  # noqa: F401
from app.models.entity import CardEntity, Entity  # noqa: F401
from app.models.feed import Feed  # noqa: F401
from app.models.file import File  # noqa: F401
from app.models.path import Path, PathCard  # noqa: F401
from app.models.path_progress import PathProgress  # noqa: F401
from app.models.path_quiz_attempt import PathQuizAttempt  # noqa: F401
from app.models.graph_preset import GraphPreset  # noqa: F401
from app.models.job import Job  # noqa: F401
from app.models.learning_session import LearningSession  # noqa: F401
from app.models.podcast import (  # noqa: F401
    EpisodeShare,
    PodcastEpisode,
    PodcastPlaylist,
    PodcastPlaylistCard,
)
from app.models.quiz import QuizQuestion, ReviewEvent  # noqa: F401
from app.models.reaction import CardReaction  # noqa: F401
from app.models.relation import CardRelation  # noqa: F401
from app.models.share import CardShare  # noqa: F401
from app.models.source import Source  # noqa: F401
from app.models.tag import CardTag, Tag  # noqa: F401
from app.models.transcript import Transcript  # noqa: F401
from app.models.user import User  # noqa: F401


def register_models() -> None:
    """Side-effect free helper used by Alembic env.py."""
    return None
