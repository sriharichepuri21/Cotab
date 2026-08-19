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

http://localhost:3000. The UI talks to `NEXT_PUBLIC_API_URL`. For local dev,
point it at **`http://localhost:8000`** (NOT `127.0.0.1`) so the origin matches
the backend's CORS allowlist and the session cookie flows:

```bash
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > .env.local
```

You can register a real account at `/register` (cookie + Bearer both work on
same-origin localhost), **or** skip login entirely: when `NODE_ENV !==
"production"` the frontend home page also sends the `X-Dev-User` header, which
the non-prod backend accepts. See the auth model note in
[ARCHITECTURE.md §6](ARCHITECTURE.md#6-auth).

### Testing auth & cookies locally

Two things that repeatedly bite people testing sign-in:

- **HttpOnly cookies can't be cleared from JS.** `document.cookie` can't see or
  delete an `HttpOnly` cookie (that's the point). To test "logged out," either
  hit `POST /api/v1/auth/logout`, or clear it in DevTools → Application →
  Cookies. Wiping localStorage/sessionStorage does **not** log you out of the
  cookie path.
- **Bearer vs cookie.** The frontend authenticates with a Bearer token stored in
  `sessionStorage` (per-tab). Closing the tab logs you out; a new tab needs a
  fresh login. That's deliberate — see the auth note in ARCHITECTURE.

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
pytest -q                    # 166 tests
pytest tests/test_analytics.py -k budget -v
```

Tests run against an in-memory SQLite DB — no network, no Gemini calls. They
cover the OCR rule engine, chat tools, analytics aggregations, list
filtering/search, auth, and migration round-trips. Two properties are asserted
throughout: **user isolation** (one account's data never appears in another's
results) and that tools return the `{status, ...}` envelope rather than raising.

Note the in-memory DB is built with `create_all`, so the suite cannot catch an
unapplied migration — see the `no such table` entry under Troubleshooting.

There are **no frontend tests**.

**Who verifies what.** Assistants verify API behavior with `curl` and rendering
via DOM snapshot / static inspection. **Interactive paths — clicks, form submits,
cross-page navigation, file upload — are human-in-the-loop in a real browser.**
The controlled/automated browser used during development cannot reliably fire
React handlers, so "it rendered" ≠ "it works on click." We do **not** add dev-only
frontend auth headers to make the sandbox work; the `X-Dev-User` backend escape
hatch stays backend-only and is ignored by the frontend. If an interactive flow
needs verifying, a human confirms it in `http://localhost:3000` or on the deployed
URL, and the report names the verification level explicitly.

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

## Adding a dashboard card

The dashboard is one endpoint and one component, so a new card is two small
edits plus a test — deliberately, so nobody is tempted to add a second endpoint
and a second copy of the arithmetic.

1. **Add the aggregation** to `app/services/analytics_service.py`. Use
   `spend_query(db, user_id, start, end_exclusive)` as the base rather than
   writing a fresh `db.query(Receipt)` — it already applies user scoping, the
   soft-delete filter, and the `extracted`/`reviewed` status rule. Skipping it is
   how the dashboard starts disagreeing with the chat assistant.
2. **Include it** in `dashboard_summary()`'s return dict.
3. **Add the field** to `DashboardSummary` in `frontend/src/lib/api.ts`.
4. **Render it** with `<Card>` in `frontend/src/components/DashboardCards.tsx`.
   Give it a `sub` that says something when the value is empty — "No spend yet"
   is information, a blank tile looks broken.
5. **Test the number**, not the shape, in `tests/test_analytics.py`. Assert an
   exact value from seeded receipts; `assert x is not None` would pass on a
   wrong total.

Money is rendered with `Intl.NumberFormat` using `currencyDisplay: "narrowSymbol"`
— the default renders USD as `US$296.59`, which clips inside a card on mobile.

## Testing budget alerts locally

Budgets are checked on every upload, so the fastest way to see an alert is to
set a limit just under what you've already spent, then upload anything.

```bash
cd backend && source venv/bin/activate
API=http://localhost:8000
TOKEN=$(curl -sS -X POST $API/api/v1/auth/login \
  -d "username=you@example.com&password=..." | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

# what does the current month look like?
curl -sS $API/api/v1/analytics/summary -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["this_month"])'

# set a total budget just above it, then upload a receipt to cross it
curl -sS -X POST $API/api/v1/budgets/ -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"level":"total","target":"","period":"monthly","amount":300}'

curl -sS $API/api/v1/budgets/ -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

The upload response carries `budget_alerts`, and the home page turns that into
the amber toast.

**A second upload deliberately stays quiet.** Alerts fire on *crossing* a
threshold band, not on being over one — so if you upload again and see nothing,
that's the feature. To make it fire again, cross the next band (80 → 100 → 120)
or lower the budget.

**Item budgets count line items, not receipts.** A `coffee` item budget only
counts line items whose description matches, so it needs receipts that actually
have line items — a receipt whose extraction produced none will never move it.

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
The auth token isn't reaching the backend. Check in order:

1. **Localhost host mismatch.** `NEXT_PUBLIC_API_URL` must use **`localhost`,
   not `127.0.0.1`** — browsers treat them as different hosts. Ports don't
   matter for same-site, so `localhost:3000 → localhost:8000` is fine.
   `NEXT_PUBLIC_*` is inlined at build time, so restart the dev server after
   changing `.env.local`.
2. **A dead stored token.** The frontend keeps the Bearer token in
   `sessionStorage` (`rw_token`). A stale/expired token 401s; `apiFetch` clears
   it on 401 so the next render redirects to login. To force a clean state, run
   `sessionStorage.clear()` in DevTools → Console (or clear site data).
3. **Cross-site cookie mode (production).** If you're relying on the cookie path
   on a cross-site deploy (Vercel → Render), browsers like Chrome Incognito block
   third-party cookies on *send* even when stored. That's why the frontend is
   Bearer-primary — see [ARCHITECTURE.md §6](ARCHITECTURE.md#6-auth).

Confirm in DevTools → Network → the request → Request Headers: if there's no
`Cookie:` header, this is it.

**UI shows "Couldn't load receipts"**
The API is unreachable or returned non-2xx. Check the backend is up and
`CORS_ORIGINS` includes your frontend origin.

**Uploads "work" but images disappear**
`db/s3.py` falls back to `./local_data/objects` whenever S3 errors — including
when it's misconfigured. Silent by design. Verify `S3_ENDPOINT_URL` and the AWS
credentials.

**`Cannot find module './819.js'` / unstyled page / stale frontend**
`next build` and `next dev` share the `.next` directory, so building while the
dev server is live swaps the chunk files out from under it. The running app dies
with a module-not-found error that looks like a code bug and isn't.

`npm run build` now refuses to start while something is listening on port 3000
(`scripts/guard-dev-server.js`; skipped in CI, override with
`ALLOW_BUILD_WITH_DEV=1`). If you hit it anyway, recover in this order:

```bash
rm -rf .next && npm run dev
```

**A new endpoint 500s with `no such table`, but the tests pass**
The tests build their schema with `create_all` on an in-memory DB, so they never
notice an unapplied migration. Your dev DB does. Run `alembic upgrade head` in
`backend/`. A migration existing in the repo is not a migration applied to your
database — this has bitten twice.

Related: a FastAPI 500 bypasses `CORSMiddleware`, so the browser reports it as
"No 'Access-Control-Allow-Origin' header" instead of the real error. If you see a
CORS error on an endpoint that used to work, check the server log for a traceback
before touching CORS config.

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

## Browser end-to-end tests

The frontend has deterministic Playwright coverage for registration, login,
onboarding intent, and authenticated dashboard access. API calls are intercepted
in the browser, so these tests need neither the backend nor Gemini and cannot
mutate production data.

```bash
cd frontend
npx playwright install chromium   # first run only
npm run test:e2e -- --project=chromium
```

CI runs the Chromium project after lint, typecheck, and build. The configuration
also defines a Pixel 7 project for local mobile checks.

## Testing splits locally

1. Run `cd backend && alembic upgrade head`, start both apps, and use a reviewed
   receipt with line items.
2. Choose **Split this receipt**, add two people, and test even and itemized
   modes. Assign one item to both people to exercise shared ownership.
3. Confirm shares equal the receipt total exactly, including `$10.00 / 3`, and
   exercise pro-rata, even, and payer tax modes.
4. Add two receipts to one group with different payers. The group page must show
   simplified settlements; `/groups` must show the cross-group owner net.
5. Open `/share/{share_code}` in incognito. It must load without auth and expose
   names and balances but no contact email.
6. Create three itemized splits at the same merchant, then open a fourth. Exact
   normalized item-description patterns should prefill at confidence `1`.

Fast checks live in `tests/test_splits.py`; migration round-trip coverage ensures
the assignment-history table and allocation metadata exist in a fresh database.
## Extending chat and insights

To add a read tool, implement a user-scoped function in `chat_tools.py`, add its
typed Gemini declaration in `gemini_service.py`, register it in `TOOL_REGISTRY`,
and add deterministic tests for empty, normal, malformed, and cross-user cases.
Never accept `user_id` from model arguments. If the tool mutates state, also add
its name to `MUTATION_TOOLS`; direct execution from the model is forbidden.

Tool explanations are persisted in `ChatMessage.tool_trace`. Keep returned data
small and user-safe because the frontend intentionally displays it under “How was
this answered?”. The question-routing corpus in `test_phase7_chat.py` pins varied
phrasing before any Gemini call.

To add an insight rule, compute an auditable fact in `insight_service.py`, choose
a stable period-based `dedupe_key`, set a finite expiry, and test both the trigger
and non-trigger boundary. Insight discovery must not require an LLM.
