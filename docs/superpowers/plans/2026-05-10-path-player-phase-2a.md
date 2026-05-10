# Path Player Phase 2a — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a public path into a real walkable course for anonymous and logged-in non-owner consumers — full content (Summary, Transcript, Quiz, Source media) visible, plus per-user progress + quiz history for logged-in users.

**Architecture:** Three new unauthenticated public endpoints expose card / transcript / quiz scoped to a public path. Existing `_accessible_path`-guarded endpoints already serve logged-in non-owner progress + quiz attempts. The Phase 1 player components (`PathPlayerPage`, `PathPlayerCardView`) get a `mode: "owner" | "public"` prop that switches API targets and tab visibility — no UI fork.

**Tech Stack:** FastAPI + SQLAlchemy 2 + Pydantic (backend), React 18 + TypeScript + react-router-dom + react-i18next (frontend). No new deps.

**Spec reference:** `docs/superpowers/specs/2026-05-10-path-player-phase-2a-design.md`.

**Branch strategy:** new branch `feat/path-player-phase-2a` off `main`. Fast-forward main at the end.

**Test gate:** Backend has `pytest` configured (existing tests under `backend/tests/`). Frontend has `npx tsc -b --noEmit` only. Manual smoke is the regression gate; no Playwright.

---

## File map

| Path | Action | Responsibility |
|---|---|---|
| `backend/app/api/paths.py` | modify | Add 3 public endpoints (`/cards/{id}`, `/transcript`, `/quiz`) + `_load_public_card_in_path` helper. Add `id` to `PublicPathOut`. |
| `backend/app/schemas/path.py` | modify | Add `id: UUID` to `PublicPathOut`. New `PublicCardOut` (subset of `CardOut`, no owner-private fields). |
| `backend/tests/test_public_paths.py` | create | pytest covering happy-path + 404s for each new endpoint. |
| `frontend/src/lib/api.ts` | modify | New methods: `getPublicCard`, `getPublicCardTranscript`, `getPublicCardQuiz`. Add `id` to `PublicPathOut` interface. |
| `frontend/src/components/PathPlayerCardView.tsx` | modify | Accept `mode: "owner" \| "public"` + optional `username`/`slug` props. Switch fetch source. Filter Notes/Chat in public mode. |
| `frontend/src/pages/PathPlayerPage.tsx` | modify | Accept `mode` prop. Read `username`/`slug`/`step` from public route. Skip progress save when no auth token. |
| `frontend/src/pages/PathQuizPage.tsx` | modify | Accept `mode` prop. Read questions via public endpoint when `mode="public"`. Hide submit + show sign-in banner when anonymous. |
| `frontend/src/pages/PublicPathPage.tsx` | modify | Add primary "Start path" CTA linking to the public player route. |
| `frontend/src/App.tsx` | modify | Register three new routes under `/u/:username/path/:slug/`: `play`, `play/:step`, `quiz`. |
| `frontend/src/locales/en.json` | modify | Add `paths.startPath`, `paths.signInToSaveScore`, `paths.signInToSaveProgress`. |
| `frontend/src/locales/de.json` | modify | German equivalents. |

---

## Task 1: Backend — public card / transcript / quiz endpoints + tests

**Files:**
- Modify: `backend/app/schemas/path.py`
- Modify: `backend/app/api/paths.py`
- Create: `backend/tests/test_public_paths.py`

- [ ] **Step 1: Add `id` to `PublicPathOut` and define `PublicCardOut`**

In `backend/app/schemas/path.py`, modify the existing `PublicPathOut` and add `PublicCardOut`:

```python
from uuid import UUID
# (existing imports stay)

class PublicCardOut(BaseModel):
    """Subset of CardOut that is safe to expose to non-owner consumers
    of a public path. Drops owner-private fields (notes_md, error_message,
    user_id, original_file_id) and consumer-irrelevant detail (tags,
    public_via_tags)."""
    id: UUID
    title: str
    source_type: str
    status: str
    thumbnail_url: str | None = None
    concise_summary_md: str | None = None
    detailed_summary_md: str | None = None
    key_takeaways_json: list | None = None
    source_url: str | None = None
    external_id: str | None = None
    source_metadata: dict | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class PublicPathOut(BaseModel):
    """Public read-only view — username + slug pair instead of the
    owner's UUID."""
    id: UUID
    title: str
    slug: str
    description_md: str | None
    cover_url: str | None
    author_username: str
    cards: list[PathCardItem]
    created_at: datetime
```

The only change to the existing `PublicPathOut` is adding `id: UUID` as the first field.

- [ ] **Step 2: Add the helper + three endpoints in `paths.py`**

In `backend/app/api/paths.py`, locate the existing `public_router` block (around line 635). Add ABOVE the existing `get_public_path` handler:

```python
def _load_public_card_in_path(
    db: Session, username: str, slug: str, card_id: UUID
) -> tuple["Path", "Card"]:
    """Resolve a (public-path, card) pair by username + slug + card_id.
    Raises 404 unless: the user is public, the path is public and owned
    by them, and the card belongs to that path."""
    user = db.execute(
        select(User).where(User.username == username, User.public_profile.is_(True))
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="Path not found")
    path = db.execute(
        select(Path).where(Path.user_id == user.id, Path.slug == slug, Path.is_public.is_(True))
    ).scalar_one_or_none()
    if path is None:
        raise HTTPException(status_code=404, detail="Path not found")
    pc = db.execute(
        select(PathCard).where(PathCard.path_id == path.id, PathCard.card_id == card_id)
    ).scalar_one_or_none()
    if pc is None:
        raise HTTPException(status_code=404, detail="Card not in path")
    card = db.get(Card, card_id)
    if card is None:
        raise HTTPException(status_code=404, detail="Card not found")
    return path, card
```

Then update the existing `get_public_path` to include `id`:

Find the `return PublicPathOut(...)` block at the bottom of `get_public_path` and add `id=path.id,` as the first argument (just before `title=path.title,`).

Then add the three new endpoints after the existing `stream_public_cover` handler (so `public_router` stays cohesive):

```python
@public_router.get("/{username}/{slug}/cards/{card_id}", response_model=PublicCardOut)
def get_public_card(
    username: str,
    slug: str,
    card_id: UUID,
    db: Session = Depends(get_db),
) -> PublicCardOut:
    """Full public-safe card detail for a card inside a public path."""
    _, card = _load_public_card_in_path(db, username, slug, card_id)
    return PublicCardOut.model_validate(card)


@public_router.get("/{username}/{slug}/cards/{card_id}/transcript")
def get_public_card_transcript(
    username: str,
    slug: str,
    card_id: UUID,
    db: Session = Depends(get_db),
) -> dict:
    _, card = _load_public_card_in_path(db, username, slug, card_id)
    transcript = db.execute(
        select(Transcript).where(Transcript.card_id == card.id).order_by(Transcript.created_at.desc())
    ).scalar_one_or_none()
    if transcript is None:
        raise HTTPException(status_code=404, detail="No transcript available")
    return {
        "card_id": str(card.id),
        "language": transcript.language,
        "provider": transcript.provider,
        "text": transcript.text,
        "segments": transcript.segments_json,
    }


@public_router.get(
    "/{username}/{slug}/cards/{card_id}/quiz",
    response_model=list[QuizQuestionOut],
)
def get_public_card_quiz(
    username: str,
    slug: str,
    card_id: UUID,
    db: Session = Depends(get_db),
) -> list[QuizQuestion]:
    _, card = _load_public_card_in_path(db, username, slug, card_id)
    return list(
        db.execute(
            select(QuizQuestion)
            .where(QuizQuestion.card_id == card.id)
            .order_by(QuizQuestion.created_at)
        ).scalars()
    )
```

Verify the imports at the top of `paths.py` cover: `Card` from `app.models.card`, `Transcript` from `app.models.transcript`, `QuizQuestion` from `app.models.quiz_question`, `QuizQuestionOut` from `app.schemas.card`, `PublicCardOut` from `app.schemas.path`. Add any that are missing.

- [ ] **Step 3: Write failing tests**

Create `backend/tests/test_public_paths.py`:

```python
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
```

The fixtures (`seeded_public_path`, `seeded_private_path`, `seeded_public_path_with_transcript`, `seeded_public_path_with_quiz`, `seeded_other_card`) need to live in `backend/tests/conftest.py`. Check whether `conftest.py` exists:

```bash
ls backend/tests/conftest.py 2>/dev/null && echo exists || echo missing
```

If it doesn't exist, the implementer creates it with helpers that build up these fixtures using the live DB session. Concrete fixture skeleton (paste into `backend/tests/conftest.py` if creating):

```python
"""Shared test fixtures for backend pytest suite."""
from __future__ import annotations

import uuid
from dataclasses import dataclass

import pytest
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.card import Card
from app.models.path import Path, PathCard
from app.models.quiz_question import QuizQuestion
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
        external_id="dQw4w9WgXcQ",
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
def db() -> Session:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


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


@pytest.fixture
def seeded_public_path_with_quiz(db: Session) -> SeededPath:
    user = _make_user(db, public_profile=True)
    card = _make_card(db, user)
    db.add(QuizQuestion(card_id=card.id, question="Q?", answer="A.", question_type="open"))
    db.commit()
    path = _make_path(db, user, [card], is_public=True)
    return SeededPath(user=user, path=path, cards=[card])
```

If `conftest.py` already exists, the implementer adds the fixtures from above into it (de-duplicating any helpers).

- [ ] **Step 4: Run tests, expect failures or passes depending on dev DB state**

Run: `cd backend && .venv/bin/pytest tests/test_public_paths.py -v 2>&1 | tail -40`

If the DB schema doesn't match (e.g. `User` doesn't have `public_profile`), the implementer reports BLOCKED with the schema mismatch — DO NOT invent migrations. The fixture should adjust to the real schema.

If tests pass on first run because the endpoints already exist (impossible — they're new), something is wrong; investigate.

Expected: 6/6 tests pass after the endpoints are implemented.

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/path.py backend/app/api/paths.py backend/tests/test_public_paths.py backend/tests/conftest.py
git commit -m "feat(paths): public card/transcript/quiz endpoints for path consumers"
```

(Drop `backend/tests/conftest.py` from the `git add` if it already existed and you only added fixtures.)

---

## Task 2: Frontend api.ts public methods + type updates

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Add `id` to the `PublicPathOut` TypeScript interface**

Locate the `PublicPathOut` interface (around line 822) and add `id: string;` as the first field:

```ts
export interface PublicPathOut {
  id: string;
  title: string;
  slug: string;
  description_md: string | null;
  cover_url: string | null;
  author_username: string;
  cards: PathCardItem[];
  created_at: string;
}
```

- [ ] **Step 2: Add a `PublicCardOut` interface**

Add this interface near `PathCardItem` (the consumer card shape — subset of `Card` without owner-private fields):

```ts
export interface PublicCardOut {
  id: string;
  title: string;
  source_type: string;
  status: string;
  thumbnail_url: string | null;
  concise_summary_md: string | null;
  detailed_summary_md: string | null;
  key_takeaways_json: unknown[] | null;
  source_url: string | null;
  external_id: string | null;
  source_metadata: Record<string, unknown> | null;
  created_at: string;
}
```

The reason for a separate type instead of `Card`: `Card` carries fields (`user_id`, `notes_md`, `is_public`, `tags`, `public_via_tags`) the public endpoint doesn't return. We reuse it as a `Card` lookalike at the call site by spreading defaults — see Step 4.

- [ ] **Step 3: Add the three public API methods**

Add these methods to the `api` object (next to the existing `getPublicPath`):

```ts
  getPublicCard: (username: string, slug: string, cardId: string) =>
    request<PublicCardOut>(
      `/api/public/paths/${username}/${slug}/cards/${cardId}`,
    ),
  getPublicCardTranscript: (username: string, slug: string, cardId: string) =>
    request<TranscriptOut>(
      `/api/public/paths/${username}/${slug}/cards/${cardId}/transcript`,
    ),
  getPublicCardQuiz: (username: string, slug: string, cardId: string) =>
    request<QuizQuestion[]>(
      `/api/public/paths/${username}/${slug}/cards/${cardId}/quiz`,
    ),
```

These rely on the existing `request<T>(path)` helper (no auth header is appended unless a JWT exists, which is fine — public endpoints ignore auth).

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(api): public path consumer methods (card, transcript, quiz)"
```

---

## Task 3: `PathPlayerCardView` — `mode` prop + public fetch

**Files:**
- Modify: `frontend/src/components/PathPlayerCardView.tsx`

The current component fetches via `api.getCard(cardId)` (owner-only) and renders all five tabs. Phase 2a adds:
- A `mode` prop. When `mode="owner"`, today's behaviour. When `mode="public"`, fetch via the public endpoints (require `username`/`slug` props) and filter Notes/Chat tabs out.
- Cast the public card (a `PublicCardOut`) into the `Card` shape the existing tabs expect via spread + sensible defaults.

- [ ] **Step 1: Update the props interface**

Change the existing props:

```tsx
type PathPlayerMode = { kind: "owner" } | { kind: "public"; username: string; slug: string };

interface PathPlayerCardViewProps {
  cardId: string;
  mode?: PathPlayerMode; // defaults to { kind: "owner" }
}
```

(Discriminated union avoids "did you remember to pass username/slug?" mistakes.)

- [ ] **Step 2: Switch the API calls based on mode**

Inside the component, derive `mode` once:

```tsx
const playerMode: PathPlayerMode = mode ?? { kind: "owner" };
```

Replace the existing `fetchCard` body with a mode-aware version:

```tsx
const fetchCard = useCallback(async () => {
  try {
    if (playerMode.kind === "owner") {
      const data = await api.getCard(cardId);
      setCard(data);
      setNotes(data.notes_md ?? "");
    } else {
      const data = await api.getPublicCard(playerMode.username, playerMode.slug, cardId);
      // Adapt the PublicCardOut to the Card shape the tabs expect.
      setCard({
        ...data,
        user_id: "",
        source_id: null,
        original_file_id: null,
        notes_md: null,
        error_message: null,
        is_public: true,
        public_via_tags: [],
        tags: [],
        updated_at: data.created_at,
      } as unknown as Card);
      setNotes("");
    }
    setError(null);
  } catch (err) {
    setError((err as Error).message);
  }
}, [cardId, playerMode]);
```

(The cast is acceptable here because public-mode tabs never read the dropped fields. Notes tab is hidden, error_message isn't used in the player, etc.)

Replace the lazy-fetch effect's two branches:

```tsx
useEffect(() => {
  if (!card || card.status !== "completed") return;
  if (tab === "transcript" && transcript === null) {
    const fetcher =
      playerMode.kind === "owner"
        ? api.getTranscript(cardId)
        : api.getPublicCardTranscript(playerMode.username, playerMode.slug, cardId);
    void fetcher
      .then(setTranscript)
      .catch((err) =>
        setTranscript({
          card_id: cardId,
          language: null,
          provider: null,
          text: (err as Error).message,
          segments: null,
        }),
      );
  }
  if (tab === "quiz" && quiz.length === 0) {
    const fetcher =
      playerMode.kind === "owner"
        ? api.getQuiz(cardId)
        : api.getPublicCardQuiz(playerMode.username, playerMode.slug, cardId);
    void fetcher.then(setQuiz).catch(() => undefined);
  }
}, [tab, cardId, transcript, quiz.length, card, playerMode]);
```

- [ ] **Step 3: Filter the tabs in public mode**

Update the `tabs` memo:

```tsx
const tabs = useMemo<PlayerTab[]>(
  () =>
    playerMode.kind === "public"
      ? ["summary", "transcript", "quiz"]
      : ["summary", "transcript", "quiz", "notes", "chat"],
  [playerMode.kind],
);
```

Also: the rendered tab body's `{tab === "notes" && ...}` and `{tab === "chat" && ...}` blocks stay as they are — they're guarded by the active `tab` value and the `tabs` array no longer offers them in public mode. Defensive `playerMode.kind === "owner"` guards on those two lines are belt-and-suspenders; not necessary but harmless:

```tsx
{playerMode.kind === "owner" && tab === "notes" && (
  <NotesTab ... />
)}
{playerMode.kind === "owner" && tab === "chat" && (
  <ChatTab card={card} showSourceMedia={false} />
)}
```

- [ ] **Step 4: Skip note saving in public mode**

The `saveNotes` callback is only reachable from the Notes tab — which is now hidden in public mode — so no change needed. But add a defensive early return for safety:

```tsx
const saveNotes = useCallback(async () => {
  if (playerMode.kind !== "owner") return;
  setSavingNotes(true);
  try {
    const updated = await api.updateNotes(cardId, notes);
    setCard(updated);
  } catch (err) {
    setError((err as Error).message);
  } finally {
    setSavingNotes(false);
  }
}, [cardId, notes, playerMode]);
```

- [ ] **Step 5: Type-check**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/PathPlayerCardView.tsx
git commit -m "feat(paths): PathPlayerCardView accepts public mode"
```

---

## Task 4: `PathPlayerPage` — `mode` prop + public route handling

**Files:**
- Modify: `frontend/src/pages/PathPlayerPage.tsx`

The current page reads `:pathId` from the URL and calls `api.getPath(pathId)`. In public mode it'll receive `:username`/`:slug` instead and call `api.getPublicPath(username, slug)`. Progress save is skipped if there's no auth token.

- [ ] **Step 1: Update the prop signature**

```tsx
interface PathPlayerPageProps {
  mode?: "owner" | "public"; // defaults to "owner"
}

export default function PathPlayerPage({ mode = "owner" }: PathPlayerPageProps) {
  // ... existing code
}
```

- [ ] **Step 2: Read the right route params**

```tsx
const params = useParams<{ pathId?: string; username?: string; slug?: string; step?: string }>();
const pathId = params.pathId ?? "";
const username = params.username ?? "";
const slug = params.slug ?? "";
```

(The `useParams` line that already exists — `const { pathId = "" } = useParams<{ pathId: string }>();` — gets replaced.)

- [ ] **Step 3: Mode-aware path fetch**

Replace the existing `fetchPath` body:

```tsx
const fetchPath = useCallback(async () => {
  try {
    let detail: PathDetail | PublicPathOut;
    let resolvedId: string;
    if (mode === "owner") {
      detail = await api.getPath(pathId);
      resolvedId = pathId;
    } else {
      detail = await api.getPublicPath(username, slug);
      resolvedId = detail.id;
    }
    setPath(detail as PathDetail);  // shapes overlap on the fields we read

    // Resume from saved progress (logged-in only — anonymous has no row).
    const hasToken = !!localStorage.getItem("mindshift.token");
    if (!params.step && hasToken) {
      try {
        const prog = await api.getPathProgress(resolvedId);
        if (prog && prog.current_position > 0) {
          const next = new URLSearchParams(searchParams);
          next.set("step", String(prog.current_position + 1));
          setSearchParams(next, { replace: true });
        }
      } catch {
        /* ignore — progress is best-effort */
      }
    }
    setError(null);
  } catch (err) {
    setError((err as Error).message);
  } finally {
    setLoading(false);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [mode, pathId, username, slug]);
```

Note two changes from today:
- The function decides which API to call based on `mode`.
- `resolvedId` (the path UUID) is used for `api.getPathProgress` regardless of mode — for public mode, we read it off the response.

`PublicPathOut` and `PathDetail` differ but the page only reads `title`, `cards[]` (with `card_id`, `lesson_md`, `title`), and `id` — both shapes carry these. The cast is safe.

Add `import type { PublicPathOut } from "../lib/api";` at the top.

Also: `params.step` is read above; replace the existing `parseInt(params.get("step") ?? "1", 10)` line with logic that uses `params.step` (a route param now) when in public mode, and the `?step=` search param otherwise. Concretely:

```tsx
const stepFromRoute = params.step;
const stepRaw = parseInt(stepFromRoute ?? searchParams.get("step") ?? "1", 10);
```

(`searchParams` is the existing `useSearchParams()` hook output renamed for clarity; if it's still called `params`, rename it to `searchParams` to disambiguate from `useParams`.)

- [ ] **Step 4: Mode-aware progress save**

Update the existing `useEffect` that calls `api.updatePathProgress`:

```tsx
useEffect(() => {
  if (!path || total === 0) return;
  const hasToken = !!localStorage.getItem("mindshift.token");
  if (!hasToken) return; // anonymous: no progress save
  const id = mode === "owner" ? pathId : (path as PublicPathOut).id;
  void api.updatePathProgress(id, step - 1).catch(() => undefined);
}, [pathId, step, total, path, mode]);
```

- [ ] **Step 5: Mode-aware "back to editor" button**

The current sticky-header has a `ChevronLeft` button that does `navigate(`/paths/${pathId}`)`. In public mode this points nowhere meaningful (consumers don't have edit rights). Change it to:

```tsx
const onBack = () => {
  if (mode === "owner") {
    navigate(`/paths/${pathId}`);
  } else {
    navigate(`/u/${username}/path/${slug}`);
  }
};
```

And use `onBack` in the existing two `navigate(...)` calls in the header (the back button and the empty-cards-state's "Open editor" button — but the empty-cards button stays "Open editor" only in owner mode; in public mode it's nonsensical so render a "Back to path" link instead). Adjust the empty-cards-state JSX:

```tsx
if (path.cards.length === 0) {
  return (
    <div className="flex h-full items-center justify-center text-center text-sm text-ink-400">
      <div>
        <p className="mb-3">
          {t("paths.noStepsToPlay", { defaultValue: "This path has no steps yet." })}
        </p>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-md bg-ink-100 px-3 py-1.5 text-xs font-semibold text-ink-900 transition hover:bg-ink-200"
        >
          {mode === "owner" ? (
            <>
              <Pencil className="h-3 w-3" />
              {t("paths.openEditor", { defaultValue: "Open editor" })}
            </>
          ) : (
            <>
              <ArrowLeft className="h-3 w-3" />
              {t("paths.backToPath", { defaultValue: "Back to path" })}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Pass mode + username/slug down to `PathPlayerCardView`**

```tsx
{current && (
  <PathPlayerCardView
    key={current.card_id}
    cardId={current.card_id}
    mode={mode === "owner" ? { kind: "owner" } : { kind: "public", username, slug }}
  />
)}
```

- [ ] **Step 7: Step navigation + quiz CTA — mode-aware destinations**

The bottom sticky-nav has a "Take quiz" CTA pointing at `/paths/${pathId}/quiz`. In public mode it should point at `/u/${username}/path/${slug}/quiz`. Update both occurrences (top-header CTA and bottom-nav CTA):

```tsx
const quizHref =
  mode === "owner" ? `/paths/${pathId}/quiz` : `/u/${username}/path/${slug}/quiz`;
// ... <button onClick={() => navigate(quizHref)} ...>
```

- [ ] **Step 8: Type-check**

Run: `cd frontend && npx tsc -b --noEmit`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/PathPlayerPage.tsx
git commit -m "feat(paths): PathPlayerPage accepts public mode + auth-aware progress"
```

---

## Task 5: Routes + `PublicPathPage` CTA + i18n keys

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/pages/PublicPathPage.tsx`
- Modify: `frontend/src/locales/en.json`
- Modify: `frontend/src/locales/de.json`

- [ ] **Step 1: Register the new public routes in `App.tsx`**

Locate the existing public-path route (`<Route path="u/:username/path/:slug" element={<PublicPathPage />} />`, around line 52). Add three siblings right after it:

```tsx
<Route path="u/:username/path/:slug" element={<PublicPathPage />} />
<Route
  path="u/:username/path/:slug/play"
  element={<PathPlayerPage mode="public" />}
/>
<Route
  path="u/:username/path/:slug/play/:step"
  element={<PathPlayerPage mode="public" />}
/>
<Route
  path="u/:username/path/:slug/quiz"
  element={<PathQuizPage mode="public" />}
/>
```

`PathQuizPage` will accept the `mode` prop in Task 6 — TypeScript will flag this until that task lands; that's expected.

- [ ] **Step 2: Add the "Start path" CTA on `PublicPathPage`**

Open `frontend/src/pages/PublicPathPage.tsx`. Find the page header / hero block (it has the path title + author name). Add a primary button below the title:

```tsx
import { useNavigate } from "react-router-dom";
import { Play } from "lucide-react";
// (existing imports)

// inside the component, after the existing useState etc.:
const navigate = useNavigate();

// in the JSX, right after the path title/description block:
{path.cards.length > 0 && (
  <button
    type="button"
    onClick={() => navigate(`/u/${username}/path/${slug}/play`)}
    className="inline-flex items-center gap-2 rounded-md bg-fuchsia-500/20 px-4 py-2 text-sm font-semibold text-fuchsia-100 ring-1 ring-fuchsia-500/40 transition hover:bg-fuchsia-500/30"
  >
    <Play className="h-4 w-4" />
    {t("paths.startPath", { defaultValue: "Start path" })}
  </button>
)}
```

(The `username` and `slug` come from `useParams` — the page already has them; verify and reuse.)

- [ ] **Step 3: Add the i18n keys**

Add to `frontend/src/locales/en.json` inside the `paths` object (next to existing `playerMode`-related keys):

```json
"startPath": "Start path",
"backToPath": "Back to path",
"signInToSaveScore": "Sign in to save your score",
"signInToSaveProgress": "Sign in to save your progress",
```

Add to `frontend/src/locales/de.json`:

```json
"startPath": "Path starten",
"backToPath": "Zurück zum Path",
"signInToSaveScore": "Einloggen, um dein Ergebnis zu speichern",
"signInToSaveProgress": "Einloggen, um deinen Fortschritt zu speichern",
```

- [ ] **Step 4: Validate JSON + type-check**

```bash
python3 -c "import json; json.load(open('frontend/src/locales/en.json')); json.load(open('frontend/src/locales/de.json')); print('ok')"
cd frontend && npx tsc -b --noEmit; echo exit=$?
```

`tsc` will complain that `PathQuizPage` doesn't accept `mode` — that's fixed in Task 6. The type-check error is acceptable until Task 6 lands; the engineer should verify the only error is on `PathQuizPage` and proceed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/pages/PublicPathPage.tsx frontend/src/locales/en.json frontend/src/locales/de.json
git commit -m "feat(paths): public path routes + Start CTA + i18n keys"
```

---

## Task 6: `PathQuizPage` — public mode + anonymous banner

**Files:**
- Modify: `frontend/src/pages/PathQuizPage.tsx`

The path-quiz page currently fetches `/api/paths/{pathId}/quiz` and posts attempts to `/api/paths/{pathId}/quiz/attempts`. Public mode reuses both endpoints when logged in (they accept non-owners on public paths via `_accessible_path`). For anonymous, the questions come from the public quiz endpoints — but since path-quiz aggregates ALL card-quiz questions, we'd need a public path-quiz aggregator, OR fetch each card's quiz via the new endpoint and stitch client-side.

The simplest cut for 2a: in public mode the page calls the EXISTING `api.getPathQuiz(pathId)` if a JWT is present (works because of `_accessible_path`). If anonymous, the page renders an empty state with a sign-in CTA — anonymous quiz preview deferred (parking-lot for the future).

- [ ] **Step 1: Update the prop signature**

```tsx
interface PathQuizPageProps {
  mode?: "owner" | "public"; // defaults to "owner"
}

export default function PathQuizPage({ mode = "owner" }: PathQuizPageProps) {
  // ...
}
```

- [ ] **Step 2: Read the right route params**

```tsx
const { pathId, username, slug } = useParams<{
  pathId?: string;
  username?: string;
  slug?: string;
}>();
```

- [ ] **Step 3: Resolve the path id in public mode**

Public mode doesn't have a `:pathId` route param; we resolve it from the public path lookup:

```tsx
const [resolvedPathId, setResolvedPathId] = useState<string | null>(
  mode === "owner" ? (pathId ?? null) : null,
);

useEffect(() => {
  if (mode === "public" && username && slug) {
    void api
      .getPublicPath(username, slug)
      .then((p) => setResolvedPathId(p.id))
      .catch(() => setResolvedPathId(null));
  }
}, [mode, username, slug]);
```

Then in the page's existing fetch + post calls, replace `pathId` with `resolvedPathId`.

- [ ] **Step 4: Anonymous-aware fetch + submit**

If `resolvedPathId` is null AND mode is public → render the sign-in banner state:

```tsx
const hasToken = !!localStorage.getItem("mindshift.token");

if (mode === "public" && !hasToken) {
  return (
    <div className="flex h-full items-center justify-center text-center text-sm text-ink-300">
      <div className="max-w-md space-y-4">
        <p>{t("paths.signInToSaveScore", { defaultValue: "Sign in to save your score" })}</p>
        <Link
          to="/login"
          className="inline-flex items-center gap-2 rounded-md bg-ink-100 px-4 py-2 text-sm font-semibold text-ink-900 transition hover:bg-ink-200"
        >
          {t("auth.signIn", { defaultValue: "Sign in" })}
        </Link>
      </div>
    </div>
  );
}
```

(Add `import { Link } from "react-router-dom";` if not present.)

For logged-in non-owners, the existing fetch + submit logic Just Works because `_accessible_path` admits them. The only change is using `resolvedPathId` everywhere `pathId` was used.

- [ ] **Step 5: Mode-aware "back" navigation**

The page has a back button somewhere — find it (`navigate(\`/paths/${pathId}\`)` or similar) and update it:

```tsx
const backHref =
  mode === "owner" ? `/paths/${pathId}` : `/u/${username}/path/${slug}`;
// ... onClick={() => navigate(backHref)}
```

- [ ] **Step 6: Type-check**

Run: `cd frontend && npx tsc -b --noEmit; echo exit=$?`
Expected: `exit=0` (Task 5's pending error from `mode` prop on `PathQuizPage` should now resolve).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/PathQuizPage.tsx
git commit -m "feat(paths): PathQuizPage public mode + anonymous sign-in banner"
```

---

## Task 7: Manual smoke walk

**Files:** none.

- [ ] **Step 1: Restart the stack**

```bash
./scripts/stop.sh && ./scripts/start.sh
```

- [ ] **Step 2: Set up a public path (one-time)**

Sign in as `chris@example.com` / `testpass1234`. Open an existing path or create one with 2+ steps (mix YouTube + article ideally). In the path editor, mark it public.

Note the path's URL: `/u/<chris-username>/path/<slug>`.

- [ ] **Step 3: Anonymous walkthrough**

Open a private/incognito window. Hit the public path URL.

Verify:
1. **Landing page** (`PublicPathPage`) loads. "Start path" button is visible.
2. Click "Start path" → `/u/<user>/path/<slug>/play` → step 1 of N renders.
3. **Tabs visible**: Summary, Transcript, Quiz. **Hidden**: Notes, Chat.
4. Source media renders for YouTube (embed) and article ("Open original" link).
5. Bottom-nav `Next`/`Previous` work. URL updates to `/play/2`.
6. Browser refresh keeps you on step 2 (URL preserves it).
7. Top header "back" arrow returns to `/u/<user>/path/<slug>` (not the editor).
8. Click "Take quiz" → `/u/<user>/path/<slug>/quiz`.
9. Quiz page shows the sign-in banner instead of the full quiz UI.
10. **No 401/403/404** in browser console.

- [ ] **Step 4: Logged-in non-owner walkthrough**

Create a second user (or sign in as a different seeded user) and open the same public path URL.

Verify:
1. Same player UI as anonymous, no Notes/Chat tabs.
2. Walk through 2 steps. Refresh → resumes at step 2.
3. Open the path URL in a new tab → resumes at step 2 automatically (read off `path_progress`).
4. Click "Take quiz" → quiz renders, submit a score → response includes the saved attempt.
5. Re-run quiz → `quiz/stats` shows 1+ attempts.
6. In Postgres: `SELECT * FROM path_progress WHERE path_id = '<id>';` shows two rows — one for the owner, one for the non-owner. Same for `path_quiz_attempts`.

- [ ] **Step 5: Owner sanity-check**

Sign in as the owner (`chris@example.com`) and open the path's editor + player as before.

Verify:
1. Player has all five tabs (Summary, Transcript, Quiz, Notes, Chat).
2. Owner action bar (Regenerate / Delete / Share / Re-Tag) on the library card-detail page is unchanged.
3. Owner's `path_progress` row is independent of the non-owner's row.

- [ ] **Step 6: Done — fast-forward main**

```bash
git checkout main && git merge --ff-only feat/path-player-phase-2a
git log --oneline -7
```

---

## Self-review checklist

**Spec coverage:**
- §4 exposure matrix: all rows mapped (owner unchanged, public-non-owner gets Summary/Transcript/Quiz/Source/Progress/Quiz-attempts; anonymous gets the same minus progress + quiz-attempts) → Tasks 1, 3, 4, 6.
- §5 backend: 3 new endpoints + helper + add `id` to PublicPathOut → Task 1.
- §6 frontend: routes + mode prop on player + Quiz mode + Public CTA → Tasks 4, 5, 6.
- §7 edge cases: anonymous Notes/Chat hidden ✓, anonymous quiz preview-only ✓, path-private 404 ✓, card-deleted-from-path step list shrinks ✓ (handled by reusing existing logic).
- §3 non-goals: no PDF endpoint ✓ (spec §5.3 was clarified to skip), no notes/chat overlay ✓ (Notes/Chat hidden), no anon progress ✓ (token check skips save), no clone ✓.

**Placeholder scan:** no TBDs / TODOs in the plan body. Tasks 1–6 contain complete code blocks. Task 7 is the manual smoke (intentional — the codebase has no Playwright setup, decided in Phase 1).

**Type consistency:** `PathPlayerMode` in Task 3 matches the discriminated union shape used in Task 4's prop wiring. `PublicCardOut` has the same field names in Pydantic (Task 1) and TypeScript (Task 2). `mode: "owner" | "public"` is consistent across `PathPlayerPage` (Task 4) and `PathQuizPage` (Task 6) — but `PathPlayerCardView` (Task 3) uses a discriminated union object, not a string. That's intentional: the player-page passes `username` + `slug` only when public, and the union enforces this at the call site. Page-level pages (PathPlayerPage, PathQuizPage) read `username`/`slug` from `useParams`, so a string mode flag is sufficient there.

---

## Done criteria

- All 7 tasks ticked.
- `cd backend && .venv/bin/pytest tests/test_public_paths.py -v` → 6 passed.
- `cd frontend && npx tsc -b --noEmit` → exit 0.
- Manual smoke (Task 7 Steps 3–5) all green.
- No new tables, no migrations, no schema changes outside adding `id: UUID` to `PublicPathOut` response.
