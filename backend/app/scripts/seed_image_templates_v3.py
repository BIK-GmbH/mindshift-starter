"""Seed the next wave of layout-specific LinkedIn image templates,
informed by the May 2026 gpt-image-2 prompting + LinkedIn engagement
research:

  - Bold Text Typography   — headline IS the art (winning 2025 trend)
  - Light Brutalist        — off-white pattern-break against dark-mode default
  - Screenshot Mockup      — fake-realistic SaaS dashboard, high trust signal

Idempotent (skip when row already exists by name + user); supports
`--update` to refresh content on existing rows. Never touches
`is_default`.

Usage:
    .venv/bin/python -m app.scripts.seed_image_templates_v3 --email chris@example.com
    .venv/bin/python -m app.scripts.seed_image_templates_v3 --update
"""

from __future__ import annotations

import argparse
import sys

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.image_template import ImageTemplate
from app.models.user import User


TEMPLATES: list[tuple[str, str]] = [
    (
        "Bold Text Typography",
        """A 4:5 portrait poster (1024x1280 pixels) where the headline IS the entire composition. Maximum impact, minimum visual noise.

Background: dark navy hex 000e22, subtle radial darkening from centre to corners.

Centred vertically and horizontally: the headline "{{HEADLINE}}" rendered MASSIVE — heavy condensed sans-serif, weight 900, optical white #F8FAFC, very tight tracking (-2%), tight 90% leading. The text fills roughly 60% of the canvas width.

Subtle electric-blue (#00aaff) glow behind the letters: 24 px Gaussian blur, 25% opacity. Just enough to lift the type off the background without compromising readability.

Optional smaller orange subtitle directly below the headline, only if {{SUBTITLE}} is non-empty: "{{SUBTITLE}}" in 50% of headline size, weight 600, colour #ffaa3a, tracking 0.

Footer at the very bottom, 32px from the edge, small light-grey 12px text, centered:
"Source: {{SOURCES}} | {{DATE}}"

Image style:
- 4:5 PORTRAIT (1024x1280). NEVER 1:1 or 16:9.
- Dark navy background hex 000e22.
- Headline in optical white hex F8FAFC with cyan #00aaff glow.
- Optional subtitle in orange/gold hex ffaa3a.
- Heavy condensed geometric sans-serif typography. No serifs.
- Premium editorial poster aesthetic.
- NO other elements. NO icons. NO cards. NO decorative shapes. NO illustrations.
- NO brain icons. NO logos. NO cartoon style.
- Render every quoted string verbatim, exactly as written.
""",
    ),
    (
        "Light Brutalist",
        """A 4:5 portrait poster (1024x1280 pixels) in a deliberately light, brutalist style — a pattern-break against the standard dark-mode tech aesthetic that dominates LinkedIn feeds.

Background: warm off-white hex F4F1EC (slightly creamy, not pure white), with subtle paper-grain noise overlay.

Top of the image, 64px from the top edge: the kicker "{{SUBTITLE}}" in tiny 14px all-caps tracked sans-serif, black hex 0A0A0A, 70% opacity. Acts as the eyebrow.

Below the kicker, 32px gap: the headline "{{HEADLINE}}" in MASSIVE heavy condensed sans-serif, weight 900, pure black hex 0A0A0A, tight 95% leading, left-aligned, occupying ~70% of the canvas width.

Below the headline, 48px gap: a single OPAQUE accent block — solid orange hex FF7A1A, ~140x140 px, placed asymmetrically (offset left or right, not centred). This is the only colour in the image apart from the off-white and black.

Below the orange block, 48px gap: a single short body line, "{{BEFORE_DESCRIPTION}}" in regular sans-serif, 28px, black hex 0A0A0A, max-width 70% of canvas. (Reuses the BEFORE_DESCRIPTION variable so the recommender can route content here without minting new placeholders.)

Footer at the very bottom, 32px from edge, tiny 12px tracked sans-serif, black 50% opacity, left-aligned:
"Source: {{SOURCES}} | {{DATE}}"

Image style:
- 4:5 PORTRAIT (1024x1280). NEVER 1:1 or 16:9.
- Warm off-white background hex F4F1EC with subtle paper noise.
- Pure black ink hex 0A0A0A for type.
- ONE single opaque orange accent block hex FF7A1A — the only colour.
- Heavy condensed geometric sans-serif (NO serif fallback — this template is sans-only despite the brutalist tone).
- Brutalist editorial aesthetic — raw, asymmetric, intentionally rough.
- NO drop shadows. NO gradients. NO glow effects. NO glassmorphism. NO icons.
- NO brain icons. NO logos. NO cartoon style. NO stock-photo people.
- Render every quoted string verbatim, exactly as written.
""",
    ),
    (
        "Screenshot Mockup",
        """A 4:5 portrait image (1024x1280 pixels) showing a hyper-realistic SaaS-product screenshot, framed as if captured directly from a shipped web app. The visual register is "real product demo", not "concept mockup" — no wireframe lines, no Lorem Ipsum, no placeholder rectangles.

Top of the image, above the screenshot frame: the headline "{{HEADLINE}}" in heavy geometric sans-serif, weight 800, white hex FFFFFF, on the dark navy hex 000e22 outer background. ~64px from top.

The screenshot itself occupies the central ~75% of the canvas, with browser chrome at the top of the frame:
  - URL bar reads "{{LEFT_OBJECT}}" (reuse this variable for the fake URL — e.g. "app.cdbrain.io/agents")
  - Three traffic-light dots in the top-left of the chrome (red, yellow, green)

Inside the screenshot canvas, render a believable SaaS dashboard layout:
  - Left sidebar (~20% width) with a navigation list including the items from "{{RIGHT_OBJECT}}" (reuse for nav-list contents — e.g. "Inbox, Agents, Knowledge, Settings")
  - Main canvas: a kanban board with three columns. Column 1 titled "{{BEFORE_LABEL}}", column 2 "{{AFTER_LABEL}}", column 3 "{{HEADLINE}}" (reused). Each column has 2–3 frosted glass cards with short, believable task titles drawn from the source content. No Lorem Ipsum.
  - Right side panel (~25% width) showing a single area chart trending up-and-to-the-right, with two visible axis labels.

Palette inside the screenshot: dark navy surfaces hex 000e22 / 001e42, electric blue accents hex 00aaff, ONE orange CTA button hex ffaa3a labelled "{{BEFORE_DESCRIPTION}}" (reused; e.g. "RUN AGENT") visible in the top-right of the dashboard.

Footer below the screenshot frame, small white-grey 12px text:
"Source: {{SOURCES}} | {{DATE}}"

Image style:
- 4:5 PORTRAIT (1024x1280). NEVER 1:1 or 16:9.
- Outer background dark navy hex 000e22.
- Screenshot interior uses navy + cyan + orange palette as specified above.
- Realistic shipped-product feel — sharp screenshot lines, real-looking type.
- Clean modern geometric sans-serif throughout.
- NO Lorem Ipsum. NO placeholder text. Use the supplied variables verbatim.
- NO brain icons. NO logos other than a small fake product icon in the sidebar top.
- NO cartoon style. NO illustrated humans. NO stock photos.
- Render every quoted string verbatim, exactly as written.
""",
    ),
]


def seed(email: str, *, update: bool = False) -> tuple[int, int]:
    """Insert templates that don't yet exist. With `update=True`, also
    refresh the `content` of existing rows. Returns (inserted, updated).
    Never touches `is_default`."""
    db = SessionLocal()
    try:
        user = db.execute(
            select(User).where(User.email == email)
        ).scalar_one_or_none()
        if user is None:
            print(f"user not found: {email}", file=sys.stderr)
            return 0, 0

        inserted = 0
        updated = 0
        for name, content in TEMPLATES:
            existing = db.execute(
                select(ImageTemplate).where(
                    ImageTemplate.user_id == user.id,
                    ImageTemplate.name == name,
                )
            ).scalar_one_or_none()
            if existing is not None:
                if not update:
                    print(f"  skip (exists):    {name}")
                    continue
                if existing.content == content:
                    print(f"  unchanged:        {name}")
                    continue
                existing.content = content
                updated += 1
                print(f"  refreshed:        {name}")
                continue
            row = ImageTemplate(
                user_id=user.id,
                name=name,
                content=content,
                is_default=False,
            )
            db.add(row)
            inserted += 1
            print(f"  seeded:           {name}")
        db.commit()
        return inserted, updated
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", default="chris@example.com")
    parser.add_argument(
        "--update",
        action="store_true",
        help="Refresh content of existing rows. Default is insert-only.",
    )
    args = parser.parse_args()
    inserted, updated = seed(args.email, update=args.update)
    print(
        f"\ndone — inserted {inserted} of {len(TEMPLATES)} templates"
        + (f", refreshed {updated}" if args.update else "")
    )


if __name__ == "__main__":
    main()
