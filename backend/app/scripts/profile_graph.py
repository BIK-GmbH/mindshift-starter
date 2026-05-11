"""Profile the global-graph edge engine.

Why: /api/graph runs the full edge-engine on every call (no caching),
which is N+1 in the worst case — for each card it independently
computes 5 signals against every other card. For 144 cards that's
~720 service-function invocations + a lot of DB roundtrips.

This script bypasses HTTP, calls the service layer directly, and
measures:
  - End-to-end get_global_graph timing (cold call)
  - Per-signal time across all cards (sum, mean, share-of-total)
  - Card+tags fetch overhead
  - Top per-card outliers (slowest individual cards by signal)

Run from the repo root:
    cd backend
    .venv/bin/python -m app.scripts.profile_graph [email]

Default email is `chris@example.com` (seed account). Pass a different
email if you want to profile against another user. Read-only — no
writes, safe to run on prod data.
"""

from __future__ import annotations

import sys
import time
from collections import defaultdict
from contextlib import contextmanager
from statistics import mean, median
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.card import Card
from app.models.user import User
from app.services import connections


# Counters mutated by the wrappers.
_signal_times: dict[str, list[float]] = defaultdict(list)
_signal_per_card: dict[str, dict[UUID, float]] = defaultdict(dict)

SIGNALS = [
    "_accumulate_semantic",
    "_accumulate_shared_entities",
    "_accumulate_shared_tags",
    "_accumulate_shared_tag_ancestors",
    "_accumulate_manual_relations",
]


def _wrap_signals() -> None:
    """Monkey-patch each _accumulate_* function with a timing wrapper.
    We do this on the module so the recursion through get_connections
    picks up the instrumented versions. Idempotent — repeat calls
    re-wrap the originals, not double-wrap."""
    for name in SIGNALS:
        original = getattr(connections, name)
        if getattr(original, "_profiled", False):
            continue

        def make_wrapper(orig: Any, sig_name: str):
            def wrapper(db, source, out, user_id):
                t0 = time.perf_counter()
                result = orig(db, source, out, user_id)
                dt = time.perf_counter() - t0
                _signal_times[sig_name].append(dt)
                _signal_per_card[sig_name][source.id] = dt
                return result

            wrapper._profiled = True  # type: ignore[attr-defined]
            return wrapper

        setattr(connections, name, make_wrapper(original, name))


@contextmanager
def timed(label: str, sink: dict[str, float]):
    t0 = time.perf_counter()
    try:
        yield
    finally:
        sink[label] = time.perf_counter() - t0


def _fmt_ms(s: float) -> str:
    return f"{s * 1000:7.1f} ms"


def _fmt_pct(part: float, whole: float) -> str:
    if whole <= 0:
        return "    -"
    return f"{(part / whole) * 100:5.1f}%"


def _print_signal_table(total_signal_time: float, n_cards: int) -> None:
    header = f"{'signal':<35} {'total':>12} {'mean/card':>12} {'median':>10} {'p95':>10} {'share':>7}"
    print(header)
    print("-" * len(header))
    rows: list[tuple[str, float, float, float, float, float]] = []
    for name in SIGNALS:
        times = sorted(_signal_times.get(name, []))
        if not times:
            continue
        total = sum(times)
        avg = total / n_cards if n_cards else 0.0
        med = median(times)
        p95 = times[int(0.95 * (len(times) - 1))] if times else 0.0
        rows.append((name, total, avg, med, p95, total))
    rows.sort(key=lambda r: r[1], reverse=True)
    for name, total, avg, med, p95, _ in rows:
        print(
            f"{name:<35} {_fmt_ms(total)} {_fmt_ms(avg)} {_fmt_ms(med)} {_fmt_ms(p95)} {_fmt_pct(total, total_signal_time)}"
        )


def _print_per_card_outliers(n: int = 5) -> None:
    print("\nTop-N slowest cards per signal:")
    for name in SIGNALS:
        per_card = _signal_per_card.get(name, {})
        if not per_card:
            continue
        worst = sorted(per_card.items(), key=lambda kv: kv[1], reverse=True)[:n]
        print(f"  {name}:")
        for card_id, dt in worst:
            print(f"    {card_id}  {_fmt_ms(dt)}")


def main(email: str = "chris@example.com") -> int:
    _wrap_signals()
    db = SessionLocal()
    try:
        user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if user is None:
            print(f"!! User not found: {email}", file=sys.stderr)
            return 1
        cards_in_db = db.execute(
            select(Card).where(Card.user_id == user.id)
        ).scalars().all()
        n_cards = len(cards_in_db)
        print(f"User: {email} ({user.id})")
        print(f"Cards: {n_cards}")
        print("Running get_global_graph() with default args …")
        print()

        sections: dict[str, float] = {}
        t_full = time.perf_counter()
        with timed("get_global_graph total", sections):
            graph = connections.get_global_graph(db, user.id)
        full = time.perf_counter() - t_full
        print(f"End-to-end:  {_fmt_ms(full)}")
        print(f"Nodes:       {len(graph.nodes)}")
        print(f"Edges:       {len(graph.edges)}")
        print()

        total_signal = sum(sum(_signal_times.get(s, [])) for s in SIGNALS)
        print(f"Signal sub-totals (sum of all per-card calls):")
        _print_signal_table(total_signal, n_cards)
        print()
        print(f"Sum of signals:      {_fmt_ms(total_signal)}  "
              f"({_fmt_pct(total_signal, full)} of end-to-end)")
        print(f"Overhead (merging + tags fetch + edge dedup): "
              f"{_fmt_ms(full - total_signal)}  "
              f"({_fmt_pct(full - total_signal, full)} of end-to-end)")
        print()

        _print_per_card_outliers(5)

        # Second-call timing — useful to see whether anything is implicitly
        # cached (SQLAlchemy session, query plan cache, OS page cache).
        # Reset counters and run again on a fresh session to mimic a real
        # second HTTP request (each request gets its own Session).
        print("\n--- Warm second run (fresh session) ---")
        _signal_times.clear()
        _signal_per_card.clear()
        db.close()
        db = SessionLocal()
        t_warm = time.perf_counter()
        connections.get_global_graph(db, user.id)
        warm = time.perf_counter() - t_warm
        print(f"End-to-end:  {_fmt_ms(warm)}")
        warm_signal = sum(sum(_signal_times.get(s, [])) for s in SIGNALS)
        _print_signal_table(warm_signal, n_cards)

        return 0
    finally:
        db.close()


if __name__ == "__main__":
    email_arg = sys.argv[1] if len(sys.argv) > 1 else "chris@example.com"
    sys.exit(main(email_arg))
