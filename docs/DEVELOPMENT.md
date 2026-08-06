# Development runbook

## Backend

```bash
cd backend
source venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

Endpoints: http://127.0.0.1:8000/docs (OpenAPI UI), `/health`

## Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

App: http://localhost:3000

## LocalStack (optional, for S3)

```bash
docker compose -f docker-compose.dev.yml up localstack
# or stand-alone:
docker run -p 4566:4566 localstack/localstack:3.0
```

The backend falls back to `./local_data/objects/` if S3 is unreachable — you don't need LocalStack for dev.

## Database

- Local: SQLite at `backend/receiptwise.db` (gitignored)
- Docker/prod: Postgres via `DATABASE_URL`

## Reminders (cron)

The reminders are triggered by GitHub Actions workflows (`/.github/workflows/reminders-cron.yml`). To run them manually:

```bash
curl -X POST http://127.0.0.1:8000/api/v1/reminders/cron/weekly-digest \
  -H "X-Cron-Secret: dev-cron-secret"
```
