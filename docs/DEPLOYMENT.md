# ReceiptWise — Deployment

Target shape: **Render** (API) + **Vercel** (frontend) + **Supabase** (Postgres +
S3-compatible storage) + **GitHub Actions** (cron). All have usable free tiers.

**Status: the API is deployed and verified** — https://receiptwise.onrender.com
(Render free tier + Supabase Postgres + Supabase Storage). Migrations apply at
boot, the production auth guard is confirmed firing, and uploaded objects were
manually confirmed present in the bucket.

> The live service was configured **by hand in the Render dashboard**, not from
> `render.yaml`. This file is kept accurate so the service is reproducible, but
> it is not currently the source of truth — if you change one, change the other.
> The frontend is **not** deployed (no login UI yet; see §3).

## Gotchas already hit — don't rediscover these

| Symptom | Cause | Fix |
|---|---|---|
| Build fails compiling `pydantic-core` | Render defaults to Python 3.14; no wheel yet | Set `PYTHON_VERSION=3.13.1` |
| App can't reach Postgres; connection times out | Supabase's direct host `db.<ref>.supabase.co:5432` is **IPv6-only**; Render free tier is IPv4-only | Use the **transaction pooler** URI: `aws-0-<region>.pooler.supabase.com:6543` |

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
| `GEMINI_MODEL` | `gemini-3.5-flash` |
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

**Rate limiting is per-process and in-memory.** `_chat_windows` resets on every
restart and isn't shared between instances, so the real limit is
`RATE_LIMIT_CHAT_PER_HOUR × instance_count`. Redis is already a dependency but
unused — that's the fix if this matters.

**Migrations run at boot.** Render's `startCommand` runs `alembic upgrade head`
before `uvicorn`. A failed migration fails the deploy loudly rather than serving
against a drifted schema. To evolve the schema, add a revision
(`alembic revision --autogenerate -m "..."`, review it, commit) — never
`create_all()` or hand-SQL on the live DB.

**Reminders don't send anything.** `reminder_service._send()` prints to stdout.
Wire a real channel before promising users notifications.

**Watch Gemini spend.** Extraction is one vision call per upload; each chat
message is 2+ calls (one per tool round trip, capped at 5 iterations).
