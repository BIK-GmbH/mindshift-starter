"""Public path consumer endpoints (anonymous-accessible)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_public_card_404_when_path_private(client, seeded_private_path):
    user = seeded_private_path.user
    path = seeded_private_path.path
    card_id = seeded_private_path.cards[0].id
    r = client.get(f"/api/public/paths/{user.username}/{path.slug}/cards/{card_id}")
    assert r.status_code == 404


def test_public_card_404_when_card_not_in_path(client, seeded_public_path, seeded_other_card):
    user = seeded_public_path.user
    path = seeded_public_path.path
    r = client.get(
        f"/api/public/paths/{user.username}/{path.slug}/cards/{seeded_other_card.id}"
    )
    assert r.status_code == 404


def test_public_card_returns_public_safe_shape(client, seeded_public_path):
    user = seeded_public_path.user
    path = seeded_public_path.path
    card_id = seeded_public_path.cards[0].id
    r = client.get(f"/api/public/paths/{user.username}/{path.slug}/cards/{card_id}")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == str(card_id)
    assert body["title"]
    assert "notes_md" not in body
    assert "user_id" not in body
    assert "error_message" not in body


def test_public_path_includes_id(client, seeded_public_path):
    user = seeded_public_path.user
    path = seeded_public_path.path
    r = client.get(f"/api/public/paths/{user.username}/{path.slug}")
    assert r.status_code == 200
    assert r.json()["id"] == str(path.id)


def test_public_transcript_happy_path(client, seeded_public_path_with_transcript):
    user = seeded_public_path_with_transcript.user
    path = seeded_public_path_with_transcript.path
    card_id = seeded_public_path_with_transcript.cards[0].id
    r = client.get(
        f"/api/public/paths/{user.username}/{path.slug}/cards/{card_id}/transcript"
    )
    assert r.status_code == 200
    assert r.json()["text"]


def test_public_quiz_happy_path(client, seeded_public_path_with_quiz):
    user = seeded_public_path_with_quiz.user
    path = seeded_public_path_with_quiz.path
    card_id = seeded_public_path_with_quiz.cards[0].id
    r = client.get(f"/api/public/paths/{user.username}/{path.slug}/cards/{card_id}/quiz")
    assert r.status_code == 200
    assert isinstance(r.json(), list)
