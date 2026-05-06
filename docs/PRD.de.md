# Mindshift PRD

## 1. Produktzusammenfassung

Mindshift ist eine persönliche AI Knowledge Base zum Sammeln, Verstehen, Verknüpfen und langfristigen Behalten von Wissen aus YouTube-Videos, Artikeln, PDFs und eigenen Notizen.

Das Produkt ist von Tools wie Recall inspiriert, soll aber als eigenständige Anwendung gebaut werden: mit pragmatischem MVP, sauberer lokaler Entwicklung, klar getrenntem Frontend/Backend und einer Architektur, die später zu einem graphbasierten Lernsystem ausgebaut werden kann.

## 2. Research-Notizen

Recall positioniert sich als AI Knowledge Base, in der Nutzer Inhalte speichern, zusammenfassen, befragen, automatisch organisieren, in einem Knowledge Graph verknüpfen und über Quiz- und Spaced-Repetition-Workflows wiederholen können.

Beobachtete Kernfunktionen von Recall:

- Inhalte können über Browser Extension, URL-Eingabe in der App, Mobile Sharing, PDF Upload, Bookmark Imports, Markdown Imports und Pocket Imports hinzugefügt werden.
- Unterstützte Inhalte umfassen YouTube-Videos mit Transkripten, PDFs, Google Docs/Slides, Blogs, Artikel, Websites und Notizen.
- Jeder gespeicherte Inhalt wird zu einer Card mit Originalinhalt, Notebook, Zusammenfassungen, Chat, Graph-Sichtbarkeit und Spaced-Repetition-Review.
- Recall speichert den Originalinhalt, wodurch das Produkt auch als Read-it-later-System funktioniert.
- Recall unterstützt kurze und detaillierte Zusammenfassungen sowie content-spezifischen Chat.
- Recall nutzt eine Graph-Datenbank, um verwandte Inhalte zu verbinden und Keywords/Begriffe anzureichern.
- Die Graph-Ansicht stellt gespeicherte Cards als Nodes dar, Beziehungen als Edges, Node-Größe nach Vernetzungsgrad und Farben nach Tags.
- Quiz- und Spaced-Repetition-Workflows enthalten generierte Fragen, fällige Reviews, Fortschrittsstufen, Filter und Review-Benachrichtigungen.
- Recall Plus hebt unter anderem Chat mit Wissen, automatische Organisation, Knowledge Graph, Augmented Browsing, Quiz/Spaced Repetition, Bulk Imports, Multi-PDF Uploads und Mehrsprachigkeit hervor.

Research-Quellen:

- [Recall Introduction](https://docs.recall.it/)
- [Recall: Add Content](https://docs.recall.it/getting-started/2-add-content)
- [Recall: Interact with Content](https://docs.recall.it/getting-started/3-summarize-and-chat-with-content)
- [Recall: Knowledge Graph Overview](https://docs.recall.it/deep-dives/graph/overview)
- [Recall: Quiz and Spaced Repetition](https://docs.recall.it/deep-dives/quiz-and-spaced-repetition)
- [Recall Pricing and FAQ](https://www.recall.it/pricing)

## 3. Problemstellung

Menschen konsumieren große Mengen an Lern-, Fach- und Recherchecontent, wandeln diesen aber selten in dauerhaft nutzbares Wissen um.

Typische Probleme:

- Gespeicherte Links werden zu ungenutztem Archivmaterial.
- YouTube-Videos sind schwer wiederzuverwenden, weil wichtige Stellen in langen Timelines versteckt sind.
- Notizen, Zusammenfassungen und Quellenmaterial liegen in verschiedenen Tools.
- Klassische Suche ist keyword-basiert und erkennt konzeptionelle Zusammenhänge schlecht.
- Nutzer vergessen den Großteil konsumierter Inhalte ohne aktive Wiederholung.
- Manuelle Organisation über Ordner und Tags wird mit der Zeit inkonsistent.

## 4. Produktziele

Mindshift soll Nutzern helfen:

- wertvolle Inhalte schnell zu speichern
- lange Inhalte in strukturierte Knowledge Cards umzuwandeln
- Quellenmaterial und Transkripte dauerhaft referenzierbar zu machen
- Zusammenfassungen, Key Takeaways, Tags, Entitäten und Review-Fragen zu generieren
- gespeichertes Wissen zu durchsuchen und zu befragen
- Beziehungen zwischen gespeicherten Inhalten zu entdecken
- wichtige Ideen durch Active Recall und Spaced Repetition langfristig zu behalten

## 5. Nicht-Ziele für das MVP

Das MVP soll nicht versuchen, den gesamten Funktionsumfang von Recall nachzubauen.

Nicht Teil der ersten Version:

- Browser Extension
- Mobile App
- öffentliches Teilen oder Challenges
- Team Workspaces
- komplexe Graph-Bearbeitung
- vollständige Offline-first/Local-first-Synchronisation
- Multi-User-Billing
- native App-Pakete
- TikTok-, Podcast- und Google-Docs-Ingestion
- produktionsreife Recommendation Engine

## 6. Zielgruppen

Primäre Nutzer für V1:

- Solo-Learner, die viele edukative YouTube-Videos schauen
- Gründer und Knowledge Worker, die Recherche sammeln
- Studenten, die Zusammenfassungen und Review-Fragen brauchen
- Creator, die Themen über längere Zeit recherchieren
- Entwickler, die technische Videos, Artikel und Notizen speichern

## 7. Core User Journey

1. Nutzer öffnet Mindshift.
2. Nutzer fügt eine YouTube-URL ein.
3. Backend erstellt einen Processing Job.
4. Backend ruft Video-Metadaten und Transkript ab.
5. Falls kein Transkript verfügbar ist, versucht das Backend optional Audio-Extraktion und Transkription, sofern konfiguriert.
6. AI Processing erzeugt:
   - kurze Zusammenfassung
   - detaillierte Zusammenfassung
   - Key Takeaways
   - Timestamps oder Kapitel, sofern möglich
   - Tags
   - Entitäten/Konzepte
   - vorgeschlagene verwandte Cards
   - Quiz-Fragen
7. Frontend zeigt den Processing-Status.
8. Der fertige Inhalt erscheint als Knowledge Card in der Library.
9. Nutzer öffnet die Card und kann:
   - die Zusammenfassung lesen
   - Transkript/Quellentext ansehen
   - persönliche Notizen bearbeiten
   - innerhalb des Inhalts suchen
   - Quiz-Fragen generieren oder bearbeiten
   - verwandte Cards sehen
10. Nutzer sucht oder chattet später über die Knowledge Base.
11. Nutzer wiederholt fällige Fragen nach einem Review-Zeitplan.

## 8. MVP Scope

### 8.1 Content Ingestion

MVP-Anforderungen:

- Nutzer kann eine YouTube-URL einreichen.
- System speichert Source URL, Video ID, Titel, Channel, Dauer, Thumbnail und Veröffentlichungsdatum, sofern verfügbar.
- System versucht Transkript/Captions abzurufen.
- System speichert Job-Status: `queued`, `processing`, `completed`, `failed`.
- System speichert aussagekräftige Fehlermeldungen für fehlgeschlagene Ingestion.

Später:

- PDF Uploads
- Webartikel-Extraktion
- Browser Extension
- Bulk Imports
- Mobile Share Target

### 8.2 Knowledge Cards

Jeder erfolgreich oder teilweise verarbeitete Inhalt wird zu einer Knowledge Card.

Card-Felder:

- Titel
- Source Type
- Source URL
- Thumbnail
- Processing Status
- kurze Zusammenfassung
- detaillierte Zusammenfassung
- Transkript/Quellentext
- persönliche Notizen
- Tags
- Entitäten/Konzepte
- Erstellungsdatum
- Aktualisierungsdatum

Card-Aktionen:

- Card Detail öffnen
- persönliche Notizen bearbeiten
- Zusammenfassung neu generieren
- Card löschen
- Tags manuell hinzufügen oder entfernen

### 8.3 AI-Zusammenfassungen

Für jedes erfolgreich verarbeitete Transkript soll das Backend erzeugen:

- kurze Zusammenfassung
- detaillierte Zusammenfassung
- Key Takeaways als Bullet Points
- wichtige Begriffe/Konzepte
- vorgeschlagene Tags
- vorgeschlagene Quiz-Fragen

Die Ergebnisse sollen als strukturierte JSON-Daten plus lesbares Markdown gespeichert werden.

### 8.4 Library

Das Frontend soll bieten:

- Card-Liste/Grid
- Suchfeld
- Filter nach Tag, Source und Status
- Sortierung nach neueste/älteste/Titel
- Empty State
- Failed-Processing-State

### 8.5 Notizen

Jede Card enthält ein editierbares Notebook-Feld.

MVP-Anforderung:

- Einfacher Markdown Editor oder Textarea reicht aus.
- Notizen werden unabhängig von AI-generierten Zusammenfassungen gespeichert.

Später:

- Block Editor
- bidirektionale Wiki-Links
- kollaboratives Rich-Text-Editing

### 8.6 Suche

MVP-Suche:

- Keyword-Suche über Titel, Summary, Transkript, Notizen und Tags
- optionale semantische Suche, falls pgvector früh eingerichtet wird

V1.1-Suche:

- semantisches Retrieval über Transkript-Chunks und Notizen
- Quellenzitate in Suchergebnissen

### 8.7 Knowledge Connections

Das MVP soll Wissensverbindungen in PostgreSQL modellieren, nicht direkt in Neo4j.

Begründung:

- PostgreSQL ist auf Railway einfacher zu deployen.
- Relationship-Tabellen reichen für frühe Card-to-Card-Verbindungen.
- pgvector kann semantische Ähnlichkeit abbilden.
- Neo4j kann später ergänzt werden, falls Graph Traversal zentral wird.

MVP-Beziehungstypen:

- `mentions`
- `similar_to`
- `same_topic`
- `manual_link`
- `derived_from`

### 8.8 Quiz und Review

Das MVP soll Quiz-Fragen generieren. Vollständiges Spaced Repetition Scheduling kann bei Bedarf in V1.1 verschoben werden.

MVP:

- Fragen aus Card Summary/Transkript generieren.
- Frage, Antwort, Fragetyp, Schwierigkeit und Source Card speichern.
- Nutzer kann Antwort anzeigen oder beantworten.

V1.1:

- Review Queue
- Due Dates
- Ratings: Again, Hard, Good, Easy
- Stufen: New, Learning, Practiced, Confident, Mastered
- Review History

## 9. V1.1 Scope

V1.1 soll hinzufügen:

- PDF Upload und Text-Extraktion
- Artikel-URL-Extraktion
- Chat mit einzelner Card
- Chat über die gesamte Knowledge Base mit RAG
- Embedding-Generierung und pgvector-Suche
- Review Scheduler
- bessere Graph UI
- Markdown Export

## 10. V2 Scope

V2 kann enthalten:

- Browser Extension
- Mobile-freundlicher Capture Flow
- Neo4j oder dediziertes Graph Backend
- Augmented Browsing
- Bulk Imports
- Obsidian/Notion Import
- mehrsprachige Zusammenfassungen
- Listen Mode / generierte Audio-Zusammenfassungen
- Team/shared Libraries
- öffentliche Challenge Links

## 11. Technische Architektur

### 11.1 Repository-Struktur

Zielstruktur:

```text
mindshift/
├── frontend/
├── backend/
├── scripts/
│   ├── start.sh
│   └── stop.sh
├── docs/
│   ├── PRD.md
│   └── PRD.de.md
├── docker-compose.yml
├── .env.example
└── README.md
```

### 11.2 Frontend

Technologie:

- React
- Tailwind CSS
- Lucide Icons
- Vite als Empfehlung für die erste Version

Frontend-Verantwortung:

- Benutzeroberfläche und Routing
- YouTube-URL-Eingabe
- Processing-Status anzeigen
- Library- und Card-Ansichten
- Notizen bearbeiten
- Search UI
- Quiz/Review UI

Das Frontend soll nicht:

- API Keys speichern
- Transkripte direkt von Drittanbietern abrufen
- AI Calls direkt ausführen

### 11.3 Backend

Technologie:

- FastAPI
- Python
- SQLAlchemy oder SQLModel
- Alembic für Migrationen
- Pydantic Settings

Backend-Verantwortung:

- REST API
- Persistenz in der Datenbank
- YouTube-Metadaten und Transkript-Ingestion
- Background Processing
- AI Calls
- Embedding-Generierung
- Search Endpoints
- Export Endpoints

### 11.4 Datenbank

Empfehlung für MVP:

- PostgreSQL
- pgvector, falls semantische Suche früh integriert wird

Mögliche spätere Ergänzung:

- Neo4j für fortgeschrittene Graph-Erkundung und Traversal

### 11.5 Background Jobs

YouTube-Verarbeitung kann länger dauern, deshalb sollte Ingestion asynchron laufen.

MVP-Optionen:

- Einfache FastAPI Background Tasks für lokalen Prototyp
- später ARQ, RQ, Celery oder Dramatiq für Produktion

Empfohlener Weg:

- Mit klarer Job-Tabelle und einfachem Worker-Prozess starten.
- Die Schnittstelle von Anfang an worker-fähig halten.

### 11.6 AI Provider

Das Backend soll AI Calls hinter einem Service-Modul kapseln.

Benötigte Fähigkeiten:

- Zusammenfassung
- strukturierte Extraktion
- Quiz-Generierung
- Embeddings
- später Chat/RAG

Environment-Variablen:

- `OPENAI_API_KEY`
- optionale Model Settings
- optionale Transcription Provider Settings

## 12. Datenmodell-Entwurf

### users

Für das MVP ist Single-User-Modus akzeptabel. Die Tabelle kann trotzdem angelegt werden, wenn Authentifizierung geplant ist.

- `id`
- `email`
- `display_name`
- `created_at`

### cards

- `id`
- `user_id`
- `source_id`
- `title`
- `source_type`
- `status`
- `thumbnail_url`
- `concise_summary_md`
- `detailed_summary_md`
- `key_takeaways_json`
- `notes_md`
- `created_at`
- `updated_at`

### sources

- `id`
- `source_type`
- `url`
- `canonical_url`
- `external_id`
- `metadata_json`
- `created_at`

### transcripts

- `id`
- `card_id`
- `language`
- `text`
- `segments_json`
- `provider`
- `created_at`

### tags

- `id`
- `user_id`
- `name`
- `color`
- `created_at`

### card_tags

- `card_id`
- `tag_id`

### entities

- `id`
- `name`
- `entity_type`
- `description`
- `created_at`

### card_entities

- `card_id`
- `entity_id`
- `relevance_score`

### card_relations

- `id`
- `from_card_id`
- `to_card_id`
- `relation_type`
- `confidence`
- `created_by`
- `created_at`

### embeddings

- `id`
- `card_id`
- `chunk_type`
- `chunk_text`
- `chunk_index`
- `embedding`
- `metadata_json`
- `created_at`

### quiz_questions

- `id`
- `card_id`
- `question`
- `answer`
- `question_type`
- `difficulty`
- `source_excerpt`
- `created_at`

### review_events

- `id`
- `question_id`
- `user_id`
- `rating`
- `reviewed_at`
- `next_due_at`
- `stage`

## 13. API-Entwurf

### Health

- `GET /api/health`

### Cards

- `POST /api/cards/from-youtube`
- `GET /api/cards`
- `GET /api/cards/{card_id}`
- `PATCH /api/cards/{card_id}`
- `DELETE /api/cards/{card_id}`

### Processing

- `GET /api/jobs/{job_id}`
- `POST /api/cards/{card_id}/summarize`
- `POST /api/cards/{card_id}/regenerate`

### Search

- `GET /api/search?q=...`
- `POST /api/search/semantic`

### Notes

- `PATCH /api/cards/{card_id}/notes`

### Tags

- `GET /api/tags`
- `POST /api/tags`
- `PATCH /api/cards/{card_id}/tags`

### Quiz

- `POST /api/cards/{card_id}/quiz/generate`
- `GET /api/cards/{card_id}/quiz`
- `POST /api/quiz/{question_id}/review`

### Chat

Später in V1.1:

- `POST /api/cards/{card_id}/chat`
- `POST /api/chat`

## 14. Lokale Entwicklungsanforderungen

Das Projekt braucht einen sauberen lokalen Start/Stop-Workflow.

### start.sh

Das Script soll:

- lokale Datenbankservices starten, falls Docker Compose genutzt wird
- Backend API starten
- Frontend Dev Server starten
- optional Worker-Prozess starten
- Process IDs in ein lokales Runtime-Verzeichnis schreiben
- Frontend- und Backend-URLs ausgeben

Erwarteter Befehl:

```bash
./scripts/start.sh
```

### stop.sh

Das Script soll:

- Frontend-Prozess stoppen
- Backend-Prozess stoppen
- Worker-Prozess stoppen
- optional Docker-Compose-Services stoppen
- PID-Dateien bereinigen

Erwarteter Befehl:

```bash
./scripts/stop.sh
```

## 15. Railway Deployment Anforderungen

Die Anwendung soll als getrennte Railway Services deploybar sein:

- `frontend`: React Build als Web App
- `backend`: FastAPI API Service
- `postgres`: Managed PostgreSQL Service
- optional `worker`: separater Backend Worker Service

Frontend Environment-Variablen:

- `VITE_API_BASE_URL`

Backend Environment-Variablen:

- `DATABASE_URL`
- `OPENAI_API_KEY`
- `FRONTEND_ORIGIN`
- `ENVIRONMENT`

## 16. UX-Anforderungen

Die UI soll sich wie ein fokussiertes Knowledge-Work-Tool anfühlen, nicht wie eine Marketingseite.

Primäre Screens:

- Library
- Card Detail
- Add Content Modal/Panel
- Search Results
- Review/Quiz
- Graph View später
- Settings

Design-Prinzipien:

- Dicht, aber lesbar.
- Linke Sidebar für Navigation und Tags.
- Hauptbereich für Library oder Card Detail.
- Klare Processing States.
- Lucide Icons für Aktionen.
- Tailwind Utility Styling.
- Cards sollen funktional sein, nicht dekorativ.
- Keine übergroßen Hero Sections in der App UI.

## 17. Akzeptanzkriterien für das MVP

Das MVP gilt als fertig, wenn:

- Nutzer `./scripts/start.sh` lokal ausführen kann.
- Nutzer alle lokalen Services mit `./scripts/stop.sh` stoppen kann.
- Frontend und Backend in getrennten Ordnern liegen.
- Backend einen Health Endpoint bereitstellt.
- Nutzer eine YouTube-URL einreichen kann.
- Backend einen Processing Job erstellt und verfolgt.
- Backend YouTube-Metadaten speichert.
- Backend Transkripttext speichert, sofern verfügbar.
- Backend Summary Output generiert und speichert.
- Frontend Processing State anzeigt.
- Frontend fertige Knowledge Cards anzeigt.
- Nutzer eine Card Detail Page öffnen kann.
- Nutzer Notizen bearbeiten und speichern kann.
- Nutzer gespeicherte Cards durchsuchen kann.
- Nutzer generierte Quiz-Fragen ansehen kann.
- App als getrennte Frontend-/Backend-Services auf Railway deploybar ist.

## 18. Offene Fragen

- Soll V1 Authentifizierung enthalten oder als Single-User-App starten?
- Welche AI Provider und Modelle sollen zuerst genutzt werden?
- Soll Transkriptions-Fallback Teil des MVP sein oder verschoben werden?
- Soll YouTube-Transcript-Extraction zuerst nur mit vorhandenen Captions arbeiten?
- Soll semantische Suche Teil des MVP oder V1.1 sein?
- Sollen PDFs Teil des MVP oder V1.1 sein?
- Soll die App standardmäßig Deutsch ausgeben, Englisch ausgeben oder eine Nutzerwahl bieten?
- Soll das erste Deployment nur Railway PostgreSQL nutzen oder auch Redis für Jobs?

## 19. Empfohlene Build-Reihenfolge

1. Repository mit `frontend/`, `backend/`, `scripts/`, `docs/` scaffolden.
2. FastAPI App mit Health Endpoint und Settings erstellen.
3. React App mit Tailwind und Lucide erstellen.
4. Lokale Start/Stop-Scripts hinzufügen.
5. PostgreSQL und Migrationen einrichten.
6. Card/Source/Job-Datenmodell hinzufügen.
7. YouTube-Ingestion-Endpoint implementieren.
8. Transcript Fetching implementieren.
9. AI Summarization implementieren.
10. Library UI bauen.
11. Card Detail UI bauen.
12. Notes Editing hinzufügen.
13. Suche hinzufügen.
14. Quiz-Fragen-Generierung hinzufügen.
15. Railway Deployment vorbereiten.

## 20. Produktname

Arbeitsname: Mindshift.

Der Name kann intern bleiben, bis die Kern-UX validiert ist.
