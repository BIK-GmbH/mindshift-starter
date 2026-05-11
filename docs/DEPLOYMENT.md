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
exposes a tailnet service to the public internet. One-time setup
(verified working on macOS Tailscale.app — no `sudo` needed there,
the GUI app's helper grants the entitlement):

1. **Enable HTTPS Certificates** for your tailnet:
   <https://login.tailscale.com/admin/dns> → scroll to *HTTPS
   Certificates* → click *Enable HTTPS…*. One-time per tailnet.

2. **Start Funnel** pointing at the backend port:
   ```bash
   /Applications/Tailscale.app/Contents/MacOS/Tailscale \
     funnel --bg --https=443 http://127.0.0.1:8001
   ```
   Output prints e.g. `Available on the internet:
   https://your-machine.tail-abc123.ts.net/`.

3. **Provision the cert** the first time
   (Let's Encrypt issues it; subsequent renews are automatic):
   ```bash
   /Applications/Tailscale.app/Contents/MacOS/Tailscale \
     cert your-machine.tail-abc123.ts.net
   ```

4. **Put the URL in `backend/.env`** (no trailing slash) and **restart
   the uvicorn process** — `--reload` watches Python files only, not
   `.env`, so a Ctrl-C + re-run is required.
   ```
   PUBLIC_BASE_URL=https://your-machine.tail-abc123.ts.net
   ```

5. **Verify** from the Mac:
   ```bash
   curl -o /dev/null -w "%{http_code}\n" \
     https://your-machine.tail-abc123.ts.net/api/health
   # → 200
   ```

To stop: `tailscale funnel --https=443 off`. Funnel respects your
tailnet ACLs — see <https://tailscale.com/kb/1223/funnel> for the full
reference. Funnel-allowed nodes need the `funnel` nodeAttr in the
tailnet ACL (default permissive ACL allows it).

### Production deploy on Railway

Two valid layouts; the env var is the same, only the value changes.

**Layout A — single domain, reverse-proxy routes `/api/*` to backend**
(recommended; matches the nginx/Caddy snippets above):
```
PUBLIC_BASE_URL=https://mindshift.example.com
```
The route `/api/public/post-images/<token>.png` is auth-free at the
backend, and the proxy forwards `/api/*` straight through — Reepl
fetches `https://mindshift.example.com/api/public/post-images/...` and
the proxy delivers the PNG.

**Layout B — Railway serves frontend and backend on separate domains**
(default Railway template when you don't set up a custom domain):
```
PUBLIC_BASE_URL=https://mindshift-backend-production.up.railway.app
```
Use the **backend service's** generated `*.up.railway.app` hostname,
not the frontend's. Reepl never talks to the frontend.

Railway-specific checklist for this feature:
- Backend service → **Variables** tab → add `PUBLIC_BASE_URL=…` →
  Save. Railway redeploys automatically on variable change.
- Confirm the backend service has a **public network** enabled
  (Settings → Networking → Generate Domain, or attach a custom one).
- The auth-free route `/api/public/post-images/<token>.png` is by
  design — the token (UUID4, unique per post) is unguessable. No
  rate-limit gate is needed at the reverse-proxy level, but you can
  add one if you're paranoid about scrapers (5 req/s is plenty).
- After first deploy, run the migration once:
  `python -m alembic upgrade head` (Railway: add to the deploy
  command, or run via `railway run alembic upgrade head`).
- No outbound firewall rules needed — the bytes flow from Reepl to
  Railway, never the other way.

### Verifying end-to-end on a new environment

Quick smoke test after setting `PUBLIC_BASE_URL`:

```bash
# 1. Hit health from outside (proves Funnel/Railway is forwarding):
curl https://<base>/api/health
# → {"status":"ok"}

# 2. From any card in the UI, generate a post WITH image, then check
#    the response of GET /api/cards/<id>/social-posts contains a
#    non-null public_image_url field on that post:
curl -H "Authorization: Bearer <jwt>" \
  https://<base>/api/cards/<card_id>/social-posts | jq '.[0].public_image_url'
# → "https://<base>/api/public/post-images/<uuid>.png"

# 3. Open the URL in an incognito tab — should serve the PNG with no auth.

# 4. Publish via Reepl from the UI, then open Reepl's draft list — the
#    draft should now carry the attached image.
```

## First-run checklist

1. `alembic upgrade head` against your production DB.
2. `psql … -c 'CREATE EXTENSION IF NOT EXISTS vector;'` (idempotent).
3. Deploy backend + frontend.
4. Open the frontend, register your account.
5. (Optional) Settings → API & Extension → reveal token, install the
   extension from `extension/`.
