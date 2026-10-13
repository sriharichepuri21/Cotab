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
→ `{"access_token": "...", "token_type": "bearer"}`
`409` if the email exists.

### `POST /auth/login` — *no auth*
OAuth2 password form (`application/x-www-form-urlencoded`), **not JSON**. The
username field takes the email.
```bash
curl -X POST http://127.0.0.1:8000/api/v1/auth/login \
  -d "username=a@b.com&password=secret"
```
→ same token response. `401` on bad credentials. `429` (with `Retry-After`)
after `RATE_LIMIT_LOGIN_PER_15MIN` attempts (default 10) for one email address
in 15 minutes, counted case-insensitively.

### `GET /auth/me`
→ `{id, email, full_name, timezone, telegram_chat_id}`

### `POST /auth/delete-account`
```json
{"password": "current password"}
```
→ `{"ok": true}`. `403` if the password is wrong. Soft-deletes the user and
everything they own, revokes their public share links, scrubs the email and
name immediately, and clears the session cookie. The email can be registered
again afterwards.

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
Filtered, searchable list. Every parameter is optional and they AND together;
with none supplied this is the plain newest-first list.

| Param | Notes |
|---|---|
| `q` | Searches merchant names **and line-item descriptions** |
| `category` | Exact, lower-cased |
| `merchant` | Case-insensitive substring |
| `status` | `uploaded`/`processing`/`extracted`/`reviewed`/`failed` |
| `start_date`, `end_date` | `YYYY-MM-DD`; **`end_date` is inclusive** |
| `min_amount`, `max_amount` | |
| `sort` | `date` (default), `amount`, `merchant`, `created` |
| `order` | `desc` (default), `asc` |
| `limit`, `offset` | limit 1–500, default 100 |

```bash
curl "$API/api/v1/receipts/?q=paper+towels&category=groceries&sort=amount&order=asc" \
  -H "Authorization: Bearer $TOKEN"
```

> Search matching line items is the point — "did I buy paper towels" finds the
> Costco receipt even though no merchant is called that.

### `GET /receipts/facets`
Distinct `categories`, `merchants` and `statuses` present in **your** receipts,
for populating filter dropdowns with values that can actually return rows.

### `POST /receipts/bulk`
```json
{"receipt_ids": ["...", "..."], "action": "categorize", "category": "dining"}
```
`action` is `categorize` or `delete` (soft). Returns
`{"requested": 2, "updated": 2}` — ids you don't own are silently skipped rather
than erroring, so the count is how you learn some were dropped. `422` on an
unknown category.

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

## Analytics — `/api/v1/analytics`

### `GET /analytics/summary?trend_months=6`
Everything the dashboard needs in one call — one endpoint rather than five so a
cold free-tier backend isn't hit with a request waterfall.

```json
{
  "this_month": {"start_date": "...", "end_date": "...", "receipt_count": 3,
                 "total_spent": 296.59, "currency": "USD"},
  "top_category": {"name": "dining", "amount": 171.03, "count": 2},
  "top_merchant": {"name": "Blue Bottle Coffee", "amount": 171.03, "count": 2},
  "categories": [...], "merchants": [...],
  "monthly_trend": [{"month": "2026-03", "amount": 430.1}],
  "budget_health": [{"category": "dining", "limit": 80, "spent": 171.03,
                     "percent_used": 213.8, "over_budget": true}],
  "budget_alerts": [ /* same shape as GET /budgets/, only those past a threshold */ ],
  "pending_review": 19
}
```

Only `extracted` and `reviewed` receipts count toward money. `trend_months` is
1–24 (`422` outside that). `top_category`/`top_merchant` are `null` on an account
with no spend this month.

---

## Budgets — `/api/v1/budgets`

### `GET /budgets/`
Every budget **with its evaluated state**, worst offender first — a budget
without its progress isn't useful to render, so the page needs one request.

```json
[{"budget_id": "...", "label": "dining", "level": "category", "target": "dining",
  "period": "monthly", "limit": 50.0, "spent": 55.0, "remaining": -5.0,
  "percent_used": 110.0, "over_budget": true,
  "period_start": "2026-08-01", "period_end": "2026-08-31",
  "thresholds": [80, 100, 120], "threshold_reached": 100}]
```

### `POST /budgets/`
```json
{"level": "item", "target": "coffee", "period": "weekly", "amount": 25}
```

| `level` | `target` | Counts |
|---|---|---|
| `total` | ignored | all spend in the period |
| `category` | a category (aliases accepted: `food` → `dining`) | that category |
| `merchant` | substring | merchants containing it |
| `item` | substring | **matching line items only**, not whole receipts |

`period` is `weekly` / `monthly` / `yearly`. Upserts on
(level, target, period) — re-saving a scope edits it rather than creating a
duplicate that fires its own alerts. `422` on an unknown category, a missing
target for a non-total level, or a non-positive amount.

### `PATCH /budgets/{id}` · `DELETE /budgets/{id}`
Delete is soft. `404` if it isn't yours.

> `POST /receipts/upload` returns `budget_alerts` alongside the receipt: the
> budgets whose threshold band *rose because of that upload*. Already-breached
> budgets stay silent, so the toast means something.

---

## Saved views — `/api/v1/saved-views`

A named filter combination for the receipts list.

### `GET /saved-views/`
### `POST /saved-views/`
```json
{"name": "Coffee this month", "filters": {"q": "coffee", "category": "dining"}}
```
Keys outside the filter allowlist are dropped, as are empty values. Saving an
existing **name overwrites** it rather than creating a duplicate. `201`.

### `DELETE /saved-views/{id}`
Soft delete. `404` if it isn't yours.

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
{"name": "Trip", "my_name": "Ada", "members": [
  {"name": "Bob", "email": "bob@example.com"}, {"name": "Cleo"}
]}
```
→ `{id, name, share_code, share_url, members}`. `my_name` is linked to your user.

### `GET /splits/groups`

### `POST /splits/groups/{group_id}/splits`
```json
{"receipt_id": "...", "paid_by": "Ada", "mode": "even",
 "tax_mode": "pro_rata"}
```
`mode: "itemized"` additionally requires `assignments` — a map of member name →
list of line-item ids. The same item can belong to multiple people. `tax_mode`
is `pro_rata`, `even`, or `payer` and reconciles tax, tip, discount and rounding.

→ `{"split_id": "...", "shares": {"Bob": 29.14, "Cleo": 29.14}}`

### `GET /splits/groups/{group_id}/summary`
Per-split detail plus `suggested_settlements` — a **minimal** transfer list from
greedy debtor/creditor netting, not everyone-pays-everyone.

### `GET /splits/suggestions/{receipt_id}`
Prior contacts, same-merchant people/item patterns, confidence, and the
three-example automatic-application flag.

### `GET /splits/net-balances`
Owner-relative balances merged across all owned groups by email/name.

### `GET /splits/share/{share_code}` — *no auth*
Public read-only view of a group. The share code is a bearer capability: anyone
holding it can read the group. Contact emails are removed from this response.

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
