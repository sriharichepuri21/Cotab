"""Tabby's report card: real requests, sent to the real AI.

Each request in tabby_requests.json runs against a fresh, made-up account
(receipts at Costco, Trader Joe's, Target, Uber...; friends Ben, Priya and two
Sams; a few budgets and tabs). The AI's reply is checked for the right
outcome: the right steps in the plan, a question when something is unclear,
or no changes at all for questions and things Tabby must not do.

Nothing is ever approved, so nothing is changed; it only grades the plans.

    GEMINI_API_KEY=... python -m evals.run_tabby_evals            # everything
    GEMINI_API_KEY=... python -m evals.run_tabby_evals split-     # ids starting so

Needs a Gemini key; without one it explains and exits cleanly. Writes a
summary table (and to $GITHUB_STEP_SUMMARY on GitHub) and fails if the score
is under TABBY_EVAL_MIN (default 0.8).
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, List

os.environ.setdefault("DATABASE_URL", "sqlite://")

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.config.settings import get_settings  # noqa: E402
from app.db.session import Base  # noqa: E402
from app.models import (  # noqa: E402
    Budget,
    ChatActionProposal,
    Receipt,
    TabbyRule,
    User,
)
from app.services import (  # noqa: E402
    ai_client,
    ai_usage,
    chat_service,
    price_memory,
    split_service,
    tabby_agent,
)

HERE = Path(__file__).parent
NOW = datetime.now(timezone.utc)


def _line(desc: str, total: float):
    return SimpleNamespace(
        description=desc,
        quantity=1,
        unit_price=total,
        total_price=total,
        item_code=None,
        item_name=None,
        size=None,
    )


def seed(db) -> User:
    """A believable month for Ada."""
    ada = User(
        email="ada@example.com",
        hashed_password="x",
        full_name="Ada",
        email_verified=True,
        pay_handles='{"venmo": "ada-pays"}',
    )
    db.add(ada)
    db.commit()

    def receipt(store, days, lines, category="groceries", status="reviewed"):
        total = round(sum(p for _, p in lines), 2)
        r = Receipt(
            user_id=ada.id,
            merchant=store,
            total=total,
            subtotal=total,
            tax=0,
            currency="USD",
            category=category,
            status=status,
            confidence=0.9,
            purchased_at=NOW - timedelta(days=days, hours=2),
        )
        db.add(r)
        db.flush()
        for desc, price in lines:
            db.add(price_memory.make_line(r.id, ada.id, _line(desc, price)))
        db.commit()
        return r

    receipt(
        "Costco",
        0,
        [
            ("GOPI PANEER", 9.99),
            ("GOPI PANEER", 9.99),
            ("KS ORGANIC EGGS", 8.49),
            ("KS BANANAS", 1.99),
        ],
    )
    receipt("Costco", 9, [("KS WATER 40PK", 4.99), ("ROTISSERIE CHKN", 4.99)])
    receipt("Costco", 40, [("KS TP 30RL", 23.99)])
    receipt("Trader Joe's", 3, [("MANDARINS", 3.99), ("OAT MILK", 2.49)])
    receipt("Trader Joe's", 3, [("MANDARINS", 3.99), ("OAT MILK", 2.49)])
    receipt("Target", 5, [("DISH SOAP", 4.29), ("TOWELS", 12.00)], "shopping")
    receipt("Uber", 2, [("TRIP", 18.40)], "other")
    receipt("Nopa", 1, [("DINNER", 86.88)], "dining")
    receipt("Starbucks", 4, [("LATTE", 5.75)], "groceries")
    receipt("Starbucks", 11, [("LATTE", 5.75)], "groceries")
    receipt("Safeway", 6, [("MILK", 4.99)], "groceries", status="extracted")

    split_service.direct_tab(db, ada.id, "Ada", [("Ben", None)])
    split_service.direct_tab(db, ada.id, "Ada", [("Sam Lee", None)])
    split_service.direct_tab(db, ada.id, "Ada", [("Sam Ortiz", None)])
    flat = tabby_agent.Plan()
    tabby_agent.prepare(
        "create_group",
        db,
        ada.id,
        {"name": "Flat 4B", "people": ["Ben", "Priya"]},
        flat,
    )
    tabby_agent.run(db, ada.id, flat.steps)
    # Ben owes Ada for an older Costco trip; Sam Lee owes for Nopa.
    older = (
        db.query(Receipt)
        .filter_by(merchant="Costco")
        .order_by(Receipt.purchased_at)
        .first()
    )
    for who, rid in (("Ben", older.id),):
        plan = tabby_agent.Plan()
        tabby_agent.prepare(
            "split_purchase", db, ada.id, {"receipt_id": rid, "people": [who]}, plan
        )
        tabby_agent.run(db, ada.id, plan.steps)
    lunch = receipt("Burma Love", 14, [("LUNCH", 30.00)], "dining")
    plan = tabby_agent.Plan()
    tabby_agent.prepare(
        "split_purchase",
        db,
        ada.id,
        {"receipt_id": lunch.id, "people": ["Sam Lee"]},
        plan,
    )
    tabby_agent.run(db, ada.id, plan.steps)

    for level, target, period, amount in (
        ("category", "groceries", "monthly", 400),
        ("category", "dining", "monthly", 200),
        ("category", "dining", "weekly", 60),
        ("item", "coffee", "monthly", 50),
        ("total", "", "monthly", 2000),
    ):
        db.add(
            Budget(
                user_id=ada.id, level=level, target=target, period=period, amount=amount
            )
        )
    db.add(
        TabbyRule(
            user_id=ada.id,
            summary="From now on, put every Lyft receipt in transport.",
            store="Lyft",
            action="categorize",
            params='{"category": "transport"}',
        )
    )
    db.commit()
    return ada


class _Errors(logging.Handler):
    """Keeps what went wrong inside a turn (the chat swallows AI errors and
    answers politely), so the report card can say why a request failed."""

    def __init__(self) -> None:
        super().__init__(level=logging.WARNING)
        self.seen: List[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        text = record.getMessage()
        if text.startswith("Couldn't record AI usage"):
            return  # bookkeeping, not Tabby
        if record.exc_info and record.exc_info[1] is not None:
            text += f" ({record.exc_info[1]!r})"
        self.seen.append(text[:300])


ERRORS = _Errors()
logging.getLogger("app").addHandler(ERRORS)


def _annotate(kind: str, title: str, text: str) -> None:
    """A GitHub annotation: shows on the run's page and through its API."""
    if os.environ.get("GITHUB_ACTIONS"):
        clean = text.replace("%", "%25").replace("\r", "").replace("\n", "%0A")
        print(f"::{kind} title={title}::{clean}")


def run_case(case: Dict[str, Any]) -> Dict[str, Any]:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    ada = seed(db)
    session_id = None
    events: List[Dict[str, Any]] = []
    for message in case["say"]:
        if message.startswith("{choice:"):
            index = int(message[8:-1])
            options = next(
                (e["options"] for e in reversed(events) if e["type"] == "choices"), []
            )
            message = options[index] if index < len(options) else "Just one"
        turn = chat_service.prepare_turn(
            db, db, ada.id, message, session_id, {"page": "/app"}
        )
        session_id = turn.session_id
        events = list(chat_service.run_turn(turn))
    text = "".join(e["text"] for e in events if e["type"] == "delta").strip()
    proposal = next((e["proposal"] for e in events if e["type"] == "proposal"), None)
    steps = []
    if proposal:
        row = db.get(ChatActionProposal, proposal["id"])
        steps = (
            json.loads(row.payload).get("steps", []) if row.tool_name == "plan" else []
        )
    actions = [s["action"] for s in steps]
    choices = next((e["options"] for e in events if e["type"] == "choices"), [])
    now = [
        e["summary"].split(":")[0].lower() for e in events if e["type"] == "done_now"
    ]
    links = [
        link["href"] for e in events if e["type"] == "links" for link in e["links"]
    ]
    asked = bool(choices) or (not steps and text.rstrip().endswith("?"))
    got = {
        "text": text,
        "actions": actions,
        "steps": steps,
        "asked": asked,
        "choices": choices,
        "now": now,
        "links": links,
    }
    db.close()
    return got


def grade(expect: Dict[str, Any], got: Dict[str, Any]) -> List[str]:
    """Problems with the reply; empty means it passed."""
    problems = []
    actions = Counter(got["actions"])
    if "plan" in expect and actions != Counter(expect["plan"]):
        problems.append(f"plan {sorted(actions.elements())} != {expect['plan']}")
    if "plan_any" in expect and not any(
        actions == Counter(option) for option in expect["plan_any"]
    ):
        if not (expect.get("or_now") and expect["or_now"] in got["now"]):
            problems.append(
                f"plan {sorted(actions.elements())} not in {expect['plan_any']}"
            )
    if "plan_min" in expect:
        for name, count in expect["plan_min"].items():
            if actions[name] < count:
                problems.append(f"wanted {count}+ {name}, got {actions[name]}")
    if "plan_or_ask" in expect:
        wanted = Counter(expect["plan_or_ask"])
        if not got["asked"] and not all(actions[a] >= n for a, n in wanted.items()):
            problems.append(f"neither asked nor planned {expect['plan_or_ask']}")
    if expect.get("ask") and not got["asked"]:
        problems.append("should have asked first")
    if expect.get("ask") and got["actions"]:
        problems.append(f"planned {got['actions']} instead of asking")
    if expect.get("no_plan") and got["actions"]:
        problems.append(f"should change nothing, planned {got['actions']}")
    if "now" in expect and expect["now"] not in got["now"]:
        problems.append(f"didn't {expect['now']}")
    if "link" in expect and not any(expect["link"] in href for href in got["links"]):
        problems.append(f"no button to {expect['link']}")
    if "item_ids" in expect:
        split = next((s for s in got["steps"] if s["action"] == "split_purchase"), None)
        if split and len(split["step"].get("item_ids") or []) != expect["item_ids"]:
            problems.append(f"split {len(split['step'].get('item_ids') or [])} items")
    for name, wanted in (expect.get("args") or {}).items():
        step = next((s for s in got["steps"] if s["action"] == name), None)
        if step is None:
            continue
        blob = json.dumps(step["step"]).lower() + " " + step["summary"].lower()
        for key, value in wanted.items():
            if str(value).lower() not in blob:
                problems.append(f"{name}.{key} should mention {value}")
    if expect.get("no_error") and not got["text"]:
        problems.append("no reply")
    if not got["text"]:
        problems.append("empty reply")
    return problems


class QuotaExhausted(Exception):
    pass


# Set once the quota waits pass their budget; the run stops after that case.
OUT_OF_QUOTA: List[str] = []


def _pace_the_model() -> None:
    """Keep under the key's requests-per-minute limit, and wait and retry when
    Gemini says the quota is used up (free keys allow only a few a minute).

    The waits share one budget (TABBY_EVAL_MAX_QUOTA_WAIT seconds). A key out
    of quota for the day would otherwise sleep until the job's time limit and
    be cancelled with nothing to show."""
    real = ai_client.stream
    gap = float(os.environ.get("TABBY_EVAL_PACE", "6"))
    budget = [float(os.environ.get("TABBY_EVAL_MAX_QUOTA_WAIT", "600"))]
    last = [0.0]

    def paced(*args, **kwargs):
        if OUT_OF_QUOTA:
            raise QuotaExhausted(OUT_OF_QUOTA[0])
        for attempt in range(5):
            wait = gap - (time.time() - last[0])
            if wait > 0:
                time.sleep(wait)
            last[0] = time.time()
            try:
                yield from real(*args, **kwargs)
                return
            except Exception as exc:
                if attempt < 4 and ai_client.is_quota_error(exc):
                    pause = 30 * (attempt + 1)
                    if pause > budget[0]:
                        OUT_OF_QUOTA.append(
                            "Gemini kept saying the quota is used up; "
                            "stopped waiting. Try again later."
                        )
                        raise QuotaExhausted(OUT_OF_QUOTA[0]) from exc
                    budget[0] -= pause
                    print(f"  quota hit, waiting {pause}s", flush=True)
                    time.sleep(pause)
                    continue
                raise

    ai_client.stream = paced


def main() -> int:
    settings = get_settings()
    if not settings.gemini_api_key:
        print("No GEMINI_API_KEY set, so Tabby's report card can't run. Skipping.")
        return 0
    # The eval account isn't limited like a real person.
    chat_service._check_rate_limit = lambda _user: None
    ai_usage.check = lambda *a, **k: None
    ai_usage.record = lambda *a, **k: None
    _pace_the_model()
    prefix = sys.argv[1] if len(sys.argv) > 1 else ""
    cases = [
        c
        for c in json.loads((HERE / "tabby_requests.json").read_text())
        if c["id"].startswith(prefix)
    ]
    rows, passed = [], 0
    for case in cases:
        started = time.time()
        ERRORS.seen.clear()
        try:
            got = run_case(case)
            problems = grade(case["expect"], got)
            if ERRORS.seen:
                problems.append("error: " + ERRORS.seen[0])
        except Exception as exc:  # a crash is a failure, not the end of the run
            got, problems = {"text": "", "actions": []}, [f"crashed: {exc!r}"]
        ok = not problems
        passed += ok
        rows.append(
            {
                "id": case["id"],
                "ok": ok,
                "say": case["say"][-1],
                "problems": problems,
                "actions": got.get("actions"),
                "reply": got.get("text", "")[:240],
                "seconds": round(time.time() - started, 1),
            }
        )
        print(
            f"{'PASS' if ok else 'FAIL'}  {case['id']:<28} {'; '.join(problems)}",
            flush=True,
        )
        if OUT_OF_QUOTA:
            break
    if OUT_OF_QUOTA:
        print(f"\n{OUT_OF_QUOTA[0]} ({len(rows)}/{len(cases)} requests ran)")
        (HERE / "results.json").write_text(json.dumps(rows, indent=2))
        _annotate("error", "Gemini quota", OUT_OF_QUOTA[0])
        return 1
    score = passed / len(cases) if cases else 1.0
    print(f"\n{passed}/{len(cases)} passed ({score:.0%}) on {settings.gemini_model}")

    (HERE / "results.json").write_text(json.dumps(rows, indent=2))
    failed = [r for r in rows if not r["ok"]]
    _annotate(
        "notice",
        "Tabby report card",
        f"{passed}/{len(cases)} passed ({score:.0%}) on {settings.gemini_model}",
    )
    # GitHub shows up to 10 errors per step: the first failures, one line each.
    for row in failed[:9]:
        _annotate(
            "error",
            row["id"],
            f"{row['say']} -> {'; '.join(row['problems'])} | actions={row['actions']} "
            f"| reply={row['reply'][:160]}",
        )
    if len(failed) > 9:
        _annotate(
            "error",
            "more failures",
            "; ".join(
                f"{r['id']}: {'; '.join(r['problems'])[:80]}" for r in failed[9:]
            ),
        )
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as out:
            out.write(
                f"## Tabby's report card: {passed}/{len(cases)} ({score:.0%})\n\n"
            )
            out.write(
                f"Model: `{settings.gemini_model}`\n\n| | Request | Problem |\n|---|---|---|\n"
            )
            for row in rows:
                out.write(
                    f"| {'✅' if row['ok'] else '❌'} | {row['say']} | "
                    f"{'; '.join(row['problems']) or ''} |\n"
                )
    minimum = float(os.environ.get("TABBY_EVAL_MIN", "0.8"))
    return 0 if score >= minimum else 1


if __name__ == "__main__":
    sys.exit(main())
