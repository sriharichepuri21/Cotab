# ReceiptWise — Development

## Prerequisites

- Python 3.11+ (3.13 works; CI runs 3.11)
- Node 20+
- A Gemini API key — https://aistudio.google.com/app/apikey

Neither Docker, LocalStack, nor Postgres is required for local work. SQLite and
a local-filesystem object store are the defaults.

---

## Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp ../.env.example .env       # then add GEMINI_API_KEY
uvicorn app.main:app --port 8000 --reload
```

```bash
curl http://127.0.0.1:8000/health
```

## Database & migrations (Alembic)

The schema is managed by **Alembic** — the app no longer calls `create_all()` at
startup. Migrations live in `backend/alembic/versions/`; the baseline that creates
all current tables is the first revision there.

**First-time setup (new clone or fresh DB):** apply the baseline so the tables
exist before booting the API.

```bash
cd backend && source venv/bin/activate
alembic upgrade head        # builds schema at DATABASE_URL (default: sqlite)
uvicorn app.main:app --port 8000 --reload
```

`alembic` reads `DATABASE_URL` from the environment or `backend/.env` (no
credentials in `alembic.ini`). Supabase/Render `postgres://` URIs are normalized
automatically, same as the app.

**Changing the schema:**

```bash
# 1. edit app/models/models.py
# 2. autogenerate a revision from the current models:
alembic revision --autogenerate -m "add <thing> to <table>"
# 3. REVIEW the generated file in alembic/versions/ — autogen is a draft,
#    not gospel; check destructive drops especially.
# 4. apply it:
alembic upgrade head
```

- `alembic history` · `alembic current` · `alembic downgrade -1` are your friends.
- A round-trip test (`tests/test_migrations.py`) proves the baseline reproduces
  the ORM schema exactly — run it before committing any model/migration change.

> `backend/.env` is gitignored and is the right place for your real API key.
> Never put it in `.env.example`.

## Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

http://localhost:3000. The UI talks to `NEXT_PUBLIC_API_URL` (default
`http://127.0.0.1:8000`) and authenticates with the `X-Dev-User` header, so no
login is needed locally.

## LocalStack (optional, for S3)

You don't need it — the backend falls back to `./local_data/objects/` whenever S3
is unreachable. Run it only if you want to exercise the real S3 code path:

```bash
docker compose -f docker-compose.dev.yml up localstack
# or stand-alone:
docker run -p 4566:4566 localstack/localstack:3.0
```

## Database

- Local: SQLite at `backend/receiptwise.db` (gitignored)
- Docker/prod: Postgres via `DATABASE_URL`

## Reminders

Trigger a cron endpoint by hand:

```bash
curl -X POST http://127.0.0.1:8000/api/v1/reminders/cron/weekly-digest \
  -H "X-Cron-Secret: dev-cron-secret"
```

Delivery is log-only, so watch the server output. Re-running within the same
period is a no-op — `ReminderLog.period_key` dedupes.

## Full stack in Docker

```bash
docker compose -f docker-compose.dev.yml up
```

Postgres + LocalStack + Redis + both apps. **Not verified end-to-end** — it was
broken for a while by an env-var rename and the fix hasn't been exercised.

---

## Testing

```bash
cd backend && source venv/bin/activate
pytest -q                    # 34 tests
pytest tests/test_chat_tools.py -k budget -v
```

Tests cover `chat_tools` and `categories` against an in-memory SQLite DB — no
network, no Gemini calls. They specifically assert **user isolation** (one user's
data never appears in another's results) and that every tool returns the
`{status, ...}` envelope rather than raising.

There are **no frontend tests**.

## Linting & formatting

CI enforces all of these; run them before pushing.

```bash
# backend
black app/ && isort app/
black --check app/ && isort --check-only app/

# frontend
npm run lint
npm run typecheck
npm run build
```

`isort` is pinned to the black profile in `backend/.isort.cfg`.

---

## CI

| Workflow | Triggers on | Does |
|---|---|---|
| `backend-ci.yml` | `backend/**` | black, isort, import smoke test, pytest |
| `frontend-ci.yml` | `frontend/**` | `npm ci`, lint, typecheck, build |
| `reminders-cron.yml` | schedule | POSTs the cron endpoints |

`reminders-cron` **currently fails on every run** because the `API_URL` variable
and `CRON_SECRET` secret aren't configured. See
[DEPLOYMENT.md](DEPLOYMENT.md#4-reminder-cron).

---

## Working on the chat tools

The most common change. To add a tool:

1. Write the function in `services/chat_tools.py`. Signature must start
   `(db: Session, user_id: str, ...)`. Return `_ok()` / `_empty()` / `_err()`.
   **Never raise, never interpolate user input into SQL.**
2. Register it in `TOOL_REGISTRY` at the bottom of that file.
3. Declare it to Gemini in `gemini_service._chat_tool_declarations()` — name,
   description, and a typed `genai.protos.Schema`. The description is the only
   thing steering the model, so make it precise.
4. Add tests.

**Never add `user_id` as a tool parameter.** It's injected server-side by
`_call_tool`, which also strips any `user_id` the model tries to pass.

> The Gemini declarations use the legacy `google-generativeai` 0.8.x
> `genai.protos.*` API. A migration to the `google-genai` 2.x SDK (plain dicts)
> would touch only `_chat_tool_declarations()` and the `Part`/`FunctionResponse`
> construction in `chat_service`.

---

## Troubleshooting

**`404 ... is not found for API version v1beta`**
The model name in `GEMINI_MODEL` doesn't exist or was retired. List what your key
can actually reach:

```bash
python -c "
import google.generativeai as genai
from app.config.settings import get_settings
genai.configure(api_key=get_settings().gemini_api_key)
print([m.name for m in genai.list_models() if 'generateContent' in m.supported_generation_methods])
"
```

**Chat replies "I've hit my AI usage limit for now"**
Gemini quota. The free tier allows ~20 requests/day per model, and each chat
message costs 2+ calls. Switch `GEMINI_MODEL` to a model with remaining quota, or
enable billing.

**Chat replies "I'm having trouble thinking right now"**
A genuine error, not quota. The traceback **is** in the server log — that's what
`logger.exception` is there for.

**Login succeeds but every later request 401s**
Almost always a cookie that was set but never sent back. Check `.env.local`:
`NEXT_PUBLIC_API_URL` must use **`localhost`, not `127.0.0.1`**. The dev server
runs on `localhost:3000`, and browsers treat `localhost` and `127.0.0.1` as
different hosts — so `127.0.0.1:8000` is a *cross-site* request, and the
`SameSite=Lax` session cookie is withheld. Ports don't affect same-site, so
`localhost:3000 → localhost:8000` is fine. `NEXT_PUBLIC_*` is inlined at build
time, so restart the dev server after changing it.

Confirm in DevTools → Network → the request → Request Headers: if there's no
`Cookie:` header, this is it.

**UI shows "Couldn't load receipts"**
The API is unreachable or returned non-2xx. Check the backend is up and
`CORS_ORIGINS` includes your frontend origin.

**Uploads "work" but images disappear**
`db/s3.py` falls back to `./local_data/objects` whenever S3 errors — including
when it's misconfigured. Silent by design. Verify `S3_ENDPOINT_URL` and the AWS
credentials.

**Unstyled page / stale frontend**
Running `next build` while `next dev` is live corrupts the shared `.next`
directory. Stop the dev server, `rm -rf .next`, restart — **in that order**.

**Schema changes don't take effect**
Schema is owned by Alembic, not `create_all()`. If the API boots but a table or
column is missing, you haven't applied the latest migration:

```bash
cd backend && source venv/bin/activate
alembic upgrade head
```

If the local DB got into a weird state and it's safe to lose the data, the
nuclear option is to delete `backend/receiptwise.db` and re-run
`alembic upgrade head`. **Never do this against a live/production database** —
write a real migration instead.
