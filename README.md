# sport-day — ระบบสุ่มแบ่งกลุ่ม 4 สี

Web app for the Office of the Permanent Secretary, Ministry of Finance: draws staff into four
colour teams, either in one pass or in five staged rounds by position level.

Converted from PHP to a static front end plus a zero-dependency Node server that runs anywhere
(container, VPS, Kubernetes, Vercel).

## What is in here

| Path | Purpose |
| --- | --- |
| `index.html` | single-pass four-colour draw |
| `stage_random.html` | five-round draw by position level, with per-round history |
| `server.cjs` | production HTTP server: static files, `/api/*`, `/healthz`, `/readyz`, gzip, ETag |
| `api/save_state.js` | GET/POST the last saved draw (JSON, written to `STATE_DIR`) |
| `api/upload_avatar.js` | avatar list / delete / upload, stored under `STATE_DIR/avatars` |
| `dev/server.cjs` | local dev server (same contract, port 8090) |
| `scripts/` | one-off E-Office roster and photo fetchers (credentials read from `~/.secrets`, never committed) |
| `*.php` | original PHP implementation, kept for reference; excluded from the image and from Vercel |
| `Dockerfile`, `docker-compose.yml`, `deploy/k8s/` | deployment |
| `DEPLOY.md` | full deployment runbook |

## Run locally

```bash
npm run dev          # http://localhost:8090
# or the production server:
PORT=8080 STATE_DIR=./.state npm start
```

## Data files are not in git

`officials_live.json`, `officials_504.json`, `latest_spin.json`,
`performance-appraisal.users19.json` and `uploads/photos/` contain real staff records
(names, e-mails, photos, password hashes, signature images), so they are git-ignored.
Copy them into the working tree (or mount them into the container) before running the app;
without them the pages load but have no roster to draw from.

## Deploy

```bash
docker build -t sport-spin:1.0.0 .
kubectl apply -k deploy/k8s      # production, Traefik ingress
```

See `DEPLOY.md` for registry, TLS, persistence, rollout and rollback, and for the
single-VPS Docker Compose alternative.

## Runtime contract

`PORT` (default 8080), `HOST` (0.0.0.0), `STATE_DIR` (writable dir for the saved draw and avatars).

Endpoints: `/healthz`, `/readyz`, `/api/save_state`, `/api/upload_avatar`, `/uploads/avatars/*`,
plus the static pages. Request bodies above 25 MB are rejected with 413.