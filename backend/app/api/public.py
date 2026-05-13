"""Auth-free public profile + tag endpoints.

Each user can mark single tags as `is_public`. The user themselves needs
a `username` and `public_profile=true` to be reachable.

URL shape:
- `GET /api/public/users/{username}` — profile + list of public tags.
- `GET /api/public/users/{username}/tags/{slug}` — tag with all cards
  (recursive through sub-tags). `slug` may be a multi-segment path like
  `finance/investment` for nested tags.
- `GET /api/public/users/{username}/cards/{card_id}` — single card
  detail, but only if it is reachable via at least one public tag of
  this user.
- `GET /api/public/avatars/{file_id}` — avatar bytes (only files whose
  purpose is "avatar" can be fetched here).
"""

from __future__ import annotations

from uuid import UUID

import hashlib
import html as _html
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import get_db
from app.models.card import Card
from app.models.file import File
from app.models.path import Path, PathCard
from app.models.podcast import PodcastEpisode, PodcastPlaylist, PodcastPlaylistCard
from app.models.reaction import CardReaction
from app.models.tag import CardTag, Tag
from app.models.user import User
from app.schemas.auth import (
    PublicCardSummary,
    PublicEpisodeBrief,
    PublicPlaylistDetail,
    PublicProfileOut,
    PublicProfilePathOut,
    PublicProfilePlaylistOut,
    PublicProfileSearchOut,
    PublicProfileTagOut,
    PublicSubtagOut,
    PublicTagDetail,
)
from app.schemas.card import CardOut
from app.services.storage import get_storage

router = APIRouter(prefix="/public", tags=["public"])


def _load_public_user(db: Session, username: str) -> User:
    user = db.execute(
        select(User).where(User.username == username.lower(), User.public_profile.is_(True))
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    return user


def _walk_public_subtree(db: Session, user_id: UUID, root_tag: Tag) -> set[UUID]:
    """Return ids of `root_tag` plus every descendant tag belonging to
    `user_id`. Public-ness is anchored at `root_tag` — children inherit
    visibility automatically.
    """
    all_user_tags = db.execute(select(Tag).where(Tag.user_id == user_id)).scalars().all()
    children: dict[UUID | None, list[Tag]] = {}
    for t in all_user_tags:
        children.setdefault(t.parent_id, []).append(t)
    visited: set[UUID] = {root_tag.id}
    stack: list[Tag] = [root_tag]
    while stack:
        current = stack.pop()
        for child in children.get(current.id, []):
            if child.id not in visited:
                visited.add(child.id)
                stack.append(child)
    return visited


def _name_path(db: Session, user_id: UUID, tag: Tag) -> list[str]:
    """Ancestor → leaf chain of tag names, used for both the URL slug
    and the breadcrumb on the public profile.
    """
    parts: list[str] = [tag.name]
    cursor = db.get(Tag, tag.parent_id) if tag.parent_id else None
    safety = 0
    while cursor is not None and safety < 50:
        if cursor.user_id != user_id:
            break
        parts.append(cursor.name)
        cursor = db.get(Tag, cursor.parent_id) if cursor.parent_id else None
        safety += 1
    parts.reverse()
    return parts


def _slug_path(db: Session, user_id: UUID, tag: Tag) -> str:
    """Build `parent/child/leaf` style slug from a tag up to the root.
    Tag names are already lowercase + dash-separated, so they double
    as URL-safe slugs.
    """
    return "/".join(_name_path(db, user_id, tag))


@router.get("/users/{username}", response_model=PublicProfileOut)
def get_public_profile(
    username: str,
    db: Session = Depends(get_db),
) -> PublicProfileOut:
    user = _load_public_user(db, username)

    # Public tags. We surface only the user's *top-level* public tags
    # (or public tags whose parent is private — those become entry
    # points). Sub-tags of a public tag inherit visibility but we don't
    # list them on the profile to avoid clutter.
    public_tags = db.execute(
        select(Tag).where(Tag.user_id == user.id, Tag.is_public.is_(True)).order_by(Tag.name)
    ).scalars().all()

    # Public paths the user has published. Path's cover_url, if present,
    # is rewritten to the public cover endpoint so anonymous browsers can
    # render it.
    path_rows = db.execute(
        select(Path).where(Path.user_id == user.id, Path.is_public.is_(True)).order_by(Path.created_at.desc())
    ).scalars().all()
    out_paths: list[PublicProfilePathOut] = []
    for p in path_rows:
        count = db.execute(
            select(func.count(PathCard.card_id)).where(PathCard.path_id == p.id)
        ).scalar_one()
        cover = (
            f"/api/public/paths/{user.username}/{p.slug}/cover.png"
            if p.cover_url
            else None
        )
        out_paths.append(
            PublicProfilePathOut(
                id=p.id,
                title=p.title,
                slug=p.slug,
                description_md=p.description_md,
                cover_url=cover,
                card_count=int(count or 0),
            )
        )

    # Public podcast playlists. cover_url comes from the latest episode
    # with a cover (if any) — we don't store a cover on the playlist
    # itself, so this gives the visitor something to look at on the tile.
    playlist_rows = db.execute(
        select(PodcastPlaylist)
        .where(PodcastPlaylist.user_id == user.id, PodcastPlaylist.is_public.is_(True))
        .order_by(PodcastPlaylist.created_at.desc())
    ).scalars().all()
    out_playlists: list[PublicProfilePlaylistOut] = []
    for pl in playlist_rows:
        card_count = db.execute(
            select(func.count(PodcastPlaylistCard.card_id))
            .where(PodcastPlaylistCard.playlist_id == pl.id)
        ).scalar_one()
        ready_eps = db.execute(
            select(PodcastEpisode)
            .where(
                PodcastEpisode.playlist_id == pl.id,
                PodcastEpisode.status == "ready",
            )
            .order_by(PodcastEpisode.created_at.desc())
        ).scalars().all()
        cover = (
            f"/api/public/users/{user.username}/podcasts/{pl.id}/episodes/{ready_eps[0].id}/cover.png"
            if ready_eps and ready_eps[0].cover_file_id
            else None
        )
        out_playlists.append(
            PublicProfilePlaylistOut(
                id=pl.id,
                name=pl.name,
                description=pl.description,
                card_count=int(card_count or 0),
                episode_count=len(ready_eps),
                cover_url=cover,
            )
        )

    if not public_tags:
        return PublicProfileOut(
            username=user.username or "",
            display_name=user.display_name,
            bio=user.bio,
            avatar_file_id=user.avatar_file_id,
            tags=[],
            paths=out_paths,
            playlists=out_playlists,
        )

    # Card counts per public tag tree. Every tag the user explicitly
    # marked public gets its own profile entry — including sub-tags
    # of a public parent. Earlier behaviour hid those to "avoid
    # clutter", but it violated the principle of least surprise:
    # toggle a tag public, the toggle silently no-ops on the profile.
    out_tags: list[PublicProfileTagOut] = []
    for t in public_tags:
        subtree_ids = _walk_public_subtree(db, user.id, t)
        count = db.execute(
            select(func.count(func.distinct(CardTag.card_id))).where(CardTag.tag_id.in_(subtree_ids))
        ).scalar_one()
        path = _name_path(db, user.id, t)
        out_tags.append(
            PublicProfileTagOut(
                name=t.name,
                slug="/".join(path),
                card_count=int(count or 0),
                name_path=path,
                subtag_count=max(0, len(subtree_ids) - 1),
            )
        )

    out_tags.sort(key=lambda x: (-x.card_count, x.name))
    return PublicProfileOut(
        username=user.username or "",
        display_name=user.display_name,
        bio=user.bio,
        avatar_file_id=user.avatar_file_id,
        tags=out_tags,
        paths=out_paths,
        playlists=out_playlists,
    )


def _resolve_tag_by_slug(db: Session, user_id: UUID, slug_path: str) -> Tag:
    """Resolve `parent/child/leaf` to the matching Tag, anchored at a
    public top-level tag.
    """
    parts = [p for p in slug_path.split("/") if p]
    if not parts:
        raise HTTPException(status_code=404, detail="Tag not found")

    cursor: Tag | None = None
    for i, part in enumerate(parts):
        stmt = select(Tag).where(Tag.user_id == user_id, Tag.name == part)
        if cursor is None:
            # Top of the path must be a public tag (or a tag whose
            # ancestor is public, but we only allow direct entry at a
            # public tag for clarity).
            stmt = stmt.where(Tag.parent_id.is_(None), Tag.is_public.is_(True))
        else:
            stmt = stmt.where(Tag.parent_id == cursor.id)
        cursor = db.execute(stmt).scalar_one_or_none()
        if cursor is None:
            # Fallback: a top-level public tag may have an ancestor we
            # couldn't follow because the user keeps their root private
            # but exposes a sub-tag. Allow exposing a non-root public
            # tag directly when no parent matched.
            if i == 0:
                cursor = db.execute(
                    select(Tag).where(
                        Tag.user_id == user_id,
                        Tag.name == part,
                        Tag.is_public.is_(True),
                    )
                ).scalar_one_or_none()
            if cursor is None:
                raise HTTPException(status_code=404, detail="Tag not found")
    assert cursor is not None
    return cursor


@router.get("/users/{username}/tags/{slug:path}", response_model=PublicTagDetail)
def get_public_tag(
    username: str,
    slug: str,
    db: Session = Depends(get_db),
) -> PublicTagDetail:
    user = _load_public_user(db, username)
    tag = _resolve_tag_by_slug(db, user.id, slug)

    subtree_ids = _walk_public_subtree(db, user.id, tag)
    # Use distinct() instead of group_by — Card has eager-joined Source
    # which would otherwise need to be in the GROUP BY too.
    cards = db.execute(
        select(Card)
        .where(
            Card.user_id == user.id,
            Card.status == "completed",
            Card.id.in_(select(CardTag.card_id).where(CardTag.tag_id.in_(subtree_ids))),
        )
        .order_by(Card.created_at.desc())
    ).scalars().all()

    # Bulk-fetch sources so we don't N+1 when serializing.
    source_ids = {c.source_id for c in cards if c.source_id}
    sources_by_id = {}
    if source_ids:
        from app.models.source import Source

        rows = db.execute(select(Source).where(Source.id.in_(source_ids))).scalars().all()
        sources_by_id = {s.id: s for s in rows}

    def _summary(c: Card) -> PublicCardSummary:
        s = sources_by_id.get(c.source_id) if c.source_id else None
        return PublicCardSummary(
            id=c.id,
            title=c.title,
            source_type=c.source_type,
            thumbnail_url=c.thumbnail_url,
            concise_summary_md=c.concise_summary_md,
            source_url=s.canonical_url or s.url if s else None,
            external_id=s.external_id if s else None,
        )

    # Direct child tags → chip row on the detail page. Sub-tags inherit
    # visibility from the public ancestor, so we list every direct child
    # regardless of its own `is_public` flag. card_count uses the same
    # recursive subtree-count rule that the profile cards use.
    direct_children = db.execute(
        select(Tag)
        .where(Tag.user_id == user.id, Tag.parent_id == tag.id)
        .order_by(Tag.name)
    ).scalars().all()
    subtag_out: list[PublicSubtagOut] = []
    for child in direct_children:
        child_subtree = _walk_public_subtree(db, user.id, child)
        child_count = db.execute(
            select(func.count(func.distinct(CardTag.card_id))).where(
                CardTag.tag_id.in_(child_subtree)
            )
        ).scalar_one()
        if not child_count:
            # A child with zero cards anywhere in its own subtree is just
            # visual noise on the chip row — skip it.
            continue
        subtag_out.append(
            PublicSubtagOut(
                name=child.name,
                slug=_slug_path(db, user.id, child),
                card_count=int(child_count or 0),
            )
        )

    path = _name_path(db, user.id, tag)
    return PublicTagDetail(
        name=tag.name,
        slug="/".join(path),
        card_count=len(cards),
        cards=[_summary(c) for c in cards],
        subtags=subtag_out,
        name_path=path,
    )


@router.get("/users/{username}/search", response_model=PublicProfileSearchOut)
def search_public_profile(
    username: str,
    q: str = Query("", max_length=120),
    limit: int = Query(30, ge=1, le=50),
    db: Session = Depends(get_db),
) -> PublicProfileSearchOut:
    """Full-text-ish search across a user's public cards.

    Searches `title` + `concise_summary_md` via ILIKE for the given
    query string. Scope is restricted to cards reachable through at
    least one of the user's public tag subtrees — same visibility
    rule as the per-tag detail page. Returns at most `limit` results
    (cap 50). Empty / too-short queries return an empty list rather
    than 400, so the frontend can fire on every keystroke without
    extra guarding.
    """
    user = _load_public_user(db, username)
    needle = q.strip()
    if len(needle) < 2:
        return PublicProfileSearchOut(query=needle, cards=[])

    # Visible tag scope: union of every public tag subtree.
    public_roots = db.execute(
        select(Tag).where(Tag.user_id == user.id, Tag.is_public.is_(True))
    ).scalars().all()
    visible_tag_ids: set[UUID] = set()
    for root in public_roots:
        visible_tag_ids |= _walk_public_subtree(db, user.id, root)
    if not visible_tag_ids:
        return PublicProfileSearchOut(query=needle, cards=[])

    pattern = f"%{needle}%"
    cards = db.execute(
        select(Card)
        .where(
            Card.user_id == user.id,
            Card.status == "completed",
            Card.id.in_(
                select(CardTag.card_id).where(CardTag.tag_id.in_(visible_tag_ids))
            ),
            (Card.title.ilike(pattern)) | (Card.concise_summary_md.ilike(pattern)),
        )
        .order_by(Card.created_at.desc())
        .limit(limit)
    ).scalars().all()

    source_ids = {c.source_id for c in cards if c.source_id}
    sources_by_id: dict = {}
    if source_ids:
        from app.models.source import Source

        rows = db.execute(select(Source).where(Source.id.in_(source_ids))).scalars().all()
        sources_by_id = {s.id: s for s in rows}

    def _summary(c: Card) -> PublicCardSummary:
        s = sources_by_id.get(c.source_id) if c.source_id else None
        return PublicCardSummary(
            id=c.id,
            title=c.title,
            source_type=c.source_type,
            thumbnail_url=c.thumbnail_url,
            concise_summary_md=c.concise_summary_md,
            source_url=s.canonical_url or s.url if s else None,
            external_id=s.external_id if s else None,
        )

    return PublicProfileSearchOut(query=needle, cards=[_summary(c) for c in cards])


@router.get("/users/{username}/cards/{card_id}")
def get_public_card(
    username: str,
    card_id: UUID,
    db: Session = Depends(get_db),
) -> dict:
    user = _load_public_user(db, username)
    card = db.get(Card, card_id)
    if card is None or card.user_id != user.id:
        raise HTTPException(status_code=404, detail="Card not found")

    # Walk every public top-level tag's subtree; the card must be in at
    # least one to be visible.
    public_roots = db.execute(
        select(Tag).where(Tag.user_id == user.id, Tag.is_public.is_(True))
    ).scalars().all()
    visible_tag_ids: set[UUID] = set()
    for root in public_roots:
        visible_tag_ids |= _walk_public_subtree(db, user.id, root)
    if not visible_tag_ids:
        raise HTTPException(status_code=404, detail="Card not found")

    is_visible = db.execute(
        select(CardTag).where(
            CardTag.card_id == card.id, CardTag.tag_id.in_(visible_tag_ids)
        )
    ).first()
    if is_visible is None:
        raise HTTPException(status_code=404, detail="Card not found")

    out = CardOut.model_validate(card).model_dump()
    # Pull the original Source so the public viewer can embed YouTube /
    # link out to articles + PDFs.
    source_url: str | None = None
    external_id: str | None = None
    if card.source_id:
        from app.models.source import Source

        s = db.get(Source, card.source_id)
        if s is not None:
            source_url = s.canonical_url or s.url
            external_id = s.external_id
    # Trim sensitive-ish fields.
    return {
        "id": out["id"],
        "title": out["title"],
        "source_type": out["source_type"],
        "thumbnail_url": out["thumbnail_url"],
        "concise_summary_md": out["concise_summary_md"],
        "detailed_summary_md": out["detailed_summary_md"],
        "key_takeaways_json": out["key_takeaways_json"],
        "notes_md": out["notes_md"],
        "source_url": source_url,
        "external_id": external_id,
    }


@router.get("/users/{username}/feeds/{slug:path}.rss")
def get_public_tag_rss(
    username: str,
    slug: str,
    request: Request,
    db: Session = Depends(get_db),
) -> Response:
    """RSS 2.0 feed for a public tag tree. One <item> per card,
    newest first. Use any RSS reader (Feedly, NetNewsWire) to follow.
    """
    user = _load_public_user(db, username)
    tag = _resolve_tag_by_slug(db, user.id, slug)
    subtree_ids = _walk_public_subtree(db, user.id, tag)
    cards = db.execute(
        select(Card)
        .where(
            Card.user_id == user.id,
            Card.status == "completed",
            Card.id.in_(select(CardTag.card_id).where(CardTag.tag_id.in_(subtree_ids))),
        )
        .order_by(Card.created_at.desc())
        .limit(40)
    ).scalars().all()

    base = f"{request.url.scheme}://{request.url.netloc}"
    feed_url = f"{base}/api/public/users/{username}/tags/{slug}.rss"
    site_url = f"{base}/u/{username}/{slug}"
    title = f"#{tag.name} — @{username}"
    desc = (user.bio or f"Public collection #{tag.name} on Mindshift.")[:300]

    def _item(card: Card) -> str:
        item_url = f"{base}/u/{username}/cards/{card.id}"
        pub = format_datetime((card.created_at or datetime.now(timezone.utc)).astimezone(timezone.utc))
        body = card.concise_summary_md or ""
        return (
            "<item>"
            f"<title>{_html.escape(card.title)}</title>"
            f"<link>{_html.escape(item_url)}</link>"
            f"<guid isPermaLink=\"true\">{_html.escape(item_url)}</guid>"
            f"<pubDate>{pub}</pubDate>"
            f"<description>{_html.escape(body)}</description>"
            "</item>"
        )

    body = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">'
        "<channel>"
        f"<title>{_html.escape(title)}</title>"
        f"<link>{_html.escape(site_url)}</link>"
        f'<atom:link href="{_html.escape(feed_url)}" rel="self" type="application/rss+xml" />'
        f"<description>{_html.escape(desc)}</description>"
        "<language>en</language>"
        + "".join(_item(c) for c in cards)
        + "</channel></rss>"
    )
    return Response(content=body, media_type="application/rss+xml")


REACTION_KINDS = {"like", "insightful", "mindblown"}


class ReactionRequest(BaseModel):
    kind: str = Field(pattern=r"^(like|insightful|mindblown)$")


def _ip_hash(request: Request) -> str:
    """Stable per-installation hash. Salted with JWT_SECRET so the
    raw IP never leaves memory and the hash isn't transferable.
    """
    fwd = request.headers.get("x-forwarded-for", "")
    ip = (fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "")) or "anon"
    salt = get_settings().jwt_secret
    return hashlib.sha256(f"{salt}|{ip}".encode("utf-8")).hexdigest()


def _aggregate_reactions(db: Session, card_id) -> dict[str, int]:
    rows = db.execute(
        select(CardReaction.kind, func.count(CardReaction.id))
        .where(CardReaction.card_id == card_id)
        .group_by(CardReaction.kind)
    ).all()
    counts = {k: 0 for k in REACTION_KINDS}
    for kind, n in rows:
        if kind in counts:
            counts[kind] = int(n or 0)
    return counts


def _user_reactions(db: Session, card_id, ip_hash: str) -> list[str]:
    rows = db.execute(
        select(CardReaction.kind).where(
            CardReaction.card_id == card_id, CardReaction.ip_hash == ip_hash
        )
    ).scalars().all()
    return list(rows)


@router.post("/users/{username}/cards/{card_id}/reactions")
def react_to_card(
    username: str,
    card_id,
    payload: ReactionRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    """Toggle the visitor's reaction on a public card. The same IP can
    only have one row per (card, kind) — re-posting removes it (toggle
    behaviour). Per-IP hourly cap of 60 to keep abuse boring.
    """
    user = _load_public_user(db, username)
    card = db.get(Card, card_id)
    if card is None or card.user_id != user.id:
        raise HTTPException(status_code=404, detail="Card not found")

    # Reachable via any public tag?
    public_roots = db.execute(
        select(Tag).where(Tag.user_id == user.id, Tag.is_public.is_(True))
    ).scalars().all()
    visible: set = set()
    for root in public_roots:
        visible |= _walk_public_subtree(db, user.id, root)
    if not visible:
        raise HTTPException(status_code=404, detail="Card not found")
    if not db.execute(
        select(CardTag).where(CardTag.card_id == card.id, CardTag.tag_id.in_(visible))
    ).first():
        raise HTTPException(status_code=404, detail="Card not found")

    iph = _ip_hash(request)

    # Hourly rate limit per IP (any kind, any card).
    one_hour_ago = datetime.now(timezone.utc) - timedelta(hours=1)
    recent = db.execute(
        select(func.count(CardReaction.id)).where(
            CardReaction.ip_hash == iph, CardReaction.created_at >= one_hour_ago
        )
    ).scalar_one()
    if int(recent or 0) >= 60:
        raise HTTPException(status_code=429, detail="Too many reactions, slow down.")

    existing = db.execute(
        select(CardReaction).where(
            CardReaction.card_id == card.id,
            CardReaction.ip_hash == iph,
            CardReaction.kind == payload.kind,
        )
    ).scalar_one_or_none()
    if existing is not None:
        db.delete(existing)
        db.commit()
        active = False
    else:
        db.add(CardReaction(card_id=card.id, ip_hash=iph, kind=payload.kind))
        db.commit()
        active = True

    return {
        "kind": payload.kind,
        "active": active,
        "counts": _aggregate_reactions(db, card.id),
        "mine": _user_reactions(db, card.id, iph),
    }


@router.get("/users/{username}/cards/{card_id}/reactions")
def get_reactions(
    username: str,
    card_id,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    user = _load_public_user(db, username)
    card = db.get(Card, card_id)
    if card is None or card.user_id != user.id:
        raise HTTPException(status_code=404, detail="Card not found")
    iph = _ip_hash(request)
    return {
        "counts": _aggregate_reactions(db, card.id),
        "mine": _user_reactions(db, card.id, iph),
    }


@router.get("/avatars/{file_id}")
def get_public_avatar(file_id: UUID, db: Session = Depends(get_db)) -> Response:
    """Public avatar fetch. Only files marked with purpose=avatar can be
    served through this path — everything else is 404.
    """
    file = db.get(File, file_id)
    if file is None or file.purpose != "avatar":
        raise HTTPException(status_code=404, detail="Avatar not found")
    blob = get_storage().read(file)
    return Response(
        content=blob,
        media_type=file.content_type or "application/octet-stream",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.get("/post-images/{token}.png")
def get_public_post_image(token: UUID, db: Session = Depends(get_db)) -> Response:
    """Public, no-auth fetch of a generated post image, keyed by an
    unguessable token stored on the social-post row. Used so third-party
    MCP publishers (Reepl, Buffer, etc.) can pull the image as
    `mediaUrls` during a draft creation. The token only resolves when
    it matches the row AND a file is attached — rotating the image or
    deleting the post invalidates old links."""
    from app.models.card_social_post import CardSocialPost

    post = db.execute(
        select(CardSocialPost).where(CardSocialPost.image_share_token == token)
    ).scalar_one_or_none()
    if post is None or post.image_file_id is None:
        raise HTTPException(status_code=404, detail="Image not found")
    file = db.get(File, post.image_file_id)
    if file is None:
        raise HTTPException(status_code=404, detail="Image file not found")
    blob = get_storage().read(file)
    return Response(
        content=blob,
        media_type=file.content_type or "image/png",
        headers={"Cache-Control": "public, max-age=300"},
    )


# --- Public podcast playlists -----------------------------------------------


def _load_public_playlist(
    db: Session, username: str, playlist_id: UUID
) -> tuple[User, PodcastPlaylist]:
    user = _load_public_user(db, username)
    pl = db.get(PodcastPlaylist, playlist_id)
    if pl is None or pl.user_id != user.id or not pl.is_public:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return user, pl


@router.get("/users/{username}/podcasts/{playlist_id}", response_model=PublicPlaylistDetail)
def get_public_playlist(
    username: str,
    playlist_id: UUID,
    db: Session = Depends(get_db),
) -> PublicPlaylistDetail:
    user, pl = _load_public_playlist(db, username, playlist_id)
    eps = db.execute(
        select(PodcastEpisode)
        .where(
            PodcastEpisode.playlist_id == pl.id,
            PodcastEpisode.status == "ready",
        )
        .order_by(PodcastEpisode.created_at.desc())
    ).scalars().all()
    base = f"/api/public/users/{username}/podcasts/{pl.id}/episodes"
    return PublicPlaylistDetail(
        id=pl.id,
        name=pl.name,
        description=pl.description,
        author_username=user.username or "",
        author_display_name=user.display_name,
        episodes=[
            PublicEpisodeBrief(
                id=ep.id,
                title=ep.title,
                voice=ep.voice,
                audio_url=f"{base}/{ep.id}/audio.wav",
                cover_url=f"{base}/{ep.id}/cover.png" if ep.cover_file_id else None,
                narrative_text=ep.narrative_text,
                created_at=ep.created_at,
            )
            for ep in eps
        ],
    )


def _load_public_episode(
    db: Session, username: str, playlist_id: UUID, episode_id: UUID
) -> PodcastEpisode:
    _, pl = _load_public_playlist(db, username, playlist_id)
    ep = db.get(PodcastEpisode, episode_id)
    if ep is None or ep.playlist_id != pl.id or ep.status != "ready":
        raise HTTPException(status_code=404, detail="Episode not found")
    return ep


@router.get("/users/{username}/podcasts/{playlist_id}/episodes/{episode_id}/audio.wav")
def get_public_playlist_episode_audio(
    username: str,
    playlist_id: UUID,
    episode_id: UUID,
    db: Session = Depends(get_db),
) -> Response:
    ep = _load_public_episode(db, username, playlist_id, episode_id)
    if ep.audio_file_id is None:
        raise HTTPException(status_code=404, detail="No audio")
    file = db.get(File, ep.audio_file_id)
    if file is None:
        raise HTTPException(status_code=404, detail="Audio file missing")
    blob = get_storage().read(file)
    return Response(
        content=blob,
        media_type="audio/wav",
        headers={
            "Content-Disposition": "inline",
            "Content-Length": str(len(blob)),
            "Cache-Control": "public, max-age=3600",
        },
    )


@router.get("/users/{username}/podcasts/{playlist_id}/episodes/{episode_id}/cover.png")
def get_public_playlist_episode_cover(
    username: str,
    playlist_id: UUID,
    episode_id: UUID,
    db: Session = Depends(get_db),
) -> Response:
    ep = _load_public_episode(db, username, playlist_id, episode_id)
    if ep.cover_file_id is None:
        raise HTTPException(status_code=404, detail="No cover")
    file = db.get(File, ep.cover_file_id)
    if file is None:
        raise HTTPException(status_code=404, detail="Cover file missing")
    blob = get_storage().read(file)
    return Response(
        content=blob,
        media_type="image/png",
        headers={
            "Content-Disposition": "inline",
            "Content-Length": str(len(blob)),
            "Cache-Control": "public, max-age=86400",
        },
    )
