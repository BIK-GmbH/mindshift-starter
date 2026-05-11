"""One-off seed: insert the user's sci-fi-tech image template as their
first row + mark is_default. Re-running is idempotent (no-op when the
template already exists by name)."""

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.image_template import ImageTemplate
from app.models.user import User

TEMPLATE_NAME = "Sci-fi Tech (LinkedIn)"

TEMPLATE_CONTENT = """\
Du baust ein einzelnes quadratisches Bild im Sci-fi-Tech-Stil für einen LinkedIn-Post. Output: ein Text-Prompt für ein Text-zu-Bild-Modell (z.B. OpenAI gpt-image-2). Kein Referenzbild verfügbar — der Look muss komplett aus dem Prompt kommen.

# Format

- Quadratisch 1:1, 1024×1024 Pixel. Niemals Landscape oder Portrait.

# Look-and-Feel (in einem Satz)

Premium Tech-Company-Ästhetik mit dunkelblauem Hintergrund, schwebenden "Glas"-Kärtchen, elektrisch-blauem Leuchten und orangenen Zahlen — wie ein Dashboard aus einem teuren SaaS-Produkt oder ein Sci-fi-Cockpit-Screen.

# Farbpalette (immer exakt diese Hex-Werte verwenden)

- Hintergrund (dominant, fast schwarzes Marineblau): #000e22
- Sekundär-Hintergrund / Card-Flächen (dunkles Blau): #001e42
- Akzent & Glow (leuchtendes Cyan-Blau): #00aaff
- Warmer Akzent — alle Zahlen (Orange/Gold): #ffaa3a
- Warmer Highlight (helleres Gold): #ffbc5e
- Text auf dunkel: #ffffff (Headlines) + light grey (Sublabels)

# Typografie

- Headlines: bold, groß, moderner geometrischer Sans-Serif (Inter, Helvetica, Geist).
- Body / Labels: gleicher Sans-Serif, ca. 50 % der Headline-Größe.
- Stat-Zahlen: sehr fett, in Orange #ffaa3a.
- Keine Serifen. Keine Schreibschrift. Kein Retro/Pixel-Look.

# Treatment

- Glassmorphism-Karten: halbtransparente Rechtecke mit gerundeten Ecken, einer dünnen leuchtend-blauen Randlinie, weichem inneren Schatten und einem äußeren cyan-blauen Glow. Wirken wie Glas, das vor dem Hintergrund schwebt.
- Komposition: symmetrisch oder klar achsial gebalanced. Keine chaotische Streuung.
- Cyan-blaue Glows auf Linien, Pfeilen, Trennern, Icon-Outlines.
- Dezente Hintergrund-Elemente erlaubt: feines Grid, geometrische Linien, ein abstrakter Nebel/Glow. Niemals Fotos von Menschen oder Stockfoto-Look.

# Verboten

- Gehirn-Icons / Gehirn-Imagery jeglicher Art
- Firmen-Logos am unteren Bildrand (oder irgendwo sonst)
- Cartoon-Charaktere, Maskottchen, anthropomorphe Roboter
- Watermarks, dekorative Frames, Marken-Border
- Generic Business-Stockphoto-Look (gestellte Leute mit Laptops etc.)
- Serifenschriften, Schreibschriften, Pixel-Fonts

# Bild-Anatomie (1:1)

- TOP: Bold white headline (1–6 Worte, das Topic)
- TOP-RIGHT: optional ein kurzer orangener Subtitle (der Winkel)
- CENTER: 3–4 Glassmorphism-Stat-Cards (gestapelt oder als 2×2 Grid) ODER eine abstrakte Metapher (Diagramm, Daten-Viz)
- BOTTOM: Source-Line in kleinem hell-grauem Text, exakt: "Source: <Names> | <Date>" (z.B. "Source: CNBC, Reuters | Q4 2025"). Wenn keine Zahlen im Bild → BOTTOM bleibt leer.

# Stat-Card-Anatomie

Jede Card zeigt eine Zahl + ein Label:
- Zahl: sehr groß, orange #ffaa3a
- Label: weiß, deutlich kleiner
Drei oder vier solcher Cards vertikal gestapelt oder in einem 2×2-Grid = das bewährte Muster.

# Source-Policy (Pflicht, wenn Zahlen abgebildet werden)

Am unteren Bildrand, klein, hell-grau, eine Zeile, exaktes Format:
`Source: <Quelle1, Quelle2> | <Quartal/Datum>`

# Style-Block (wörtlich ans Ende jedes Prompts hängen)

Image style:
- 1:1 SQUARE (1024x1024). NEVER 16:9.
- Dark navy background hex 000e22.
- Electric blue glows hex 00aaff. Orange/gold accents hex ffaa3a.
- Glassmorphism stat cards with glowing borders. Big bold numbers in orange, white labels.
- Symmetrical or balanced composition. Clean modern sans-serif typography.
- Premium tech company aesthetic — like a high-end SaaS dashboard.
- NO brain icons. NO logos anywhere in the image. NO cartoon style.
- NO generic business stock-photo look (no people, no laptops, no handshakes).
- BOTTOM of image MUST contain a small light-grey source line, exactly:
    "Source: <names> | <date>"
  e.g. "Source: CNBC, Reuters | Q4 2025"
"""


def seed():
    db = SessionLocal()
    try:
        user = db.execute(
            select(User).where(User.email == "chris@example.com")
        ).scalar_one_or_none()
        if user is None:
            print("user not found")
            return
        existing = db.execute(
            select(ImageTemplate).where(
                ImageTemplate.user_id == user.id,
                ImageTemplate.name == TEMPLATE_NAME,
            )
        ).scalar_one_or_none()
        if existing:
            print(f"template already exists: {existing.id}")
            # Make sure it's the default.
            if not existing.is_default:
                from app.api.image_templates import _clear_default

                _clear_default(db, user.id, except_id=existing.id)
                existing.is_default = True
                db.commit()
                print("  promoted to default")
            return

        from app.api.image_templates import _clear_default

        _clear_default(db, user.id)
        template = ImageTemplate(
            user_id=user.id,
            name=TEMPLATE_NAME,
            content=TEMPLATE_CONTENT,
            is_default=True,
        )
        db.add(template)
        db.commit()
        db.refresh(template)
        print(f"seeded template: {template.id} (is_default={template.is_default})")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
