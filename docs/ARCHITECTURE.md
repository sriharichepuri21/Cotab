# ReceiptWise — Architecture

End-to-end reference for how the system is put together. For running it, see
[DEVELOPMENT.md](DEVELOPMENT.md); for shipping it, [DEPLOYMENT.md](DEPLOYMENT.md);
for endpoints, [API.md](API.md).

---

## 1. What it does

Photograph a receipt → an LLM extracts structured fields → you review and correct
→ ask questions about your spending in plain language → optionally split the bill
with people who don't have accounts.

Five capability areas:

| Area | Entry point | Core module |
|---|---|---|
| Receipt capture & extraction | `POST /api/v1/receipts/upload` | `services/gemini_service.py` |
| Conversational querying | `POST /api/v1/chat/` | `services/chat_service.py` + `chat_tools.py` |
| Budgets & reminders | `/api/v1/reminders/*` | `services/reminder_service.py` |
| Bill splitting | `/api/v1/splits/*` | `services/split_service.py` |
| Data portability | `/api/v1/exports/` | `api/v1/exports.py` |

---

## 2. Shape of the system

```
Browser (Next.js 14, App Router)
  │  compress to WebP ≤300KB client-side before upload
  ▼
FastAPI  ── SQLAlchemy ──▶  SQLite (dev) / Postgres (prod)
  │
  ├──▶ Gemini API      (vision extraction + function-calling chat)
  └──▶ S3 / LocalStack (receipt images; falls back to local disk)

GitHub Actions cron ──▶ POST /api/v1/reminders/cron/*  (X-Cron-Secret)
```

Deliberately serverless-friendly: no queue, no worker, no background scheduler.
Extraction happens inline during the upload request, and reminders are driven by
an external cron hitting secret-guarded endpoints. This keeps it deployable on a
free Render web service, at the cost of a slow upload request (see
[§9 Known gaps](#9-known-gaps--upgrade-paths)).

---

## 3. Repository layout

```
backend/
  app/
    main.py                 FastAPI app, CORS, lifespan, prod config validation
    config/settings.py      Pydantic Settings — every env var lives here
    core/security.py        JWT issue/verify, bcrypt, X-Dev-User escape hatch
    db/
      session.py            Engines (rw + readonly), SessionLocal, Base
      s3.py                 Object storage w/ automatic local-disk fallback
    models/models.py        All 12 SQLAlchemy tables
    schemas/                Pydantic request/response models
    api/v1/                 Routers: auth, receipts, chat, reminders, splits, exports
    services/
      gemini_service.py     Vision extraction + chat tool declarations
      chat_service.py       Tool-calling orchestration loop
      chat_tools.py         The 6 callable tools (hand-written SQL)
      categories.py         Deterministic category alias normalization
      reminder_service.py   Digests, monthly reports, budget alerts
      split_service.py      Even/itemized splits, debt simplification
    utils/db_url.py         Postgres DSN normalization
  tests/test_chat_tools.py  34 tests
frontend/
  src/app/page.tsx          The entire UI (upload + list + chat)
  src/app/layout.tsx        Root layout
docs/                       This documentation
.github/workflows/          backend-ci, frontend-ci, reminders-cron
render.yaml                 Render blueprint for the API
docker-compose.dev.yml      Full local stack (Postgres + LocalStack + both apps)
```

---

## 4. Data model

12 tables, all with `id: str` (UUID4), and all inheriting `TimestampMixin`
(`created_at`, `updated_at`, `deleted_at`).

**Soft delete is the rule everywhere.** `deleted_at IS NOT NULL` means deleted;
rows are meant to purge after `SOFT_DELETE_GRACE_DAYS` (default 30). Every query
in the codebase filters `deleted_at.is_(None)` — omitting that filter in new code
is the single easiest way to leak deleted data back into the UI.

Because that filter is on every read path, `deleted_at` is indexed on all 12
tables (`ix_<table>_deleted_at`). The mixin declares `index=True`; declarative
copies mixin columns per subclass, so each table gets its own index and the
names don't collide. `tests/test_migrations.py` asserts the migrated index set
matches the ORM's — a columns-only comparison silently passed once while every
one of these indexes was missing.

```
User ─┬─< Receipt ──< ReceiptLineItem
      ├─< Budget
      ├─< ChatSession ──< ChatMessage
      ├─< ExportRequest
      └─< SplitGroup ──< SplitMember
                    └──< ReceiptSplit ──< SplitShare
ReminderLog  (standalone; dedupe ledger, no FK)
```

### Notable columns

**`Receipt.status`** — the extraction state machine:
`uploaded → processing → extracted → reviewed`, or `failed`.
Spend aggregation only counts `extracted` and `reviewed`, so a `failed` receipt
never pollutes totals.

**`Receipt.category`** — one of ten canonical values, defined in **two places
that must stay in sync**: `gemini_service.CATEGORIES` (what the extractor may
emit) and `categories.CANONICAL_CATEGORIES` (what chat tools accept):
`groceries, dining, transport, utilities, rent, entertainment, health, shopping,
travel, other`.

**`ReceiptLineItem.user_id`** — denormalized from the parent receipt purely so
user-scoping filters never require a join.

**`ReminderLog.period_key`** — the dedupe guard (e.g. `2026-W31`). Before
sending, `has_been_sent()` checks `(user_id, kind, period_key)`. This is what
makes the cron endpoints safe to call repeatedly.

**`SplitMember.user_id`** — nullable by design. That null is the whole
"no accounts needed" feature: members are just names.

**`SplitGroup.share_code`** — a UUID serving as a bearer token for the public
read-only endpoint. Anyone holding the code can read the group.

**`ChatMessage.sql_used`** — vestigial. Left over from the text-to-SQL era; the
column still exists but is always written as `NULL` now. Safe to drop in a
future migration.

---

## 5. Request flows

### 5.1 Receipt upload

`POST /api/v1/receipts/upload` — [`api/v1/receipts.py`](../backend/app/api/v1/receipts.py)

1. Reject non-images (415) and anything over `MAX_UPLOAD_BYTES` / 300KB (413).
   The browser has already resized to 1600px and encoded WebP.
2. Insert `Receipt(status="processing")` so the row exists even if later steps die.
3. Upload bytes to S3 under `uploads/{user_id}/{uuid}.webp`. **Failure here is
   swallowed** — a missing object store must not lose the receipt.
4. Call Gemini vision with `EXTRACTION_PROMPT`, parse the JSON, populate merchant
   / totals / date / category / line items, set `status="extracted"`.
   Unrecognized categories are coerced to `other`.
5. Run budget alerts for the affected category.

Extraction is **synchronous**, so this request takes as long as the Gemini call.

### 5.2 Chat — the tool-calling loop

`POST /api/v1/chat/` — [`services/chat_service.py`](../backend/app/services/chat_service.py)

This is the most security-sensitive path in the app, and it was deliberately
rebuilt. It used to be text-to-SQL: the model wrote SQL, and `sqlglot` validated
it (SELECT-only, table allowlist, AST-level `user_id` injection). **That approach
is gone.** The model no longer sees the schema and cannot emit SQL at all.

```
message
  │
  ├─ per-user rate limit (RATE_LIMIT_CHAT_PER_HOUR, in-memory sliding window)
  ├─ find-or-create ChatSession, persist the user turn
  ▼
loop, max MAX_ITERATIONS = 5
  │  Gemini returns either function_call parts or final text
  │  ├─ text  → break
  │  └─ calls → execute each via _call_tool(), feed results back
  ▼
persist assistant turn, return (session_id, None, answer)
```

Four properties do the security work:

1. **`user_id` is never a tool parameter.** It's not in any `FunctionDeclaration`,
   and `_call_tool` invokes `fn(db, user_id, **args)` with the *server's* value.
   Any `user_id` or `db` key the model tries to pass is stripped before the call.
2. **Every tool owns hand-written SQL.** Nothing is assembled from model output.
3. **Tools never raise.** They return `{"status": "ok"|"empty"|"error", ...}`.
   Raw exceptions are logged server-side but only a generic `hint` reaches the
   model — exception text can leak schema details.
4. **The loop is bounded.** After 5 tool calls, `_force_final_text()` demands a
   textual answer, so a confused model can't burn quota indefinitely.

Error handling distinguishes three failure classes, which matters operationally:

| Condition | User sees |
|---|---|
| `GEMINI_API_KEY` unset | "Chat isn't configured on the server right now…" |
| `ResourceExhausted` (quota/429) | "I've hit my AI usage limit for now…" |
| Anything else | "I'm having trouble thinking right now…" |

All three log server-side via `logger.exception`/`logger.warning`. Before that
logging existed, an upstream 429 surfaced as a generic error while the server
recorded a clean `200 OK` — the failure was invisible.

#### The six tools

Defined in [`chat_tools.py`](../backend/app/services/chat_tools.py), declared to
Gemini in `gemini_service._chat_tool_declarations()`. **Adding a tool means
editing both files plus `TOOL_REGISTRY`.**

| Tool | Required args | Notes |
|---|---|---|
| `get_spend_summary` | — | Defaults to last 30 days; totals + top 5 categories |
| `get_budget_status` | `category` | Spend vs limit for a month |
| `list_receipts` | — | Newest first; `limit` clamped to 1–50 |
| `find_receipts` | `search_text` | Searches merchant **and** line-item text |
| `create_split` | `receipt_id`, `member_names` | Even splits only |
| `add_budget` | `category`, `amount` | Upsert |

Category arguments always route through `categories._normalize_category()`, which
maps free text ("food", "Trader Joe's", "eating out") onto canonical values via
longest-alias-wins substring matching. It's deterministic and non-LLM, so it's
cheap and testable.

### 5.3 Reminders

Three cron endpoints guarded by `require_cron_secret` (an `X-Cron-Secret` header
check, reused from `exports.py`). GitHub Actions calls them on schedule.

| Job | Schedule (UTC) | `period_key` |
|---|---|---|
| Daily digest | `0 8 * * *` | per-day |
| Weekly digest | `0 19 * * 0` | `YYYY-Www` |
| Monthly report | `0 9 1 * *` | per-month |

Delivery is **log-only** today — `reminder_service._send()` prints. Telegram/email
adapters plug in there; `User.telegram_chat_id` already exists for it.

### 5.4 Splitting

Two split algorithms in [`split_service.py`](../backend/app/services/split_service.py):

- **Even** — `total / n`, rounded to cents.
- **Itemized** — each person pays for their assigned line items plus a
  *pro-rata* share of tax, apportioned by their subtotal share.

`simplify_debts()` nets everyone's balances and greedily matches the largest
debtor to the largest creditor, producing a minimal transfer list rather than
making everyone pay everyone.

Note the chat `create_split` tool always creates a **fresh single-purpose group**
per call ("one receipt, one split"), whereas the REST API lets you build a
persistent group and attach many receipts.

---

## 6. Auth

JWT bearer tokens (`python-jose`, HS256) with bcrypt password hashing.
Access tokens last `ACCESS_TOKEN_EXPIRE_MINUTES` (60), refresh tokens
`REFRESH_TOKEN_EXPIRE_DAYS` (30).

**The `X-Dev-User` escape hatch** — [`core/security.py`](../backend/app/core/security.py):
sending `X-Dev-User: dev@local` authenticates as that email, **creating the user
if it doesn't exist**. It is gated on `not settings.is_production()`, and the
frontend additionally only sends the header when `NODE_ENV !== "production"`.

> ⚠️ Two independent guards protect this, and both hinge on environment config
> being correct. If `ENVIRONMENT` is ever not exactly `production` in a deployed
> environment, this header becomes an unauthenticated account-creation endpoint.

There is **no login UI**. The frontend has no token handling at all — it relies
entirely on the dev header, which is why it is not production-usable as-is.

---

## 7. Storage

[`db/s3.py`](../backend/app/db/s3.py) wraps boto3 with a `LocalStore` fallback:
every operation try/excepts to `./local_data/objects`. That's what lets the app
run end-to-end with no AWS and no LocalStack.

The tradeoff: a genuine S3 misconfiguration in production **degrades silently to
local disk** rather than erroring. On ephemeral hosts those files vanish on
redeploy. If uploads seem to work but images later disappear, check this first.

Set `S3_ENDPOINT_URL=""` for real AWS; point it at Supabase for S3-compatible
storage (see [SUPABASE_S3.md](SUPABASE_S3.md)).

---

## 8. Configuration

Every setting is declared in [`config/settings.py`](../backend/app/config/settings.py)
as a Pydantic `Settings` field; env var names are the upper-cased field names.
`extra="ignore"` means **unknown env vars are silently discarded** — a misspelled
or renamed variable doesn't error, it just doesn't apply. (That's exactly how
`docker-compose.dev.yml` came to be broken after `AWS_ENDPOINT_URL` was renamed
to `S3_ENDPOINT_URL`.)

| Var | Default | Purpose |
|---|---|---|
| `ENVIRONMENT` | `development` | `production` enables prod validation, disables dev auth |
| `DEBUG` | `true` | |
| `SECRET_KEY` | dev placeholder | JWT signing |
| `DATABASE_URL` | `sqlite:///./receiptwise.db` | `postgres://` is auto-normalized |
| `DATABASE_URL_READONLY` | falls back to `DATABASE_URL` | Read-role DSN |
| `CORS_ORIGINS` | localhost:3000 | Comma-separated |
| `S3_ENDPOINT_URL` | `http://localhost:4566` | `""` = real AWS |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | `test` | |
| `AWS_DEFAULT_REGION` | `us-east-1` | |
| `S3_BUCKET` | `receiptwise-uploads` | |
| `GEMINI_API_KEY` | — | Required for extraction and chat |
| `GEMINI_MODEL` | `gemini-3.5-flash` | |
| `RATE_LIMIT_CHAT_PER_HOUR` | `20` | Per user, in-memory |
| `SOFT_DELETE_GRACE_DAYS` | `30` | |
| `MAX_UPLOAD_BYTES` | `307200` | 300KB |
| `CRON_SECRET` | dev placeholder | Guards `/reminders/cron/*` |

`Settings.validate_production()` runs at startup **only when
`ENVIRONMENT=production`** and hard-fails on: the placeholder `SECRET_KEY`, a
missing `GEMINI_API_KEY`, or a SQLite `DATABASE_URL`.

---

## 9. Known gaps & upgrade paths

Honest list of what's incomplete. Roughly ordered by how much it would hurt in
production.

### Blocking for real users

1. **No login UI.** The frontend never obtains or sends a JWT; it depends on the
   dev header, which is disabled in production. `/auth/register` and `/auth/login`
   exist and work — the client side simply doesn't use them.
2. **Rate limiting is per-process, in-memory.** `_chat_windows` is a module-level
   dict. It resets on restart and isn't shared across instances, so the limit is
   effectively `20 × instances`. `redis` is already a dependency and in
   docker-compose but unused — that's the intended fix.
3. **Gemini free tier is 20 requests/day** on `gemini-3.5-flash`, and one chat
   message costs 2+ calls (one per tool round trip). Real use needs billing
   enabled, or a higher-quota model.

### Correctness / operational

4. ~~**No migrations.**~~ **Fixed.** The schema is now managed by Alembic
   (`backend/alembic/`). `create_all()` was removed from startup; migrations are
   applied via `alembic upgrade head` (Render runs this at boot). A baseline
   revision creates all 12 tables, and `tests/test_migrations.py` round-trips
   `upgrade head` / `downgrade base` against the ORM metadata.
5. **Silent S3 fallback** (§7) can mask a production misconfiguration.
6. **Synchronous extraction** makes upload latency equal to Gemini latency, with
   no retry. A queue (or a `failed` + retry path) is the upgrade.
7. **Exports are synchronous** and built in-memory in the request; large accounts
   will be slow. `ExportRequest.status` already models an async flow that isn't
   implemented.
8. **Reminders only print.** `_send()` is a stub.
9. **Two category lists** must be manually kept in sync (§4).
10. **`ChatMessage.sql_used`** is dead weight (§4).

### Deployment

11. **The reminder cron has been failing daily** — `API_URL` (a repo *variable*)
    and `CRON_SECRET` (a repo *secret*) are unset, so `curl` gets an empty URL.
    It will keep failing until the API is deployed and both are configured.
12. **The frontend Dockerfile has never been built.** It was rewritten to use
    Next's `standalone` output and is unverified — CI runs `next build`, not
    `docker build`.
13. **`docker-compose.dev.yml` was broken** by the `AWS_ENDPOINT_URL` →
    `S3_ENDPOINT_URL` rename (now fixed, but the whole compose stack remains
    untested end-to-end).

### Product surface

14. The frontend is a **single 180-line page** with no routing, no component
    split, and no state management. Review queue, budgets, splits, and exports
    all have working APIs with **no UI at all**.
15. **No frontend tests.** Backend has 34; the frontend has zero.
16. Not actually a PWA — no manifest, no service worker, no `public/`.
