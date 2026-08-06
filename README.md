# ReceiptWise

AI-powered receipt tracking: scan → extract → chat with your data.

## Features (MVP)

- **Receipt upload** — client-side compress (1600px max, WebP, ~150KB target) → S3/LocalStack → Gemini extraction → human review
- **AI Chat** — text-to-SQL agent with sqlglot AST validation, SELECT-only, table allowlist, complexity budget, auto user-scoping; raw DB errors never echoed back to LLM (schema-leak mitigation)
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

- **Backend**: FastAPI + SQLAlchemy + sqlglot + boto3 (LocalStack-aware, fs fallback) + google-generativeai
- **Frontend**: Next.js 14 PWA (camera input, client-side image compression)
- **Storage**: SQLite locally (Postgres in docker/prod), LocalStack S3 or `./local_data/objects` fallback
- **Reminders**: GitHub Actions cron → POST `/api/v1/reminders/cron/*` with `X-Cron-Secret`

## Security model (text-to-SQL)

1. sqlglot parse → single statement, SELECT-only, table & function allowlists
2. Complexity budget (~50 AST nodes), auto `LIMIT 100`
3. Server-side `WHERE user_id = :uid` injection at AST level
4. Raw DB errors are **never** fed back to the LLM (prevents schema leaks)
5. Per-user hourly chat rate limit
