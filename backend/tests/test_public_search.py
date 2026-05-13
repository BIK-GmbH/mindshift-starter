"""Search endpoint on the public profile (`/api/public/users/{u}/search`).

Confirms the visibility rule: hits must be reachable through at least
one public tag subtree. Cards that only carry private tags must not
leak through search even if their title or summary matches.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_search_404_when_user_not_public(client, seeded_search, db):
    # Flip the user back to private and confirm the endpoint hides them.
    user = seeded_search.user
    user.public_profile = False
    db.commit()
    r = client.get(f"/api/public/users/{user.username}/search", params={"q": "robotics"})
    assert r.status_code == 404


def test_search_empty_query_returns_no_cards(client, seeded_search):
    r = client.get(
        f"/api/public/users/{seeded_search.user.username}/search", params={"q": ""}
    )
    assert r.status_code == 200
    assert r.json()["cards"] == []


def test_search_too_short_query_returns_no_cards(client, seeded_search):
    # Single char queries are too noisy → empty result, not 400.
    r = client.get(
        f"/api/public/users/{seeded_search.user.username}/search", params={"q": "r"}
    )
    assert r.status_code == 200
    assert r.json()["cards"] == []


def test_search_matches_title_and_summary_within_public_tags(client, seeded_search):
    r = client.get(
        f"/api/public/users/{seeded_search.user.username}/search",
        params={"q": "robotics"},
    )
    assert r.status_code == 200
    ids = {c["id"] for c in r.json()["cards"]}
    # Both the title-match and summary-match cards under the public tag
    # must come back. The privately-tagged card must NOT.
    assert str(seeded_search.matching_card.id) in ids
    assert str(seeded_search.summary_match_card.id) in ids
    assert str(seeded_search.hidden_card.id) not in ids
    # Unrelated card on the same public tag stays out.
    assert str(seeded_search.other_card.id) not in ids


def test_search_is_case_insensitive(client, seeded_search):
    r = client.get(
        f"/api/public/users/{seeded_search.user.username}/search",
        params={"q": "ROBOTICS"},
    )
    assert r.status_code == 200
    ids = {c["id"] for c in r.json()["cards"]}
    assert str(seeded_search.matching_card.id) in ids


def test_search_respects_limit(client, seeded_search):
    r = client.get(
        f"/api/public/users/{seeded_search.user.username}/search",
        params={"q": "robotics", "limit": 1},
    )
    assert r.status_code == 200
    assert len(r.json()["cards"]) == 1


def test_search_returns_public_safe_shape(client, seeded_search):
    r = client.get(
        f"/api/public/users/{seeded_search.user.username}/search",
        params={"q": "robotics"},
    )
    assert r.status_code == 200
    card = r.json()["cards"][0]
    # Visible fields only — no detailed summary, no user_id leakage, etc.
    expected_keys = {
        "id",
        "title",
        "source_type",
        "thumbnail_url",
        "concise_summary_md",
        "source_url",
        "external_id",
    }
    assert set(card.keys()) == expected_keys
