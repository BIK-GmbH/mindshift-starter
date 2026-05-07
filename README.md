# Mindshift — Workshop-Starter

> **Pfad B des BIK Claude Code Workshops**: ein vorbereiteter Build-Pfad für TN, die kein eigenes Projekt mitbringen wollen oder gemeinsam mit dem Trainer ein realistisches Projekt von Null aufziehen möchten.

**Mindshift** ist eine persönliche AI Knowledge Base zum Sammeln, Verstehen, Verknüpfen und langfristigen Behalten von Wissen aus YouTube-Videos, Artikeln, PDFs und eigenen Notizen. Inspiriert von [Recall](https://www.recall.it/), aber als eigenständige Anwendung gebaut — pragmatischer MVP, sauberer lokaler Entwicklungs-Workflow, klar getrenntes Frontend/Backend.

## Was hier liegt

| Pfad | Inhalt |
|---|---|
| `docs/PRD.de.md`     | Vollständiges Product Requirements Document (deutsch) |
| `docs/PRD.md`        | English version |
| `backend/`           | FastAPI + SQLAlchemy + Alembic |
| `frontend/`          | React + Vite + Tailwind + i18n (DE/EN) |
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
| Frontend | React + Tailwind CSS + Lucide Icons + Vite |
| Backend  | FastAPI + Python + SQLAlchemy + Alembic + Pydantic Settings |
| DB       | PostgreSQL (+ pgvector für semantische Suche) |
| Jobs     | FastAPI Background Tasks → später ARQ/Dramatiq |
| AI       | OpenAI / Anthropic (über Service-Modul gekapselt) |
| Deploy   | Railway (Frontend / Backend / Postgres als getrennte Services) |

## Lizenz

Workshop-Material der BIK GmbH. Verwendung im Rahmen des Claude Code Workshops + zum persönlichen Lernen erlaubt. Kommerzielle Nutzung nach Absprache mit der BIK GmbH.

---

> **Workshop:** [Claude Code Workshop · BIK GmbH](https://bik-gmbh.github.io/claude-code-workshop/)
> **Trainer:** Christian Hubmann · ch@bik.biz
