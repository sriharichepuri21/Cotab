# ReceiptWise — Deployment

Target shape: **Render** (API) + **Vercel** (frontend) + **Supabase** (Postgres +
S3-compatible storage) + **GitHub Actions** (cron). All have usable free tiers.

**Status: API and frontend are both deployed and verified end-to-end.**
- API — https://receiptwise.onrender.com (Render free tier + Supabase Postgres +
  Supabase Storage). Migrations apply at boot, the production auth guard is
  confirmed firing, and uploaded objects were manually confirmed in the bucket.
- Frontend — https://receiptwise-eight.vercel.app (Vercel). Auth verified in a
  clean incognito session: register → onboarding intent → upload → chat →
  logout → re-login.

> The live service was configured **by hand in the Render dashboard**, not from
> `render.yaml`. This file is kept accurate so the service is reproducible, but
> it is not currently the source of truth — if you change one, change the other.

> **Auth is Bearer-primary.** The frontend authenticates with a Bearer token in
> `sessionStorage`, not a cross-site cookie — browsers (esp. Incognito) block
> third-party cookies on send even when they store them. See
> [ARCHITECTURE.md §6](ARCHITECTURE.md#6-auth) for the full post-mortem.

## Gotchas already hit — don't rediscover these

| Symptom | Cause | Fix |
|---|---|---|
| Build fails compiling `pydantic-core` | Render defaults to Python 3.14; no wheel yet | Set `PYTHON_VERSION=3.13.1` |
| App can't reach Postgres; connection times out | Supabase's direct host `db.<ref>.supabase.co:5432` is **IPv6-only**; Render free tier is IPv4-only | Use the **transaction pooler** URI: `aws-0-<region>.pooler.supabase.com:6543` |

---

## Before you start

Have these ready — the API **refuses to boot** in production without them:

```bash
openssl rand -base64 48    # SECRET_KEY
openssl rand -base64 32    # CRON_SECRET
```

- A Postgres `DATABASE_URL`
- A Gemini API key with **billing enabled** (free tier is ~20 req/day; one chat
  message costs 2+ calls)

`Settings.validate_production()` hard-fails at startup on a placeholder
`SECRET_KEY`, a missing or placeholder `CRON_SECRET`, a missing
`GEMINI_API_KEY`, or a SQLite `DATABASE_URL`. That's
deliberate — a silent misconfiguration is worse than a failed deploy.

---

## 1. Database + storage (Supabase)

Full walkthrough in [SUPABASE_S3.md](SUPABASE_S3.md). Summary:

1. New project → save the DB password.
2. Storage → new **private** bucket `receiptwise-uploads`.
3. Project Settings → Storage → S3 → generate an access key pair.
4. Project Settings → Database → connection string (URI).

No SQL to run by hand: migrations are managed by Alembic, and Render applies them
automatically at boot (see below). For a brand-new database, `alembic upgrade head`
builds the full schema.

Supabase hands out `postgres://` URIs; `utils/db_url.py` rewrites them to
`postgresql+psycopg2://` automatically, so paste it as-is.

---

## 2. API (Render)

[`render.yaml`](../render.yaml) is a blueprint — point Render at the repo and it
picks it up. `SECRET_KEY` and `CRON_SECRET` use `generateValue: true`; everything
marked `sync: false` must be set by hand in the dashboard.

| Var | Value |
|---|---|
| `ENVIRONMENT` | `production` |
| `DEBUG` | `false` |
| `DATABASE_URL` | Supabase URI |
| `SECRET_KEY` | auto-generated |
| `GEMINI_API_KEY` | your key |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` |
| `GEMINI_UPGRADE_MODEL` | `gemini-3.8-flash` |
| `AI_USER_DAILY_BUDGET_USD` / `AI_DAILY_BUDGET_USD` | `0.25` / `3.00` |
| `CRON_SECRET` | auto-generated |
| `CORS_ORIGINS` | `https://your-app.vercel.app` |
| `S3_ENDPOINT_URL` | **must be set** — Supabase S3 endpoint, or `""` for real AWS |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Supabase S3 keys |
| `S3_BUCKET` | `receiptwise-uploads` |

Health check is `/health`.

> **`CORS_ORIGINS` is exact-match, no wildcards.** Vercel preview deployments get
> unique URLs and will be blocked unless you add them.

> **Render's free tier sleeps after inactivity.** First request after a sleep
> takes tens of seconds — and receipt upload already blocks on a Gemini call.

---

## 3. Frontend (Vercel)

Root directory `frontend`. Set:

```
NEXT_PUBLIC_API_URL = https://your-api.onrender.com
```

`NEXT_PUBLIC_*` is **inlined at build time**, not read at runtime — changing it
requires a rebuild, not just a restart.

`next.config.js` sets `output: "standalone"`, which Vercel ignores harmlessly;
it exists for the Docker path.

> **CORS note.** `CORS_ORIGINS` on the API must include the exact Vercel origin
> (e.g. `https://receiptwise-eight.vercel.app`) — exact match, no wildcard, no
> trailing slash — alongside `http://localhost:3000` if you want local dev to hit
> the prod backend. Vercel *preview* deploys get other URLs and will be blocked.
>
> Vercel's bot mitigation (`x-vercel-mitigated: challenge`) can answer scripted
> `curl` polls with a 403 "Security Checkpoint" during a redeploy. Real browsers
> pass it; don't mistake it for a failed deploy — check the Deployments tab or
> load the URL in a browser.

---

## 4. Reminder cron

[`reminders-cron.yml`](../.github/workflows/reminders-cron.yml) hits the cron
endpoints on schedule. It needs **one repo variable and one repo secret** —
note they are different things in GitHub's UI:

- Settings → Secrets and variables → Actions → **Variables** → `API_URL` =
  `https://your-api.onrender.com`
- Settings → Secrets and variables → Actions → **Secrets** → `CRON_SECRET` =
  the value Render generated

The workflow validates both values before making a request, so a missing setting
now produces a named Actions error instead of a cryptic curl failure. Configure
both values, then use **Run workflow**; all four requests must return 2xx.

Verify with **Actions → Reminder crons → Run workflow** (the manual dispatch runs
all three jobs).

Schedules (UTC): daily `0 8 * * *`, weekly `0 19 * * 0`, monthly `0 9 1 * *`.
Safe to re-run — `ReminderLog.period_key` dedupes.

---

## Docker (alternative)

Both apps have Dockerfiles. The frontend one uses Next's `standalone` output and
**has never actually been built** — CI runs `next build`, not `docker build`.
Verify before relying on it:

```bash
docker build -t receiptwise-frontend ./frontend
```

`docker-compose.dev.yml` runs the whole stack locally but is likewise unverified
end-to-end.

---

## Post-deploy checklist

Run the smoke test — it covers everything below except the storage check:

```bash
./scripts/smoke.sh https://your-api.onrender.com path/to/receipt.webp
```

> **You cannot smoke-test a deployment with `X-Dev-User`.** It is refused when
> `ENVIRONMENT=production` (that's the point of it). Use real auth instead —
> `POST /api/v1/auth/register` returns a JWT, and the script does this for you.
> Setting `ENVIRONMENT` to something else to make the header work would skip
> `validate_production()` *and* expose unauthenticated account creation on a
> public URL. Don't.

- [ ] `/health` returns 200
- [ ] Startup logs show `alembic upgrade head` ran, no `validate_production` failure
- [ ] `POST /api/v1/auth/register` issues a token
- [ ] `X-Dev-User` is rejected with 401
- [ ] Upload returns 201 with `status: "extracted"` (proves Gemini is reachable
      and billed)
- [ ] **Manually confirm the object exists in your bucket.** A 201 does *not*
      prove this — `db/s3.py` swallows storage errors and writes to local disk,
      so a misconfigured bucket looks identical to success until the files
      vanish on Render's ephemeral disk at next deploy. See
      [ARCHITECTURE §7](ARCHITECTURE.md#7-storage).
- [ ] Manually dispatch **Reminder crons**; expect 200s

---

## Operational notes

**Rate limiting uses Redis when `REDIS_URL` is set.** Chat and schema-aware SQL
consume separate atomic sliding-window keys shared across API instances. With a
configured but unavailable Redis, expensive requests fail closed with a generic
503/tool error. With no URL, the app uses a process-local development fallback;
do not horizontally scale or onboard real users in that state.

**Migrations run at boot.** Render's `startCommand` runs `alembic upgrade head`
before `uvicorn`. A failed migration fails the deploy loudly rather than serving
against a drifted schema. To evolve the schema, add a revision
(`alembic revision --autogenerate -m "..."`, review it, commit) — never
`create_all()` or hand-SQL on the live DB.

**Reminders don't send anything.** `reminder_service._send()` prints to stdout.
Wire a real channel before promising users notifications.

### Error tracking

Create Sentry Python and Next.js projects. Set `SENTRY_DSN` on the API; on
Vercel set `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, and
`NEXT_PUBLIC_APP_ENV=production`. Create alerts for new issues, error-count
spikes, and p95 transaction/page-load duration. Both runtimes capture unhandled
errors and sample 10% of transactions. The API refuses to boot without its DSN,
preventing an accidentally unmonitored release. PII capture stays disabled.

### Backups and restore drill

In Supabase, confirm **Database → Backups** shows scheduled backups for the
production project and record the retention shown by the current plan. Platform
backup availability cannot be proven from this repository.

Create a disposable empty Postgres database (never use production as the
target), then run this before launch and quarterly:

```bash
./scripts/verify-database-restore.sh "$PRODUCTION_DATABASE_URL" "$DISPOSABLE_DATABASE_URL"
```

The script creates and validates a consistent archive, restores with
`--exit-on-error`, and verifies public tables plus the Alembic revision. Delete
the disposable database after recording the date and output in the ops log.

### Staging

Deploy `render-staging.yaml` as a separate Blueprint connected to a dedicated
Supabase project and bucket. Never point staging at production data. Run
migrations and `scripts/smoke.sh` there before promoting the same commit. Staging
has its own Redis and uses the same fail-fast storage checks as production.

**Watch Gemini spend.** Extraction is one vision call per upload; each chat
message is 2+ calls (one per tool round trip, capped at 5 iterations).
