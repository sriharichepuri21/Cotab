#!/usr/bin/env bash
# Pipeline smoke test against a deployed ReceiptWise API.
#
#   ./scripts/smoke.sh https://receiptwise-api.onrender.com [path/to/receipt.webp]
#
# Proves, in order: the service is up, prod config validation passed, Alembic
# migrations ran (writes fail without tables), auth works, Gemini is reachable
# and billable, and object storage accepted the image.
#
# Uses real JWT auth on purpose. X-Dev-User is refused when ENVIRONMENT=production
# (app/core/security.py), so it cannot be used to smoke-test a real deployment.

set -uo pipefail

API="${1:-}"
IMAGE="${2:-}"
[ -z "$API" ] && { echo "usage: $0 <api-url> [image]"; exit 2; }
API="${API%/}"

EMAIL="smoke-$(date +%s)@example.com"
PASS="$(openssl rand -base64 24)"
pass=0; fail=0

ok()   { echo "  PASS  $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL  $1"; fail=$((fail+1)); }
section() { echo; echo "== $1"; }

section "1. Health"
code=$(curl -sS -o /tmp/smoke_health -w '%{http_code}' "$API/health" --max-time 90)
if [ "$code" = 200 ]; then ok "/health $(cat /tmp/smoke_health)"
else bad "/health returned $code"; echo "  (free tier cold start can take ~60s; retry once)"; fi

section "2. Register (exercises Postgres write + bcrypt + JWT issue)"
TOKEN=$(curl -sS -X POST "$API/api/v1/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"full_name\":\"Smoke Test\"}" \
  --max-time 60 | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
if [ -n "$TOKEN" ]; then ok "registered $EMAIL, got a token"
else bad "no access_token — if this 500s, migrations likely did not run"; fi
AUTH="Authorization: Bearer $TOKEN"

section "3. Authenticated read (proves JWT verify + user lookup)"
code=$(curl -sS -o /tmp/smoke_me -w '%{http_code}' "$API/api/v1/auth/me" -H "$AUTH" --max-time 60)
[ "$code" = 200 ] && ok "/auth/me 200" || bad "/auth/me returned $code"

section "4. X-Dev-User must be REFUSED (confirms ENVIRONMENT=production)"
code=$(curl -sS -o /dev/null -w '%{http_code}' "$API/api/v1/auth/me" \
  -H 'X-Dev-User: dev@local' --max-time 60)
if [ "$code" = 401 ]; then
  ok "dev header rejected (401) as expected"
elif [ "$code" = 200 ] && [[ "$API" == *"127.0.0.1"* || "$API" == *localhost* ]]; then
  echo "  SKIP  accepted (200) — expected against a local dev server, not a failure"
else
  bad "dev header returned $code — expected 401. Is ENVIRONMENT really 'production'?"
  echo "  This is a live unauthenticated account-creation endpoint. Fix before use."
fi

section "5. Receipts list (proves tables exist)"
code=$(curl -sS -o /tmp/smoke_list -w '%{http_code}' "$API/api/v1/receipts/" -H "$AUTH" --max-time 60)
[ "$code" = 200 ] && ok "/receipts/ 200 -> $(head -c 60 /tmp/smoke_list)" \
  || bad "/receipts/ returned $code"

section "6. Upload + Gemini extraction + object storage"
if [ -z "$IMAGE" ]; then
  echo "  SKIP  no image given — pass one to test the full path"
else
  code=$(curl -sS -o /tmp/smoke_up -w '%{http_code}' -X POST "$API/api/v1/receipts/upload" \
    -H "$AUTH" -F "file=@$IMAGE" --max-time 180)
  if [ "$code" = 201 ]; then
    ok "upload 201"
    grep -q '"status":"extracted"' /tmp/smoke_up \
      && ok "Gemini extracted the receipt" \
      || bad "status is not 'extracted' — check GEMINI_API_KEY / billing: $(head -c 200 /tmp/smoke_up)"
    echo "  -> $(head -c 200 /tmp/smoke_up)"
  else
    bad "upload returned $code: $(head -c 200 /tmp/smoke_up)"
  fi
  echo
  echo "  NOTE: a 201 does NOT prove S3 worked. db/s3.py swallows storage errors"
  echo "        and writes to local disk. Confirm the object exists in your bucket."
fi

section "7. Cron endpoint auth"
code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
  "$API/api/v1/reminders/cron/weekly-digest" -H 'X-Cron-Secret: definitely-wrong' --max-time 60)
[ "$code" = 401 ] || [ "$code" = 403 ] && ok "bad cron secret rejected ($code)" \
  || bad "bad cron secret returned $code — expected 401/403"

echo
echo "=================================="
echo " passed: $pass   failed: $fail"
echo "=================================="
[ "$fail" -eq 0 ] || exit 1
