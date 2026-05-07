"""Seed the library with a curated set of AI-related YouTube videos.

Run from backend/:

    set -a; source ../.env; set +a
    .venv/bin/python -m app.scripts.seed_ai_videos --email chris@example.com --password testpass1234

Each URL is POSTed sequentially to /api/cards/from-youtube. The backend then
processes each card asynchronously, so this script returns quickly even though
ingestion (transcript fetch + OpenAI summarization + embeddings) keeps running
in the background.
"""

from __future__ import annotations

import argparse
import sys
import time

import httpx

# Curated list of AI-related YouTube videos with English captions.
# Mix of educational explainers, paper reviews, lectures and interviews.
AI_VIDEO_IDS: list[tuple[str, str]] = [
    # --- 3Blue1Brown — Neural networks series ---
    ("aircAruvnKk", "But what is a Neural Network?"),
    ("IHZwWFHWa-w", "Gradient descent, how neural networks learn"),
    ("Ilg3gGewQ5U", "What is backpropagation really doing?"),
    ("tIeHLnjs5U8", "Backpropagation calculus"),
    # --- 3Blue1Brown — Transformers / LLMs ---
    ("wjZofJX0v4M", "But what is a GPT?"),
    ("eMlx5fFNoYc", "Attention in transformers, visually explained"),
    ("9-Jl0dxWQs8", "How might LLMs store facts?"),
    # --- Andrej Karpathy ---
    ("kCc8FmEb1nY", "Let's build GPT from scratch"),
    ("VMj-3S1tku0", "The spelled-out intro to neural networks"),
    ("PaCmpygFfXo", "Let's reproduce GPT-2 (124M)"),
    ("zduSFxRajkE", "Let's build the GPT Tokenizer"),
    ("zjkBMFhNj_g", "Intro to Large Language Models"),
    # --- Two Minute Papers ---
    ("fYbVLAaC_kI", "ChatGPT explained"),
    ("TucsT00Mhrk", "Stable Diffusion"),
    ("jXKZ2CRZ24Q", "OpenAI Sora paper"),
    # --- Lex Fridman AI episodes ---
    ("Yf1o0TQzry8", "Demis Hassabis on Lex Fridman"),
    ("HiNwx5wMx68", "Yann LeCun on Lex Fridman"),
    ("rEDzUT3ymw4", "Sam Altman on Lex Fridman"),
    ("lvY3z1KKp_g", "Geoffrey Hinton on Lex Fridman"),
    ("Yf1o0TQzry8", "Hassabis follow-up"),  # may dedupe
    # --- StatQuest ---
    ("xBEh66V9gZo", "Decision Trees"),
    ("CqOfi41LfDw", "Random Forests Part 1"),
    ("zxagGtF9MeU", "Neural Networks Pt. 1"),
    ("CkwgN0Bzfmw", "Long Short-Term Memory networks"),
    # --- Computerphile ---
    ("L_Q3pPQVSO8", "AI Lying"),
    ("cfj6yaYE86U", "AlphaGo and Deep Reinforcement Learning"),
    ("R9OHn5ZF4Uo", "Generative Adversarial Networks"),
    # --- MIT 6.S191 Intro to Deep Learning ---
    ("njKP3FqW3Sk", "MIT 6.S191: Intro to Deep Learning 2024"),
    ("QvkQ1B3FBqA", "MIT 6.S191: Recurrent Neural Networks"),
    # --- Yannic Kilcher ---
    ("Bft7cV7mgfk", "Attention Is All You Need (paper review)"),
    ("4uG8WzPzULY", "GPT-3 paper review"),
    # --- DeepMind / Anthropic / OpenAI talks ---
    ("ml-7p5cMlbU", "DeepMind: AlphaFold"),
    ("VgM0fNd5zGI", "Anthropic: Claude on safety"),
    # --- Stanford lectures ---
    ("UzxYlbK2c7E", "Stanford CS229: Andrew Ng — Lecture 1"),
    ("4pUmZ8hXTHM", "Stanford CS224N: NLP with Deep Learning"),
    # --- Educational broad intros ---
    ("aircAruvnKk", "Neural Networks intro repeat"),  # may dedupe
]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", default="chris@example.com")
    parser.add_argument("--password", default="testpass1234")
    parser.add_argument("--api", default="http://localhost:8001")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args(argv)

    seen: set[str] = set()
    targets: list[tuple[str, str]] = []
    for vid, label in AI_VIDEO_IDS:
        if vid in seen:
            continue
        seen.add(vid)
        targets.append((vid, label))
    if args.limit:
        targets = targets[: args.limit]

    print(f"Will ingest {len(targets)} unique videos")
    if args.dry_run:
        for vid, label in targets:
            print(f"  - {vid}  {label}")
        return 0

    with httpx.Client(timeout=30.0, base_url=args.api) as client:
        # Login
        resp = client.post(
            "/api/auth/login",
            json={"email": args.email, "password": args.password},
        )
        resp.raise_for_status()
        token = resp.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # Fetch existing cards to skip already-ingested videos by external_id
        existing_resp = client.get("/api/cards", headers=headers)
        existing_resp.raise_for_status()
        # We can't filter by source.external_id from /api/cards, so we'll just send all
        # and let duplicates pile up — caller can dedupe later if needed.
        existing_titles = {c["title"] for c in existing_resp.json()}

        ok = 0
        skipped = 0
        failed = 0
        for vid, label in targets:
            url = f"https://www.youtube.com/watch?v={vid}"
            # Naive title-based skip: if any existing card title contains the label,
            # treat as already-seeded.
            if any(label in t or t in label for t in existing_titles):
                print(f"  • skip (title overlap): {label}")
                skipped += 1
                continue
            try:
                r = client.post("/api/cards/from-youtube", headers=headers, json={"url": url})
                if r.status_code == 201:
                    print(f"  + queued: {label}")
                    ok += 1
                else:
                    print(f"  ! {r.status_code}: {label} — {r.text[:100]}")
                    failed += 1
            except Exception as exc:  # noqa: BLE001
                print(f"  ! exception: {label} — {exc}")
                failed += 1
            time.sleep(0.5)  # gentle pacing

        print(f"\nQueued: {ok}  skipped: {skipped}  failed: {failed}")
        print("Cards now process in the background. Check the library or DB to see progress.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
