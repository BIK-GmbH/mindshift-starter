# Mindshift — Workshop-Starter

> **Pfad B des BIK Claude Code Workshops**: ein vorbereiteter Build-Pfad für TN, die kein eigenes Projekt mitbringen wollen oder gemeinsam mit dem Trainer ein realistisches Projekt von Null aufziehen möchten.

**Mindshift** ist eine persönliche AI Knowledge Base zum Sammeln, Verstehen, Verknüpfen und langfristigen Behalten von Wissen aus YouTube-Videos, Artikeln, PDFs, GitHub-Repos, RSS-Feeds und eigenen Notizen. Inspiriert von [Recall](https://www.recall.it/), aber als eigenständige Anwendung gebaut — pragmatischer MVP, sauberer lokaler Entwicklungs-Workflow, klar getrenntes Frontend/Backend.

## Was Mindshift aktuell kann

**Capture** — YouTube · Web-Artikel (mit og:image-Thumbnail) · PDFs · Google-Wiki-Suche · Eigene Notizen · GitHub-Repos (Auto-OG-Thumbnail) · RSS/Atom-Feeds (auto-poll alle 30 min) · Browser-Extension (Save-to-Mindshift, Bookmarks-Bulk-Import) · PWA mit OS-Share-Sheet (iPhone/Android Home-Screen-Install).

**Verstehen** — strukturierte Summaries + Key Takeaways via OpenAI · Quiz-Generierung · automatische Hierarchical Tags (`finance/investment`) · Entity-Extraktion · Translation pro Card.

**Verknüpfen** — Knowledge-Graph (force-layout) mit semantischen + entity-/tag-basierten Edges · pro-Card-Subgraph · Smart Connections.

**Erinnern** — Spaced Repetition (Learning-Page) mit Kalender-Heatmap + Sessions · ChatGPT-style Chat über einzelne Card oder den ganzen Knowledge-Base · Audio-Podcast pro Card via Gemini-TTS · ganze Playlists als Podcast-Episoden mit Cover-Art · Episode-Sharing per Token-URL.

**Teilen** — public Profile (`/u/<name>`) · public Tag-Trees (`/u/<name>/<tag>`) · public Cards (`/share/<token>`) · embeddable Episode-Player (`/embed/episode/<token>`).

Mobile-Strategie: Library + Capture sind first-class, alles andere ist desktop-first — siehe [`docs/MOBILE.md`](docs/MOBILE.md). Phasen-Plan: [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Was hier liegt

| Pfad | Inhalt |
|---|---|
| `docs/PRD.de.md`     | Vollständiges Product Requirements Document (deutsch) |
| `docs/PRD.md`        | English version |
| `docs/ROADMAP.md`    | Aktueller Phasen-Plan + abgeschlossene Phasen |
| `docs/MOBILE.md`     | Mobile-Contract: was Phone-fähig ist und was nicht |
| `docs/edge-engine.md`| Knowledge-Graph Edge-Score-Logik |
| `backend/`           | FastAPI + SQLAlchemy + Alembic |
| `frontend/`          | React + Vite + Tailwind + i18n (DE/EN) + PWA-Manifest |
| `extension/`         | Unpacked Browser-Extension (MV3, Chrome/Edge/Brave/Firefox) |
| `scripts/start.sh`   | Startet Postgres (Docker), Backend, Frontend |
| `scripts/stop.sh`    | Stoppt alle lokalen Services |
| `docker-compose.yml` | Lokaler Postgres |

## Schnellstart lokal

```bash
cp .env.example .env
# OPENAI_API_KEY in .env eintragen
./scripts/start.sh
```

- Frontend: http://localhost:5173
- Backend:  http://localhost:8001  (Health: `/api/health`)
- Logs:     `.runtime/logs/{backend,frontend}.log`
- Stop:     `./scripts/stop.sh`

Beim ersten Start im Frontend einen Account anlegen (Sign up), dann eine YouTube-URL einfügen — die Card durchläuft `queued → processing → completed` und zeigt Summary, Key Takeaways, Tags, Quiz und Transkript.

## Railway-Deployment

Drei Services anlegen:

1. **postgres** — Managed Postgres (gibt `DATABASE_URL` aus)
2. **backend** — Root: `backend/`, Env: `DATABASE_URL`, `OPENAI_API_KEY`, `JWT_SECRET`, `FRONTEND_ORIGIN`
3. **frontend** — Root: `frontend/`, Build-Arg/Env: `VITE_API_BASE_URL` (Backend-URL)

Die PRD enthält:
- Produktzusammenfassung + Research-Notizen
- Problem, Ziele, Zielgruppen
- MVP-Scope (klar abgegrenzt von V1.1 + V2)
- Datenmodell-Entwurf + API-Entwurf
- Lokale Entwicklungs- und Railway-Deployment-Anforderungen
- 17 Akzeptanzkriterien
- 15-Schritt empfohlene Build-Reihenfolge

## Empfohlener Workshop-Workflow

1. **Repo clonen**
   ```bash
   git clone https://github.com/BIK-GmbH/mindshift-starter.git mindshift
   cd mindshift
   ```

2. **PRD lesen** (`docs/PRD.de.md`)

3. **Mit Claude Code arbeiten**:
   ```bash
   claude --plan
   ```
   ```
   > Lies docs/PRD.de.md. Erstelle einen Implementierungsplan
   > für Schritte 1-5 aus Abschnitt 19 (Repository scaffolden,
   > FastAPI Health, React+Tailwind, Start/Stop-Scripts, Postgres).
   ```

4. **Iterativ bauen** — Schritt für Schritt aus der Build-Reihenfolge in Abschnitt 19

## Tech-Stack

| Schicht | Technologie |
|---|---|
| Frontend | React 18 + Vite + TypeScript + Tailwind CSS + i18next (DE/EN) + Lucide Icons |
| Editor   | TipTap (StarterKit + Link + Placeholder) mit Markdown-Round-Trip |
| Tags-Tree | react-arborist |
| Graph    | react-force-graph-2d (Canvas, force layout) |
| PWA      | manifest.webmanifest + Web Share Target |
| Backend  | FastAPI + Python 3 + SQLAlchemy 2 + Alembic + Pydantic Settings |
| DB       | PostgreSQL 16 + pgvector (1536-dim Embeddings) |
| Jobs     | FastAPI BackgroundTasks + APScheduler (für RSS-Poll) |
| AI       | OpenAI `gpt-5.4-mini` (Chat/Summary/Rewrites) + `text-embedding-3-small` + `gpt-image-2` (Cover-Art) |
| TTS      | Gemini `gemini-3.1-flash-tts-preview` (24 kHz mono PCM, in WAV gewrappt) |
| Ingestion | youtube-transcript-api · pypdf · trafilatura · feedparser · GitHub REST |
| Extension | Manifest v3, vanilla JS, geteilter long-lived JWT |
| Deploy   | Railway (Frontend / Backend / Postgres als getrennte Services) |

## Lizenz

Workshop-Material der BIK GmbH. Verwendung im Rahmen des Claude Code Workshops + zum persönlichen Lernen erlaubt. Kommerzielle Nutzung nach Absprache mit der BIK GmbH.

---

> **Workshop:** [Claude Code Workshop · BIK GmbH](https://bik-gmbh.github.io/claude-code-workshop/)
> **Trainer:** Christian Hubmann · ch@bik.biz
