"""Tabby as an agent: several steps in one plan, one approval, every change
logged, and the whole task undone with one tap."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.api.v1.chat import confirm_proposal
from app.api.v1.tabby import activity as activity_api
from app.api.v1.tabby import undo as undo_api
from app.models import (
    Budget,
    ChatActionProposal,
    ChatSession,
    Receipt,
    ReceiptSplit,
    Settlement,
    SplitGroup,
    TabbyActivity,
    User,
)
from app.services import chat_service, price_memory, split_service, tabby_agent
from app.services.tabby_agent import Plan
from tests import fake_gemini

NOW = datetime.now(timezone.utc)


@pytest.fixture(autouse=True)
def _settings(monkeypatch):
    monkeypatch.setattr(chat_service.settings, "gemini_model", "gemini-3.5-flash-lite")
    monkeypatch.setattr(chat_service, "_check_rate_limit", lambda _u: None)


def _line(desc, total, name=None):
    return SimpleNamespace(
        description=desc,
        quantity=1,
        unit_price=total,
        total_price=total,
        item_code=None,
        item_name=name,
        size=None,
    )


def _receipt(db, user, days_ago, lines, merchant="Costco", category="groceries"):
    subtotal = round(sum(li.total_price for li in lines), 2)
    receipt = Receipt(
        user_id=user.id,
        merchant=merchant,
        total=subtotal,
        subtotal=subtotal,
        tax=0,
        currency="USD",
        category=category,
        status="extracted",
        confidence=0.9,
        purchased_at=NOW - timedelta(days=days_ago),
    )
    db.add(receipt)
    db.flush()
    for li in lines:
        db.add(price_memory.make_line(receipt.id, user.id, li))
    db.commit()
    db.refresh(receipt)
    return receipt


@pytest.fixture()
def trips(db_session, user):
    user.full_name = "Ada"
    db_session.commit()
    one = _receipt(db_session, user, 3, [_line("EGGS", 6.00), _line("MILK", 4.00)])
    two = _receipt(db_session, user, 1, [_line("PANEER", 9.99, "Gopi paneer")])
    target = _receipt(db_session, user, 2, [_line("SOAP", 12.00)], "Target", "shopping")
    return one, two, target


def _plan(db, user, *calls):
    """Prepare actions the way a chat turn does, into one plan."""
    plan = Plan()
    for name, args in calls:
        out = tabby_agent.prepare(name, db, user.id, args, plan)
        assert out["status"] == "added_to_plan", out
    return plan


def _approve(db, user, plan):
    session = ChatSession(user_id=user.id)
    db.add(session)
    db.commit()
    proposal = chat_service.save_plan(db, user.id, session.id, plan)
    return confirm_proposal(proposal.id, db, user)


def _live_splits(db):
    return db.query(ReceiptSplit).filter(ReceiptSplit.deleted_at.is_(None)).count()


# ---------- plans ----------


def test_several_splits_are_one_plan_one_approval_one_undo(db_session, user, trips):
    one, two, _ = trips
    plan = _plan(
        db_session,
        user,
        ("split_purchase", {"receipt_id": one.id, "people": ["Ben"]}),
        ("split_purchase", {"receipt_id": two.id, "people": ["Ben"]}),
    )
    assert len(plan.steps) == 2
    assert _live_splits(db_session) == 0

    out = _approve(db_session, user, plan)
    assert out["status"] == "executed"
    assert len(out["result"]["steps"]) == 2 and out["result"]["undoable"]
    assert _live_splits(db_session) == 2
    tabs = db_session.query(SplitGroup).filter(SplitGroup.deleted_at.is_(None)).all()
    assert [t.name for t in tabs] == ["You & Ben"]

    history = activity_api(db_session, user)
    assert history[0]["run_id"] == out["result"]["run_id"]
    assert len(history[0]["steps"]) == 2 and history[0]["undoable"]

    undo_api(out["result"]["run_id"], db_session, user)
    assert _live_splits(db_session) == 0
    # The friend tab the plan made is gone again too.
    assert (
        db_session.query(SplitGroup).filter(SplitGroup.deleted_at.is_(None)).count()
        == 0
    )
    assert activity_api(db_session, user)[0]["status"] == "undone"


def test_the_same_receipt_twice_in_one_plan_is_questioned(db_session, user, trips):
    one, _, _ = trips
    plan = _plan(
        db_session, user, ("split_purchase", {"receipt_id": one.id, "people": ["Ben"]})
    )
    again = tabby_agent.prepare(
        "split_purchase",
        db_session,
        user.id,
        {"receipt_id": one.id, "people": ["Ben"]},
        plan,
    )
    assert again["status"] == "needs_clarification"


def test_make_a_group_then_split_on_it_in_one_plan(db_session, user, trips):
    one, _, _ = trips
    plan = _plan(
        db_session,
        user,
        ("create_group", {"name": "Tahoe trip", "people": ["Ben", "Sam"]}),
        (
            "split_purchase",
            {"receipt_id": one.id, "people": ["Ben", "Sam"], "group": "Tahoe trip"},
        ),
    )
    assert (
        plan.steps[0]["summary"] == "Make a group called Tahoe trip with Ben and Sam."
    )
    out = _approve(db_session, user, plan)
    group = db_session.query(SplitGroup).filter_by(name="Tahoe trip").one()
    split = db_session.query(ReceiptSplit).one()
    assert split.group_id == group.id
    summary = split_service.group_summary(db_session, group.id)
    assert sorted(r["amount"] for r in summary["suggested_settlements"]) == [3.33, 3.33]

    undo_api(out["result"]["run_id"], db_session, user)
    assert db_session.get(SplitGroup, group.id).deleted_at is not None


def test_redo_a_split_differently(db_session, user, trips):
    _, two, _ = trips
    first = _plan(
        db_session, user, ("split_purchase", {"receipt_id": two.id, "people": ["Ben"]})
    )
    _approve(db_session, user, first)
    plan = _plan(
        db_session,
        user,
        ("remove_split", {"receipt_id": two.id, "person": "Ben"}),
        ("split_purchase", {"receipt_id": two.id, "people": ["Ben"], "paid_by": "Ben"}),
    )
    _approve(db_session, user, plan)
    live = (
        db_session.query(ReceiptSplit).filter(ReceiptSplit.deleted_at.is_(None)).all()
    )
    assert len(live) == 1
    summary = split_service.group_summary(db_session, live[0].group_id)
    row = summary["suggested_settlements"][0]
    assert (row["from"], row["to"]) == ("Ada", "Ben")


def test_a_failing_step_undoes_the_ones_before_it(db_session, user, trips):
    one, two, _ = trips
    plan = _plan(
        db_session,
        user,
        ("split_purchase", {"receipt_id": one.id, "people": ["Ben"]}),
        ("edit_receipt", {"receipt_id": two.id, "total": 12.5}),
    )
    # The receipt goes away between the plan and the approval.
    two.deleted_at = NOW
    db_session.commit()
    session = ChatSession(user_id=user.id)
    db_session.add(session)
    db_session.commit()
    proposal = chat_service.save_plan(db_session, user.id, session.id, plan)
    with pytest.raises(Exception) as problem:
        confirm_proposal(proposal.id, db_session, user)
    assert "Nothing was changed" in str(problem.value.detail)
    assert _live_splits(db_session) == 0
    assert db_session.get(ChatActionProposal, proposal.id).status == "pending"


# ---------- receipts ----------


def test_fix_a_receipt_and_undo(db_session, user, trips):
    one, _, _ = trips
    plan = _plan(
        db_session,
        user,
        (
            "edit_receipt",
            {"receipt_id": one.id, "store": "Costco Wholesale", "total": 11.0},
        ),
    )
    assert "store to Costco Wholesale, total to $11.00" in plan.steps[0]["summary"]
    out = _approve(db_session, user, plan)
    db_session.refresh(one)
    assert (one.merchant, one.total) == ("Costco Wholesale", 11.0)
    undo_api(out["result"]["run_id"], db_session, user)
    db_session.refresh(one)
    assert (one.merchant, one.total) == ("Costco", 10.0)


def test_fix_an_item(db_session, user, trips):
    one, _, _ = trips
    eggs = next(li for li in one.line_items if li.description == "EGGS")
    plan = _plan(
        db_session,
        user,
        (
            "edit_item",
            {
                "receipt_id": one.id,
                "line_id": eggs.id,
                "name": "Eggs 18ct",
                "price": 6.5,
            },
        ),
    )
    _approve(db_session, user, plan)
    db_session.refresh(eggs)
    assert (eggs.item_name, eggs.total_price, eggs.unit_price) == (
        "Eggs 18ct",
        6.5,
        6.5,
    )


def test_an_unknown_category_is_asked_about(db_session, user, trips):
    one, _, _ = trips
    out = tabby_agent.prepare(
        "edit_receipt",
        db_session,
        user.id,
        {"receipt_id": one.id, "category": "spaceships"},
        Plan(),
    )
    assert out["status"] == "needs_clarification" and out["data"]["options"]


def test_move_several_purchases_and_undo(db_session, user, trips):
    one, two, target = trips
    plan = _plan(
        db_session,
        user,
        ("recategorize", {"receipt_ids": [one.id, target.id], "category": "dining"}),
    )
    out = _approve(db_session, user, plan)
    assert {db_session.get(Receipt, i).category for i in (one.id, target.id)} == {
        "dining"
    }
    undo_api(out["result"]["run_id"], db_session, user)
    assert db_session.get(Receipt, target.id).category == "shopping"
    assert db_session.get(Receipt, one.id).category == "groceries"


def test_delete_a_split_receipt_and_bring_it_back(db_session, user, trips):
    one, _, _ = trips
    _approve(
        db_session,
        user,
        _plan(
            db_session,
            user,
            ("split_purchase", {"receipt_id": one.id, "people": ["Ben"]}),
        ),
    )
    plan = _plan(db_session, user, ("delete_receipt", {"receipt_id": one.id}))
    assert plan.steps[0]["summary"].endswith("and take it off You & Ben.")
    out = _approve(db_session, user, plan)
    assert db_session.get(Receipt, one.id).deleted_at is not None
    assert _live_splits(db_session) == 0
    undo_api(out["result"]["run_id"], db_session, user)
    assert db_session.get(Receipt, one.id).deleted_at is None
    assert _live_splits(db_session) == 1


def test_receipts_to_check_then_mark_them_checked(db_session, user, trips):
    one, two, target = trips
    one.total = 99.0  # doesn't match its items
    db_session.commit()
    found = chat_service._call_tool("receipts_to_check", {}, db_session, user.id)
    issues = {r["receipt_id"]: r["issues"] for r in found["data"]["receipts"]}
    assert any("total says $99.00" in i for i in issues[one.id])
    plan = _plan(
        db_session, user, ("mark_checked", {"receipt_ids": [one.id, two.id, target.id]})
    )
    _approve(db_session, user, plan)
    assert {r.status for r in db_session.query(Receipt)} == {"reviewed"}


# ---------- budgets ----------


def test_raise_a_budget_and_undo(db_session, user):
    db_session.add(
        Budget(user_id=user.id, level="category", target="groceries", amount=400)
    )
    db_session.commit()
    plan = _plan(
        db_session, user, ("change_budget", {"budget": "groceries", "amount": 500})
    )
    assert plan.steps[0]["summary"] == (
        "Change your groceries budget from $400.00 to $500.00 (a month)."
    )
    out = _approve(db_session, user, plan)
    assert db_session.query(Budget).one().amount == 500
    undo_api(out["result"]["run_id"], db_session, user)
    assert db_session.query(Budget).one().amount == 400


def test_setting_an_existing_budget_says_it_changes_it(db_session, user):
    db_session.add(
        Budget(user_id=user.id, level="category", target="dining", amount=200)
    )
    db_session.commit()
    plan = _plan(
        db_session,
        user,
        ("add_budget", {"level": "category", "target": "dining", "amount": 350}),
    )
    assert plan.steps[0]["summary"].startswith("Change your dining budget from $200.00")
    out = _approve(db_session, user, plan)
    undo_api(out["result"]["run_id"], db_session, user)
    assert db_session.query(Budget).one().amount == 200


def test_which_budget_is_asked_when_unclear(db_session, user):
    for period in ("weekly", "monthly"):
        db_session.add(
            Budget(
                user_id=user.id,
                level="category",
                target="dining",
                period=period,
                amount=100,
            )
        )
    db_session.commit()
    out = tabby_agent.prepare(
        "remove_budget", db_session, user.id, {"budget": "dining"}, Plan()
    )
    assert out["status"] == "needs_clarification" and len(out["data"]["options"]) == 2


def test_remove_a_budget_and_bring_it_back(db_session, user):
    db_session.add(Budget(user_id=user.id, level="total", target="", amount=2000))
    db_session.commit()
    out = _approve(
        db_session,
        user,
        _plan(db_session, user, ("remove_budget", {"budget": "total"})),
    )
    assert db_session.query(Budget).one().deleted_at is not None
    undo_api(out["result"]["run_id"], db_session, user)
    assert db_session.query(Budget).one().deleted_at is None


# ---------- tabs ----------


def test_groups_add_people_rename_and_delete(db_session, user, trips):
    _approve(
        db_session,
        user,
        _plan(
            db_session, user, ("create_group", {"name": "Flat 4B", "people": ["Ben"]})
        ),
    )
    out = _approve(
        db_session,
        user,
        _plan(
            db_session,
            user,
            ("add_people", {"group": "flat 4b", "people": ["Priya", "Ben"]}),
            ("rename_group", {"group": "Flat 4B", "new_name": "Flat 5C"}),
        ),
    )
    group = db_session.query(SplitGroup).one()
    assert group.name == "Flat 5C"
    assert sorted(m.name for m in group.members if m.deleted_at is None) == [
        "Ada",
        "Ben",
        "Priya",
    ]
    undo_api(out["result"]["run_id"], db_session, user)
    db_session.refresh(group)
    assert group.name == "Flat 4B"
    assert sorted(m.name for m in group.members if m.deleted_at is None) == [
        "Ada",
        "Ben",
    ]
    gone = _approve(
        db_session,
        user,
        _plan(db_session, user, ("delete_group", {"group": "Flat 4B"})),
    )
    assert db_session.get(SplitGroup, group.id).deleted_at is not None
    undo_api(gone["result"]["run_id"], db_session, user)
    assert db_session.get(SplitGroup, group.id).deleted_at is None


def test_deleting_a_tab_with_money_owed_says_so(db_session, user, trips):
    one, _, _ = trips
    _approve(
        db_session,
        user,
        _plan(
            db_session,
            user,
            ("split_purchase", {"receipt_id": one.id, "people": ["Ben"]}),
        ),
    )
    plan = _plan(db_session, user, ("delete_group", {"group": "You & Ben"}))
    assert "Ben still owes Ada $5.00" in plan.steps[0]["summary"]


def test_remove_a_payment_and_put_it_back(db_session, user, trips):
    one, _, _ = trips
    _approve(
        db_session,
        user,
        _plan(
            db_session,
            user,
            ("split_purchase", {"receipt_id": one.id, "people": ["Ben"]}),
        ),
    )
    _approve(
        db_session, user, _plan(db_session, user, ("settle_up", {"person": "Ben"}))
    )
    plan = _plan(db_session, user, ("remove_payment", {"person": "ben"}))
    assert plan.steps[0]["summary"].startswith(
        "Remove the $5.00 payment from Ben to Ada"
    )
    out = _approve(db_session, user, plan)
    assert db_session.query(Settlement).one().deleted_at is not None
    undo_api(out["result"]["run_id"], db_session, user)
    assert db_session.query(Settlement).one().deleted_at is None


def test_balances_and_share_link(db_session, user, trips):
    one, _, _ = trips
    _approve(
        db_session,
        user,
        _plan(
            db_session,
            user,
            ("split_purchase", {"receipt_id": one.id, "people": ["Ben"]}),
        ),
    )
    owed = chat_service._call_tool("balances", {}, db_session, user.id)
    assert owed["data"]["people"] == [
        {"person": "Ben", "direction": "owes_you", "amount": 5.0}
    ]
    link = chat_service._call_tool("share_link", {"group": "ben"}, db_session, user.id)
    assert link["data"]["path"].startswith("/share/")


# ---------- settings ----------


def test_profile_and_pay_handles(db_session, user):
    user.full_name = "Ada"
    db_session.commit()
    out = _approve(
        db_session,
        user,
        _plan(
            db_session,
            user,
            ("update_profile", {"name": "Ada L", "tabby_outfit": "beanie"}),
            ("set_pay_handle", {"app": "venmo", "handle": "@ada-lovelace"}),
        ),
    )
    db_session.refresh(user)
    assert (user.full_name, user.avatar_look) == ("Ada L", "beanie")
    assert "ada-lovelace" in user.pay_handles
    undo_api(out["result"]["run_id"], db_session, user)
    db_session.refresh(user)
    assert user.full_name == "Ada" and user.avatar_look is None
    assert not user.pay_handles


def test_a_bad_pay_handle_is_asked_about(db_session, user):
    out = tabby_agent.prepare(
        "set_pay_handle", db_session, user.id, {"app": "venmo", "handle": "@x"}, Plan()
    )
    assert out["status"] == "needs_clarification"


# ---------- the whole conversation ----------


def _ask(db, user, message, session_id=None):
    turn = chat_service.prepare_turn(db, db, user.id, message, session_id, None)
    return turn, list(chat_service.run_turn(turn))


def test_a_multi_step_request_becomes_one_checklist(
    db_session, user, trips, monkeypatch
):
    one, two, _ = trips
    stream = fake_gemini.Stream(
        [fake_gemini.call("find_purchases", store="costco")],
        [
            fake_gemini.call("split_purchase", receipt_id=one.id, people=["Ben"]),
            fake_gemini.call("split_purchase", receipt_id=two.id, people=["Ben"]),
            fake_gemini.call(
                "add_budget", level="category", target="groceries", amount=400
            ),
            fake_gemini.call("open_page", page="budgets"),
        ],
        [fake_gemini.text("Here's the plan. Approve it below.")],
    )
    monkeypatch.setattr(chat_service.ai_client, "stream", stream)
    _, events = _ask(
        db_session,
        user,
        "Split my Costco trips with Ben and set a $400 grocery budget",
    )
    proposal = next(e for e in events if e["type"] == "proposal")["proposal"]
    assert proposal["tool_name"] == "plan" and len(proposal["steps"]) == 3
    assert (
        proposal["steps"][2] == "Set a $400.00 monthly budget for groceries spending."
    )
    links = next(e for e in events if e["type"] == "links")["links"]
    assert links == [{"label": "Budgets", "href": "/app/budgets"}]
    assert db_session.query(ChatActionProposal).count() == 1

    out = confirm_proposal(proposal["id"], db_session, user)
    assert len(out["result"]["steps"]) == 3
    assert db_session.query(TabbyActivity).count() == 3
    assert db_session.query(Budget).count() == 1


def test_open_page_refuses_other_sites(db_session, user):
    links = []
    out = chat_service._open_page({"path": "https://evil.example"}, links)
    assert out["status"] == "error" and links == []


def test_someone_elses_run_cannot_be_undone(db_session, user, trips):
    one, _, _ = trips
    out = _approve(
        db_session,
        user,
        _plan(db_session, user, ("edit_receipt", {"receipt_id": one.id, "total": 11})),
    )
    other = User(email="eve@example.com", hashed_password="x", email_verified=True)
    db_session.add(other)
    db_session.commit()
    with pytest.raises(Exception):
        undo_api(out["result"]["run_id"], db_session, other)
    db_session.refresh(one)
    assert one.total == 11


# ---------- a purchase is only split once ----------


def test_splitting_an_already_split_purchase_with_someone_else_asks(
    db_session, user, trips
):
    one, _, _ = trips
    _approve(
        db_session,
        user,
        _plan(
            db_session,
            user,
            ("split_purchase", {"receipt_id": one.id, "people": ["Dikshitha"]}),
        ),
    )
    again = tabby_agent.prepare(
        "split_purchase",
        db_session,
        user.id,
        {"receipt_id": one.id, "people": ["Sukeerthi"]},
        Plan(),
    )
    assert again["status"] == "needs_clarification"
    assert "count the same money twice" in again["hint"]
    assert again["data"]["options"] == [
        "Redo it with Dikshitha, Sukeerthi",
        "Keep it with Dikshitha only",
    ]


def test_adding_someone_redoes_the_split_in_one_plan(db_session, user, trips):
    one, _, _ = trips
    _approve(
        db_session,
        user,
        _plan(
            db_session,
            user,
            ("split_purchase", {"receipt_id": one.id, "people": ["Dikshitha"]}),
        ),
    )
    plan = _plan(
        db_session,
        user,
        ("remove_split", {"receipt_id": one.id, "person": "Dikshitha"}),
        (
            "split_purchase",
            {"receipt_id": one.id, "people": ["Dikshitha", "Sukeerthi"]},
        ),
    )
    assert "on You, Dikshitha & Sukeerthi" in plan.steps[1]["summary"]
    _approve(db_session, user, plan)
    live = (
        db_session.query(ReceiptSplit).filter(ReceiptSplit.deleted_at.is_(None)).all()
    )
    assert len(live) == 1
    owed = sorted(
        r["amount"]
        for r in split_service.group_summary(db_session, live[0].group_id)[
            "suggested_settlements"
        ]
    )
    assert owed == [3.33, 3.33]


def test_different_items_can_go_to_different_people(db_session, user, trips):
    one, _, _ = trips
    eggs = next(li.id for li in one.line_items if li.description == "EGGS")
    milk = next(li.id for li in one.line_items if li.description == "MILK")
    _approve(
        db_session,
        user,
        _plan(
            db_session,
            user,
            (
                "split_purchase",
                {"receipt_id": one.id, "people": ["Ben"], "item_ids": [eggs]},
            ),
        ),
    )
    out = tabby_agent.prepare(
        "split_purchase",
        db_session,
        user.id,
        {"receipt_id": one.id, "people": ["Sam"], "item_ids": [milk]},
        Plan(),
    )
    assert out["status"] == "added_to_plan"
    whole = tabby_agent.prepare(
        "split_purchase",
        db_session,
        user.id,
        {"receipt_id": one.id, "people": ["Sam"]},
        Plan(),
    )
    assert whole["status"] == "needs_clarification"


def test_a_newer_plan_replaces_the_older_one(db_session, user, trips):
    one, two, _ = trips
    session = ChatSession(user_id=user.id)
    db_session.add(session)
    db_session.commit()
    first = chat_service.save_plan(
        db_session,
        user.id,
        session.id,
        _plan(
            db_session,
            user,
            ("split_purchase", {"receipt_id": one.id, "people": ["Ben"]}),
        ),
    )
    chat_service.save_plan(
        db_session,
        user.id,
        session.id,
        _plan(
            db_session,
            user,
            ("split_purchase", {"receipt_id": two.id, "people": ["Ben"]}),
        ),
    )
    db_session.refresh(first)
    assert first.status == "cancelled"
    with pytest.raises(Exception):
        confirm_proposal(first.id, db_session, user)
