# ReceiptWise — Codebase Reference

A file-by-file map of the repository: every tracked folder and file, what it
holds, and why it exists.

This is the **"where is it"** document. For the **"why"**, see:

| Doc | Covers |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System design, data model rationale, request flows, known gaps |
| [API.md](API.md) | Endpoint contracts with request/response examples |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Running it, migrations, testing, troubleshooting |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Render + Vercel + Supabase, env vars, post-deploy checks |

Figures below were measured against commit `3144480` (before this file was
added), not estimated: **139 tracked files**, **12,613 lines of Python**,
**3,465 lines of TypeScript/TSX/CSS**, **16 tables**, **44 API routes**,
**290 passing backend tests**, **9 Alembic migrations**.

---

## 1. Top level

```
receiptwise/
├── backend/              FastAPI + SQLAlchemy service (85 files)
├── frontend/             Next.js 14 App Router client (35 files)
├── docs/                 This documentation (10 files)
├── scripts/              Repo-level operational scripts (1 file)
├── .github/workflows/    CI and the reminder cron (3 files)
├── .claude/launch.json   Dev-server definitions for the Claude Code preview pane
├── docker-compose.dev.yml  Postgres + LocalStack + Redis + both apps
├── render.yaml           Render blueprint for the API
├── .env.example          Backend env template
├── .gitignore
└── README.md             Front door and doc index
```

| File | Purpose |
|---|---|
| `render.yaml` | Render blueprint. Pins `PYTHON_VERSION=3.13.1` (3.14 has no `pydantic-core` wheel) and runs `alembic upgrade head && uvicorn …` so a failed migration fails the deploy loudly. Declares `S3_ENDPOINT_URL` explicitly — unset, it silently falls back to local disk. |
| `docker-compose.dev.yml` | Full local stack. Sets `S3_ENDPOINT_URL` (not the removed `AWS_ENDPOINT_URL`), `GEMINI_MODEL`, `CORS_ORIGINS`. Not verified end-to-end. |
| `.env.example` | Backend env template. Copy to `backend/.env`. |
| `.claude/launch.json` | `backend` and `frontend` dev-server entries. Backend binds `--host localhost` deliberately — see §7. |
| `scripts/smoke.sh` | Post-deploy pipeline check against a live API. Uses real JWT auth because `X-Dev-User` is refused in production. |

---

## 2. `backend/` — FastAPI service

```
backend/
├── app/
│   ├── main.py             App factory, CORS, lifespan, router registration
│   ├── api/v1/             10 routers (44 routes)
│   ├── config/settings.py  Every env var, in one Pydantic Settings class
│   ├── core/security.py    JWT, bcrypt, the X-Dev-User escape hatch
│   ├── db/                 Engines, session, object storage
│   ├── models/models.py    All 16 SQLAlchemy tables
│   ├── schemas/            Pydantic request/response models
│   ├── services/           17 modules — the business logic
│   └── utils/db_url.py     Postgres DSN normalization
├── alembic/                9 migrations + env
├── tests/                  17 test modules, 290 tests
├── scripts/                3 OCR measurement harnesses
├── requirements.txt
├── pyproject.toml, .isort.cfg
└── Dockerfile
```

### 2.1 Entry point and configuration

| File | Lines | What it does |
|---|---|---|
| `app/main.py` | 73 | Builds the `FastAPI` app, registers 10 routers under `/api/v1`, adds CORS from `CORS_ORIGINS`. The lifespan hook runs `validate_production()` (production only), `verify_rate_limiter_backend()`, and best-effort bucket creation. **No `create_all()`** — schema is Alembic's job, and `create_all` masks drift by creating missing tables while never altering existing ones. |
| `app/config/settings.py` | 116 | One `Settings` class; env var names are the upper-cased field names. `extra="ignore"` means **unknown env vars are silently dropped** — that is exactly how a renamed variable breaks compose files without erroring. Holds `validate_production()` (refuses the placeholder `SECRET_KEY`, a missing Gemini key, or SQLite in prod) and `execute_sql_is_enabled_for()` (the Phase 7B canary gate). |
| `app/utils/db_url.py` | — | Rewrites `postgres://` → `postgresql+psycopg2://`. Supabase and Render hand out the old scheme; SQLAlchemy wants the driver form. |

### 2.2 `app/core/` and `app/db/`

| File | What it does |
|---|---|
| `core/security.py` (139) | `python-jose` HS256 tokens, bcrypt hashing, `get_current_user`. Accepts a Bearer token **or** the `X-Dev-User` header, the latter gated on `not is_production()` — it auto-creates the named user, so in production it would be an unauthenticated account-creation endpoint. |
| `db/session.py` | Read/write and read-only engines, `SessionLocal`, declarative `Base`. Postgres gets `pool_pre_ping` + `pool_recycle=300` because Render and Supabase close idle connections. |
| `db/s3.py` (112) | boto3 wrapper with a `LocalStore` filesystem fallback. **Every operation try/excepts to `./local_data/objects`** — the reason the app runs with no AWS, and the reason a production misconfiguration degrades silently instead of erroring. |

### 2.3 `app/models/models.py` — 16 tables

All rows use a UUID4 `String(36)` id and inherit `TimestampMixin`
(`created_at`, `updated_at`, `deleted_at`). **Soft delete is the rule**: every
query filters `deleted_at IS NULL`, and `deleted_at` is indexed on all tables.

| Table | Notes |
|---|---|
| `users` | `intent` (personal/splits/business) is null until onboarding, which is how the frontend knows to show `/welcome`. |
| `receipts` | Status machine `uploaded → processing → extracted → reviewed \| failed`. Only `extracted` and `reviewed` count toward money. `extraction_method` records `ocr` vs `gemini`. |
| `receipt_line_items` | `user_id` denormalized so scoping never needs a join. |
| `budgets` | Four levels × three periods. Column is `amount`, **not** `monthly_limit` — that name is a lie on weekly and yearly rows. Unique on `(user_id, level, target, period)` so re-saving a scope edits rather than stacking duplicate alerts. |
| `chat_sessions`, `chat_messages` | `tool_trace` and `context` are JSON text. `sql_used` is vestigial from the retired text-to-SQL design. |
| `chat_action_proposals` | The confirmation boundary: chat never mutates directly, it proposes. |
| `insights` | Deterministic observations, deduped on `(user_id, dedupe_key)`. |
| `export_requests`, `reminder_logs` | `period_key` is the dedupe guard that makes cron endpoints safe to re-run. |
| `split_groups`, `split_members`, `receipt_splits`, `split_shares`, `split_item_assignments` | `SplitMember.user_id` is nullable **by design** — that null is the whole "no accounts needed" feature. `share_code` is a bearer capability. |
| `saved_views` | `filters` is JSON text, not a column per filter, because the filter surface is still moving. |

### 2.4 `app/services/` — the business logic (17 modules)

**Extraction**

| Module | Lines | Role |
|---|---|---|
| `extraction_service.py` | 68 | The single entry both upload and retry call. **Gemini always, today** — the OCR path is behind `ocr_engine_enabled`, default off. Gemini is injected as a parameter so the pipeline is testable with no network or API key. |
| `gemini_service.py` | 504 | Vision extraction, question reformulation, chat system prompt, and the function-calling tool declarations (legacy `genai.protos` 0.8.x API). |
| `ocr_service.py` | 50 | RapidOCR wrapper: image bytes → `OcrLine` rows. |
| `ocr_rules.py` | 1066 | The rule engine. Row grouping, price extraction, split-decimal repair, typo-tolerant labels (`Subtptal` → `SUBTOTAL`), locale-aware number parsing, currency detection, multi-row item merging. The largest file in the repo. |
| `ocr_packs.py` | 106 | Per-merchant fingerprints (Costco, Walmart, Kmart, Courtyard, Willow Fork) that took merchant accuracy from 3/6 to 6/6. |

**Chat (Phases 1 and 7)**

| Module | Lines | Role |
|---|---|---|
| `chat_service.py` | 437 | The bounded tool loop: rate-limit → Gemini picks a tool → execute server-side → feed result back → final text. `MAX_ITERATIONS=5`. Mutating tools (`add_budget`, `create_split`) produce a **proposal** the user confirms rather than executing. |
| `chat_tools.py` | 662 | The callable tools. Each owns hand-written parameterized SQL; `user_id` is **never** a tool parameter and is injected server-side, so the model cannot forge it. |
| `categories.py` | 173 | Deterministic alias map ("food" → "dining"). Non-LLM, so it is cheap and testable. |
| `sql_safety.py` | 369 | Phase 7B policy boundary. Parses with `sqlglot`, enforces a column allowlist (excludes `image_key`, `error_message`, `share_code`, member emails, all auth and chat content) and rewrites tables as user-scoped subqueries. **Does not execute anything.** |
| `sql_executor.py` | 128 | Runs SQL that already passed `sql_safety`, on the read-only engine, with a statement timeout. |

**Domain**

| Module | Lines | Role |
|---|---|---|
| `analytics_service.py` | 210 | Shared aggregations — the single source of truth behind both the dashboard and the chat tools. |
| `budget_service.py` | 190 | Period bounds, per-level spend matching (item budgets match **line items**, not whole receipts), threshold crossing. |
| `receipt_query.py` | 136 | Filtering and search. Postgres gets real full-text (`to_tsvector @@ plainto_tsquery` + GIN); SQLite falls back to a genuine `LIKE`. Both paths are exercised because prod is Postgres and every test is SQLite. |
| `split_service.py` | 314 | Cent-accurate allocation (integer cents, remainder distributed), itemized splits with pro-rata tax, greedy debtor/creditor netting into a minimal transfer list. |
| `insight_service.py` | 196 | Deterministic proactive observations — no LLM needed to discover a fact. |
| `reminder_service.py` | 185 | Digests and budget alerts, deduped by `period_key`. **Delivery is log-only**: `_send()` prints. |
| `rate_limiter.py` | 151 | Sliding window. Redis is authoritative when `REDIS_URL` is set (atomic Lua script); otherwise a bounded in-process fallback. Fails **closed** by default when a configured Redis is unreachable, so expensive AI calls don't silently become unlimited. |

### 2.5 `app/api/v1/` — 10 routers, 44 routes

| Router | Lines | Routes |
|---|---|---|
| `auth.py` | 92 | `register`, `login` (OAuth2 form), `logout`, `me`, `set-intent` |
| `receipts.py` | 397 | `upload`, list (filtered), `facets`, `review-queue`, get, `image`, `retry`, `review`, `bulk`, delete |
| `analytics.py` | 25 | `summary` — one call for the whole dashboard, so a cold free-tier backend isn't hit with a request waterfall |
| `budgets.py` | 172 | CRUD; list returns budgets **with evaluated state**, worst offender first |
| `saved_views.py` | 128 | CRUD; filter keys outside an allowlist are dropped |
| `chat.py` | 164 | `POST /`, proposal `confirm`/`cancel`, sessions, messages |
| `splits.py` | 326 | groups, add split, summary, `suggestions`, `net-balances`, public `share/{code}` |
| `insights.py` | 40 | list, dismiss |
| `reminders.py` | 43 | `budget-alerts` + four cron endpoints behind `X-Cron-Secret` |
| `exports.py` | 96 | JSON export (synchronous); also defines `require_cron_secret`, reused by `reminders.py` |
| `split_schemas.py` | 50 | Pydantic models for the split endpoints (not a router) |

### 2.6 `alembic/` — 9 migrations

Chain, oldest first:

| # | Revision | What |
|---|---|---|
| 1 | `ca20712d0dc6` | Baseline schema — autogenerated against an empty scratch DB |
| 2 | `179c4287269e` | `deleted_at` indexes on all tables |
| 3 | `ba0b47dd332c` | `users.intent` |
| 4 | `766645a7e65f` | `receipts.extraction_method` |
| 5 | `c31f8a4b7d92` | Full-text GIN indexes — **Postgres only**, guarded by dialect so SQLite dev and CI still migrate |
| 6 | `d8ceac844fb2` | `saved_views` |
| 7 | `e5b71c9a3f04` | Budget levels and periods; migrates existing category rows to `level=category, period=monthly` |
| 8 | `f42a8c19d501` | Split history and allocation metadata |
| 9 | `6d5cb728f074` | Chat proposals, explanations, insights |

`alembic/env.py` resolves `DATABASE_URL` through the **same**
`normalize_db_url()` the app uses, so migrations and runtime never disagree on a
Supabase DSN. No credentials live in `alembic.ini`.

### 2.7 `tests/` — 290 tests

| File | Tests | Covers |
|---|---|---|
| `test_ocr_rules_rows.py` | 56 | Row reconstruction for the OCR engine |
| `test_chat_tools.py` | 34 | Each tool, including cross-user isolation |
| `test_budgets.py` | 32 | Levels, periods, threshold crossing |
| `test_receipt_query.py` | 23 | Filter combinations and search |
| `test_analytics.py` | 19 | Dashboard aggregations |
| `test_saved_views_and_bulk.py` | 16 | Saved views and bulk actions, over HTTP |
| `test_sql_safety.py` | 14 | Policy rejections and user scoping |
| `test_phase7b_tools.py` | 11 | Schema-aware chat tools |
| `test_rate_limiter.py` | 9 | Redis and memory backends, fail-closed |
| `test_auth_flow.py` | 8 | Auth and onboarding intent |
| `test_sql_executor.py` | 6 | Bounded execution |
| `test_ocr_packs.py`, `test_extraction_gating.py`, `test_phase7b_prompt.py` | 5 each | Packs, gating, prompt |
| `test_splits.py` | 4 | Cent accuracy, tax modes, netting |
| `test_phase7_chat.py` | 3 | Proposal flow |
| `test_migrations.py` | 2 | **Round-trip**: `upgrade head` reproduces the ORM schema (tables, nullability, **and indexes**) and `downgrade base` drops cleanly |

`conftest.py` provides `db_session` (in-memory SQLite), `user`, and `other_user`
— the last exists so isolation is testable, not assumed.

> The index assertion in `test_migrations.py` was added after a columns-only
> comparison passed while every `deleted_at` index was missing. A test that
> cannot fail on the bug it covers is worse than no test.

### 2.8 `backend/scripts/`

| Script | Purpose |
|---|---|
| `dump_corpus.py` | Dumps the receipt corpus for offline measurement |
| `measure_gemini_baseline.py` | Scores Gemini extraction against ground truth |
| `measure_ocr_engine.py` | Scores the OCR engine, per field and per item |

Results live in [`docs/phase2/`](phase2/).

---

## 3. `frontend/` — Next.js 14 App Router

```
frontend/
├── src/
│   ├── app/          10 routes
│   ├── components/   8 component modules
│   ├── lib/api.ts    The only module that calls fetch
│   └── styles/globals.css
├── tests/e2e/        Playwright
├── scripts/guard-dev-server.js
└── config: next.config.js, tailwind.config.ts, tsconfig.json,
            playwright.config.ts, postcss.config.js, .eslintrc.json
```

### 3.1 Routes

| Route | File | Lines | Notes |
|---|---|---|---|
| `/` | `app/page.tsx` | 520 | Dashboard, charts, budget health, filter bar, receipt list, bulk actions. Filter state lives in the **URL**, so a filtered list is shareable and survives reload. |
| `/login` | `app/login/page.tsx` | 104 | `useSearchParams` requires the `Suspense` boundary or `next build` fails the page. `?expired=1` shows a session-timeout message. |
| `/register` | `app/register/page.tsx` | 95 | |
| `/welcome` | `app/welcome/page.tsx` | 91 | Intent picker; three cards, one action each |
| `/budgets` | `app/budgets/page.tsx` | 329 | Budget CRUD with progress bars |
| `/receipts/[id]` | `app/receipts/[id]/page.tsx` | 560 | Receipt detail and review — the largest frontend file |
| `/receipts/[id]/split` | `.../split/page.tsx` | 154 | Split builder |
| `/groups` | `app/groups/page.tsx` | 18 | Groups list and net balances |
| `/groups/[id]` | `app/groups/[id]/page.tsx` | 18 | Group detail, settlements, history |
| `/share/[code]` | `app/share/[code]/page.tsx` | 7 | **Public**, no auth |
| — | `app/layout.tsx` | 16 | Root layout |

> The 7–18 line files are not stubs. They are complete implementations written
> in a very dense single-line style — `/share/[code]/page.tsx` is one 7-line file
> containing a full page. Worth normalizing if these ever need editing under
> time pressure.

### 3.2 Components

| File | Lines | Exports |
|---|---|---|
| `FilterBar.tsx` | 339 | `FilterBar`, `BulkToolbar` |
| `DashboardCards.tsx` | 168 | `DashboardCards`, `BudgetHealth` |
| `SpendCharts.tsx` | 163 | `SpendCharts` — Recharts trend + category donut |
| `AuthCard.tsx` | 98 | `AuthCard`, `Field`, `PrimaryButton`, `ErrorNote`, `TextLink` |
| `BudgetBar.tsx` | 93 | `money`, `LevelBadge`, `BudgetBar` |
| `EmptyState.tsx` | 68 | `EmptyState` — copy branches on the user's `intent` |
| `ChatDrawer.tsx` | 35 | `ChatDrawer` — page-aware assistant with a "How was this answered?" trace and confirm/cancel for proposals |
| `InsightsCard.tsx` | 6 | `InsightsCard` |

### 3.3 `src/lib/api.ts` (439 lines)

The **only** module that calls `fetch`. Holds the typed client for every
endpoint, the token helpers (`getToken`/`setToken`/`clearToken`/`isAuthed`), and
`ApiError`. A 401 clears the stored token so the next render routes to login — a
dead token is worse than none.

### 3.4 Frontend tooling

| File | Purpose |
|---|---|
| `scripts/guard-dev-server.js` | Runs as `prebuild`. **Refuses `next build` while a dev server is running**, because both write the same `.next` and the build swaps chunks out from under the live server — it dies with `Cannot find module './819.js'`, which looks like a code bug and isn't. No-op in CI; `ALLOW_BUILD_WITH_DEV=1` overrides. |
| `tests/e2e/auth.spec.ts` | Playwright auth journey, run in CI against Chromium |
| `next.config.js` | `output: "standalone"` for the Docker path |
| `Dockerfile` / `.dockerignore` | Standalone build. **Never actually built** — CI runs `next build`, not `docker build`. |

---

## 4. CI and operations

| Workflow | Triggers | Steps |
|---|---|---|
| `backend-ci.yml` | `backend/**` | `black --check`, `isort --check-only`, `ruff` (E4,E7,E9,F), `mypy` on `rate_limiter.py` only, import smoke test, `pytest -q` |
| `frontend-ci.yml` | `frontend/**` | `npm ci`, lint, typecheck, build, Playwright Chromium |
| `reminders-cron.yml` | schedule | POSTs the cron endpoints with `X-Cron-Secret` |

Two deliberate choices worth knowing:

- **`pytest -q` has no `|| true`.** It previously ended in
  `|| echo "no tests yet"`, which let the job go green while tests failed.
- **mypy is ratcheted, not global.** Only `rate_limiter.py` is checked; the
  SQLAlchemy 1.x-style declarative models need a typed-mapping migration first.
  Widening the path is a real task, not a config flip.

---

## 5. Where the bodies are buried

Things that are true, non-obvious, and will cost you time if rediscovered.
Full list in [ARCHITECTURE.md §9](ARCHITECTURE.md#9-known-gaps--upgrade-paths).

1. **The OCR engine is shipped but off.** `ocr_engine_enabled=False`. It reaches
   ~72% field accuracy on the 6-receipt corpus — good enough for a second
   opinion, not as a sole extractor. Line items (2/6) are the blocker.
2. **S3 failures are swallowed.** A misconfigured bucket looks *identical* to
   success until files vanish on redeploy. A 201 upload does not prove storage
   worked; check the bucket.
3. **`extra="ignore"` on Settings** means a renamed env var is silently dropped,
   not an error.
4. **Reminders don't send anything.** `_send()` prints.
5. **Email alerts (Phase 4.4.5) are not built** — blocked on Phase 6 email infra.
6. **Use `localhost`, not `127.0.0.1`, in `NEXT_PUBLIC_API_URL`.** Browsers treat
   them as different hosts.
7. **Never `next build` with a dev server running.** The guard script now
   prevents it.
8. **Gemini free tier is ~20 requests/day** and one chat message costs 2+.

---

## 6. Reading order for a newcomer

1. `README.md`, then [ARCHITECTURE.md §1–2](ARCHITECTURE.md)
2. `backend/app/models/models.py` — the data model is the shape of the product
3. `backend/app/main.py` → `app/api/v1/receipts.py` — follow one upload end to end
4. `backend/app/services/chat_service.py` + `chat_tools.py` — the most
   security-sensitive path
5. `frontend/src/lib/api.ts` → `frontend/src/app/page.tsx`
6. `backend/tests/conftest.py` + any `test_*.py` — the tests document intent
