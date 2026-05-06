# Mindshift PRD

## 1. Product Summary

Mindshift is a personal AI knowledge base for collecting, understanding, connecting, and retaining knowledge from YouTube videos, articles, PDFs, and personal notes.

The product is inspired by tools like Recall, but should be built as an independent application with a pragmatic first version: fast local development, clean deployment boundaries, and a focused MVP that can later grow into a graph-based learning system.

## 2. Research Notes

Recall positions itself as an AI knowledge base that lets users save content, summarize it, chat with it, organize it automatically, connect it in a knowledge graph, and review it through quiz/spaced repetition workflows.

Key observed capabilities from Recall:

- Content capture from browser extension, in-app URL entry, mobile sharing, PDF upload, bookmark imports, Markdown imports, and Pocket imports.
- Supported content includes YouTube videos with transcripts, PDFs, Google Docs/Slides, blogs, articles, websites, and notes.
- Each saved item becomes a card containing original read-only content, a notebook, summaries, chat, graph visibility, and spaced repetition review.
- Recall stores original content so the product can function as a read-it-later system.
- Recall supports concise summaries, detailed summaries, and content-specific chat.
- Recall uses a graph database to connect related content and extract/enrich keywords.
- Graph view represents saved cards as nodes, relationships as edges, node size by connectedness, and colors by tags.
- Quiz and spaced repetition workflows include generated questions, due reviews, progress stages, filtering, and review notifications.
- Recall Plus currently highlights chat with knowledge, auto-organization, knowledge graph, augmented browsing, quiz/spaced repetition, bulk imports, multi-PDF uploads, and multilingual support.

Research sources:

- [Recall Introduction](https://docs.recall.it/)
- [Recall: Add Content](https://docs.recall.it/getting-started/2-add-content)
- [Recall: Interact with Content](https://docs.recall.it/getting-started/3-summarize-and-chat-with-content)
- [Recall: Knowledge Graph Overview](https://docs.recall.it/deep-dives/graph/overview)
- [Recall: Quiz and Spaced Repetition](https://docs.recall.it/deep-dives/quiz-and-spaced-repetition)
- [Recall Pricing and FAQ](https://www.recall.it/pricing)

## 3. Problem Statement

People consume large amounts of educational and professional content but rarely convert it into durable knowledge. Common problems:

- Saved links become dead storage.
- YouTube videos are hard to revisit because the important points are buried in long timelines.
- Notes, summaries, and source material live in separate tools.
- Search is keyword-based and misses conceptual relationships.
- Users forget most of what they consumed unless they actively review it.
- Manual organization through folders and tags becomes inconsistent over time.

## 4. Product Goals

Mindshift should help users:

- Save useful content quickly.
- Convert long-form content into structured knowledge cards.
- Preserve source material and transcripts for later reference.
- Generate clear summaries, key takeaways, tags, entities, and review questions.
- Search and ask questions across saved knowledge.
- Discover relationships between saved items.
- Retain important ideas through active recall and spaced repetition.

## 5. Non-Goals for MVP

The MVP should not attempt to match the full Recall product surface.

Out of scope for the first version:

- Browser extension.
- Mobile app.
- Public sharing/challenges.
- Team workspaces.
- Complex graph editing.
- Full offline-first/local-first sync.
- Multi-user billing.
- Native app packaging.
- TikTok, podcast platform, and Google Docs ingestion.
- Production-grade recommendation engine.

## 6. Target Users

Primary users for V1:

- Solo learners who watch educational YouTube videos.
- Founders and knowledge workers collecting research.
- Students who want summaries and review questions.
- Creators researching topics over time.
- Developers saving technical videos, articles, and notes.

## 7. Core User Journey

1. User opens Mindshift.
2. User pastes a YouTube URL into the app.
3. Backend creates a processing job.
4. Backend fetches video metadata and transcript.
5. If a transcript is unavailable, the backend attempts audio extraction/transcription if configured.
6. AI processing generates:
   - concise summary
   - detailed summary
   - key takeaways
   - timestamps or chapters where possible
   - tags
   - entities/concepts
   - suggested related cards
   - quiz questions
7. Frontend displays processing status.
8. Completed item appears as a knowledge card in the library.
9. User opens the card and can:
   - read the summary
   - inspect transcript/source text
   - edit personal notes
   - search within the content
   - generate or edit quiz questions
   - see related cards
10. User later searches or chats across the knowledge base.
11. User reviews due questions on a schedule.

## 8. MVP Scope

### 8.1 Content Ingestion

MVP requirements:

- User can submit a YouTube URL.
- System stores source URL, video ID, title, channel, duration, thumbnail, and publish date where available.
- System attempts to fetch transcript/captions.
- System records job status: `queued`, `processing`, `completed`, `failed`.
- System stores meaningful error messages for failed ingestion.

Deferred:

- PDF uploads.
- Web article extraction.
- Browser extension.
- Bulk imports.
- Mobile share target.

### 8.2 Knowledge Cards

Each ingested item becomes a knowledge card.

Card fields:

- title
- source type
- source URL
- thumbnail
- processing status
- concise summary
- detailed summary
- transcript/source text
- personal notes
- tags
- entities/concepts
- created date
- updated date

Card actions:

- open card detail
- edit personal notes
- regenerate summary
- delete card
- manually add/remove tags

### 8.3 AI Summaries

For each successfully processed transcript, the backend should generate:

- concise summary
- detailed summary
- bullet-point key takeaways
- important terms/concepts
- suggested tags
- suggested quiz questions

Summary output should be stored as structured JSON plus human-readable Markdown.

### 8.4 Library

The frontend should provide:

- card list/grid
- search input
- filters by tag/source/status
- sort by newest/oldest/title
- empty state
- failed-processing state

### 8.5 Notes

Each card should include an editable notebook field.

MVP requirement:

- Plain Markdown editor or textarea is sufficient.
- Notes are saved independently of AI-generated summaries.

Deferred:

- Block editor.
- Bidirectional wiki links.
- Rich text collaborative editing.

### 8.6 Search

MVP search should include:

- keyword search over title, summary, transcript, notes, and tags
- optional semantic search if pgvector is configured

V1.1 search should support:

- semantic retrieval over transcript chunks and notes
- source citations in results

### 8.7 Knowledge Connections

MVP should model knowledge connections in PostgreSQL, not Neo4j.

Reasoning:

- PostgreSQL is simpler to deploy on Railway.
- Relationship tables are enough for early card-to-card links.
- pgvector can support semantic similarity.
- Neo4j can be added later if graph traversal becomes central.

MVP relationship types:

- `mentions`
- `similar_to`
- `same_topic`
- `manual_link`
- `derived_from`

### 8.8 Quiz and Review

MVP should generate quiz questions but can defer full spaced repetition scheduling if needed.

MVP:

- Generate questions from card summary/transcript.
- Store question, answer, question type, difficulty, source card.
- Let user answer or reveal answer.

V1.1:

- Review queue.
- Due dates.
- Ratings: Again, Hard, Good, Easy.
- Stages: New, Learning, Practiced, Confident, Mastered.
- Review history.

## 9. V1.1 Scope

V1.1 should add:

- PDF upload and extraction.
- Article URL extraction.
- Chat with a single card.
- Chat across the knowledge base using RAG.
- Embedding generation and pgvector search.
- Review scheduler.
- Better graph UI.
- Markdown export.

## 10. V2 Scope

V2 may add:

- Browser extension.
- Mobile-friendly capture flow.
- Neo4j or dedicated graph backend.
- Augmented browsing.
- Bulk imports.
- Obsidian/Notion import.
- Multi-language summaries.
- Listen mode / generated audio summaries.
- Team/shared libraries.
- Public challenge links.

## 11. Technical Architecture

### 11.1 Repository Layout

Target layout:

```text
mindshift/
├── frontend/
├── backend/
├── scripts/
│   ├── start.sh
│   └── stop.sh
├── docs/
│   └── PRD.md
├── docker-compose.yml
├── .env.example
└── README.md
```

### 11.2 Frontend

Technology:

- React
- Tailwind CSS
- Lucide Icons
- Vite recommended for the first version

Frontend responsibilities:

- User interface and routing.
- YouTube URL submission.
- Processing status display.
- Library/card views.
- Notes editing.
- Search UI.
- Quiz/review UI.

Frontend should not:

- Store API keys.
- Fetch transcripts directly from third-party services.
- Run AI calls directly.

### 11.3 Backend

Technology:

- FastAPI
- Python
- SQLAlchemy or SQLModel
- Alembic for migrations
- Pydantic settings

Backend responsibilities:

- REST API.
- Database persistence.
- YouTube metadata/transcript ingestion.
- Background processing.
- AI calls.
- Embedding generation.
- Search endpoints.
- Export endpoints.

### 11.4 Database

Recommended MVP:

- PostgreSQL
- pgvector if semantic search is included early

Possible later addition:

- Neo4j for advanced graph exploration and traversal.

### 11.5 Background Jobs

Processing YouTube videos can take time, so ingestion should run asynchronously.

MVP options:

- Simple FastAPI background task for local prototype.
- Upgrade to ARQ, RQ, Celery, or Dramatiq for production.

Recommended path:

- Start with a clear job table and simple worker process.
- Keep the interface worker-friendly from the start.

### 11.6 AI Providers

Backend should abstract AI calls behind a service module.

Required capabilities:

- summarization
- structured extraction
- quiz generation
- embeddings
- chat/RAG later

Environment variables:

- `OPENAI_API_KEY`
- optional model settings
- optional transcription provider settings

## 12. Data Model Draft

### users

For MVP, single-user mode is acceptable. The table should still exist if authentication is planned.

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

## 13. API Draft

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

Deferred to V1.1:

- `POST /api/cards/{card_id}/chat`
- `POST /api/chat`

## 14. Local Development Requirements

The project must include a clean local start/stop workflow.

### start.sh

The script should:

- start local database services if using Docker Compose
- start backend API
- start frontend dev server
- optionally start worker process
- write process IDs to a local runtime directory
- print frontend and backend URLs

Expected command:

```bash
./scripts/start.sh
```

### stop.sh

The script should:

- stop frontend process
- stop backend process
- stop worker process
- optionally stop Docker Compose services
- clean up PID files

Expected command:

```bash
./scripts/stop.sh
```

## 15. Railway Deployment Requirements

The application should be deployable as separate Railway services:

- `frontend`: React build served as web app.
- `backend`: FastAPI API service.
- `postgres`: managed PostgreSQL service.
- optional `worker`: separate backend worker service.

Frontend environment variables:

- `VITE_API_BASE_URL`

Backend environment variables:

- `DATABASE_URL`
- `OPENAI_API_KEY`
- `FRONTEND_ORIGIN`
- `ENVIRONMENT`

## 16. UX Requirements

The UI should feel like a focused knowledge work tool, not a marketing site.

Primary screens:

- Library
- Card detail
- Add content modal/panel
- Search results
- Review/Quiz
- Graph view later
- Settings

Design principles:

- Dense but readable information layout.
- Left sidebar for navigation/tags.
- Main panel for library or card detail.
- Clear processing states.
- Lucide icons for actions.
- Tailwind utility styling.
- Cards should be functional, not decorative.
- Avoid oversized hero sections in the app UI.

## 17. Acceptance Criteria for MVP

MVP is complete when:

- User can run `./scripts/start.sh` locally.
- User can stop all local services with `./scripts/stop.sh`.
- Frontend and backend are in separate folders.
- Backend exposes a health endpoint.
- User can submit a YouTube URL.
- Backend creates and tracks a processing job.
- Backend stores YouTube metadata.
- Backend stores transcript text when available.
- Backend generates and stores summary output.
- Frontend shows processing state.
- Frontend shows completed knowledge cards.
- User can open a card detail page.
- User can edit and persist notes.
- User can search saved cards.
- User can view generated quiz questions.
- App can be deployed to Railway as separate frontend/backend services.

## 18. Open Questions

- Should V1 require user authentication, or start as a single-user local app?
- Which AI provider and models should be used first?
- Should transcription fallback be included in MVP or postponed?
- Should YouTube transcript extraction rely only on available captions first?
- Should semantic search be included in MVP or V1.1?
- Should PDFs be part of MVP or V1.1?
- Should the app support German output by default, English output, or user-selectable language?
- Should the first deployment use Railway PostgreSQL only, or also Redis for jobs?

## 19. Recommended Build Order

1. Scaffold repository with `frontend/`, `backend/`, `scripts/`, `docs/`.
2. Create FastAPI app with health endpoint and settings.
3. Create React app with Tailwind and Lucide.
4. Add local start/stop scripts.
5. Add PostgreSQL and migrations.
6. Add card/source/job data model.
7. Implement YouTube ingestion endpoint.
8. Implement transcript fetching.
9. Implement AI summarization.
10. Build library UI.
11. Build card detail UI.
12. Add notes editing.
13. Add search.
14. Add quiz question generation.
15. Prepare Railway deployment configuration.

## 20. Product Name

Working name: Mindshift.

This can stay internal until the core UX is proven.
