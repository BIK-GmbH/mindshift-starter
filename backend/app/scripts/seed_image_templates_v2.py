"""Seed the six layout-specific LinkedIn image templates.

Adds these rows (idempotent — re-running skips templates that already
exist for the target user by name; never touches `is_default`):

  - Before / After Split
  - News Recap Cover
  - Concept Morph
  - Anatomy Diagram
  - Vintage Newspaper Page
  - Landscape Map

Usage:
    .venv/bin/python -m app.scripts.seed_image_templates_v2 --email chris@example.com
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
        "Before / After Split",
        """A 4:5 portrait poster (1024x1280 pixels) split horizontally across the middle into two panels of equal height — "BEFORE" on top, "AFTER" on bottom.

Very top of the image, above the upper panel: the headline "{{HEADLINE}}" in bold sentence-case (capitalise the first word + proper nouns only), heavy geometric sans-serif, centered.

UPPER PANEL (the "before" state, takes the upper ~45% below the headline): muted, desaturated colours. A glassmorphism card centered in the panel containing:
  - bold white label "{{BEFORE_LABEL}}" at the top of the card
  - smaller light-grey description "{{BEFORE_DESCRIPTION}}" beneath the label
  - a subtle visual cue suggesting friction or fragmentation (broken grid lines, scattered shapes)

LOWER PANEL (the "after" state, takes the lower ~45% above the footer): the same composition but bright and confident. A glassmorphism card containing:
  - bold orange label "{{AFTER_LABEL}}" at the top of the card (colour #ffaa3a)
  - smaller white description "{{AFTER_DESCRIPTION}}" beneath the label
  - a clean visual cue suggesting flow, alignment, automation (continuous flowing lines, unified shape)

A glowing electric-blue HORIZONTAL divider across the exact horizontal centre separates the two panels.

Very bottom of the image, small light-grey text, single line, centered:
"Source: {{SOURCES}} | {{DATE}}"

Image style:
- 4:5 PORTRAIT (1024x1280). NEVER 16:9 or square.
- Dark navy background hex 000e22. Card surfaces hex 001e42.
- Electric blue glows hex 00aaff. Orange/gold accents hex ffaa3a.
- Glassmorphism cards with glowing borders, soft inner shadow, outer cyan glow.
- Clean modern geometric sans-serif typography. No serifs. No script.
- Premium tech-company aesthetic — like a high-end SaaS dashboard.
- NO brain icons. NO logos. NO cartoon style. NO stock-photo people.
- Render every quoted string verbatim, exactly as written.
""",
    ),
    (
        "News Recap Cover",
        """A 4:5 portrait magazine cover (1024x1280 pixels) summarizing three news stories of the week.

Top of the image: bold white masthead "AI THIS WEEK" in large clean geometric sans-serif. Directly below, in smaller orange text (#ffaa3a): "{{DATE_RANGE}}".

A thin glowing electric-blue horizontal divider sits beneath the masthead.

Below the divider, a vertical stack of three story rows. Each row contains, from left to right:
  1. A simple line-style glowing electric-blue icon hinting at the topic (no text inside the icon)
  2. A bold white headline in large sans-serif
  3. A small orange number "01", "02", "03" on the far right

Story 1 — icon hint: "{{STORY_1_ICON}}"   headline: "{{STORY_1_HEADLINE}}"
Story 2 — icon hint: "{{STORY_2_ICON}}"   headline: "{{STORY_2_HEADLINE}}"
Story 3 — icon hint: "{{STORY_3_ICON}}"   headline: "{{STORY_3_HEADLINE}}"

Bottom of the image, small light-grey text, centered:
"Source: {{SOURCES}} | {{DATE_RANGE}}"

Image style:
- 4:5 PORTRAIT (1024x1280). NEVER 16:9 or square.
- Dark navy background hex 000e22.
- Electric blue glows hex 00aaff. Orange/gold accents hex ffaa3a.
- Clean modern geometric sans-serif typography. No serifs.
- Editorial magazine-cover aesthetic, premium tech-company feel.
- Icons are minimalist line-style with cyan glow, NOT filled illustrations.
- NO brain icons. NO logos. NO photos of people. NO cartoon style.
- Render every quoted string verbatim, exactly as written.
""",
    ),
    (
        "Concept Morph",
        """A 1:1 square studio product photograph (1024x1024 pixels) of a single physical object that gradually transforms from left to right.

The LEFT HALF of the object is "{{LEFT_OBJECT}}", rendered in hyper-detailed photorealistic studio quality.
The RIGHT HALF of the object is "{{RIGHT_OBJECT}}", also hyper-detailed and photorealistic.
The two halves are seamlessly fused at the exact horizontal midpoint with a smooth, plausible material transition — no hard seam, no collage, no Photoshop edges. Both halves must look fully functional.

The object floats centered on a dark navy field with subtle cyan rim-light from the left side, making the cyan glow appear strongest on the seam itself, as if energy flows from left to right.

Top of the image: bold white headline "{{HEADLINE}}" in clean modern geometric sans-serif.
Optional smaller orange subtitle directly below: "{{SUBTITLE}}".

Bottom of the image, small light-grey text, centered:
"Source: {{SOURCES}} | {{DATE}}"

Image style:
- 1:1 SQUARE (1024x1024). NEVER 16:9.
- Dark navy background hex 000e22.
- Electric blue rim-light and glow on the seam hex 00aaff.
- Orange/gold accent only on the subtitle hex ffaa3a.
- Hyper-detailed photorealistic product shot. Sharp focus on the seam.
- Premium tech-company aesthetic.
- NO brain icons. NO logos. NO cartoon style. NO people.
- Render every quoted string verbatim, exactly as written.
""",
    ),
    (
        "Anatomy Diagram",
        """A 1:1 square technical diagram poster (1024x1024 pixels) styled like a high-end engineering schematic.

In the center: a stylized abstract representation of "{{SUBJECT}}" — a glowing geometric shape (cube, prism, layered stack, or modular grid) composed of five distinct visible parts. The shape should feel like an exploded-view technical illustration, with thin glowing electric-blue lines connecting each component.

Top of the image: bold white headline "{{HEADLINE}}" in clean modern geometric sans-serif.

Around the central shape, distributed evenly: thin glowing electric-blue annotation lines extend from each of the five components outward to a small labeled callout. Each callout contains:
  - bold orange component name (color #ffaa3a) on the first line
  - smaller white description on the second line

Callouts and labels:
Component 1 — name: "{{COMPONENT_1_NAME}}"   description: "{{COMPONENT_1_DESC}}"
Component 2 — name: "{{COMPONENT_2_NAME}}"   description: "{{COMPONENT_2_DESC}}"
Component 3 — name: "{{COMPONENT_3_NAME}}"   description: "{{COMPONENT_3_DESC}}"
Component 4 — name: "{{COMPONENT_4_NAME}}"   description: "{{COMPONENT_4_DESC}}"
Component 5 — name: "{{COMPONENT_5_NAME}}"   description: "{{COMPONENT_5_DESC}}"

Bottom of the image, small light-grey text, centered:
"Source: {{SOURCES}} | {{DATE}}"

Image style:
- 1:1 SQUARE (1024x1024). NEVER 16:9.
- Dark navy background hex 000e22.
- Electric blue glows and annotation lines hex 00aaff.
- Orange/gold component names hex ffaa3a.
- Clean modern geometric sans-serif typography. No serifs.
- Engineering-schematic aesthetic, premium tech-company feel.
- NO brain icons. NO logos. NO cartoon style. NO photographs.
- Render every quoted string verbatim, exactly as written.
""",
    ),
    (
        "Vintage Newspaper Page",
        """A 4:5 portrait mockup (1024x1280 pixels) of a vintage newspaper front page from the early-to-mid 20th century. Portrait orientation matches real broadsheet proportions.

Top of the page: the newspaper's masthead in bold serif typography reading "{{NEWSPAPER_NAME}}" with thin horizontal rules above and below. Below the masthead, in small serif: "{{DATE}} — {{EDITION}}".

A small kicker line in italics: "{{KICKER}}"

Below the kicker: the MAIN HEADLINE in massive bold serif, all caps: "{{MAIN_HEADLINE}}"

Below the headline: a subhead in medium serif: "{{SUBHEAD}}"

The lower 60% of the page is filled with realistic-looking columns of grey filler body text (lorem-ipsum-like, but resembling news prose), separated by thin vertical rules. Include one small framed black-and-white illustration or photograph placeholder in the middle of the columns — abstract, no specific person.

Render the entire image as if printed on aged off-white paper with subtle fiber texture, slight yellowing at the edges, and faint ink-bleed on the bold type.

Image style:
- 4:5 PORTRAIT (1024x1280). Real broadsheet proportions.
- Aged off-white paper background.
- Pure black ink for type, with subtle ink-bleed.
- Bold serif typography throughout (this template intentionally BREAKS sans-serif rules).
- Vintage newspaper aesthetic, no modern elements, no colors except black on cream.
- NO brain icons. NO logos. NO modern photographs. NO cartoon style.
- Render every quoted string verbatim, exactly as written.
""",
    ),
    (
        "Landscape Map",
        """A 1:1 square illustrated landscape map (1024x1024 pixels) showing the ecosystem of "{{DOMAIN}}".

The map is rendered like a stylized strategic territory diagram — abstract continents, regions and zones, NOT a geographic map. Each region is a softly glowing area on a dark navy backdrop, separated by thin glowing electric-blue borders that look like circuit traces.

Top of the image: bold white headline "{{HEADLINE}}" in clean modern geometric sans-serif.

Each region contains:
  - a bold orange region name (color #ffaa3a) at its center
  - a short list of items beneath, each on its own line in smaller white text

Regions and items:
Region 1 — name: "{{CLUSTER_1_NAME}}"   items: "{{CLUSTER_1_ITEMS}}"
Region 2 — name: "{{CLUSTER_2_NAME}}"   items: "{{CLUSTER_2_ITEMS}}"
Region 3 — name: "{{CLUSTER_3_NAME}}"   items: "{{CLUSTER_3_ITEMS}}"
Region 4 — name: "{{CLUSTER_4_NAME}}"   items: "{{CLUSTER_4_ITEMS}}"
Region 5 — name: "{{CLUSTER_5_NAME}}"   items: "{{CLUSTER_5_ITEMS}}"

The composition should feel balanced and readable, not chaotic — items must be legible at 1024x1024. Avoid overlapping regions. Place a faint cyan grid behind everything for a "strategic map" feel.

Bottom of the image, small light-grey text, centered:
"Source: {{SOURCES}} | {{DATE}}"

Image style:
- 1:1 SQUARE (1024x1024). NEVER 16:9.
- Dark navy background hex 000e22 with faint cyan grid hex 00aaff at 10% opacity.
- Region borders glowing electric blue hex 00aaff.
- Region names in orange/gold hex ffaa3a.
- Items in white sans-serif.
- Clean modern geometric sans-serif typography throughout.
- Strategic-map aesthetic, premium tech-company feel.
- NO brain icons. NO logos. NO cartoon style. NO photographs.
- Render every quoted string verbatim, exactly as written.
""",
    ),
]


def seed(email: str) -> int:
    """Insert templates that don't yet exist. Returns the number of
    rows inserted. Never touches `is_default` — the user's existing
    default stays the default."""
    db = SessionLocal()
    try:
        user = db.execute(
            select(User).where(User.email == email)
        ).scalar_one_or_none()
        if user is None:
            print(f"user not found: {email}", file=sys.stderr)
            return 0

        inserted = 0
        for name, content in TEMPLATES:
            existing = db.execute(
                select(ImageTemplate).where(
                    ImageTemplate.user_id == user.id,
                    ImageTemplate.name == name,
                )
            ).scalar_one_or_none()
            if existing is not None:
                print(f"  skip (exists): {name}")
                continue
            row = ImageTemplate(
                user_id=user.id,
                name=name,
                content=content,
                is_default=False,
            )
            db.add(row)
            inserted += 1
            print(f"  seeded:        {name}")
        db.commit()
        return inserted
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", default="chris@example.com")
    args = parser.parse_args()
    inserted = seed(args.email)
    print(f"\ndone — inserted {inserted} of {len(TEMPLATES)} templates")


if __name__ == "__main__":
    main()
