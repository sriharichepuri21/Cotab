# Cotab V2 UI parity release gate

**Audit date:** 2026-10-25  
**Decision:** **Do not replace the production UI yet.** The V2 demo is a strong visual direction, but it is not feature- or rule-complete.

This document is the release contract for shipping the new interface. It compares the production application, backend rules, and tests with the `/mobile-demo` prototype. A polished screen is not considered parity unless it uses the real API, preserves permissions and edge cases, and has proof.

## Status language

| Status | Meaning |
|---|---|
| **Missing** | No usable V2 flow exists. |
| **Represented** | The V2 demonstrates the idea with local/mock state only. |
| **Connected** | The V2 uses the real endpoint, but edge cases or tests are incomplete. |
| **Verified** | Real endpoint, permissions, failures, recovery, accessibility, and tests are covered. |

## Release rule

V2 may replace production only when:

1. Every P0 row is **Verified**.
2. Every P1 row is at least **Connected**, with no unresolved data-loss, privacy, authorization, payment-truth, or currency defect.
3. Light and dark themes pass contrast and interaction review at 320, 375, 390, and 430 px widths.
4. A migration review proves that no production route becomes unreachable.

## Verdict across the 19 audited areas

| # | Area | Source of truth | Production behavior that must survive | V2 status | Priority | Release verdict |
|---:|---|---|---|---|---|---|
| 1 | Authentication and onboarding | `backend/app/api/v1/auth.py`; `/login`, `/register`, `/verify`, `/forgot`, `/welcome`, `/phone` | Email/password and provider auth, verification/resend, password reset, profile completion, phone capture, authenticated session recovery | **Missing** | P0 | V2 has no complete entry or recovery journey. |
| 2 | Home and monthly plan | `frontend/src/app/app/page.tsx`; `backend/app/api/v1/analytics.py`; budgets API | Real safe-to-spend math, monthly progress, pace, actionable notices, review queue, recent activity, truthful shared-spend accounting | **Represented** | P0 | Visual hierarchy exists; demo figures and “Move $20” behavior are not authoritative production flows. |
| 3 | Receipt capture entry | `frontend/src/components/ScanSheet.tsx`; `frontend/src/lib/upload.ts`; receipts API | Camera, photo picker, files, HEIC/images/PDFs, up to 20 inputs, privacy copy, batch validation | **Connected** | P0 | The approved V2 controls now drive the production picker, validation, compression, batch limit, and upload queue without rendering the original scanner UI. Real-device camera/files and theme QA remain. |
| 4 | Scan processing and recovery | `backend/app/api/v1/receipts.py`; OCR services; `ScanSheet.test.tsx` | Background processing, polling, progress, duplicate/non-receipt/quality warnings, retry, manual fallback, close-and-return behavior | **Connected** | P0 | Production polling, refusal, duplicate, error, retry, and background state now render through V2 animation and result screens. Timeout/resume and browser-level visual QA remain. |
| 5 | Receipt review and editing | `/app/receipts/[id]`; receipt review API | Edit merchant/date/category/currency/totals; add, rename, reprice, and delete line items; reconcile subtotal/tax/tip; delete receipt; original image | **Connected** | P0 | A completed production scan now opens inside V2 with real extracted fields, line items and image. V2 saves corrections, retries extraction and deletes through production APIs. Conflict, unsaved-change, PDF, and browser-level theme/accessibility verification remain. |
| 6 | Manual expense | `frontend/src/components/AddExpenseSheet.tsx`; `POST /receipts/manual` | Cent-based amount entry, category/date, item details, budget preview, validation, save, optional split | **Represented** | P0 | Cent keypad behavior is demonstrated; real persistence, locale handling, failure, and post-save split handoff remain. |
| 7 | People and invitations | `PersonPicker.tsx`; `MemberInvite.tsx`; split/group APIs | Joined/not-on-Cotab/no-phone states, duplicate-name resolution, contact privacy, self-contact rejection, ownership rules, invite/join flow | **Missing** | P0 | Demo people are fixtures and do not expose the permission model. |
| 8 | Split creation | `/app/receipts/[id]/split`; split schemas/API; `splitParts.test.ts` | Even, exact, percent, shares, and itemized modes; payer selection; every-cent validation; owned receipt enforcement; replace/conflict behavior | **Represented** | P0 | Happy-path interaction exists, but validation, conflicts, permissions, and persistence are not connected. |
| 9 | Tabs and groups | `/app/tab`, `/app/groups`, `/app/groups/[id]`; splits API | Direct tabs reuse participant sets, group history, balances, split details, members, share/join link, netting, per-currency totals | **Represented** | P0 | Core concepts are visible; real group lifecycle and currency-safe ledger are absent. |
| 10 | Settlement and payment handoff | group detail UI; settlement API; `PayLinks.tsx`; pay-handle endpoints | Suggested settlements, external Venmo/PayPal/Cash App/Zelle handoff, cash/other, return-and-confirm, settlement history and undo | **Represented** | P0 | UI now states Cotab does not move money, but external app return, real settlement recording, idempotency, and undo need integration. |
| 11 | Reminders and sharing | `RemindSheet.tsx`; reminder/share/join APIs; `/share/[code]` | Remind only when debt exists, push availability, once-per-day protection, share fallback, privacy-stripped public view, join path | **Represented** | P0 | Share and reminder sheets are demos; rate limits, privacy, and delivery state are not verified. |
| 12 | Budgets | `/app/budgets`; budgets API; Tabby budget actions | Overall/category/merchant/item budgets; weekly/monthly/yearly periods; 80/100/120% thresholds; create/edit/delete; truthful available amount | **Represented** | P1 | V2 covers the primary controls visually, but not all scopes, periods, validation, or real mutation. |
| 13 | Insights and reports | `/app/insights`; analytics/insights/report endpoints; `SpendCharts.tsx` | Month selection, trend/category/merchant drill-down, shared-spend semantics, dismissible insights, empty/multi-currency states, exports/reports | **Represented** | P1 | Interactive month concept exists; values and drill-downs are not production-backed. |
| 14 | Activity and search | `/app/tab`; receipt list/facets/saved-view/bulk APIs; `FilterBar.tsx` | Mine/shared/all, query, merchant/category/status/date/amount filters, sorting, pagination, saved views, bulk operations | **Represented** | P1 | Search/filter UI exists locally; facets, pagination, saved views, bulk permissions, and failures are not wired. |
| 15 | Notifications and next actions | `NotificationsCard.tsx`; push API; insights/reminder logs | Permission setup, actionable notices, dedupe, read/dismiss behavior, deep links, push subscribe/unsubscribe and unsupported state | **Represented** | P1 | Notification surface is designed, but delivery, permission denial, dedupe, and deep links are not verified. |
| 16 | Profile, capture, and account controls | `/app/settings`; ApplePay/Forwarding/PayHandles components; capture/inbox/auth APIs | Personal details, pay handles, Apple Pay capture keys/taps, receipt forwarding address and approved senders, push, export, account deletion | **Represented** | P0 | Profile presentation exists; sensitive account and capture operations still need real APIs, confirmation, and error states. |
| 17 | Tabby chat safety and actions | `/app/tabby`; chat API; Tabby action services; `ChatDrawer.test.tsx`; evals | Grounded answers, one-question clarification, proposal → approval → execution, atomic rollback, expiry, cancellation, activity history, undo | **Represented** | P0 | Demo plan/approve/undo is local. The server action protocol, stream recovery, expiry, and rollback are not integrated. |
| 18 | Tabby rules, memory, and personality | `tabby_rules.py`; Tabby page; memory/profile action services; mascot assets | Max 20 rules, store/category matching, split/categorize actions, pause/delete, automatic run on new receipt, seven-day undo notice, memories, consistent mood selection | **Represented** | P1 | V2 has screens and mascot moods, but rule execution, failure isolation, memories, and consistent asset-state mapping are not connected. |
| 19 | Platform quality, security, and accessibility | API ownership checks; SQL safety; frontend/backend tests; theme styles | Server-scoped user identity, authorization, safe SQL cap, untrusted receipt handling, currency isolation, loading/offline/errors, focus/keyboard/screen reader, reduced motion, contrast | **Missing** | P0 | Visual testing alone cannot establish this. A11y, security boundaries, offline/retry, and responsive evidence are incomplete. |

### Current tally

- **Verified:** 0 / 19
- **Connected:** 3 / 19
- **Represented:** 13 / 19
- **Missing:** 3 / 19

This is intentionally strict. The count measures the new `/mobile-demo`, not the existing production UI. Existing production capabilities remain available in their current routes.

## Non-negotiable product rules

These rules must be encoded in the V2 implementation and covered by tests; they must not live only in copy or design notes.

### Money and payments

- Cotab records expenses, shares, and settlements; it does **not** move money.
- Venmo and Cash App handoff are USD-only unless the production integration is expanded deliberately.
- A payment is not marked paid merely because an external app opened. The user must return and confirm; the settlement write must be idempotent and undoable.
- Never combine balances from different currencies into one total.
- Shared spending uses the signed-in person’s share, including expenses paid by another person—not the full receipt total.

### Splits and people

- A purchase is split once, except that separate receipt items may be assigned across tabs.
- Changing the participant set is a replace operation and must be atomic.
- The payer must be a current member, item IDs must belong to the receipt, and every split mode must account for every cent.
- Only the appropriate owner/uploader may remove protected data.
- Contact details are private. Public share pages must not expose phone, email, or Zelle data.
- Joined, invited, no-phone, duplicate-name, and self-contact states require distinct UI.

### Tabby

- Any mutation follows **plan → approve → execute → result → undo**. Read-only answers do not require approval.
- Multi-step plans execute atomically; a failed step rolls back prior steps.
- Proposals expire after 30 minutes, and a newer pending proposal in the same chat cancels the older one.
- Tabby asks one focused clarification with two to four useful choices when a receipt, budget, person, item, payer, tab, or value is ambiguous.
- Tabby stays within Cotab money data, does not invent facts, does not expose internal IDs/tools, and does not provide legal, tax, or investment advice.
- Receipt text is untrusted input. It must never become an instruction to the assistant or backend.
- Tabby cannot move real money, change a password/email address, or delete an account.
- Automatic rules use the same validation and logging as chat actions. A rule failure must never block receipt creation.

### Scan and budgets

- A batch may contain up to 20 supported images or PDFs. Each file can succeed, warn, or fail independently.
- Closing processing does not cancel server work; the receipt remains discoverable in Activity/review queue.
- Duplicate, non-receipt, poor-quality, extraction failure, and partial-result states need explicit recovery.
- Budgets support overall, category, merchant, and item scopes; weekly, monthly, and yearly periods; and 80%, 100%, and 120% alert thresholds.

## Critical audit finding: phone identity

The current backend distinguishes invite/contact states, but a code comment indicates phone ownership is not yet fully proved by SMS before automatic matching/claiming. This is a **P0 identity and privacy blocker**. V2 must not visually imply that a phone number is verified until an actual verification challenge has succeeded.

**Status (deferred by decision):** Cotab stays private, so SMS codes are not built yet. The backend is ready for them: every place a number links to an account (claiming tabs, adding someone by number, lookup) goes through `invites.phone_trusted`, and `invites.phone_verified()` is the one hook the code check will call. `REQUIRE_PHONE_VERIFICATION` is off while private (any number links, as before) and must be turned on with SMS codes before a public launch. Changing a number already clears its proof.

Required resolution:

1. Store an explicit verification state and timestamp.
2. Require OTP proof before linking a phone identity or exposing joined-account behavior.
3. Keep unverified contacts as local/invited people with restricted visibility.
4. Add tests for reused numbers, changed numbers, duplicate contacts, and account deletion/re-registration.

## P0 implementation queue

| Order | Deliverable | Definition of done |
|---:|---|---|
| 1 | Shared V2 authenticated shell | Real session, loading, unauthorized, expired-session, offline, navigation, deep-link, light/dark, safe-area, and reduced-motion states. |
| 2 | Real scan vertical slice | Real picker/upload → per-file validation → processing/polling → result/retry → receipt review; resumable after sheet close. |
| 3 | Real receipt editor | All receipt and line-item edits, original image, reconciliation warnings, validation, save/delete, and failure recovery. |
| 4 | Real split vertical slice | Person states, all five split modes, payer, preview, validation, persistence, conflict replacement, and post-save tab navigation. |
| 5 | Real tab/settlement loop | Balances by currency, external handoff, explicit confirm, settlement history, undo, reminders, share/join privacy. |
| 6 | Tabby action protocol | Streaming chat, clarification, proposal expiry/cancel, approval, atomic execution, result, activity log, and undo against backend. |
| 7 | Phone identity correction | OTP-backed verification and safe contact matching before a public launch. Deferred while private; the trust rule, hook and switch are in place (see above). |
| 8 | Profile/account completion | Capture keys, forwarding/senders, pay handles, push, export, delete, and sensitive-action confirmations. |
| 9 | Quality release pass | Unit/integration/e2e, backend authorization tests, axe/keyboard review, theme contrast, responsive screenshots, and no lost production route. |

## Proof required for each row

Each area moves to **Verified** only when its implementation ticket contains:

- links to the frontend route/component and backend endpoint/service;
- automated happy-path and failure-path tests;
- an authorization/ownership test for user data;
- an empty/loading/error/retry proof;
- light and dark screenshots at mobile widths;
- keyboard, focus, screen-reader naming, and reduced-motion evidence where applicable;
- an explicit note for currency behavior, destructive actions, and undo/recovery.

## Recommended shipping approach

Do not rewrite all 19 areas at once and do not delete the production UI. Build V2 behind a feature flag, one real vertical slice at a time. Start with receipt capture through review because it exercises the design system, uploads, background work, Tabby feedback, errors, and navigation without touching settlement identity. Next complete splitting and tabs, then Tabby actions. Run both UIs against the same APIs until all P0 rows are verified.

The visual direction can be approved independently. The product replacement cannot.
