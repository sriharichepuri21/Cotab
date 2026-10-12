# ReceiptWise

AI-powered receipt tracking: scan → extract → chat with your data.

Photograph a receipt, an LLM pulls out the merchant / total / line items, you
confirm it, then ask questions about your spending in plain language.

> **Status: deployed and usable, with known gaps.** The API runs at
> `receiptwise.onrender.com` (Render + Supabase), the client at
> `receiptwise-eight.vercel.app` (Vercel). 290 backend tests pass. Email alerts
> and OCR-primary extraction are not finished — see
> [Known gaps](docs/ARCHITECTURE.md#9-known-gaps--upgrade-paths).

## Documentation

| Doc | For |
|---|---|
| [CODEBASE.md](docs/CODEBASE.md) | **Every folder and file, what it does** — the map |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it works — data model, request flows, security, known gaps |
| [API.md](docs/API.md) | Every endpoint, with examples |
| [DEVELOPMENT.md](docs/DEVELOPMENT.md) | Running it, migrations, testing, CI, troubleshooting |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Render + Vercel + Supabase |
| [SUPABASE_S3.md](docs/SUPABASE_S3.md) | S3-compatible storage setup |
| [phase2/](docs/phase2/) | OCR engine measurement against a real receipt corpus |

## Features

- **Accounts** — register / login / logout with JWT bearer tokens, plus an
  onboarding intent picker that tailors empty-state copy
- **Receipt upload** — client-side compression (~1MB target, 5MB server ceiling)
  → S3 → Gemini vision extraction → human review queue
- **Dashboard** — this-month totals, top category and merchant, spend trend and
  category breakdown charts, pending-review count
- **Filter and search** — date range, category, merchant, amount, status; search
  spans **line-item descriptions**, not just merchant names. Filter state lives
  in the URL, so a view is shareable and survives reload. Saved views included.
- **Budgets** — four levels (total / category / merchant / item) × three periods
  (weekly / monthly / yearly), with threshold alerts on upload
- **AI chat** — Gemini function-calling over eight typed, hand-written tools. The
  model never writes ad-hoc SQL against your schema, and `user_id` is injected
  server-side so it can't be forged.
  ([details](docs/ARCHITECTURE.md#52-chat--the-tool-calling-loop))
- **Proactive insights** — deterministic observations, no LLM needed to find a fact
- **Split with friends** — no accounts needed; even or itemized splits with
  pro-rata tax, cent-accurate allocation, minimal-transfer settlement, and public
  read-only share links
- **Reminders** — daily/weekly/monthly digests and budget alerts, deduped per
  period, driven by GitHub Actions cron. *Delivery is log-only today.*
- **Data portability** — full JSON export, soft delete with a 30-day grace period

## Quick start

```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp ../.env.example .env        # then add your GEMINI_API_KEY
alembic upgrade head
uvicorn app.main:app --host localhost --port 8000 --reload
```

```bash
cd frontend && npm install && cp .env.example .env.local && npm run dev
```

API docs at http://localhost:8000/docs, app at http://localhost:3000.

No Docker, Postgres, Redis, or AWS needed locally — it defaults to SQLite, an
in-process rate limiter, and a local-filesystem object store.

> Use `localhost`, **not** `127.0.0.1`, in `NEXT_PUBLIC_API_URL`. Browsers treat
> them as different hosts.

## Full stack with Docker

```bash
docker compose -f docker-compose.dev.yml up
```

Postgres + LocalStack + Redis + both apps. Not verified end-to-end.

## Stack

- **Backend** — FastAPI, SQLAlchemy 2, Alembic, sqlglot, boto3 (LocalStack-aware
  with filesystem fallback), google-generativeai, RapidOCR, Redis
- **Frontend** — Next.js 14 App Router, Tailwind, Recharts, Playwright. Not a
  PWA — no manifest or service worker.
- **Storage** — SQLite locally, Postgres in production; S3, LocalStack, or
  `./local_data/objects`
- **Reminders** — GitHub Actions cron → `POST /api/v1/reminders/cron/*` with
  `X-Cron-Secret`

## Tests

```bash
cd backend && source venv/bin/activate && pytest -q   # 290 tests
cd frontend && npm run test:e2e                       # Playwright
```

Both run in CI on every push and pull request.
