# ReceiptWise

AI-powered receipt tracking: scan → extract → chat with your data.

## Features (MVP)

- **Receipt upload** — client-side compress (1600px max, WebP, ~150KB target) → S3/LocalStack → Gemini extraction → human review
- **AI Chat** — function-calling agent: Gemini picks from a fixed set of typed, pre-built tools (spend summary, budget status, receipt search/list, split, budget upsert); it never sees the schema or writes SQL, and `user_id` is injected server-side so it can't be forged or exfiltrated cross-user
- **Reminder engine** — weekly digest, monthly report, budget alerts with dedupe via `reminder_logs` and cron-secret-guarded endpoints
- **Split-with-friends** — no accounts needed; itemized or even splits, pro-rata tax, creditor/debtor netting, public share links
- **Data portability** — full JSON export, soft-delete with 30-day grace

## Quick start (local, SQLite + local filesystem store)

```bash
cd backend
python3.13 -m venv venv
source venv/bin/activate
pip install -r requirements.txt email-validator
cp ../.env.example .env
uvicorn app.main:app --port 8000
```

Health: `curl http://127.0.0.1:8000/health` → `{"status":"healthy"}`

Local dev auth escape hatch: pass header `X-Dev-User: dev@local` on any request.

## Full stack with Docker

```bash
docker compose -f docker-compose.dev.yml up
# api: http://localhost:8000/docs
# app: http://localhost:3000
```

## Stack

- **Backend**: FastAPI + SQLAlchemy + boto3 (LocalStack-aware, fs fallback) + google-generativeai
- **Frontend**: Next.js 14 App Router (camera input, client-side image compression). Not a PWA yet — no manifest or service worker.
- **Storage**: SQLite locally (Postgres in docker/prod), LocalStack S3 or `./local_data/objects` fallback
- **Reminders**: GitHub Actions cron → POST `/api/v1/reminders/cron/*` with `X-Cron-Secret`

## Security model (AI chat)

1. The model never writes SQL — it can only call a fixed set of typed tools (`app/services/chat_tools.py`)
2. Each tool's SQL is hand-written and audited once; `user_id` is injected server-side, not accepted as a tool argument, so it can't be forged
3. Tool loop is capped at 5 iterations, then the model is forced to compose a final answer
4. Tool failures return a structured `{status, hint}` — raw DB errors/exceptions are **never** fed back to the LLM (prevents schema leaks)
5. Per-user hourly chat rate limit
