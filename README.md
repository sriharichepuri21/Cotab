# ReceiptWise

AI-powered receipt tracking: scan → extract → chat with your data.

Photograph a receipt, an LLM pulls out the merchant / total / line items, you
confirm it, then ask questions about your spending in plain language.

> **Status: working MVP, not production-ready.** The backend is complete and
> tested; the frontend is a single page with no login flow, so it can't be handed
> to real users yet. See
> [Known gaps](docs/ARCHITECTURE.md#9-known-gaps--upgrade-paths).

## Documentation

| Doc | For |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it works — data model, request flows, security, known gaps |
| [API.md](docs/API.md) | Every endpoint, with examples |
| [DEVELOPMENT.md](docs/DEVELOPMENT.md) | Running it, testing, CI, troubleshooting |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Render + Vercel + Supabase |
| [SUPABASE_S3.md](docs/SUPABASE_S3.md) | S3-compatible storage setup |

## Features

- **Receipt upload** — client-side compression (1600px, WebP, ≤300KB) → S3 →
  Gemini vision extraction → human review queue
- **AI chat** — Gemini function-calling over six typed, hand-written tools. The
  model never sees the schema and never writes SQL; `user_id` is injected
  server-side so it can't be forged.
  ([details](docs/ARCHITECTURE.md#52-chat--the-tool-calling-loop))
- **Reminders** — daily/weekly/monthly digests and budget alerts, deduped per
  period, driven by GitHub Actions cron. *Delivery is log-only today.*
- **Split with friends** — no accounts needed; even or itemized splits with
  pro-rata tax and minimal-transfer debt settlement
- **Data portability** — full JSON export, soft delete with a 30-day grace period

## Quick start

```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp ../.env.example .env        # then add your GEMINI_API_KEY
uvicorn app.main:app --port 8000 --reload
```

```bash
cd frontend && npm install && cp .env.example .env.local && npm run dev
```

API docs at http://localhost:8000/docs, app at http://localhost:3000.

No Docker, Postgres, or AWS needed locally — it defaults to SQLite and a
local-filesystem object store. Pass `X-Dev-User: dev@local` to skip auth in dev.

## Full stack with Docker

```bash
docker compose -f docker-compose.dev.yml up
```

Postgres + LocalStack + Redis + both apps. Not verified end-to-end.

## Stack

- **Backend** — FastAPI, SQLAlchemy, boto3 (LocalStack-aware, filesystem
  fallback), google-generativeai
- **Frontend** — Next.js 14 App Router, Tailwind. Not a PWA — no manifest or
  service worker.
- **Storage** — SQLite locally (Postgres in prod); S3, LocalStack, or
  `./local_data/objects`
- **Reminders** — GitHub Actions cron → `POST /api/v1/reminders/cron/*` with
  `X-Cron-Secret`

## Tests

```bash
cd backend && source venv/bin/activate && pytest -q     # 34 tests
```

No frontend tests yet.
