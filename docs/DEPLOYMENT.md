# Deploying Mindshift

Mindshift is a single-user, self-hosted app. There's a FastAPI backend
(`backend/`), a Vite-built React frontend (`frontend/dist/` after
`npm run build`), Postgres with the `pgvector` extension, and a
filesystem volume for uploaded files.

## Components

| Piece | Notes |
|---|---|
| **Backend** (FastAPI / uvicorn) | Set `OPENAI_API_KEY`, `DATABASE_URL`, `JWT_SECRET`, `STORAGE_PATH`, `FRONTEND_ORIGIN`. Run `alembic upgrade head` on each deploy. |
| **Postgres + pgvector** | Any Postgres 14+ with the extension. On Railway: pick the Postgres template, then in the SQL editor run `CREATE EXTENSION IF NOT EXISTS vector;`. |
| **File storage** | A persistent volume at `STORAGE_PATH`. On Railway: attach a volume to the backend service, set `STORAGE_PATH` to its mount path (e.g. `/data`). |
| **Frontend** | Static files. Serve `frontend/dist/` from any HTTP server, or deploy as a separate Railway / Vercel static service pointed at `npm run build`. |
| **Reverse proxy** | Optional locally; recommended in production so `/api`, `/og`, `/share`, `/u`, and the SPA static all live under one host. |

## Environment variables

See `.env.example`. The variables that **must** be set in production:

```
DATABASE_URL=postgresql+psycopg://USER:PASS@HOST:PORT/DB
JWT_SECRET=<long random>
OPENAI_API_KEY=sk-...
FRONTEND_ORIGIN=https://your.host          # for CORS
STORAGE_PATH=/data                          # mount point of the persistent volume
STORAGE_BACKEND=local
STORAGE_MAX_BYTES_PER_USER=2147483648
```

Frontend build-time:

```
VITE_API_BASE_URL=https://your.host         # leave empty if behind a single-host reverse proxy
```

## Reverse proxy: route social bots to the OG endpoint

The public profile and tag pages are SPA routes — bots that don't
execute JavaScript (Twitter, WhatsApp, Telegram, LinkedIn, Slack-without-JS
bots) see an empty `<div id="root">`. The backend serves crawler-friendly
HTML at `/og/u/...`. Hand crawler User-Agents to those URLs.

### nginx

```nginx
# Inside the `server { … }` block that fronts the frontend host:

# 1) Forward API + share + og to the backend.
location /api/   { proxy_pass http://backend:8001; }
location /og/    { proxy_pass http://backend:8001; }

# 2) Crawler UA → server-rendered OG page; everyone else → SPA.
location ~ ^/u/(.+)$ {
  if ($http_user_agent ~* "facebookexternalhit|twitterbot|whatsapp|slackbot|linkedinbot|telegrambot|discordbot|skypeuripreview|googlebot|bingbot|preview") {
    rewrite ^/u/(.+)$ /og/u/$1 last;
  }
  try_files $uri /index.html;       # SPA fallback for real browsers
}

# 3) Everything else falls through to the SPA.
location / {
  try_files $uri /index.html;
}
```

### Caddy

```caddyfile
your.host {
  handle_path /api/* { reverse_proxy backend:8001 }
  handle_path /og/*  { reverse_proxy backend:8001 }

  @crawler header_regexp User-Agent (?i)facebookexternalhit|twitterbot|whatsapp|slackbot|linkedinbot|telegrambot|discordbot|skypeuripreview
  handle @crawler {
    @uPath path /u/*
    rewrite @uPath /og{path}
    reverse_proxy backend:8001
  }

  root * /srv/mindshift/frontend/dist
  try_files {path} /index.html
  file_server
}
```

## Railway-specific notes

- **Volume**: attach to the backend service. Set the mount path (e.g.
  `/data`) and point `STORAGE_PATH` at it.
- **Postgres + pgvector**: use the Postgres plugin, then run
  `CREATE EXTENSION IF NOT EXISTS vector;` once via `psql`.
- **Single replica**: the storage layer assumes the volume is mounted
  to one instance. If you scale to multiple replicas of the backend
  service, switch `STORAGE_BACKEND` to `s3` (not implemented yet — a
  drop-in replacement of `services/storage.py:LocalStorage`).
- **Migrations**: add a release/start hook that runs
  `python -m alembic upgrade head` before uvicorn boots.

## Publish-via-MCP image attachments

When a draft has a generated image and is published through an MCP
publisher (Reepl, Buffer, …), the backend can hand the external service
a URL to the image so the published post carries it. The external
service fetches the bytes directly — they aren't streamed through your
Mindshift instance. For this to work, Reepl's servers (or whichever
MCP publisher you use) must be able to reach your backend.

Set `PUBLIC_BASE_URL` to the externally-fetchable origin of your
backend, e.g.

```
PUBLIC_BASE_URL=https://your-machine.tail-abc123.ts.net
```

The publish flow then attaches `mediaUrls: ["<base>/api/public/post-images/<token>.png"]`
to draft-creation calls on any tool whose schema declares an
appropriate field. Leave `PUBLIC_BASE_URL` empty to publish text-only.

### Local dev via Tailscale Funnel

If you're already on Tailscale (`tailscale status` works), Funnel
exposes a tailnet service to the public internet. One-time setup:

```bash
# (Run once per device.)
sudo tailscale set --funnel=true
sudo tailscale funnel --bg --https=443 http://127.0.0.1:8001
```

The command prints something like `Available on the internet:
https://your-machine.tail-abc123.ts.net/`. Put that URL into
`backend/.env` as `PUBLIC_BASE_URL=...` (no trailing slash) and
restart the backend.

To stop: `sudo tailscale funnel --bg off`. Funnel respects your tailnet
ACLs — see <https://tailscale.com/kb/1223/funnel> for the full reference.

### Production (Railway / your host)

Just set `PUBLIC_BASE_URL` to the same domain users hit, e.g.
`https://mindshift.example.com`. No tunnel needed.

## First-run checklist

1. `alembic upgrade head` against your production DB.
2. `psql … -c 'CREATE EXTENSION IF NOT EXISTS vector;'` (idempotent).
3. Deploy backend + frontend.
4. Open the frontend, register your account.
5. (Optional) Settings → API & Extension → reveal token, install the
   extension from `extension/`.
