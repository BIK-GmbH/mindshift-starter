"""Tests for /api/transcribe."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_transcribe_requires_auth(client):
    r = client.post(
        "/api/transcribe",
        files={"audio": ("test.webm", b"fake-audio-bytes", "audio/webm")},
    )
    assert r.status_code in (401, 403)


def test_transcribe_rejects_empty_audio(client, authed_user):
    r = client.post(
        "/api/transcribe",
        files={"audio": ("test.webm", b"", "audio/webm")},
        headers={"Authorization": f"Bearer {authed_user.token}"},
    )
    assert r.status_code == 400


def test_transcribe_too_large(client, authed_user):
    huge = b"x" * (26 * 1024 * 1024)
    r = client.post(
        "/api/transcribe",
        files={"audio": ("test.webm", huge, "audio/webm")},
        headers={"Authorization": f"Bearer {authed_user.token}"},
    )
    assert r.status_code == 413


@patch("openai.OpenAI")
def test_transcribe_happy_path(mock_openai_cls, client, authed_user, monkeypatch):
    # The endpoint reads settings.openai_api_key — ensure it's set so we
    # don't hit the 503 "not configured" branch. get_settings() is cached,
    # so override the attribute on the already-built instance.
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "openai_api_key", "test-key")

    mock_client = MagicMock()
    mock_client.audio.transcriptions.create.return_value = MagicMock(text="hello world")
    mock_openai_cls.return_value = mock_client
    r = client.post(
        "/api/transcribe",
        files={"audio": ("test.webm", b"some-audio-bytes" * 100, "audio/webm")},
        headers={"Authorization": f"Bearer {authed_user.token}"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["text"] == "hello world"
    assert body["audio_bytes"] > 0
