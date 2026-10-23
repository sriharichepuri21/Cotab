"""Tabby remembering things, running standing rules on new receipts, nudging
about money owed, the month wrap-up, emailing reminders and exporting."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.api.v1 import tabby as tabby_api
from app.api.v1.chat import confirm_proposal
from app.models import (
    ChatSession,
    Insight,
    Receipt,
    ReceiptSplit,
    TabbyMemory,
    TabbyRule,
)
from app.services import (
    chat_service,
    insight_service,
    price_memory,
    tabby_agent,
    tabby_nudges,
    tabby_outside,
    tabby_rules,
)
from app.services.tabby_agent import Plan
from tests import fake_gemini

NOW = datetime.now(timezone.utc)


@pytest.fixture(autouse=True)
def _settings(monkeypatch):
    monkeypatch.setattr(chat_service.settings, "gemini_model", "gemini-3.5-flash-lite")
    monkeypatch.setattr(chat_service, "_check_rate_limit", lambda _u: None)


@pytest.fixture()
def ada(db_session, user):
    user.full_name = "Ada"
    user.pay_handles = '{"venmo": "ada-pays"}'
    db_session.commit()
    return user


def _line(desc, total):
    return SimpleNamespace(
        description=desc,
        quantity=1,
        unit_price=total,
        total_price=total,
        item_code=None,
        item_name=None,
        size=None,
    )


def _receipt(db, user, merchant, lines, days_ago=0, category="groceries"):
    total = round(sum(li.total_price for li in lines), 2)
    receipt = Receipt(
        user_id=user.id,
        merchant=merchant,
        total=total,
        subtotal=total,
        tax=0,
        currency="USD",
        category=category,
        status="extracted",
        purchased_at=NOW - timedelta(days=days_ago),
    )
    db.add(receipt)
    db.flush()
    for li in lines:
        db.add(price_memory.make_line(receipt.id, user.id, li))
    db.commit()
    db.refresh(receipt)
    return receipt


def _approve(db, user, *calls):
    plan = Plan()
    for name, args in calls:
        out = tabby_agent.prepare(name, db, user.id, args, plan)
        assert out["status"] == "added_to_plan", out
    session = ChatSession(user_id=user.id)
    db.add(session)
    db.commit()
    proposal = chat_service.save_plan(db, user.id, session.id, plan)
    return confirm_proposal(proposal.id, db, user)


def _ask(db, user, message):
    turn = chat_service.prepare_turn(db, db, user.id, message, None, None)
    return turn, list(chat_service.run_turn(turn))


# ---------- memory ----------


def test_tabby_remembers_at_once_and_uses_it(db_session, ada, monkeypatch):
    stream = fake_gemini.Stream(
        [fake_gemini.call("remember", text="Ben is your roommate", kind="person")],
        [fake_gemini.text("Got it, I'll remember that.")],
    )
    monkeypatch.setattr(chat_service.ai_client, "stream", stream)
    turn, events = _ask(db_session, ada, "Remember Ben is my roommate")
    done = next(e for e in events if e["type"] == "done_now")
    assert done["summary"] == "Remember: Ben is your roommate"
    assert db_session.query(TabbyMemory).one().text == "Ben is your roommate"
    assert "Ben is your roommate" in chat_service._system_prompt(turn)

    tabby_api.undo(done["run_id"], db_session, ada)
    assert db_session.query(TabbyMemory).one().deleted_at is not None
    assert "Ben is your roommate" not in chat_service._system_prompt(turn)


def test_forget_and_the_memory_page(db_session, ada):
    tabby_api.add_memory(
        tabby_api.MemoryIn(text="TJ's means Trader Joe's"), db_session, ada
    )
    assert [m["text"] for m in tabby_api.list_memories(db_session, ada)] == [
        "TJ's means Trader Joe's"
    ]
    plan = Plan()
    out = tabby_agent.prepare("forget", db_session, ada.id, {"about": "tj"}, plan)
    assert out["status"] == "added_to_plan"
    tabby_agent.run(db_session, ada.id, plan.steps)
    assert tabby_api.list_memories(db_session, ada) == []


# ---------- standing rules ----------


def test_a_rule_splits_every_new_costco_receipt(db_session, ada):
    out = _approve(
        db_session,
        ada,
        ("create_rule", {"store": "Costco", "action": "split", "people": ["Ben"]}),
    )
    rule = db_session.query(TabbyRule).one()
    assert rule.summary == (
        "From now on, when a Costco receipt comes in, split it evenly with Ben and "
        "let you know."
    )
    costco = _receipt(db_session, ada, "COSTCO WHOLESALE", [_line("EGGS", 8.00)])
    target = _receipt(db_session, ada, "Target", [_line("SOAP", 5.00)])
    runs = tabby_rules.on_new_receipt(db_session, ada.id, costco)
    assert len(runs) == 1
    assert tabby_rules.on_new_receipt(db_session, ada.id, target) == []
    # Running again doesn't split it twice.
    assert tabby_rules.on_new_receipt(db_session, ada.id, costco) == []
    split = db_session.query(ReceiptSplit).one()
    assert split.receipt_id == costco.id
    note = db_session.query(Insight).filter_by(kind="tabby_rule").one()
    assert note.body.startswith("Tabby split your COSTCO WHOLESALE total ($8.00)")
    assert db_session.get(TabbyRule, rule.id).run_count == 1

    # One tap undoes what the rule did.
    tabby_api.undo(runs[0], db_session, ada)
    assert db_session.query(ReceiptSplit).one().deleted_at is not None
    # Undoing the rule itself stops it.
    tabby_api.undo(out["result"]["run_id"], db_session, ada)
    assert tabby_rules.rules(db_session, ada.id) == []


def test_an_item_rule_splits_only_that_item(db_session, ada):
    _approve(
        db_session,
        ada,
        (
            "create_rule",
            {"store": "costco", "action": "split", "people": ["Ben"], "item": "paneer"},
        ),
    )
    with_paneer = _receipt(
        db_session, ada, "Costco", [_line("GOPI PANEER", 9.99), _line("EGGS", 6.00)]
    )
    without = _receipt(db_session, ada, "Costco", [_line("EGGS", 6.00)])
    assert len(tabby_rules.on_new_receipt(db_session, ada.id, with_paneer)) == 1
    assert tabby_rules.on_new_receipt(db_session, ada.id, without) == []
    split = db_session.query(ReceiptSplit).one()
    assert split.mode == "itemized"


def test_a_category_rule_and_a_paused_rule(db_session, ada):
    _approve(
        db_session,
        ada,
        (
            "create_rule",
            {"store": "Uber", "action": "categorize", "to_category": "transport"},
        ),
    )
    ride = _receipt(
        db_session, ada, "Uber Trip", [_line("RIDE", 14.0)], category="other"
    )
    tabby_rules.on_new_receipt(db_session, ada.id, ride)
    assert db_session.get(Receipt, ride.id).category == "transport"

    rule = db_session.query(TabbyRule).one()
    tabby_api.update_rule(rule.id, tabby_api.RuleUpdate(active=False), db_session, ada)
    other = _receipt(
        db_session, ada, "Uber Eats", [_line("FOOD", 20.0)], category="dining"
    )
    assert tabby_rules.on_new_receipt(db_session, ada.id, other) == []


def test_a_rule_needs_a_store_or_category(db_session, ada):
    out = tabby_agent.prepare(
        "create_rule",
        db_session,
        ada.id,
        {"action": "split", "people": ["Ben"]},
        Plan(),
    )
    assert out["status"] == "needs_clarification"


# ---------- nudges and wrap-up ----------


def _old_split(db, ada, days):
    receipt = _receipt(db, ada, "Costco", [_line("EGGS", 40.0)], days_ago=days)
    _approve(db, ada, ("split_purchase", {"receipt_id": receipt.id, "people": ["Ben"]}))
    split = db.query(ReceiptSplit).one()
    split.created_at = NOW - timedelta(days=days)
    db.commit()


def test_tabby_nudges_about_money_owed_for_weeks(db_session, ada):
    _old_split(db_session, ada, 20)
    rows = tabby_nudges.owed(db_session, ada.id)
    assert rows[0]["person"] == "Ben" and rows[0]["amount"] == 20.0
    insight_service.compute_for_user(db_session, ada.id)
    nudge = db_session.query(Insight).filter_by(kind="owed").one()
    assert nudge.title == "Ben has owed you $20.00 for two weeks"
    assert "Remind Ben" in nudge.data


def test_no_nudge_for_fresh_or_tiny_debts(db_session, ada):
    _old_split(db_session, ada, 3)
    assert tabby_nudges.owed(db_session, ada.id) == []


def test_month_wrap_numbers(db_session, ada):
    last = (NOW.replace(day=1) - timedelta(days=1)).replace(day=10, hour=12)
    for store, amount in (("Costco", 50.0), ("Costco", 30.0), ("Cafe", 12.0)):
        r = _receipt(db_session, ada, store, [_line("X", amount)])
        r.purchased_at = last
    db_session.commit()
    wrap = tabby_api.month_wrap(last.strftime("%Y-%m"), db_session, ada)
    assert wrap["total"] == 92.0 and wrap["receipts"] == 3
    assert wrap["top_store"] == {"name": "Costco", "visits": 2}


# ---------- beyond the app ----------


def _ben_uses_cotab(db):
    """Ben joins the tab with his own account and turns notifications on."""
    from app.models import SplitMember, User
    from app.services import push_service

    ben = User(email="ben@example.com", hashed_password="x", full_name="Ben")
    db.add(ben)
    db.commit()
    member = db.query(SplitMember).filter_by(name="Ben").one()
    member.user_id = ben.id
    db.commit()
    push_service.subscribe(db, ben.id, "https://push.example/ben", "p", "a")
    return ben


def test_tabby_nudges_a_friend_with_a_notification(db_session, ada):
    from app.services import push_service

    _old_split(db_session, ada, 20)
    asked = tabby_agent.prepare(
        "send_reminder", db_session, ada.id, {"person": "Ben"}, Plan()
    )
    assert asked["status"] == "needs_clarification"
    assert "notifications" in asked["hint"] and "/share/" in asked["hint"]

    ben = _ben_uses_cotab(db_session)
    out = _approve(db_session, ada, ("send_reminder", {"person": "Ben"}))
    assert out["result"]["undoable"] is False
    note = push_service.sent[-1]
    assert note["user_id"] == ben.id and note["title"] == "Reminder from Ada"
    assert "You owe Ada $20.00 on your tab with Ada" in note["body"]
    assert note["url"].startswith("/app/groups/")
    again = tabby_agent.prepare(
        "send_reminder", db_session, ada.id, {"person": "Ben"}, Plan()
    )
    assert again["status"] == "needs_clarification" and "today" in again["hint"]


def test_export_a_month(db_session, ada):
    _receipt(
        db_session, ada, "=HYPERLINK(evil)", [_line("MILK", 4.0), _line("TEA", 3.0)]
    )
    month = NOW.strftime("%Y-%m")
    body = tabby_outside.month_csv(db_session, ada.id, month)
    lines = body.strip().splitlines()
    assert lines[0].startswith("Date,Store,Category,Item")
    assert len(lines) == 3 and "'=HYPERLINK(evil)" in lines[1]
    response = tabby_api.export(month, db_session, ada)
    assert response.media_type == "text/csv"


def test_export_button_in_chat(db_session, ada, monkeypatch):
    stream = fake_gemini.Stream(
        [fake_gemini.call("export_month", month="2026-10")],
        [fake_gemini.text("Here's October as a spreadsheet.")],
    )
    monkeypatch.setattr(chat_service.ai_client, "stream", stream)
    _, events = _ask(db_session, ada, "Export October")
    links = next(e for e in events if e["type"] == "links")["links"]
    assert links[0]["href"] == "/tabby/export?month=2026-10"
    assert links[0]["filename"] == "cotab-2026-10.csv"
