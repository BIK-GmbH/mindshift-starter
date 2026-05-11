"""Tests for app.services.article.fetch_article."""
from __future__ import annotations

import httpx

from app.services.article import fetch_article


def test_fetch_article_uses_html_override():
    html = (
        "<html><head><title>Hello World</title></head>"
        "<body><article><p>"
        + "Lorem ipsum dolor sit amet. " * 30
        + "</p></article></body></html>"
    )
    result = fetch_article("https://example.com/post/1", html_override=html)
    assert result is not None
    assert result.title == "Hello World"
    assert "Lorem ipsum" in result.text


def test_fetch_article_no_network_call_when_override_set(monkeypatch):
    """When html_override is supplied, httpx must NOT be called."""

    class Boom:
        def __init__(self, *args, **kwargs):
            raise AssertionError(
                "httpx.Client should not be constructed when html_override is set"
            )

    monkeypatch.setattr("app.services.article.httpx.Client", Boom)
    html = (
        "<html><body><article><p>" + "Stuff. " * 100 + "</p></article></body></html>"
    )
    result = fetch_article("https://example.com/", html_override=html)
    assert result is not None


def test_fetch_article_returns_none_when_no_override_and_bad_url(monkeypatch):
    """Sanity: without override, network errors still produce None as before."""

    class Boom:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def get(self, *args, **kwargs):
            raise httpx.ConnectError("test")

    monkeypatch.setattr("app.services.article.httpx.Client", Boom)
    result = fetch_article("https://example.com/")
    assert result is None
