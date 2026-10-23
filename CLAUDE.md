# Cotab: notes for Claude Code

Cotab is a receipt and spending app with a mascot, **Tabby** (a cat in a green
hoodie). People scan receipts, set budgets, split bills with friends, and ask
Tabby to do things for them. Live at https://www.cotab.center.

## How it's built
- `backend/`: FastAPI + SQLAlchemy + Alembic, Python 3.13. Deployed on Render
  (`render.yaml`; start command runs `alembic upgrade head`). Postgres in prod,
  SQLite in tests. AI is Google Gemini (`GEMINI_API_KEY`, model in settings).
  Email via Resend (`EMAIL_FROM`, domain cotab.center).
- `frontend/`: Next.js 14 (app router) + Tailwind, deployed on Vercel.
  Design tokens in `tailwind.config` (forest, gold/citron, paper, ink…),
  font Manrope, icons Material Symbols Rounded via the `Icon` component.
- Tabby art: `frontend/public/cat/{mood}.webp` and `{mood}-head.webp`; outfits
  prefixed `hp-` (headphones) and `bn-` (beanie); `duo-*.webp` two-cat scenes.
  Moods are listed in `src/lib/tabby.ts` and `backend/app/schemas/auth.py`.

## Tabby the agent (backend/app/services)
- `tabby_agent.py`: every change is an `Action(prepare, execute, undo)`.
  A chat turn prepares steps into one **plan**; the person approves once; steps
  run in order, are logged in `tabby_activity`, and one Undo reverses the run.
- Actions live in `tabby_actions.py` (split, settle), `tabby_receipt_actions.py`,
  `tabby_budget_actions.py`, `tabby_tab_actions.py`, `tabby_profile_actions.py`,
  `tabby_memory.py` (remember/forget, run at once), `tabby_rules.py` (standing
  rules run on new receipts), `tabby_outside.py` (push reminder, CSV export).
- `chat_service.py` runs the turn; `chat_ai.py` has the prompt and tool
  declarations. When prepare isn't sure it returns `needs_clarification` with
  options, which show as tappable chips.
- A purchase is only ever split once (redo = remove_split + split_purchase).
- Report card: `backend/evals/` (52 real requests) run on the real model by the
  "Tabby report card" GitHub workflow (needs the `GEMINI_API_KEY` secret).

## Working rules
- Work on a branch and open a PR; the owner reviews and merges. Never push to main.
- Before a PR, run:
  - backend: `black --check app/ alembic/ tests/`, `isort --check-only app/ alembic/ tests/`,
    `ruff check app/ tests/ --select E4,E7,E9,F`, `pytest -q`
  - frontend: `npx prettier --check src tests`, `npm run lint`, `npx tsc --noEmit`,
    `npx vitest run`, `npm run build`, `npx playwright test --project=chromium`
- New tables need an Alembic migration in `backend/alembic/versions/`.
- Never put API keys in code or chat; they live in Render / GitHub secrets.
- Copy in the app is plain, friendly, sentence case; Tabby speaks in short lines.

## What's done recently
Tabby agent (plans, undo, memory, rules, nudges, wrap-up, export), forgot
password (PR #24), friend reminders by push notification + installable app
(PR #25), no double splits, report card 50/52 on the real model.

## Ideas for next
- Subscriptions radar: spot repeat charges and warn before renewal.
- Tabby can't yet: retry a failed scan, toggle digests/budget alerts, manage
  the email-forwarding inbox, pause a budget.
- Push notifications for the owner too (rule ran, friend paid you).
- Gemini key is on the free tier; turn on billing before real traffic.
