# ReceiptWise — Deployment

Target shape: **Render** (API) + **Vercel** (frontend) + **Supabase** (Postgres +
S3-compatible storage) + **GitHub Actions** (cron). All have usable free tiers.

> **Nothing here has been deployed yet.** `render.yaml` and the Dockerfiles are
> written but unexercised. Treat this as a plan, not a runbook that's been walked.

---

## Before you start

Have these ready — the API **refuses to boot** in production without the first three:

```bash
openssl rand -base64 48    # SECRET_KEY
openssl rand -base64 32    # CRON_SECRET
```

- A Postgres `DATABASE_URL`
- A Gemini API key with **billing enabled** (free tier is ~20 req/day; one chat
  message costs 2+ calls)

`Settings.validate_production()` hard-fails at startup on a placeholder
`SECRET_KEY`, a missing `GEMINI_API_KEY`, or a SQLite `DATABASE_URL`. That's
deliberate — a silent misconfiguration is worse than a failed deploy.

---

## 1. Database + storage (Supabase)

Full walkthrough in [SUPABASE_S3.md](SUPABASE_S3.md). Summary:

1. New project → save the DB password.
2. Storage → new **private** bucket `receiptwise-uploads`.
3. Project Settings → Storage → S3 → generate an access key pair.
4. Project Settings → Database → connection string (URI).

No SQL to run: the app calls `create_all()` at startup.

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
| `GEMINI_MODEL` | `gemini-3.5-flash` |
| `CRON_SECRET` | auto-generated |
| `CORS_ORIGINS` | `https://your-app.vercel.app` |
| `S3_ENDPOINT_URL` | Supabase S3 endpoint (`""` for real AWS) |
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

> ⚠️ **The frontend is not usable in production as shipped.** There is no login
> UI, and the `X-Dev-User` header it relies on is rejected when
> `ENVIRONMENT=production`. Every authenticated call will 401 until a real auth
> flow is built. Deploy it to verify the pipeline, not to hand to users.

---

## 4. Reminder cron

[`reminders-cron.yml`](../.github/workflows/reminders-cron.yml) hits the cron
endpoints on schedule. It needs **one repo variable and one repo secret** —
note they are different things in GitHub's UI:

- Settings → Secrets and variables → Actions → **Variables** → `API_URL` =
  `https://your-api.onrender.com`
- Settings → Secrets and variables → Actions → **Secrets** → `CRON_SECRET` =
  the value Render generated

**This workflow currently fails on every scheduled run** — both are unset, so
`curl` receives an empty URL and exits 3 (`URL rejected: No host part in the URL`).
It will keep failing until the API is live and both values are configured. That's
expected, not a regression.

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

```bash
curl https://your-api.onrender.com/health
```

- [ ] `/health` returns 200
- [ ] Startup logs show no `validate_production` failure
- [ ] `POST /api/v1/auth/register` issues a token
- [ ] Frontend loads and points at the right API
- [ ] Upload a receipt; confirm the object actually lands in Supabase Storage —
      **not** the silent local-disk fallback (see
      [ARCHITECTURE §7](ARCHITECTURE.md#7-storage)); on Render's ephemeral disk
      those files vanish on redeploy
- [ ] Manually dispatch **Reminder crons**; expect 200s

---

## Operational notes

**Rate limiting is per-process and in-memory.** `_chat_windows` resets on every
restart and isn't shared between instances, so the real limit is
`RATE_LIMIT_CHAT_PER_HOUR × instance_count`. Redis is already a dependency but
unused — that's the fix if this matters.

**There are no migrations.** `create_all()` creates missing tables but never
alters existing ones. Any column change on a live database has to be applied by
hand until Alembic is wired up. Plan the first schema change carefully.

**Reminders don't send anything.** `reminder_service._send()` prints to stdout.
Wire a real channel before promising users notifications.

**Watch Gemini spend.** Extraction is one vision call per upload; each chat
message is 2+ calls (one per tool round trip, capped at 5 iterations).
