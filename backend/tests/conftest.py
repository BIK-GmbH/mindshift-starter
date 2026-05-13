"""Shared test fixtures for backend pytest suite."""
from __future__ import annotations

import uuid
from collections.abc import Generator
from dataclasses import dataclass

import pytest
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.card import Card
from app.models.path import Path, PathCard
from app.models.quiz import QuizQuestion
from app.models.tag import CardTag, Tag
from app.models.transcript import Transcript
from app.models.user import User


@dataclass
class SeededPath:
    user: User
    path: Path
    cards: list[Card]


def _make_user(db: Session, *, public_profile: bool) -> User:
    user = User(
        email=f"t-{uuid.uuid4().hex[:8]}@example.com",
        username=f"t{uuid.uuid4().hex[:8]}",
        password_hash="x",
        public_profile=public_profile,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _make_card(db: Session, user: User, *, title: str = "Test card") -> Card:
    card = Card(
        user_id=user.id,
        title=title,
        source_type="youtube",
        status="completed",
        concise_summary_md="A short summary.",
        detailed_summary_md="A longer summary with more depth.",
    )
    db.add(card)
    db.commit()
    db.refresh(card)
    return card


def _make_path(
    db: Session, user: User, cards: list[Card], *, is_public: bool, slug: str = "demo"
) -> Path:
    path = Path(
        user_id=user.id,
        title="Demo path",
        slug=slug + "-" + uuid.uuid4().hex[:6],
        is_public=is_public,
    )
    db.add(path)
    db.flush()
    for i, card in enumerate(cards):
        db.add(PathCard(path_id=path.id, card_id=card.id, position=i))
    db.commit()
    db.refresh(path)
    return path


@pytest.fixture
def db() -> Generator[Session, None, None]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def authed_user(db: Session) -> User:
    """Create a user and return them with a `.token` attribute usable as a
    Bearer credential."""
    from app.core.security import create_access_token

    user = _make_user(db, public_profile=False)
    token = create_access_token(subject=user.id)
    user.token = token  # type: ignore[attr-defined]
    return user


@pytest.fixture
def seeded_public_path(db: Session) -> SeededPath:
    user = _make_user(db, public_profile=True)
    cards = [_make_card(db, user, title=f"Card {i}") for i in range(2)]
    path = _make_path(db, user, cards, is_public=True)
    return SeededPath(user=user, path=path, cards=cards)


@pytest.fixture
def seeded_private_path(db: Session) -> SeededPath:
    user = _make_user(db, public_profile=True)
    cards = [_make_card(db, user, title="Card P")]
    path = _make_path(db, user, cards, is_public=False)
    return SeededPath(user=user, path=path, cards=cards)


@pytest.fixture
def seeded_other_card(db: Session) -> Card:
    user = _make_user(db, public_profile=True)
    return _make_card(db, user, title="Loose card")


@pytest.fixture
def seeded_public_path_with_transcript(db: Session) -> SeededPath:
    user = _make_user(db, public_profile=True)
    card = _make_card(db, user)
    db.add(Transcript(card_id=card.id, language="en", provider="manual", text="hi"))
    db.commit()
    path = _make_path(db, user, [card], is_public=True)
    return SeededPath(user=user, path=path, cards=[card])


@dataclass
class SeededSearch:
    user: User
    matching_card: Card  # has "robotics" in title, public tag
    summary_match_card: Card  # "robotics" in summary, public tag
    other_card: Card  # no "robotics" anywhere, public tag (negative)
    hidden_card: Card  # has "robotics" but under a private tag (negative)
    public_tag: Tag
    private_tag: Tag


@pytest.fixture
def seeded_search(db: Session) -> SeededSearch:
    user = _make_user(db, public_profile=True)
    public_tag = Tag(user_id=user.id, name=f"pubtag-{uuid.uuid4().hex[:6]}", is_public=True)
    private_tag = Tag(user_id=user.id, name=f"privtag-{uuid.uuid4().hex[:6]}", is_public=False)
    db.add(public_tag)
    db.add(private_tag)
    db.flush()

    matching = _make_card(db, user, title="Robotics intro")
    summary_match = _make_card(db, user, title="Boring title")
    summary_match.concise_summary_md = "All about Robotics under the hood."
    other = _make_card(db, user, title="Knitting basics")
    hidden = _make_card(db, user, title="Robotics secrets")

    db.add(CardTag(card_id=matching.id, tag_id=public_tag.id))
    db.add(CardTag(card_id=summary_match.id, tag_id=public_tag.id))
    db.add(CardTag(card_id=other.id, tag_id=public_tag.id))
    db.add(CardTag(card_id=hidden.id, tag_id=private_tag.id))
    db.commit()
    return SeededSearch(
        user=user,
        matching_card=matching,
        summary_match_card=summary_match,
        other_card=other,
        hidden_card=hidden,
        public_tag=public_tag,
        private_tag=private_tag,
    )


@pytest.fixture
def seeded_public_path_with_quiz(db: Session) -> SeededPath:
    user = _make_user(db, public_profile=True)
    card = _make_card(db, user)
    db.add(QuizQuestion(card_id=card.id, question="Q?", answer="A.", question_type="open"))
    db.commit()
    path = _make_path(db, user, [card], is_public=True)
    return SeededPath(user=user, path=path, cards=[card])
