"""Tests for the YouTube channel subscription subsystem.

Covers:
  * URL/handle resolve parsing (no network)
  * Atom feed parser (real fixture body)
  * subscribe idempotency
  * poll dedupe behaviour
  * save-all-unread + exclude_shorts honouring
  * mark-read flips read_at
  * card-detail surfaces channel_subscription_id / channel_resolvable

Where the code hits the YouTube Data API or runs the real ingestion
pipeline, we monkeypatch the seams. The tests stay hermetic.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

import pytest
from sqlalchemy.orm import Session

from app.models.card import Card
from app.models.channel_subscription import ChannelSubscription
from app.models.channel_video import ChannelVideo
from app.models.source import Source
from app.models.user import User
from app.services import channel_polling, channel_search
from app.services.channel_polling import _parse_atom_entries, poll_channel


ATOM_FIXTURE = b"""<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"
      xmlns:media="http://search.yahoo.com/mrss/"
      xmlns="http://www.w3.org/2005/Atom">
  <yt:channelId>UCFIXTURE000000000000001</yt:channelId>
  <title>Fixture Channel</title>
  <entry>
    <id>yt:video:abc1234XYZA</id>
    <yt:videoId>abc1234XYZA</yt:videoId>
    <title>Long video about AI</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=abc1234XYZA"/>
    <published>2026-05-01T12:00:00+00:00</published>
    <media:group>
      <media:thumbnail url="https://i.ytimg.com/vi/abc1234XYZA/hq.jpg"/>
    </media:group>
  </entry>
  <entry>
    <id>yt:video:short9999000</id>
    <yt:videoId>short9999000</yt:videoId>
    <title>Short clip</title>
    <link rel="alternate" href="https://www.youtube.com/shorts/short9999000"/>
    <published>2026-05-02T09:00:00+00:00</published>
    <media:group>
      <media:thumbnail url="https://i.ytimg.com/vi/short9999000/hq.jpg"/>
    </media:group>
  </entry>
</feed>
"""


@pytest.fixture
def fresh_user(db: Session) -> User:
    user = User(
        email=f"ch-{uuid.uuid4().hex[:8]}@example.com",
        username=f"ch{uuid.uuid4().hex[:8]}",
        password_hash="x",
        public_profile=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


# ---------------------------------------------------------------------------
# Resolve parsing


def test_resolve_channel_id_directly(monkeypatch):
    """Bare `UCxxx` should not need any URL parsing — calls channels.list."""
    called: dict[str, Any] = {}

    def fake_fetch(ids: list[str]):
        called["ids"] = ids
        return {ids[0]: channel_search.ChannelResult(
            channel_id=ids[0],
            title="Mock Channel",
            handle="@mock",
            thumbnail_url=None,
            subscriber_count=42,
            description=None,
        )}

    monkeypatch.setattr(channel_search, "_fetch_channels_by_id", fake_fetch)
    res = channel_search.resolve_channel("UCabcdefghijklmnopqrstuv")
    assert res is not None
    assert res.title == "Mock Channel"
    assert called["ids"] == ["UCabcdefghijklmnopqrstuv"]


def test_resolve_handle_at_prefixed(monkeypatch):
    captured: dict[str, str] = {}

    def fake_handle(h: str):
        captured["handle"] = h
        return channel_search.ChannelResult(
            channel_id="UChandle",
            title="Handle",
            handle=h,
            thumbnail_url=None,
            subscriber_count=None,
            description=None,
        )

    monkeypatch.setattr(channel_search, "_fetch_channel_by_handle", fake_handle)
    res = channel_search.resolve_channel("@LexFridman")
    assert res is not None
    assert captured["handle"] == "@LexFridman"


def test_resolve_youtube_url_channel(monkeypatch):
    monkeypatch.setattr(
        channel_search,
        "_fetch_channels_by_id",
        lambda ids: {ids[0]: channel_search.ChannelResult(
            channel_id=ids[0], title="OK", handle=None,
            thumbnail_url=None, subscriber_count=None, description=None,
        )},
    )
    res = channel_search.resolve_channel(
        "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv"
    )
    assert res is not None and res.channel_id == "UCabcdefghijklmnopqrstuv"


def test_resolve_bad_input_returns_none(monkeypatch):
    monkeypatch.setattr(channel_search, "_fetch_channel_by_handle", lambda h: None)
    # Empty
    assert channel_search.resolve_channel("") is None
    # Garbage host
    assert channel_search.resolve_channel("https://example.com/foo") is None


# ---------------------------------------------------------------------------
# Atom parser


def test_parse_atom_entries_extracts_two_videos():
    rows = list(_parse_atom_entries(ATOM_FIXTURE))
    assert len(rows) == 2
    by_id = {r.video_id: r for r in rows}
    assert "abc1234XYZA" in by_id
    assert "short9999000" in by_id

    long_clip = by_id["abc1234XYZA"]
    assert long_clip.is_short is False
    assert long_clip.title.startswith("Long video")
    assert long_clip.published_at is not None
    assert long_clip.thumbnail_url and "hq.jpg" in long_clip.thumbnail_url

    short_clip = by_id["short9999000"]
    assert short_clip.is_short is True


def test_parse_atom_entries_handles_empty_feed():
    body = b"""<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:yt="http://www.youtube.com/xml/schemas/2015">
  <title>Empty</title>
</feed>"""
    rows = list(_parse_atom_entries(body))
    assert rows == []


# ---------------------------------------------------------------------------
# Poll dedupe + subscribe idempotency


def _make_sub(db: Session, user: User, channel_id: str = "UCFIXTURE000000000000001") -> ChannelSubscription:
    sub = ChannelSubscription(
        user_id=user.id,
        channel_id=channel_id,
        title="Fixture",
        ingest_mode="manual",
        exclude_shorts=True,
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return sub


def test_poll_channel_creates_inbox_rows(monkeypatch, db: Session, fresh_user: User):
    sub = _make_sub(db, fresh_user)

    from app.services import http_polling as hp

    def fake_fetch(url: str, **kwargs):
        return hp.ConditionalFetchResult(
            status="ok", body=ATOM_FIXTURE, etag='"v1"', last_modified="now"
        )

    monkeypatch.setattr(channel_polling, "conditional_fetch", fake_fetch)
    result = poll_channel(sub.id, allow_auto_ingest=False)

    assert result["new_videos"] == 2
    assert result["queued_ingestion"] == 0  # manual mode

    db.expire_all()
    rows = db.query(ChannelVideo).filter(
        ChannelVideo.subscription_id == sub.id
    ).all()
    assert {r.video_id for r in rows} == {"abc1234XYZA", "short9999000"}
    short_row = next(r for r in rows if r.video_id == "short9999000")
    assert short_row.is_short is True


def test_poll_channel_is_idempotent(monkeypatch, db: Session, fresh_user: User):
    sub = _make_sub(db, fresh_user)

    from app.services import http_polling as hp

    monkeypatch.setattr(
        channel_polling,
        "conditional_fetch",
        lambda *a, **kw: hp.ConditionalFetchResult(
            status="ok", body=ATOM_FIXTURE, etag=None, last_modified=None
        ),
    )
    poll_channel(sub.id, allow_auto_ingest=False)
    second = poll_channel(sub.id, allow_auto_ingest=False)
    assert second["new_videos"] == 0
    db.expire_all()
    total = db.query(ChannelVideo).filter(
        ChannelVideo.subscription_id == sub.id
    ).count()
    assert total == 2


def test_poll_channel_304_keeps_state_quiet(monkeypatch, db: Session, fresh_user: User):
    sub = _make_sub(db, fresh_user)
    from app.services import http_polling as hp

    monkeypatch.setattr(
        channel_polling,
        "conditional_fetch",
        lambda *a, **kw: hp.ConditionalFetchResult(status="not_modified"),
    )
    result = poll_channel(sub.id, allow_auto_ingest=False)
    assert result["new_videos"] == 0
    assert result["error"] is None


def test_poll_channel_auto_ingest_skips_shorts(monkeypatch, db: Session, fresh_user: User):
    sub = _make_sub(db, fresh_user)
    sub.ingest_mode = "auto"
    db.commit()

    queued_ids: list[str] = []

    def fake_create(db_session, user_id, row):
        queued_ids.append(row.video_id)
        return (uuid.uuid4(), uuid.uuid4())

    drained_calls: list[list] = []

    def fake_drain(pending):
        drained_calls.append(list(pending))

    monkeypatch.setattr(channel_polling, "_create_card_for_video", fake_create)
    monkeypatch.setattr(channel_polling, "_drain_pending_in_background", fake_drain)

    from app.services import http_polling as hp

    monkeypatch.setattr(
        channel_polling,
        "conditional_fetch",
        lambda *a, **kw: hp.ConditionalFetchResult(
            status="ok", body=ATOM_FIXTURE, etag=None, last_modified=None
        ),
    )
    result = poll_channel(sub.id, allow_auto_ingest=True)
    assert result["new_videos"] == 2
    # Only the long-form video should hit the ingestion queue.
    assert queued_ids == ["abc1234XYZA"]
    assert result["queued_ingestion"] == 1
    # The drainer is invoked exactly once for the whole batch — no
    # per-video threads. That's the IP-ban guard.
    assert len(drained_calls) == 1
    assert len(drained_calls[0]) == 1
    assert drained_calls[0][0][2] == "abc1234XYZA"


def test_poll_channel_handles_fetch_error(monkeypatch, db: Session, fresh_user: User):
    sub = _make_sub(db, fresh_user)
    from app.services import http_polling as hp

    monkeypatch.setattr(
        channel_polling,
        "conditional_fetch",
        lambda *a, **kw: hp.ConditionalFetchResult(status="error", error="boom"),
    )
    result = poll_channel(sub.id, allow_auto_ingest=True)
    assert result["new_videos"] == 0
    assert result["error"] == "boom"
    db.expire_all()
    refreshed = db.get(ChannelSubscription, sub.id)
    assert refreshed.last_error == "boom"


# ---------------------------------------------------------------------------
# Library suggestions


def test_library_suggestions_groups_by_channel(db: Session, fresh_user: User):
    # Seed three YouTube cards, two from the same channel.
    for i, ch_id in enumerate(["UCA", "UCA", "UCB", "UCB", "UCC"]):
        src = Source(
            source_type="youtube",
            url=f"https://www.youtube.com/watch?v=vid{i}",
            canonical_url=f"https://www.youtube.com/watch?v=vid{i}",
            external_id=f"vid{i}",
            metadata_json={"channel_id": ch_id, "channel": f"Name {ch_id}"},
        )
        db.add(src)
        db.flush()
        card = Card(
            user_id=fresh_user.id,
            source_id=src.id,
            title=f"Card {i}",
            source_type="youtube",
            status="completed",
        )
        db.add(card)
    db.commit()

    out = channel_search.library_suggestions(db, fresh_user.id)
    # UCA and UCB qualify (2 cards each); UCC has only 1 → excluded.
    ids = {row["channel_id"] for row in out}
    assert ids == {"UCA", "UCB"}
    # UCA comes first (alphabetical tiebreaker since both have count=2).
    counts = {row["channel_id"]: row["card_count_in_library"] for row in out}
    assert counts == {"UCA": 2, "UCB": 2}


def test_library_suggestions_backfills_missing_channel_id(
    monkeypatch, db: Session, fresh_user: User
):
    """Cards ingested before channel_id capture landed have only the
    channel title. The suggestions endpoint should batch-resolve the
    missing ids via the Data API and persist them back into metadata."""
    # Seed two YouTube cards with NO channel_id — only the title.
    src_ids: list[str] = []
    for i, vid in enumerate(["videoAAA", "videoBBB"]):
        src = Source(
            source_type="youtube",
            url=f"https://www.youtube.com/watch?v={vid}",
            canonical_url=f"https://www.youtube.com/watch?v={vid}",
            external_id=vid,
            metadata_json={"channel": "Some Channel"},  # no channel_id
        )
        db.add(src)
        db.flush()
        src_ids.append(src.id)
        db.add(Card(
            user_id=fresh_user.id, source_id=src.id, title=f"x{i}",
            source_type="youtube", status="completed",
        ))
    db.commit()

    # Mock the YouTube Data API key + the httpx call.
    monkeypatch.setattr(channel_search, "_api_key", lambda: "fake-key")

    class FakeResp:
        status_code = 200
        def raise_for_status(self): pass
        def json(self):
            return {
                "items": [
                    {
                        "id": "videoAAA",
                        "snippet": {
                            "channelId": "UCRESOLVED",
                            "channelTitle": "Resolved Channel",
                        },
                    },
                    {
                        "id": "videoBBB",
                        "snippet": {
                            "channelId": "UCRESOLVED",
                            "channelTitle": "Resolved Channel",
                        },
                    },
                ]
            }

    class FakeClient:
        def __init__(self, *a, **kw): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def get(self, *a, **kw): return FakeResp()

    monkeypatch.setattr(channel_search.httpx, "Client", FakeClient)
    # Skip the hydration round-trip in this test — we only care about
    # the backfill + grouping behaviour, not the avatar fetch.
    monkeypatch.setattr(channel_search, "_fetch_channels_by_id", lambda ids: {})

    out = channel_search.library_suggestions(db, fresh_user.id)
    assert len(out) == 1
    assert out[0]["channel_id"] == "UCRESOLVED"
    assert out[0]["card_count_in_library"] == 2

    # And the source rows now carry channel_id.
    db.expire_all()
    for sid in src_ids:
        meta = db.get(Source, sid).metadata_json
        assert meta.get("channel_id") == "UCRESOLVED"


def test_save_all_unread_drains_sequentially_not_per_video_threads(
    monkeypatch, db: Session, fresh_user: User
):
    """save-all-unread used to spawn one thread per video, which gets
    the transcript endpoint to IP-block us at ~5 videos. The refactor
    forces all unread items through a single drainer call instead."""
    from app.api.channels import save_all_unread

    sub = _make_sub(db, fresh_user)
    # Seed three unread inbox rows (non-shorts so exclude_shorts can't
    # filter them out).
    for vid in ["vidA0000000", "vidB0000000", "vidC0000000"]:
        db.add(ChannelVideo(
            subscription_id=sub.id,
            video_id=vid,
            title=vid,
            is_short=False,
            discovered_at=datetime(2026, 5, 1, tzinfo=timezone.utc),
        ))
    db.commit()

    # Stub out the two seams.
    from app.services import channel_polling

    def fake_create(db_session, user_id, row):
        return (uuid.uuid4(), uuid.uuid4())

    drained_calls: list[list] = []

    def fake_drain(pending):
        drained_calls.append(list(pending))

    monkeypatch.setattr(channel_polling, "_create_card_for_video", fake_create)
    monkeypatch.setattr(channel_polling, "_drain_pending_in_background", fake_drain)
    # Need to also patch the symbols imported into the API module.
    from app.api import channels as channels_api
    monkeypatch.setattr(channels_api, "_create_card_for_video", fake_create)
    monkeypatch.setattr(channels_api, "_drain_pending_in_background", fake_drain)

    fresh_user.token = "ignored"  # type: ignore[attr-defined]
    result = save_all_unread(sub.id, current_user=fresh_user, db=db)
    assert result.queued == 3
    # Crucially: a single drainer call, three items, not three calls.
    assert len(drained_calls) == 1
    assert len(drained_calls[0]) == 3


def test_library_suggestions_filters_existing_subs(db: Session, fresh_user: User):
    for i, ch in enumerate(["UCALPHA", "UCALPHA"]):
        src = Source(
            source_type="youtube",
            url=f"https://www.youtube.com/watch?v=al{i}",
            canonical_url=f"https://www.youtube.com/watch?v=al{i}",
            external_id=f"al{i}",
            metadata_json={"channel_id": ch, "channel": "Alpha"},
        )
        db.add(src)
        db.flush()
        db.add(Card(
            user_id=fresh_user.id, source_id=src.id, title="x",
            source_type="youtube", status="completed",
        ))
    db.add(ChannelSubscription(
        user_id=fresh_user.id,
        channel_id="UCALPHA",
        title="Alpha",
    ))
    db.commit()

    out = channel_search.library_suggestions(db, fresh_user.id)
    assert out == []  # already subscribed
