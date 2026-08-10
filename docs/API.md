# ReceiptWise — API Reference

Base path: `/api/v1`. Interactive docs when running: **http://localhost:8000/docs**
(Swagger) or `/redoc`. The OpenAPI spec at `/openapi.json` is generated from the
code and is always authoritative if this file drifts.

## Authentication

Two mechanisms:

**JWT bearer** (the real one) — `Authorization: Bearer <access_token>` from
`/auth/register` or `/auth/login`.

**`X-Dev-User` header** (local only) — `X-Dev-User: dev@local` authenticates as
that email and **creates the user if absent**. Refused when `ENVIRONMENT=production`.

```bash
curl http://127.0.0.1:8000/api/v1/receipts/ -H "X-Dev-User: dev@local"
```

Every endpoint below requires auth unless marked otherwise.

---

## Health

### `GET /health` — *no auth*
```json
{"status": "healthy", "version": "0.1.0", "app": "ReceiptWise API"}
```

---

## Auth — `/api/v1/auth`

### `POST /auth/register` — *no auth*
```json
{"email": "a@b.com", "password": "secret", "full_name": "Ada"}
```
→ `{"access_token": "...", "refresh_token": "...", "token_type": "bearer"}`
`409` if the email exists.

### `POST /auth/login` — *no auth*
OAuth2 password form (`application/x-www-form-urlencoded`), **not JSON**. The
username field takes the email.
```bash
curl -X POST http://127.0.0.1:8000/api/v1/auth/login \
  -d "username=a@b.com&password=secret"
```
→ same token pair. `401` on bad credentials.

### `GET /auth/me`
→ `{id, email, full_name, timezone, telegram_chat_id}`

---

## Receipts — `/api/v1/receipts`

### `POST /receipts/upload`
`multipart/form-data`, field name `file`. Must be `image/*` and ≤5MB. The client
compresses to roughly ~1MB first (upload speed + enough detail for the vision
call); the server only rejects over the 5MB ceiling — never at the client target.

```bash
curl -X POST http://127.0.0.1:8000/api/v1/receipts/upload \
  -H "X-Dev-User: dev@local" -F "file=@receipt.webp"
```

Runs Gemini extraction **synchronously**, so it takes as long as the model does.
Returns `201` with the full receipt including `line_items`.

| Code | Meaning |
|---|---|
| `415` | Not an image |
| `413` | Over `MAX_UPLOAD_BYTES` |

### `GET /receipts/`
All non-deleted receipts, newest first.

### `GET /receipts/review-queue`
Receipts awaiting human confirmation — low confidence or `status="extracted"`.

### `GET /receipts/{receipt_id}`
Single receipt. `404` if missing or not yours.

### `POST /receipts/{receipt_id}/review`
Human corrections after extraction. All fields optional; supplying `line_items`
**replaces** the existing set. Sets `status="reviewed"`.
```json
{
  "merchant": "Trader Joe's",
  "total": 87.43,
  "category": "groceries",
  "line_items": [{"description": "Bananas", "quantity": 1, "unit_price": 2.99, "total_price": 2.99}]
}
```

### `DELETE /receipts/{receipt_id}`
**Soft** delete — sets `deleted_at`. Purges after `SOFT_DELETE_GRACE_DAYS`.

---

## Chat — `/api/v1/chat`

### `POST /chat/`
```json
{"message": "How much did I spend on groceries this month?", "session_id": null}
```
Omit or null `session_id` to start a session; pass the returned one to continue.

```json
{
  "session_id": "11138cae-...",
  "message": "You've spent $211.53 on groceries so far this month, based on 2 receipts.",
  "sql": null
}
```

> `sql` is **always `null`**. It's a leftover from the old text-to-SQL design,
> kept so clients don't break. Don't build anything on it.

`429` when the per-user hourly limit is exceeded. Note that upstream *Gemini*
quota exhaustion is **not** a 429 — it returns `200` with an explanatory message
in the body ("I've hit my AI usage limit for now…"). See
[ARCHITECTURE §5.2](ARCHITECTURE.md#52-chat--the-tool-calling-loop).

### `GET /chat/sessions`
### `GET /chat/sessions/{session_id}/messages`
Full transcript, oldest first. `404` if not yours.

---

## Splits — `/api/v1/splits`

Members are **names, not accounts**.

### `POST /splits/groups`
```json
{"name": "Trip", "my_name": "Ada", "members": ["Bob", "Cleo"]}
```
→ `{id, name, share_code, share_url, members}`. `my_name` is linked to your user.

### `GET /splits/groups`

### `POST /splits/groups/{group_id}/splits`
```json
{"receipt_id": "...", "paid_by": "Ada", "mode": "even"}
```
`mode: "itemized"` additionally requires `assignments` — a map of member name →
list of line-item ids. Tax is apportioned pro-rata by each person's subtotal.

→ `{"split_id": "...", "shares": {"Bob": 29.14, "Cleo": 29.14}}`

### `GET /splits/groups/{group_id}/summary`
Per-split detail plus `suggested_settlements` — a **minimal** transfer list from
greedy debtor/creditor netting, not everyone-pays-everyone.

### `GET /splits/share/{share_code}` — *no auth*
Public read-only view of a group. The share code is a bearer capability: anyone
holding it can read the group.

---

## Reminders — `/api/v1/reminders`

### `POST /reminders/budget-alerts`
Evaluates your budgets now; returns triggered alerts.

### Cron endpoints — *`X-Cron-Secret` instead of user auth*

- `POST /reminders/cron/daily-digest`
- `POST /reminders/cron/weekly-digest`
- `POST /reminders/cron/monthly-report`

```bash
curl -X POST http://127.0.0.1:8000/api/v1/reminders/cron/weekly-digest \
  -H "X-Cron-Secret: $CRON_SECRET"
```

Idempotent per period via `ReminderLog.period_key`, so re-running is safe.
Delivery is **log-only** right now — nothing is actually sent.

---

## Exports — `/api/v1/exports`

### `POST /exports/`
Builds a full JSON export **synchronously** in-request.
→ `{id, status, download_url, expires_at}`

### `GET /exports/`
Past export requests.
